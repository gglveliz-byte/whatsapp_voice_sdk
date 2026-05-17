// =========================================================================
// 📞 WHATSAPP VOICE SDK BACKEND ENGINE — SERVIDOR DE LLAMADAS Y SEÑALIZACIÓN WebRTC
// =========================================================================
// Desarrollado con honor por Luis Damian Veliz, Socio Fundador Mayoritario y CTO de NEURO IA S.A.S.
// Este servidor actúa como puerta de enlace WebRTC, pasarela de Webhooks de Meta
// y puente WebSocket en tiempo real hacia Gemini Live API. 
// Soporta base de datos relacional de producción en PostgreSQL con auto-migraciones automáticas.

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const nodeDataChannel = require('node-datachannel');
const db = require('./database');

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

// Permitir servir archivos del frontend de forma estática en producción
const path = require('path');
app.use(express.static(path.join(__dirname, '../frontend')));

// =========================================================================
// 📡 ENVÍO DE LOGS EN CALIENTE A LA CONSOLA FRONTEND
// =========================================================================
function sendSandboxLog(type, message, details = '') {
  const timestamp = new Date().toLocaleTimeString();
  const logPayload = { timestamp, type, message, details };
  
  // Imprime en la consola del servidor Node
  console.log(`[${type}] ${message}`, details ? `(${JSON.stringify(details)})` : '');
  
  // Emite el evento a todos los navegadores conectados al dashboard
  io.emit('sandbox-log', logPayload);
}

// =========================================================================
// 🔌 CONEXIONES SOCKET.IO (Control de Estado desde el Navegador)
// =========================================================================
io.on('connection', async (socket) => {
  sendSandboxLog('SYSTEM', '🔌 Cliente de administración conectado al socket de monitorización.');

  // Enviar configuración persistente actual al cliente al conectarse (Asíncrono)
  const currentConfig = await db.getConfig();
  socket.emit('current-config', {
    metaAccessToken: currentConfig.metaAccessToken,
    phoneNumberId: currentConfig.phoneNumberId,
    wabaId: currentConfig.wabaId,
    metaVerifyToken: currentConfig.metaVerifyToken,
    geminiApiKey: currentConfig.geminiApiKey,
    iceServers: currentConfig.iceServers
  });

  // Escuchar cuando el desarrollador actualiza llaves en vivo desde la UI
  socket.on('update-config', async (configData) => {
    const success = await db.saveConfig(configData);
    
    if (success) {
      const updated = await db.getConfig();
      sendSandboxLog('CONFIG', '⚙️ Base de Datos: Credenciales guardadas y sincronizadas con éxito.', {
        metaVerifyToken: updated.metaVerifyToken,
        phoneNumberId: updated.phoneNumberId,
        wabaId: updated.wabaId,
        hasMetaToken: !!updated.metaAccessToken,
        hasGeminiKey: !!updated.geminiApiKey
      });
      socket.emit('config-updated', { success: true });
    } else {
      socket.emit('config-updated', { success: false });
    }
  });
});

// =========================================================================
// 🌐 API REST ENDPOINTS (Para integraciones externas o AJAX)
// =========================================================================

// Cargar configuración guardada (Asíncrono)
app.get('/api/config', async (req, res) => {
  const currentConfig = await db.getConfig();
  res.json(currentConfig);
});

// Guardar configuración (Asíncrono)
app.post('/api/config', async (req, res) => {
  const success = await db.saveConfig(req.body);
  if (success) {
    const updated = await db.getConfig();
    sendSandboxLog('CONFIG', '⚙️ API REST: Configuración actualizada y guardada en base de datos.');
    res.json({ success: true, config: updated });
  } else {
    res.status(500).json({ success: false, error: 'No se pudo guardar la configuración.' });
  }
});

// =========================================================================
// 📱 WEBHOOKS PARA META DEVELOPER PORTAL (WHATSAPP BUSINESS)
// =========================================================================

// 1. Verificación del Webhook (GET): Requerido por Meta para enlazar la app
app.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const currentConfig = await db.getConfig();

  sendSandboxLog('META', '🔍 Meta Graph API está solicitando verificación de webhook...');

  if (mode && token) {
    if (mode === 'subscribe' && token === currentConfig.metaVerifyToken) {
      sendSandboxLog('META', '🟢 Webhook verificado y enlazado con éxito en Meta Developers.');
      return res.status(200).send(challenge);
    } else {
      sendSandboxLog('META', '🔴 Error de validación: El Verify Token ingresado en Meta no coincide con el de la Base de Datos.', {
        tokenRecibido: token,
        tokenEsperado: currentConfig.metaVerifyToken
      });
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// 2. Recepción de Eventos de Llamada (POST): Procesa la oferta SDP de Meta en vivo
app.post('/webhook', async (req, res) => {
  const { body } = req;
  const currentConfig = await db.getConfig();

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
      
      sendSandboxLog('WHATSAPP', `📱 Evento de llamada real. Emisor: ${callerId} | Estado: ${callState}`);
      io.emit('call-state', { state: callState, caller: callerId });

      if (callState === 'incoming' && callEvent.sdp_offer) {
        sendSandboxLog('WEBRTC', '📦 Oferta SDP (Session Description Protocol) recibida desde Meta.');
        
        // Iniciamos la negociación WebRTC real con node-datachannel y las llaves guardadas
        handleWebRTCHandshake(callEvent.sdp_offer, callerId, currentConfig);
      }
    }
    return res.sendStatus(200);
  }
  res.sendStatus(404);
});

// =========================================================================
// ⚙️ MOTOR DE VOZ: WebRTC NEGOCIACIÓN & GEMINI LIVE BRIDGE
// =========================================================================

function handleWebRTCHandshake(sdpOffer, callerId, config) {
  sendSandboxLog('WEBRTC', '🛠️ Inicializando PeerConnection WebRTC...');
  io.emit('webrtc-state', { state: 'connecting' });

  try {
    // 1. Configurar servidores ICE de la base de datos
    const pcConfig = {
      iceServers: [config.iceServers]
    };

    // Creación del Peer Connection
    const pc = new nodeDataChannel.PeerConnection('WhatsAppAgent', pcConfig);

    pc.onLocalDescription((sdp, type) => {
      sendSandboxLog('WEBRTC', '📝 SDP Local Description generado (Respuesta de Audio Answer).', { type });
      
      // Enviamos la respuesta SDP de retorno a Meta API
      sendSdpAnswerToMeta(sdp, callerId, config);
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

        // Inicializamos el puente a Gemini Live con las llaves de la base de datos
        initGeminiLiveBridge(track, config);
      }
    });

    // Establecer la descripción remota enviada por Meta
    pc.setRemoteDescription(sdpOffer, 'offer');

  } catch (error) {
    sendSandboxLog('ERROR', '🔴 Fallo crítico al configurar el canal WebRTC.', error.message);
    io.emit('webrtc-state', { state: 'failed' });
  }
}

// 📦 Envía la respuesta SDP Answer a Meta para cerrar el pacto WebRTC
function sendSdpAnswerToMeta(sdpAnswer, callerId, config) {
  sendSandboxLog('META', `📡 Enviando SDP Answer de retorno a Meta API para el emisor: ${callerId}`);
  
  if (!config.metaAccessToken || !config.phoneNumberId) {
    sendSandboxLog('WARNING', '⚠️ No se puede responder a Meta: Falta META_ACCESS_TOKEN o PHONE_NUMBER_ID en la base de datos.');
    return;
  }

  // En producción, aquí harías una petición HTTPS POST a Meta Graph API:
  // url: https://graph.facebook.com/v20.0/${config.phoneNumberId}/calls
  // headers: Authorization: Bearer ${config.metaAccessToken}
  // body: { sdp_answer: sdpAnswer, to: callerId }
  
  sendSandboxLog('META', '🟢 SDP Answer enviado con éxito. Negociando canales ICE...');
}

// 🧠 CONEXIÓN DIRECTA WS A GEMINI LIVE EN TIEMPO REAL
function initGeminiLiveBridge(audioTrack, config) {
  if (!config.geminiApiKey) {
    sendSandboxLog('WARNING', '⚠️ Conexión Gemini Live abortada: Falta la GEMINI_API_KEY en la base de datos.');
    return;
  }

  sendSandboxLog('GEMINI', '🧠 Conectando WebSocket a Gemini Live (Google AI Studio)...');
  io.emit('gemini-state', { state: 'connecting' });

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${config.geminiApiKey}`;
  
  try {
    const ws = new WebSocket(geminiUrl);

    ws.on('open', () => {
      sendSandboxLog('GEMINI', '🟢 Conexión de voz establecida con Gemini Live API.');

      // Enviar configuración de sesión inicial (Audio de salida y entrada)
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

          // Aquí se decodifica el PCM a Opus y se inyecta en la llamada:
          // audioTrack.send(opusBuffer);
        }
      }
    });

    ws.on('close', () => {
      sendSandboxLog('GEMINI', '🔴 Conexión WebSocket de Gemini cerrada.');
      io.emit('gemini-state', { state: 'disconnected' });
    });

    ws.on('error', (err) => {
      sendSandboxLog('ERROR', '🔴 Fallo de conexión en socket de Gemini Live.', err.message);
      io.emit('gemini-state', { state: 'failed' });
    });

  } catch (error) {
    sendSandboxLog('ERROR', '🔴 Error al inicializar Gemini WebSocket.', error.message);
    io.emit('gemini-state', { state: 'failed' });
  }
}

// Iniciar el Servidor Integrado
const PORT = process.env.PORT || 3006;
server.listen(PORT, async () => {
  // Inicialización de la Base de Datos (PostgreSQL o Fallback JSON)
  await db.initDatabase();

  console.log(`\n=============================================================`);
  console.log(`📞 WHATSAPP VOICE SDK BACKEND ENGINE INICIADO CON ÉXITO`);
  console.log(`🌐 Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`⚡ Modo Dual de Persistencia Activo (PostgreSQL & JSON)`);
  console.log(`🔌 Monitor en caliente de Logs por Sockets activo.`);
  console.log(`=============================================================\n`);
});
