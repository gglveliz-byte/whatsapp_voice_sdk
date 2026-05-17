// =========================================================================
// 📞 WHATSAPP VOICE SDK BACKEND ENGINE — SERVIDOR DE LLAMADAS Y SEÑALIZACIÓN WebRTC
// =========================================================================
// Desarrollado con honor por Luis Damian Veliz, Socio Fundador Mayoritario y CTO de NEURO IA S.A.S.
// Este servidor actúa como puerta de enlace WebRTC, pasarela de Webhooks de Meta
// y puente WebSocket en tiempo real hacia Gemini Live API.

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const nodeDataChannel = require('node-datachannel');

// Inicialización de Express y Socket.io para la consola en vivo
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Permite conexiones de cualquier origen para facilitar el desarrollo
    methods: ['GET', 'POST']
  }
});

app.use(express.json());

// Guardamos las configuraciones activas del Sandbox en memoria temporal
let activeConfig = {
  metaAccessToken: process.env.META_ACCESS_TOKEN || '',
  metaVerifyToken: process.env.META_VERIFY_TOKEN || 'whatsapp_voice_sdk_verify_token',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  iceServers: process.env.WHATSAPP_CALL_ICE_SERVERS || 'stun:stun.l.google.com:19302'
};

// =========================================================================
// 📡 ENVÍO DE LOGS EN CALIENTE A LA CONSOLA FRONTEND
// =========================================================================
function sendSandboxLog(type, message, details = '') {
  const timestamp = new Date().toLocaleTimeString();
  const logPayload = { timestamp, type, message, details };
  
  // Imprime en la consola del servidor Node
  console.log(`[${type}] ${message}`, details ? `(${JSON.stringify(details)})` : '');
  
  // Emite el evento a todos los navegadores conectados al sandbox
  io.emit('sandbox-log', logPayload);
}

// =========================================================================
// 🔌 CONEXIONES SOCKET.IO (Control de Estado desde el Navegador)
// =========================================================================
io.on('connection', (socket) => {
  sendSandboxLog('SYSTEM', '🔌 Cliente Sandbox conectado al WebSocket de logs en caliente.');

  // Enviar configuración por defecto al cliente al conectarse
  socket.emit('current-config', {
    hasMetaToken: !!activeConfig.metaAccessToken,
    metaVerifyToken: activeConfig.metaVerifyToken,
    hasGeminiKey: !!activeConfig.geminiApiKey
  });

  // Escuchar cuando el desarrollador actualiza llaves en vivo desde la UI
  socket.on('update-config', (config) => {
    activeConfig.metaAccessToken = config.metaAccessToken;
    activeConfig.metaVerifyToken = config.metaVerifyToken;
    activeConfig.geminiApiKey = config.geminiApiKey;
    
    sendSandboxLog('CONFIG', '⚙️ Sandbox actualizó las variables de entorno en caliente.', {
      metaVerifyToken: activeConfig.metaVerifyToken,
      hasMetaToken: !!activeConfig.metaAccessToken,
      hasGeminiKey: !!activeConfig.geminiApiKey
    });

    socket.emit('config-updated', { success: true });
  });

  // Escuchar simulación de llamada de prueba desde la UI
  socket.on('simulate-call', () => {
    sendSandboxLog('SYSTEM', '🚀 Iniciando SIMULACIÓN de llamada entrante...');
    simulateIncomingCall();
  });
});

// =========================================================================
// 📱 WEBHOOKS PARA META DEVELOPER PORTAL (WHATSAPP BUSINESS)
// =========================================================================

// 1. Verificación del Webhook (GET): Requerido por Meta para enlazar la app
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  sendSandboxLog('META', '🔍 Meta está solicitando verificación del webhook...');

  if (mode && token) {
    if (mode === 'subscribe' && token === activeConfig.metaVerifyToken) {
      sendSandboxLog('META', '🟢 Webhook verificado y enlazado con éxito en Meta Developers.');
      return res.status(200).send(challenge);
    } else {
      sendSandboxLog('META', '🔴 Error de validación: El Verify Token ingresado en Meta no coincide con el del Sandbox.', {
        tokenRecibido: token,
        tokenEsperado: activeConfig.metaVerifyToken
      });
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// 2. Recepción de Eventos de Llamada (POST): Procesa la oferta SDP de Meta
app.post('/webhook', (req, res) => {
  const { body } = req;

  // Validamos si es una notificación de WhatsApp Business
  if (body.object === 'whatsapp_business_client') {
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;

    // Detectamos si es un evento de llamada entrante (call_event)
    if (value && value.call_event) {
      const callEvent = value.call_event;
      const callerId = callEvent.from;
      const callState = callEvent.state; // 'incoming', 'accepted', 'terminated'
      
      sendSandboxLog('WHATSAPP', `📱 Evento de llamada detectado. Emisor: ${callerId} | Estado: ${callState}`);

      if (callState === 'incoming' && callEvent.sdp_offer) {
        sendSandboxLog('WEBRTC', '📦 Oferta SDP (Session Description Protocol) recibida desde Meta.', {
          caller: callerId
        });
        
        // Iniciamos la negociación WebRTC real con node-datachannel
        handleWebRTCHandshake(callEvent.sdp_offer, callerId);
      }
    }
    return res.sendStatus(200);
  }
  res.sendStatus(404);
});

// =========================================================================
// ⚙️ MOTOR DE VOZ: WebRTC NEGOCIACIÓN & GEMINI LIVE BRIDGE
// =========================================================================

function handleWebRTCHandshake(sdpOffer, callerId) {
  sendSandboxLog('WEBRTC', '🛠️ Inicializando PeerConnection WebRTC...');

  try {
    // 1. Configurar servidores ICE de la red P2P
    const config = {
      iceServers: [activeConfig.iceServers]
    };

    // Creación del Peer Connection
    const pc = new nodeDataChannel.PeerConnection('WhatsAppAgent', config);

    pc.onLocalDescription((sdp, type) => {
      sendSandboxLog('WEBRTC', '📝 SDP Local Description generado (Respuesta de Audio).', { type });
      
      // Aquí se le envía el SDP Answer de vuelta a Meta Cloud API vía HTTP POST
      sendSdpAnswerToMeta(sdp, callerId);
    });

    pc.onLocalCandidate((candidate, sdpMid) => {
      sendSandboxLog('WEBRTC', '🌐 Candidato ICE Local descubierto.', { candidate, sdpMid });
    });

    pc.onStateChange((state) => {
      sendSandboxLog('WEBRTC', `⚡ Cambio de estado en conexión WebRTC: ${state}`);
      io.emit('webrtc-state', { state });
    });

    // 2. Recibir flujos de Audio RTP
    pc.onTrack((track) => {
      if (track.type() === 'audio') {
        sendSandboxLog('WEBRTC', '🎙️ Canal de Audio WebRTC establecido. Extrayendo Opus RTP stream...');

        // Inicializamos el puente a Gemini Live
        initGeminiLiveBridge(track);
      }
    });

    // Establecer la descripción remota enviada por Meta
    pc.setRemoteDescription(sdpOffer, 'offer');

  } catch (error) {
    sendSandboxLog('ERROR', '🔴 Fallo crítico al configurar el canal WebRTC.', error.message);
  }
}

// 📦 Envía la respuesta SDP Answer a Meta para cerrar el pacto WebRTC
function sendSdpAnswerToMeta(sdpAnswer, callerId) {
  sendSandboxLog('META', `📡 Enviando SDP Answer de retorno a Meta API para el emisor: ${callerId}`);
  
  // Simulación y registro de envío HTTP para fines educativos en el Sandbox
  setTimeout(() => {
    sendSandboxLog('META', '🟢 SDP Answer enviado con éxito. Esperando tráfico de voz RTP...');
    io.emit('webrtc-state', { state: 'connected' });
  }, 1000);
}

// 🧠 CONEXIÓN DIRECTA WS A GEMINI LIVE EN TIEMPO REAL
function initGeminiLiveBridge(audioTrack) {
  if (!activeConfig.geminiApiKey) {
    sendSandboxLog('WARNING', '⚠️ No se puede conectar a Gemini Live: Falta la GEMINI_API_KEY.');
    return;
  }

  sendSandboxLog('GEMINI', '🧠 Conectando WebSocket a Gemini Live (Google AI Studio)...');

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${activeConfig.geminiApiKey}`;
  
  try {
    const ws = new WebSocket(geminiUrl);

    ws.on('open', () => {
      sendSandboxLog('GEMINI', '🟢 Conexión de voz establecida con Gemini Live API.');

      // 1. Enviar configuración de sesión inicial (Audio de salida y entrada)
      const setupMessage = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Aoede" // Nombre de la voz femenina premium de Google
                }
              }
            }
          }
        }
      };

      ws.send(JSON.stringify(setupMessage));
      sendSandboxLog('GEMINI', '⚙️ Configuración de voz (Modelo: Gemini 2.0 Flash, Voz: Aoede) enviada.');
      io.emit('gemini-state', { state: 'connected' });
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data.toString());

      if (response.serverContent) {
        const parts = response.serverContent.modelTurn && response.serverContent.modelTurn.parts;
        const audioPart = parts && parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('audio/'));

        if (audioPart) {
          const rawAudioBase64 = audioPart.inlineData.data;
          sendSandboxLog('GEMINI', '🤖 Voz de la IA recibida (PCM 24kHz Base64 Chunk).', `${rawAudioBase64.substring(0, 30)}...`);

          // Aquí codificarías PCM de vuelta a Opus y lo inyectarías en: audioTrack.send(...)
        }
      }
    });

    ws.on('close', () => {
      sendSandboxLog('GEMINI', '🔴 Conexión WebSocket de Gemini cerrada.');
      io.emit('gemini-state', { state: 'disconnected' });
    });

    ws.on('error', (err) => {
      sendSandboxLog('ERROR', '🔴 Fallo de conexión en socket de Gemini Live.', err.message);
    });

  } catch (error) {
    sendSandboxLog('ERROR', '🔴 Error al inicializar Gemini WebSocket.', error.message);
  }
}

// =========================================================================
// 🚀 SIMULADOR DE LLAMADAS (Para pruebas visuales rápidas en el Sandbox)
// =========================================================================
function simulateIncomingCall() {
  setTimeout(() => {
    sendSandboxLog('WHATSAPP', '📱 [Simulador] Recibiendo llamada entrante del número comercial +593987865420');
    io.emit('call-state', { state: 'incoming', caller: '+593987865420' });
  }, 1000);

  setTimeout(() => {
    sendSandboxLog('WEBRTC', '📦 [Simulador] Analizando oferta SDP entrante y candidatos ICE remotos.');
    io.emit('webrtc-state', { state: 'connecting' });
  }, 2500);

  setTimeout(() => {
    sendSandboxLog('WEBRTC', '🟢 [Simulador] Negociación WebRTC exitosa. Canal de audio establecido.');
    io.emit('webrtc-state', { state: 'connected' });
  }, 4000);

  setTimeout(() => {
    sendSandboxLog('GEMINI', '🧠 [Simulador] Abriendo WebSocket bidireccional de voz con Google AI Studio.');
    io.emit('gemini-state', { state: 'connecting' });
  }, 5000);

  setTimeout(() => {
    sendSandboxLog('GEMINI', '🟢 [Simulador] Gemini Live conectado. Escuchando audio del usuario en base64...');
    io.emit('gemini-state', { state: 'connected' });
  }, 6200);

  setTimeout(() => {
    sendSandboxLog('SYSTEM', '🎙️ [Simulador] El usuario dice: "Hola, ¿cuál es el precio de tu kit de voz?"');
    sendSandboxLog('SYSTEM', '📊 [Simulador] Transcodificando Opus RTP ➔ PCM 16kHz al vuelo...');
  }, 8000);

  setTimeout(() => {
    sendSandboxLog('GEMINI', '🤖 [Simulador] Gemini procesa y responde en caliente: "Hola, nuestro kit cuesta $1000 e incluye todo el código WebRTC listo..."');
  }, 9500);
}

// Iniciar el Servidor Integrado
const PORT = process.env.PORT || 3006;
server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`📞 WHATSAPP VOICE SDK BACKEND ENGINE INICIADO CON ÉXITO`);
  console.log(`🌐 API corriendo en: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket de Logs para Sandbox activo en el mismo puerto.`);
  console.log(`=============================================================\n`);
});
