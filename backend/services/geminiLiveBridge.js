/**
 * geminiLiveBridge.js
 * Conexión en Tiempo Real con IA de Voz (Gemini Live).
 * Mantiene una conexión WebSocket bidireccional continua procesando buffers PCM (16-bit, 16kHz) desde/hacia WhatsApp Calling. Permite transformar comandos de voz en la respuesta directa de Gemini Live.
 */

const WebSocket = require('ws');

const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const MODEL = 'gemini-2.0-flash-exp'; // Usamos la versión estable certificada de Gemini Live

// Active sessions: Map<callId, SessionState>
const sessions = new Map();

/**
 * Create a Gemini Live session for a call.
 *
 * @param {string} callId
 * @param {string} apiKey — Gemini API Key from Google AI Studio
 * @param {string} systemPrompt — bot's personality/instructions
 * @param {string} voice — Gemini voice name (e.g. 'Aoede', 'Puck', 'Charon')
 * @param {Function} onAudio — callback(pcmBuffer: Buffer) called with each audio chunk from Gemini
 * @param {Function} onInterrupted — callback() when user speaks and cuts off Gemini
 * @param {Function} onError — callback(error) on fatal error
 * @returns {Promise<void>}
 */
async function createSession(callId, apiKey, systemPrompt, voice = 'Aoede', onAudio, onInterrupted, onError) {
    if (!apiKey) throw new Error('[GeminiBridge] GEMINI_API_KEY not set');

    const url = `${GEMINI_WS_URL}?key=${apiKey}`;
    const ws = new WebSocket(url);

    const state = {
        ws,
        ready: false,
        onAudio,
        onInterrupted,
        onError,
        audioQueue: [],
        callId,
        sendCount: 0,
        sendBytes: 0,
        receiveCount: 0,
    };
    sessions.set(callId, state);

    return new Promise((resolve, reject) => {
        ws.on('open', () => {
            // Send session setup message
            const setupMsg = {
                setup: {
                    model: `models/${MODEL}`,
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: voice },
                            },
                        },
                    },
                    systemInstruction: {
                        parts: [{ text: systemPrompt }],
                    },
                },
            };

            ws.send(JSON.stringify(setupMsg));
            console.log(`[GeminiBridge] Session setup sent for call ${callId}`);
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Session ready confirmation
                if (msg.setupComplete) {
                    state.ready = true;
                    console.log(`[GeminiBridge] Session ready for call ${callId}`);
                    
                    // Trigger Gemini to greet the caller immediately
                    ws.send(JSON.stringify({
                        clientContent: {
                            turns: [{ role: 'user', parts: [{ text: '[SISTEMA] La llamada acaba de conectarse. Saluda al cliente de forma natural, amigable y breve.' }] }],
                            turnComplete: true
                        }
                    }));
                    
                    resolve();
                    return;
                }

                // Audio response from Gemini
                if (msg.serverContent?.modelTurn?.parts) {
                    // Drop ghost audio if we recently interrupted locally
                    if (state.ignoreAudioUntil && Date.now() < state.ignoreAudioUntil) {
                        return; // Ignore trailing audio from the interrupted turn
                    }

                    for (const part of msg.serverContent.modelTurn.parts) {
                        if (part.inlineData?.data) {
                            state.receiveCount++;
                            if (state.receiveCount === 1) {
                                console.log(`[GeminiBridge] *** FIRST AUDIO FROM GEMINI *** dataLen=${part.inlineData.data.length} (${callId})`);
                            }
                            const audioBuf = Buffer.from(part.inlineData.data, 'base64');
                            if (onAudio) onAudio(audioBuf);
                        }
                    }
                }

                // Handle turn completion — especially interruptions
                if (msg.serverContent?.turnComplete) {
                    if (msg.serverContent?.interrupted) {
                        console.log(`[GeminiBridge] *** INTERRUPTED *** — clearing outbound queue (${callId})`);
                        if (state.onInterrupted) state.onInterrupted();
                    }
                }

            } catch (e) {
                console.error(`[GeminiBridge] Parse error (${callId}):`, e.message);
            }
        });

        ws.on('error', (err) => {
            console.error(`[GeminiBridge] WebSocket error (${callId}):`, err.message);
            sessions.delete(callId);
            if (onError) onError(err);
            reject(err);
        });

        ws.on('close', (code, reason) => {
            console.log(`[GeminiBridge] Session closed (${callId}) code=${code}`);
            sessions.delete(callId);
        });
    });
}

/**
 * Send a PCM audio chunk to Gemini for the given call.
 * PCM must be 16-bit, 16kHz, mono.
 */
function sendAudio(callId, pcmBuffer) {
    const state = sessions.get(callId);
    if (!state) return;

    if (!pcmBuffer || pcmBuffer.length === 0) return;

    // Si no está listo, IGNORAR el audio
    if (!state.ready) {
        return;
    }

    // --- LOCAL VAD (Barge-in detection) ---
    // Calculate RMS (volume level) to detect if the user is actually speaking
    let sumSquares = 0;
    for (let i = 0; i < pcmBuffer.length; i += 2) {
        const sample = pcmBuffer.readInt16LE(i) / 32768.0; // Normalize to -1.0 to 1.0
        sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / (pcmBuffer.length / 2));
    
    // If volume is significant (user speaking) and not just background noise
    if (rms > 0.18) { // Voice activity threshold
        const now = Date.now();
        if (!state.lastInterruptTime || now - state.lastInterruptTime > 1000) {
            console.log(`[GeminiBridge] 🎤 User speaking detected (RMS: ${rms.toFixed(3)}). Triggering local interrupt...`);
            state.lastInterruptTime = now;
            state.ignoreAudioUntil = now + 1500; // Ignore ghost audio for 1.5 seconds
            
            if (state.onInterrupted) state.onInterrupted();
            
            // Send clientContent to force Gemini server to stop generating
            state.ws.send(JSON.stringify({
                clientContent: {
                    turns: [{ role: 'user', parts: [{ text: '' }] }],
                    turnComplete: true
                }
            }));
        }
    }

    // Initialize input buffer if needed
    if (!state.inputPcmBuffer) {
        state.inputPcmBuffer = Buffer.alloc(0);
    }

    // Accumulate small PCM chunks into larger blocks
    state.inputPcmBuffer = Buffer.concat([state.inputPcmBuffer, pcmBuffer]);

    // Send in ~256ms chunks (8192 bytes = 4096 samples at 16kHz 16-bit mono)
    const CHUNK_SIZE = 8192;

    while (state.inputPcmBuffer.length >= CHUNK_SIZE) {
        const chunk = state.inputPcmBuffer.subarray(0, CHUNK_SIZE);
        state.inputPcmBuffer = state.inputPcmBuffer.subarray(CHUNK_SIZE);

        state.sendCount++;
        state.sendBytes += chunk.length;
        if (state.sendCount % 50 === 0) {
            console.log(`[GeminiBridge DIAG] sent=${state.sendCount} chunks (${CHUNK_SIZE}B each), received=${state.receiveCount} from Gemini (${callId.substring(0,20)})`);
        }
        _sendAudioChunk(state, chunk);
    }
}

function _sendAudioChunk(state, pcmBuffer) {
    if (state.ws.readyState !== WebSocket.OPEN) return;
    
    const msg = {
        realtimeInput: {
            audio: {
                data: pcmBuffer.toString('base64'),
                mimeType: 'audio/pcm;rate=16000'
            }
        }
    };
    state.ws.send(JSON.stringify(msg));
}

/**
 * Close and cleanup a Gemini session for a call.
 */
function closeSession(callId) {
    const state = sessions.get(callId);
    if (!state) return;

    if (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING) {
        state.ws.close(1000, 'Call ended');
    }
    sessions.delete(callId);
    console.log(`[GeminiBridge] Session closed for call ${callId}`);
}

module.exports = {
    createSession,
    sendAudio,
    closeSession
};
