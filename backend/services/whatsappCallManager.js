/**
 * whatsappCallManager.js
 * Motor de Telefonía WebRTC para WhatsApp Calls.
 * Gestiona conexiones Peer-to-Peer mediante SDP con la API de Graph de Meta. Transcodifica audio Opus/PCM en tiempo real usando ffmpeg y node-datachannel para conectar llamadas de voz directamente con Gemini Live.
 */

const axios = require('axios');
const OpusScript = require('opusscript');

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

// Active calls: Map<callId, CallState>
const activeCalls = new Map();

function getIceServers(configIceServers) {
    const raw = configIceServers || 'stun:stun.l.google.com:19302';
    return raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

/**
 * Handle an incoming WhatsApp voice call.
 * Performs SDP exchange with Meta and bridges audio to Gemini.
 *
 * @param {object} params
 * @param {string} params.callId — WhatsApp call ID
 * @param {string} params.offerSdp — SDP offer from Meta
 * @param {string} params.phoneNumberId — WhatsApp Business phone number ID
 * @param {string} params.accessToken — Meta access token for this phone number
 * @param {string} params.iceServers — Custom ICE servers from database
 * @param {Function} params.onAudioFromWhatsApp — callback(pcmBuffer) with decoded audio from caller
 * @param {Function} params.onCallEnded — callback() when WebRTC disconnects
 * @returns {Promise<{ sendAudioToWhatsApp: Function }>}
 */
async function handleIncomingCall({ callId, offerSdp, phoneNumberId, accessToken, iceServers, onAudioFromWhatsApp, onCallEnded }) {
    let NodeDataChannel;
    try {
        NodeDataChannel = require('node-datachannel');
    } catch (e) {
        throw new Error('[WhatsAppCallManager] node-datachannel not installed or not compiled in this Node environment');
    }
    const { PeerConnection } = NodeDataChannel;

    const pc = new PeerConnection(`call-${callId}`, {
        iceServers: getIceServers(iceServers),
        enableMedia: true,
    });

    // Track call state (RTP state for outbound audio)
    const callState = {
        pc, callId, active: true, onCallEnded,
        outTrack: null,
        // Outbound RTP state for manual RTP header construction
        rtpSeq: 0,
        rtpTimestamp: 0,
        rtpSsrc: Math.floor(Math.random() * 0xFFFFFFFF),
        rtpPayloadType: 111, // Will be updated from inbound
        // Output buffer: accumulate Gemini PCM until we have enough for Opus frames
        outboundPcmBuffer: Buffer.alloc(0),
        outboundFramesSent: 0,
    };
    activeCalls.set(callId, callState);

    // Handle ICE state changes
    pc.onStateChange((state) => {
        console.log(`[WhatsAppCallManager] ICE state (${callId}): ${state}`);
        if ((state === 'disconnected' || state === 'failed' || state === 'closed') && callState.active) {
            callState.active = false;
            activeCalls.delete(callId);
            if (onCallEnded) onCallEnded();
        }
    });

    // Handle incoming audio track from WhatsApp caller
    pc.onTrack((track) => {
        console.log(`[WhatsAppCallManager] Audio track received (${callId}): ${track.direction()}`);

        let inboundPacketCount = 0;
        let decodeSuccessCount = 0;
        let decodeFailCount = 0;
        let totalPcmBytesSent = 0;

        // Periodic diagnostic every 5 seconds
        const diagInterval = setInterval(() => {
            if (!callState.active) { clearInterval(diagInterval); return; }
            console.log(`[DIAG ${callId.substring(0,20)}] RTP packets=${inboundPacketCount}, decodeOK=${decodeSuccessCount}, decodeFail=${decodeFailCount}, pcmBytesSent=${totalPcmBytesSent}`);
        }, 5000);

        // Receive RTP audio packets from WhatsApp
        track.onMessage((data) => {
            if (!callState.active) return;

            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

            // Filter out RTCP packets (byte 1 >= 200 means RTCP, not RTP)
            if (buf[1] >= 200 && buf[1] <= 209) {
                return; // Skip RTCP
            }

            // RTP packets need at least 12-byte header + 1 byte payload
            if (buf.length < 13) return;

            // Parse RTP header to extract Opus payload
            const cc = buf[0] & 0x0F;
            const hasExtension = (buf[0] >> 4) & 0x01;
            let headerLen = 12 + (cc * 4);

            if (hasExtension && buf.length > headerLen + 4) {
                const extLen = buf.readUInt16BE(headerLen + 2);
                headerLen += 4 + (extLen * 4);
            }

            if (headerLen >= buf.length) return;
            const opusPayload = buf.subarray(headerLen);
            if (opusPayload.length === 0) return;

            if (inboundPacketCount === 0) {
                callState.rtpPayloadType = buf[1] & 0x7F;
                console.log(`[WhatsAppCallManager] RTP: PT=${callState.rtpPayloadType}, headerLen=${headerLen}, payloadLen=${opusPayload.length}, totalBufLen=${buf.length}`);
            }
            inboundPacketCount++;

            // Decode Opus to PCM
            convertOpusToPcm(opusPayload, callId).then((pcmBuf) => {
                if (pcmBuf && pcmBuf.length > 0) {
                    decodeSuccessCount++;
                    totalPcmBytesSent += pcmBuf.length;
                    if (onAudioFromWhatsApp) {
                        onAudioFromWhatsApp(pcmBuf);
                    }
                } else {
                    decodeFailCount++;
                }
            }).catch((e) => {
                decodeFailCount++;
            });
        });

        // Store the received track for BIDIRECTIONAL use (send + receive)
        callState.outTrack = track;
    });

    try {
        // Create local SDP answer
        const answerSdp = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('SDP answer timeout')), 10000);

            pc.onLocalDescription((sdp, type) => {
                if (type === 'answer') {
                    clearTimeout(timeout);
                    resolve(sdp);
                }
            });

            try {
                // Remove tricky lines from Meta's SDP that libdatachannel might reject silently
                let cleanOffer = offerSdp.replace(/a=extmap:.*\r\n/g, '');
                
                pc.setRemoteDescription(cleanOffer, 'offer');
                pc.setLocalDescription(); 
            } catch (e) {
                clearTimeout(timeout);
                reject(e);
            }
        });

        console.log(`[WhatsAppCallManager] SDP answer generated for call ${callId}`);
        const answerSession = {
            sdp_type: 'answer',
            sdp: answerSdp,
        };

        // Step 1: Pre-accept the call with the WebRTC answer.
        await metaCallAction(callId, phoneNumberId, accessToken, {
            action: 'pre_accept',
            session: answerSession,
        });

        // Step 2: Accept with SDP answer
        await metaCallAction(callId, phoneNumberId, accessToken, {
            action: 'accept',
            session: answerSession,
            biz_opaque_callback_data: `voice_call:${callId}`,
        });

        console.log(`[WhatsAppCallManager] Call accepted (${callId})`);
    } catch (err) {
        callState.active = false;
        activeCalls.delete(callId);
        try { pc.close(); } catch { /* ignore */ }
        throw err;
    }

    // Return function to send audio back to WhatsApp
    callState.rtpQueue = [];
    callState.rtpPacingTimer = setInterval(() => {
        if (!callState.active || !callState.outTrack || callState.rtpQueue.length === 0) return;
        const rtpPacket = callState.rtpQueue.shift();
        try {
            callState.outTrack.sendMessageBinary(rtpPacket);
            callState.outboundFramesSent++;
        } catch (e) {
            if (callState.outboundFramesSent <= 3) {
                console.log(`[WhatsAppCallManager] Send error: ${e.message} (${callId})`);
            }
        }
    }, 20); // 20ms = one Opus frame duration

    return {
        sendAudioToWhatsApp: (pcm24kBuffer) => {
            if (!callState.active || !callState.outTrack) return;

            // Accumulate Gemini's small PCM chunks into a buffer
            callState.outboundPcmBuffer = Buffer.concat([callState.outboundPcmBuffer, pcm24kBuffer]);

            // We need at least 960 bytes of 24kHz PCM (= 480 samples = 20ms)
            const MIN_PCM_24K = 960;

            while (callState.outboundPcmBuffer.length >= MIN_PCM_24K) {
                const chunk = callState.outboundPcmBuffer.subarray(0, MIN_PCM_24K);
                callState.outboundPcmBuffer = callState.outboundPcmBuffer.subarray(MIN_PCM_24K);

                convertPcmToOpus(chunk, callId).then((frames) => {
                    if (frames && frames.length > 0 && callState.active) {
                        for (const opusFrame of frames) {
                            // Build RTP packet: 12-byte header + Opus payload
                            const rtpPacket = Buffer.alloc(12 + opusFrame.length);
                            rtpPacket[0] = 0x80; // V=2
                            rtpPacket[1] = callState.rtpPayloadType & 0x7F;
                            rtpPacket.writeUInt16BE(callState.rtpSeq & 0xFFFF, 2);
                            callState.rtpSeq++;
                            rtpPacket.writeUInt32BE(callState.rtpTimestamp & 0xFFFFFFFF, 4);
                            callState.rtpTimestamp += 960;
                            rtpPacket.writeUInt32BE(callState.rtpSsrc, 8);
                            opusFrame.copy(rtpPacket, 12);

                            // Queue for paced sending
                            callState.rtpQueue.push(rtpPacket);
                        }
                    }
                }).catch(() => { });
            }
        },
    };
}

/**
 * Send a Meta Calling API action (pre_accept or accept).
 */
async function metaCallAction(callId, phoneNumberId, accessToken, body) {
    try {
        const url = `${META_GRAPH_URL}/${phoneNumberId}/calls`;
        const payload = {
            messaging_product: 'whatsapp',
            call_id: callId,
            action: body.action,
            ...(body.session ? { session: body.session } : {}),
            ...(body.biz_opaque_callback_data ? { biz_opaque_callback_data: body.biz_opaque_callback_data } : {}),
        };
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });
        console.log(`[WhatsAppCallManager] Meta API ${body.action} OK (${callId}):`, response.data);
        return response.data;
    } catch (err) {
        const errData = err.response?.data;
        console.error(`[WhatsAppCallManager] Meta API ${body.action} error (${callId}):`, errData || err.message);
        throw err;
    }
}

/**
 * End a call — close WebRTC peer connection and cleanup.
 */
function endCall(callId) {
    const callState = activeCalls.get(callId);
    if (!callState) return;

    callState.active = false;
    if (callState.rtpPacingTimer) clearInterval(callState.rtpPacingTimer);
    try {
        callState.pc.close();
    } catch (e) { /* ignore */ }
    activeCalls.delete(callId);
    console.log(`[WhatsAppCallManager] Call ended: ${callId}`);
}

/**
 * Returns whether a call is currently active.
 */
function isCallActive(callId) {
    return activeCalls.has(callId) && activeCalls.get(callId).active;
}

/**
 * Enable WhatsApp Calling for a phone number via Meta Graph API.
 */
async function setCallingEnabled(phoneNumberId, accessToken, enable = true) {
    const url = `${META_GRAPH_URL}/${phoneNumberId}/settings`;
    const response = await axios.post(url, {
        calling: { status: enable ? 'ENABLED' : 'DISABLED' },
    }, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        timeout: 15000,
    });
    console.log(`[WhatsAppCallManager] Calling ${enable ? 'enabled' : 'disabled'} for ${phoneNumberId}:`, response.data);
    return response.data;
}

// ── Audio conversion helpers (via opusscript) ──────────────────────────────

function getDecoder(callId) {
    const state = activeCalls.get(callId);
    if (!state) return null;
    if (!state.decoder) {
        state.decoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    }
    return state.decoder;
}

function getEncoder(callId) {
    const state = activeCalls.get(callId);
    if (!state) return null;
    if (!state.encoder) {
        state.encoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    }
    return state.encoder;
}

/**
 * Convert Opus RTP payload to PCM 16-bit 16kHz mono Buffer.
 */
async function convertOpusToPcm(opusBuffer, callId) {
    try {
        const decoder = getDecoder(callId);
        if (!decoder) return null;
        
        const pcm48 = decoder.decode(opusBuffer);
        const targetSamples = Math.floor((pcm48.length / 2) / 3);
        const pcm16 = Buffer.alloc(targetSamples * 2);
        for (let i = 0; i < pcm16.length / 2; i++) {
            pcm16.writeInt16LE(pcm48.readInt16LE(i * 6), i * 2);
        }
        return pcm16;
    } catch (e) {
        if (!activeCalls.get(callId).loggedDecodeError) {
            console.log('[OpusDecodeError] Error decoding audio:', e.message);
            activeCalls.get(callId).loggedDecodeError = true;
        }
        return null;
    }
}

/**
 * Convert PCM 16-bit 24kHz mono Buffer to Opus.
 * Returns an array of buffers.
 */
async function convertPcmToOpus(pcmBuffer, callId) {
    try {
        const encoder = getEncoder(callId);
        if (!encoder) return [];
        
        const pcm48 = Buffer.alloc(pcmBuffer.length * 2);
        for (let i = 0; i < pcmBuffer.length / 2; i++) {
            const sample = pcmBuffer.readInt16LE(i * 2);
            pcm48.writeInt16LE(sample, i * 4);
            pcm48.writeInt16LE(sample, i * 4 + 2);
        }
        
        const frames = [];
        for (let offset = 0; offset + 1920 <= pcm48.length; offset += 1920) {
            const frameBuf = pcm48.subarray(offset, offset + 1920);
            frames.push(encoder.encode(frameBuf, 960));
        }
        return frames;
    } catch (e) {
        return [];
    }
}

/**
 * Get the call state for a given call ID.
 */
function getCallState(callId) {
    return activeCalls.get(callId) || null;
}

module.exports = {
    handleIncomingCall,
    endCall,
    isCallActive,
    setCallingEnabled,
    getCallState,
};
