// =========================================================================
// 🔌 WHATSAPP VOICE SDK DASHBOARD CLIENT — CONTROLADOR INTERACTIVO REAL
// =========================================================================
// Conecta el panel web con el backend en caliente vía WebSockets (Socket.io)
// para guardar credenciales persistentes y monitorizar tráfico de voz en tiempo real.

document.addEventListener('DOMContentLoaded', () => {
  
  // Elementos del DOM
  const btnConnect = document.getElementById('btnConnect');
  const phoneIdInput = document.getElementById('phoneId');
  const wabaIdInput = document.getElementById('wabaId');
  const metaTokenInput = document.getElementById('metaToken');
  const metaVerifyInput = document.getElementById('metaVerify');
  const geminiKeyInput = document.getElementById('geminiKey');
  const terminalBody = document.getElementById('terminalBody');
  
  // LEDs indicadores
  const ledMeta = document.getElementById('ledMeta');
  const ledWebRTC = document.getElementById('ledWebRTC');
  const ledGemini = document.getElementById('ledGemini');
  // URL dinámica del backend: Soporta local (localhost:3006) y producción (Render/VPS) de forma automática
  const socketUrl = window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3006';
  appendLog('SYSTEM', `Conectando con el Servidor de Voz en ${socketUrl}...`);

  const socket = io(socketUrl, {
    reconnectionAttempts: 5,
    timeout: 5000
  });

  // Conexión Exitosa con el Servidor
  socket.on('connect', () => {
    appendLog('SYSTEM', '🟢 Conexión activa con el backend. Cargando datos de persistencia...');
    setLedState(ledMeta, 'yellow');
  });

  // Pérdida de Conexión
  socket.on('disconnect', () => {
    appendLog('ERROR', '🔴 Se perdió la conexión con el servidor backend.');
    resetAllLeds();
  });

  // Error de Conexión
  socket.on('connect_error', () => {
    appendLog('ERROR', '⚠️ No se pudo conectar al servidor local. ¿Está iniciado el backend (`npm run dev`)?');
    resetAllLeds();
  });

  // Carga de configuración existente desde la base de datos
  socket.on('current-config', (config) => {
    if (config.phoneNumberId) phoneIdInput.value = config.phoneNumberId;
    if (config.wabaId) wabaIdInput.value = config.wabaId;
    if (config.metaAccessToken) metaTokenInput.value = config.metaAccessToken;
    if (config.metaVerifyToken) metaVerifyInput.value = config.metaVerifyToken;
    if (config.geminiApiKey) geminiKeyInput.value = config.geminiApiKey;

    // Ajustar luces LED en base a los datos cargados
    if (config.phoneNumberId && config.metaAccessToken) {
      setLedState(ledMeta, 'green');
      appendLog('SYSTEM', '✅ Credenciales de Meta cargadas correctamente desde la base de datos.');
    } else {
      setLedState(ledMeta, 'yellow');
      appendLog('WARNING', '⚠️ Faltan credenciales de Meta (Phone Number ID o Access Token) en la base de datos.');
    }

    if (config.geminiApiKey) {
      appendLog('SYSTEM', '🧠 API Key de Gemini cargada correctamente desde la base de datos.');
    } else {
      appendLog('WARNING', '⚠️ Falta configurar la Gemini API Key para que el bot pueda responder.');
    }
  });

  // Recepción de Logs en Caliente de llamadas reales
  socket.on('sandbox-log', (log) => {
    appendLog(log.type, log.message, log.details);
  });

  // Recepción de Estados WebRTC reales
  socket.on('webrtc-state', (data) => {
    if (data.state === 'connected' || data.state === 'stable') {
      setLedState(ledWebRTC, 'green');
      appendLog('WEBRTC', '🟢 Conexión WebRTC completamente establecida y activa.');
    } else if (data.state === 'connecting') {
      setLedState(ledWebRTC, 'yellow');
    } else {
      setLedState(ledWebRTC, 'red');
    }
  });

  // Recepción de Estados Gemini reales
  socket.on('gemini-state', (data) => {
    if (data.state === 'connected') {
      setLedState(ledGemini, 'green');
      appendLog('GEMINI', '🧠 Canal de voz activo en directo con Gemini Live.');
    } else if (data.state === 'connecting') {
      setLedState(ledGemini, 'yellow');
    } else {
      setLedState(ledGemini, 'red');
    }
  });

  // Recepción de llamadas en vivo parpadeando luces
  socket.on('call-state', (data) => {
    if (data.state === 'incoming') {
      appendLog('WHATSAPP', `🔔 ¡Llamada real detectada! Emisor: ${data.caller}`);
      
      // Efecto visual: parpadeo rápido de LEDs al recibir llamada
      let blink = true;
      const interval = setInterval(() => {
        setLedState(ledWebRTC, blink ? 'green' : 'red');
        blink = !blink;
      }, 200);
      
      setTimeout(() => {
        clearInterval(interval);
        setLedState(ledWebRTC, 'yellow');
      }, 3000);
    } else if (data.state === 'terminated') {
      appendLog('WHATSAPP', `📴 Llamada finalizada por el emisor.`);
      resetAllLeds();
      
      // Re-establecemos Meta en verde ya que las credenciales siguen cargadas
      const hasCreds = phoneIdInput.value && metaTokenInput.value;
      setLedState(ledMeta, hasCreds ? 'green' : 'yellow');
    }
  });

  // =========================================================================
  // 🔘 ACCIONES DE BOTONES (GUARDAR CREDENCIALES PERSISTENTES)
  // =========================================================================

  btnConnect.addEventListener('click', () => {
    const phoneNumberId = phoneIdInput.value.trim();
    const wabaId = wabaIdInput.value.trim();
    const metaAccessToken = metaTokenInput.value.trim();
    const metaVerifyToken = metaVerifyInput.value.trim() || 'whatsapp_voice_sdk_verify_token';
    const geminiApiKey = geminiKeyInput.value.trim();

    if (!phoneNumberId || !metaAccessToken || !geminiApiKey) {
      appendLog('WARNING', '⚠️ Por favor, ingresa los campos requeridos (*) antes de guardar.');
      alert('Por favor, completa los campos requeridos (*): Phone Number ID, Access Token y Gemini API Key.');
      return;
    }

    appendLog('CONFIG', '⚙️ Sincronizando credenciales en caliente con la base de datos...');

    // Emitimos el evento de actualización para que se guarde de forma permanente
    socket.emit('update-config', {
      phoneNumberId,
      wabaId,
      metaAccessToken,
      metaVerifyToken,
      geminiApiKey
    });
  });

  // Escucha de respuesta de confirmación de base de datos
  socket.on('config-updated', (res) => {
    if (res.success) {
      appendLog('CONFIG', '🟢 Credenciales guardadas y persistidas correctamente en database.json.');
      setLedState(ledMeta, 'green');
      alert('¡Credenciales guardadas y sincronizadas con éxito!');
    } else {
      appendLog('ERROR', '🔴 Error al intentar guardar la configuración en la base de datos.');
      alert('Hubo un error al guardar la configuración en el servidor.');
    }
  });

  // =========================================================================
  // 🛠️ FUNCIONES AUXILIARES DE RENDERIZADO
  // =========================================================================

  // Agrega un log con estilos a la terminal en pantalla
  function appendLog(type, message, details = '') {
    const time = new Date().toLocaleTimeString();
    
    const logLine = document.createElement('div');
    logLine.className = `log-line ${type.toLowerCase()}`;
    
    // Tag de Tiempo
    const timeSpan = document.createElement('span');
    timeSpan.className = 't-time';
    timeSpan.textContent = `[${time}]`;
    logLine.appendChild(timeSpan);
    
    // Tag de Módulo
    const tagSpan = document.createElement('span');
    tagSpan.className = 't-tag';
    tagSpan.textContent = `[${type}]`;
    logLine.appendChild(tagSpan);
    
    // Mensaje Principal
    const messageSpan = document.createElement('span');
    
    if (details) {
      messageSpan.innerHTML = `${message} <span style="color: var(--text-muted); font-size: 0.8rem;">${JSON.stringify(details)}</span>`;
    } else {
      messageSpan.textContent = message;
    }
    logLine.appendChild(messageSpan);
    
    terminalBody.appendChild(logLine);
    
    // Auto-scroll hacia abajo de la terminal
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  // Cambia el estado visual de los focos LED
  function setLedState(ledElement, state) {
    ledElement.className = 'led';
    if (state === 'green') {
      ledElement.classList.add('led-green');
    } else if (state === 'yellow') {
      ledElement.classList.add('led-yellow');
    } else {
      ledElement.classList.add('led-red');
    }
  }

  // Resetea las luces de canales
  function resetAllLeds() {
    setLedState(ledMeta, 'red');
    setLedState(ledWebRTC, 'red');
    setLedState(ledGemini, 'red');
  }

});
