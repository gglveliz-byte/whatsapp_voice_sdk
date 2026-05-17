// =========================================================================
// 📞 WHATSAPP VOICE SDK BACKEND ENGINE — SERVIDOR DE LLAMADAS Y SEÑALIZACIÓN WebRTC
// =========================================================================
// Desarrollado con honor por Luis Damian Veliz, Socio Fundador Mayoritario y CTO de NEURO IA S.A.S.
// Este servidor actúa como puente WebRTC en tiempo real hacia Gemini Live API y Meta.
// Soporta base de datos relacional de producción en PostgreSQL con auto-migraciones automáticas.

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const db = require('./database');

// Importar servicios del motor real de telefonía e inteligencia artificial
const whatsappCallManager = require('./services/whatsappCallManager');
const geminiLiveBridge = require('./services/geminiLiveBridge');

// Inicialización de Express y Socket.io para la consola en vivo
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
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

  // Enviar configuración persistente actual al cliente al conectarse
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

      // Si Meta Token y Phone ID están configurados, activar llamadas automáticamente en Meta
      if (updated.metaAccessToken && updated.phoneNumberId) {
        try {
          sendSandboxLog('META', '📡 Habilitando el servicio de llamadas entrantes en la API de Meta...');
          await whatsappCallManager.setCallingEnabled(updated.phoneNumberId, updated.metaAccessToken, true);
          sendSandboxLog('META', '🟢 WhatsApp Calling habilitado con éxito.');
        } catch (err) {
          sendSandboxLog('ERROR', '🔴 Fallo al intentar habilitar WhatsApp Calling en Meta.', err.message);
        }
      }

      socket.emit('config-updated', { success: true });
    } else {
      socket.emit('config-updated', { success: false });
    }
  });
});

// =========================================================================
// 🌐 API REST ENDPOINTS
// =========================================================================

app.get('/api/config', async (req, res) => {
  const currentConfig = await db.getConfig();
  res.json(currentConfig);
});

app.post('/api/config', async (req, res) => {
  const success = await db.saveConfig(req.body);
  if (success) {
    const updated = await db.getConfig();
    sendSandboxLog('CONFIG', '⚙️ API REST: Configuración actualizada en la base de datos.');
    res.json({ success: true, config: updated });
  } else {
    res.status(500).json({ success: false, error: 'No se pudo guardar la configuración.' });
  }
});

// =========================================================================
// 📱 WEBHOOKS PARA META DEVELOPER PORTAL (WHATSAPP BUSINESS)
// =========================================================================

// 1. Verificación del Webhook (GET): Requerido por Meta para verificar el túnel
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

// 2. Recepción de Eventos de Llamada (POST): Procesa eventos reales de Meta en tiempo real
app.post('/webhook', async (req, res) => {
  const { body } = req;
  
  // Responder inmediatamente a Meta para evitar reintentos y timeouts (límite de 5 segundos de Meta)
  res.status(200).json({ success: true });

  try {
    const currentConfig = await db.getConfig();

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry && body.entry[0];
      const change = entry && entry.changes && entry.changes.find(c => c.field === 'calls');
      
      if (!change) return;

      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const callData = value?.calls && value.calls[0];

      if (!callData || !phoneNumberId) return;

      const callId = callData.id;
      const callerPhone = callData.from;
      const eventType = callData.event; // 'connect', 'terminate', 'rejected', 'failed', 'no_answer'

      sendSandboxLog('WHATSAPP', `📱 Evento de llamada. ID: ${callId} | Emisor: ${callerPhone} | Evento: ${eventType}`);

      if (eventType === 'connect' && callData.session && callData.session.sdp_type === 'offer') {
        const offerSdp = callData.session.sdp;
        sendSandboxLog('WHATSAPP', `🔔 Llamada entrante de ${callerPhone}. SDP Oferta detectada.`);
        io.emit('call-state', { state: 'incoming', caller: callerPhone });
        
        // Iniciar el flujo real y la negociación de llamada
        startIncomingCallFlow(callId, offerSdp, callerPhone, currentConfig);
      } else if (eventType === 'terminate' || eventType === 'rejected' || eventType === 'failed' || eventType === 'no_answer') {
        sendSandboxLog('WHATSAPP', `🔴 Llamada finalizada o rechazada (${eventType}) por ${callerPhone}. Limpiando canales.`);
        io.emit('call-state', { state: 'terminated', caller: callerPhone });
        
        whatsappCallManager.endCall(callId);
        geminiLiveBridge.closeSession(callId);
      }
    }
  } catch (err) {
    console.error('[Webhook POST Error]:', err.message);
  }
});

// =========================================================================
// ⚙️ FLUJO DE CONTROL EN CALIENTE: WebRTC NEGOCIACIÓN & GEMINI LIVE BRIDGE
// =========================================================================

async function startIncomingCallFlow(callId, sdpOffer, callerId, config) {
  try {
    // Validar si node-datachannel está instalado/compilado en el entorno local
    try {
      require('node-datachannel');
    } catch (e) {
      sendSandboxLog('ERROR', '🔴 WebRTC no disponible: El módulo nativo "node-datachannel" no está compilado en este entorno.');
      sendSandboxLog('SYSTEM', '💡 Para contestar llamadas reales en Windows: Instala C++ Build Tools o corre en Linux / Render.');
      io.emit('webrtc-state', { state: 'failed' });
      return;
    }

    sendSandboxLog('WEBRTC', '🛠️ Inicializando canal WebRTC para Meta Calling...');
    io.emit('webrtc-state', { state: 'connecting' });

    // 1. Crear la sesión WebSocket hacia Gemini Live
    sendSandboxLog('GEMINI', '🧠 Conectando WebSocket a Gemini Live (Google AI Studio)...');
    io.emit('gemini-state', { state: 'connecting' });

    let callBridge = null;

    const systemPrompt = `Eres el asistente de voz oficial de NEURO IA S.A.S.
    Estás atendiendo una llamada de voz real de WhatsApp.
    - Habla de forma natural, amigable, concisa y breve. Máximo 2 oraciones por turno.
    - NO utilices markdown, emojis ni asteriscos en tu respuesta de voz.
    - Responde siempre en español.`;

    await geminiLiveBridge.createSession(
      callId,
      config.geminiApiKey,
      systemPrompt,
      'Aoede', // Voz femenina premium
      // Callback: Audio PCM recibido desde Gemini -> Enviarlo a WhatsApp track
      (pcm24kBuffer) => {
        if (callBridge && callBridge.sendAudioToWhatsApp) {
          callBridge.sendAudioToWhatsApp(pcm24kBuffer);
        }
      },
      // Callback: Interrupción por voz del usuario (Barge-in) -> Vaciar cola RTP
      () => {
        sendSandboxLog('GEMINI', '🎤 Interrupción por voz del usuario. Limpiando búfer de reproducción en caliente.');
        const state = whatsappCallManager.getCallState(callId);
        if (state) {
          state.rtpQueue = []; // Vacía la cola de audio
        }
      },
      (err) => {
        sendSandboxLog('ERROR', '🔴 Error crítico en WebSocket de Gemini Live.', err.message);
        io.emit('gemini-state', { state: 'failed' });
      }
    );

    sendSandboxLog('GEMINI', '🟢 Conexión establecida y sesión de voz lista con Gemini Live.');
    io.emit('gemini-state', { state: 'connected' });

    // 2. Resolver la llamada WebRTC y realizar el intercambio SDP con Meta
    sendSandboxLog('WEBRTC', '📡 Realizando intercambio SDP Answer con la API de Graph de Meta...');
    callBridge = await whatsappCallManager.handleIncomingCall({
      callId,
      offerSdp: sdpOffer,
      phoneNumberId: config.phoneNumberId,
      accessToken: config.metaAccessToken,
      iceServers: config.iceServers,
      // Audio recibido desde el teléfono del usuario -> Enviarlo a Gemini Live
      onAudioFromWhatsApp: (pcm16Buffer) => {
        geminiLiveBridge.sendAudio(callId, pcm16Buffer);
      },
      onCallEnded: () => {
        sendSandboxLog('WEBRTC', `🔴 Canal WebRTC de la llamada ${callId} desconectado.`);
        io.emit('webrtc-state', { state: 'disconnected' });
        geminiLiveBridge.closeSession(callId);
      }
    });

    sendSandboxLog('WEBRTC', '🟢 Llamada contestada y enlazada de forma bidireccional con éxito.');
    io.emit('webrtc-state', { state: 'connected' });

  } catch (error) {
    sendSandboxLog('ERROR', '🔴 Fallo al contestar la llamada entrante.', error.message);
    io.emit('webrtc-state', { state: 'failed' });
    whatsappCallManager.endCall(callId);
    geminiLiveBridge.closeSession(callId);
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
  console.log(`⚡ Motor Real de WebRTC WhatsApp & Gemini Live Enlazado`);
  console.log(`🔌 Monitor en caliente de Logs por Sockets activo.`);
  console.log(`=============================================================\n`);
});
