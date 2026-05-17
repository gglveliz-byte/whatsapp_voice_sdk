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
  // URL dinámica del backend: Soporta local (localhost:3001) y producción (Render backend) de forma automática
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  // Si está integrado en el SaaS principal usa puerto 3001, sino (standalone) usa puerto 3006
  const socketUrl = isLocal 
    ? (window.location.port === '3000' || window.location.port === '3001' ? 'http://localhost:3001' : 'http://localhost:3006')
    : 'https://neurochat-xtwp.onrender.com';
  appendLog('SYSTEM', `Conectando con el Servidor de Voz en ${socketUrl}...`);

  const socket = io(socketUrl, {
    reconnectionAttempts: 5,
    timeout: 5000,
    transports: ['websocket', 'polling']
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

  // Temporizador de Sesión Segura (30 Minutos)
  let sessionInterval;
  function startSessionTimer() {
    const timerDisplay = document.getElementById('sessionTimer');
    if (!timerDisplay) return;
    
    clearInterval(sessionInterval);
    let secondsLeft = 30 * 60; // 30 minutos
    
    function updateDisplay() {
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      if (secondsLeft <= 0) {
        clearInterval(sessionInterval);
        timerDisplay.textContent = "00:00";
        appendLog('WARNING', '⚠️ Sesión expirada. Por seguridad las credenciales se han destruido en el servidor.');
      }
      secondsLeft--;
    }
    
    updateDisplay();
    sessionInterval = setInterval(updateDisplay, 1000);
  }

  // Escucha de respuesta de confirmación de base de datos
  socket.on('config-updated', (res) => {
    if (res.success) {
      appendLog('CONFIG', '🟢 Credenciales guardadas con éxito (Aisladas en Enrutador B2B).');
      setLedState(ledMeta, 'green');
      startSessionTimer(); // Inicia la cuenta regresiva visible
      alert('¡Credenciales seguras guardadas! La sesión durará 30 minutos.');
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
    timeSpan.textContent = time;
    logLine.appendChild(timeSpan);
    
    // Mapeo de Iconos por Tipo de Log
    let iconHTML = '';
    const cleanType = type.toUpperCase();
    if (cleanType === 'SYSTEM') iconHTML = '<i class="fa-solid fa-server"></i>';
    else if (cleanType === 'META') iconHTML = '<i class="fa-brands fa-meta"></i>';
    else if (cleanType === 'WEBRTC') iconHTML = '<i class="fa-solid fa-network-wired"></i>';
    else if (cleanType === 'GEMINI') iconHTML = '<i class="fa-solid fa-brain"></i>';
    else if (cleanType === 'WHATSAPP') iconHTML = '<i class="fa-brands fa-whatsapp"></i>';
    else if (cleanType === 'CONFIG') iconHTML = '<i class="fa-solid fa-gear"></i>';
    else if (cleanType === 'ERROR') iconHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    else if (cleanType === 'WARNING') iconHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    else iconHTML = '<i class="fa-solid fa-circle-info"></i>';

    // Tag de Módulo
    const tagSpan = document.createElement('span');
    tagSpan.className = 't-tag';
    tagSpan.innerHTML = `${iconHTML} ${type}`;
    logLine.appendChild(tagSpan);
    
    // Mensaje Principal
    const messageSpan = document.createElement('span');
    messageSpan.style.flexGrow = '1';
    
    if (details) {
      const detailsStr = typeof details === 'object' ? JSON.stringify(details, null, 2) : details;
      messageSpan.innerHTML = `${message} <span style="display: block; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); background: rgba(0,0,0,0.02); padding: 8px 12px; border-radius: 8px; margin-top: 6px; border: 1px dashed rgba(0,0,0,0.06); max-height: 120px; overflow-y: auto; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">${detailsStr}</span>`;
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

  // =========================================================================
  // 🎠 CONTROLADOR DE CARRUSEL PASO A PASO PROFESIONAL (META DEVELOPERS)
  // =========================================================================
  const carouselSteps = [
    {
      title: "1. Registrarse en Meta Developers",
      content: `El primer paso es tener un perfil de desarrollador en Meta. Ve a <a href="https://developers.facebook.com/" target="_blank">developers.facebook.com</a>, inicia sesión con tu cuenta de Facebook y completa el registro sencillo.<br><img src="guia/image.png" class="carousel-step-img" alt="Portal de Desarrolladores">`
    },
    {
      title: "2. Crear una Aplicación de Negocio",
      content: `Entra a la sección "Mis Apps" y haz clic en <a href="https://developers.facebook.com/apps/creation/" target="_blank">Crear App</a>. Selecciona la opción de caso de uso <b>"Otros"</b> o <b>"Negocios"</b>. Esto te habilitará las APIs empresariales necesarias.<br><img src="guia/image copy 2.png" class="carousel-step-img" alt="Crear Aplicación">`
    },
    {
      title: "3. Agregar el Producto WhatsApp",
      content: `En el menú lateral de tu nueva App, deslízate hasta <b>"Agregar Producto"</b>. Busca el módulo de <b>WhatsApp</b> en el listado y haz clic en <b>Configurar</b> para agregarlo a tu aplicación.<br><img src="guia/image copy 3.png" class="carousel-step-img" alt="Agregar WhatsApp">`
    },
    {
      title: "4. Entrar a Configuración de la API",
      content: `Navega en el menú lateral a <b>WhatsApp ➔ Configuración de la API</b>. Desliza la pantalla hacia abajo hasta encontrar la sección de <b>Configuración de Webhooks</b> y haz clic en ella.<br><img src="guia/image copy 4.png" class="carousel-step-img" alt="Configuración de la API">`
    },
    {
      title: "5. Configurar URL de Devolución",
      content: `Edita tu Webhook de WhatsApp y completa las casillas con tus datos del servidor en caliente:<br>
      • <b>URL de devolución de llamada</b>: <code>${socketUrl}/api/v1/webhook/meta</code><br>
      • <b>Token de verificación</b>: El token inventado que pusiste en el Dashboard.<br>
      <div style="margin-top: 8px; font-size: 0.85rem; color: #d97706; background: rgba(217, 119, 6, 0.1); padding: 8px; border-radius: 6px;">
        <i class="fa-solid fa-stopwatch"></i> <strong>Nota:</strong> Al guardar en el Dashboard, tienes <b>30 minutos exactos</b> para probar. Luego la sesión se destruye.
      </div>
      <img src="guia/image copy 5.png" class="carousel-step-img" alt="Enlazar Webhook">`
    },
    {
      title: "6. Suscribirse a Campos de Webhook (Voz, Chats y Ecos)",
      content: `Una vez enlazado el webhook, haz clic en el botón de campos y suscríbete obligatoriamente a los siguientes tres eventos de Meta para capturar las señales:<br>
      • <b><code>calls</code></b> (¡Voz WebRTC entrante!)<br>
      • <b><code>messages</code></b> (Chat normal y texto)<br>
      • <b><code>smb_message_echoes</code></b> (Ecos de mensajes de la IA)<br>
      <div class="carousel-images-row">
        <img src="guia/image copy 6.png" class="carousel-step-img half-width" alt="Campos Webhook Parte 1">
        <img src="guia/image copy 7.png" class="carousel-step-img half-width" alt="Campos Webhook Parte 2">
      </div>`
    },
    {
      title: "7. Copiar Credenciales a la Consola",
      content: `En la pantalla de WhatsApp ➔ Configuración de la API encontrarás el <b>Phone Number ID</b>, el <b>WABA ID</b> y podrás generar un <b>Access Token</b> temporal de pruebas. Copia estos datos y pégalos en el formulario de arriba.<br><img src="guia/image copy 8.png" class="carousel-step-img" alt="Credenciales de API">`
    },
    {
      title: "8. Guardar y Conectar en Caliente",
      content: `¡Listo! Rellena los datos en el panel superior, haz clic en <b>Guardar y Conectar en Caliente</b> y verás las luces de estado encenderse en verde. Estás listo para recibir y contestar llamadas WebRTC con la voz de Gemini en tiempo real.<br><img src="guia/image copy 9.png" class="carousel-step-img" alt="Conexión en Caliente Exitosa">`
    }
  ];

  let currentStep = 0;
  const stepBadge = document.getElementById('stepBadge');
  const stepTitle = document.getElementById('stepTitle');
  const stepContent = document.getElementById('stepContent');
  const carouselProgress = document.getElementById('carouselProgress');
  const btnPrevStep = document.getElementById('btnPrevStep');
  const btnNextStep = document.getElementById('btnNextStep');

  function renderStep(index) {
    if (index < 0 || index >= carouselSteps.length) return;
    
    // Animación de opacidad suave
    stepContent.style.opacity = 0;
    
    setTimeout(() => {
      currentStep = index;
      const step = carouselSteps[index];
      
      stepBadge.textContent = `Paso ${currentStep + 1} de ${carouselSteps.length}`;
      stepTitle.textContent = step.title;
      stepContent.innerHTML = step.content;
      
      // Barra de progreso dinámica
      const percent = ((currentStep + 1) / carouselSteps.length) * 100;
      carouselProgress.style.width = `${percent}%`;
      
      // Control de estado de botones
      btnPrevStep.disabled = currentStep === 0;
      if (currentStep === carouselSteps.length - 1) {
        btnNextStep.innerHTML = '¡Completado! <i class="fa-solid fa-check"></i>';
      } else {
        btnNextStep.innerHTML = 'Siguiente <i class="fa-solid fa-chevron-right"></i>';
      }
      
      stepContent.style.opacity = 1;
    }, 150);
  }

  // Enlazar eventos de clics para navegación del carrusel
  if (btnPrevStep && btnNextStep) {
    btnPrevStep.addEventListener('click', () => {
      renderStep(currentStep - 1);
    });
    
    btnNextStep.addEventListener('click', () => {
      if (currentStep < carouselSteps.length - 1) {
        renderStep(currentStep + 1);
      } else {
        // Enfoque visual al formulario al completar el tutorial
        const firstInput = document.getElementById('phoneId');
        if (firstInput) {
          firstInput.focus();
          firstInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });

    // Carga del primer paso al iniciar
    renderStep(0);
  }

  // =========================================================================
  // 🔍 MODAL LIGHTBOX PARA ZOOM DE CAPTURAS EN EL CARRUSEL
  // =========================================================================
  const lightbox = document.getElementById('imageLightbox');
  const lightboxImg = document.getElementById('lightboxImage');
  const lightboxClose = document.querySelector('.lightbox-close');

  if (stepContent && lightbox && lightboxImg) {
    // Delegación de eventos para abrir al dar click en cualquier captura
    stepContent.addEventListener('click', (e) => {
      if (e.target.classList.contains('carousel-step-img')) {
        lightboxImg.src = e.target.src;
        lightboxImg.alt = e.target.alt;
        lightbox.classList.add('active');
      }
    });

    // Cerrar al hacer click en la cruz
    if (lightboxClose) {
      lightboxClose.addEventListener('click', () => {
        lightbox.classList.remove('active');
      });
    }

    // Cerrar al hacer click fuera de la imagen (en el fondo difuminado)
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        lightbox.classList.remove('active');
      }
    });

    // Cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('active')) {
        lightbox.classList.remove('active');
      }
    });
  }

  // =========================================================================
  // ⚖️ CONTROLADOR DE MODALES LEGALES (TÉRMINOS Y PRIVACIDAD)
  // =========================================================================
  const linkTerms = document.getElementById('linkTerms');
  const linkPrivacy = document.getElementById('linkPrivacy');
  const termsModal = document.getElementById('termsModal');
  const privacyModal = document.getElementById('privacyModal');
  const closeTerms = document.getElementById('closeTerms');
  const closePrivacy = document.getElementById('closePrivacy');

  const openLegalModal = (modal) => {
    if (modal) {
      modal.style.display = 'flex';
      // Reflow for transition
      modal.offsetHeight;
      modal.classList.add('active');
    }
  };

  const closeLegalModal = (modal) => {
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    }
  };

  if (linkTerms && termsModal) {
    linkTerms.addEventListener('click', (e) => {
      e.preventDefault();
      openLegalModal(termsModal);
    });
  }

  if (linkPrivacy && privacyModal) {
    linkPrivacy.addEventListener('click', (e) => {
      e.preventDefault();
      openLegalModal(privacyModal);
    });
  }

  if (closeTerms && termsModal) {
    closeTerms.addEventListener('click', () => closeLegalModal(termsModal));
  }

  if (closePrivacy && privacyModal) {
    closePrivacy.addEventListener('click', () => closeLegalModal(privacyModal));
  }

  // Cerrar al hacer clic fuera del contenido del modal
  [termsModal, privacyModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeLegalModal(modal);
        }
      });
    }
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLegalModal(termsModal);
      closeLegalModal(privacyModal);
    }
  });

});
