// =========================================================================
// 🔌 WHATSAPP VOICE SDK SANDBOX CLIENT — CONTROLADOR INTERACTIVO DE PANTALLA
// =========================================================================
// Conecta el portal web con el motor de llamadas local vía WebSockets.

document.addEventListener('DOMContentLoaded', () => {
  
  // Elementos del DOM
  const btnConnect = document.getElementById('btnConnect');
  const btnSimulate = document.getElementById('btnSimulate');
  const metaTokenInput = document.getElementById('metaToken');
  const metaVerifyInput = document.getElementById('metaVerify');
  const geminiKeyInput = document.getElementById('geminiKey');
  const terminalBody = document.getElementById('terminalBody');
  
  // LEDs indicadores
  const ledMeta = document.getElementById('ledMeta');
  const ledWebRTC = document.getElementById('ledWebRTC');
  const ledGemini = document.getElementById('ledGemini');

  // Intentamos conectar con el servidor Socket.io en el puerto 3006
  const socketUrl = 'http://localhost:3006';
  appendLog('SYSTEM', `Conectando con el Servidor Node de Voz en ${socketUrl}...`);

  const socket = io(socketUrl, {
    reconnectionAttempts: 5,
    timeout: 5000
  });

  // =========================================================================
  // ⚡ EVENTOS DEL SOCKET (RECPCION DE DATOS DEL SERVIDOR)
  // =========================================================================

  // Conexión Exitosa
  socket.on('connect', () => {
    appendLog('SYSTEM', '🟢 Enlace establecido con el socket de logs en caliente del Backend.');
    
    // Encendemos el LED de Meta en Amarillo (Esperando que guarde llaves o valide webhook)
    setLedState(ledMeta, 'yellow');
  });

  // Pérdida de Conexión
  socket.on('disconnect', () => {
    appendLog('ERROR', '🔴 Se perdió la conexión con el servidor backend de telefonía.');
    resetAllLeds();
  });

  // Error de Conexión
  socket.on('connect_error', () => {
    appendLog('ERROR', '⚠️ No se pudo conectar al servidor local en puerto 3006. ¿Está iniciado el backend?');
    resetAllLeds();
  });

  // Carga de configuración existente
  socket.on('current-config', (config) => {
    if (config.hasMetaToken) {
      metaTokenInput.value = '••••••••••••••••••••••••';
      setLedState(ledMeta, 'green');
    }
    if (config.metaVerifyToken) {
      metaVerifyInput.value = config.metaVerifyToken;
    }
    if (config.hasGeminiKey) {
      geminiKeyInput.value = '••••••••••••••••••••••••';
    }
  });

  // Recepción de Logs en Caliente
  socket.on('sandbox-log', (log) => {
    appendLog(log.type, log.message, log.details);
  });

  // Recepción de Estados WebRTC
  socket.on('webrtc-state', (data) => {
    if (data.state === 'connected' || data.state === 'stable') {
      setLedState(ledWebRTC, 'green');
    } else if (data.state === 'connecting') {
      setLedState(ledWebRTC, 'yellow');
    } else {
      setLedState(ledWebRTC, 'red');
    }
  });

  // Recepción de Estados Gemini
  socket.on('gemini-state', (data) => {
    if (data.state === 'connected') {
      setLedState(ledGemini, 'green');
    } else if (data.state === 'connecting') {
      setLedState(ledGemini, 'yellow');
    } else {
      setLedState(ledGemini, 'red');
    }
  });

  // Recepción de llamada en caliente
  socket.on('call-state', (data) => {
    if (data.state === 'incoming') {
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
    }
  });

  // =========================================================================
  // 🔘 ACCIONES DE BOTONES (ENVÍO DE EVENTOS AL SERVIDOR)
  // =========================================================================

  // Guardar credenciales en caliente
  btnConnect.addEventListener('click', () => {
    const metaToken = metaTokenInput.value.trim();
    const metaVerify = metaVerifyInput.value.trim() || 'whatsapp_voice_sdk_verify_token';
    const geminiKey = geminiKeyInput.value.trim();

    if (!metaToken || !geminiKey) {
      appendLog('WARNING', '⚠️ Por favor, ingresa tu Meta Token y tu Gemini API Key antes de conectar.');
      return;
    }

    appendLog('CONFIG', '⚙️ Sincronizando credenciales en caliente con el servidor...');

    // Emitimos el evento de actualización de configuración al backend Node
    socket.emit('update-config', {
      metaAccessToken: metaToken === '••••••••••••••••••••••••' ? '' : metaToken,
      metaVerifyToken: metaVerify,
      geminiApiKey: geminiKey === '••••••••••••••••••••••••' ? '' : geminiKey
    });
  });

  // Escucha de respuesta de configuración guardada
  socket.on('config-updated', (res) => {
    if (res.success) {
      appendLog('CONFIG', '🟢 Credenciales guardadas correctamente en la memoria del servidor.');
      setLedState(ledMeta, 'green');
    }
  });

  // Lanzar simulación de llamada en vivo
  btnSimulate.addEventListener('click', () => {
    socket.emit('simulate-call');
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

  // Resetea todas las luces a rojo apagado
  function resetAllLeds() {
    setLedState(ledMeta, 'red');
    setLedState(ledWebRTC, 'red');
    setLedState(ledGemini, 'red');
  }

});
