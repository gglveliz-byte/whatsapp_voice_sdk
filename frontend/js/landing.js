document.addEventListener('DOMContentLoaded', () => {

  /* =====================================================
     1. MODALES LEGALES
  ===================================================== */
  const openModal = (m) => { if(m) { m.style.display = 'flex'; m.offsetHeight; m.classList.add('active'); } };
  const closeModal = (m) => { if(m) { m.classList.remove('active'); setTimeout(()=>m.style.display='none',300); } };
  const tm = document.getElementById('termsModal'), pm = document.getElementById('privacyModal');
  document.getElementById('linkTerms')?.addEventListener('click', (e) => { e.preventDefault(); openModal(tm); });
  document.getElementById('linkPrivacy')?.addEventListener('click', (e) => { e.preventDefault(); openModal(pm); });
  document.getElementById('closeTerms')?.addEventListener('click', () => closeModal(tm));
  document.getElementById('closePrivacy')?.addEventListener('click', () => closeModal(pm));
  [tm, pm].forEach(m => m?.addEventListener('click', (e) => { if(e.target === m) closeModal(m); }));


  /* =====================================================
     2. MOTOR CINEMATOGRÁFICO — AUTOMÁTICO (TIME-DRIVEN)
  ===================================================== */
  const filmLine  = document.getElementById('filmLine');
  const video     = document.getElementById('heroVideo');
  const texts     = document.querySelectorAll('.float-text');
  const phoneEl   = document.getElementById('cinematicPhone');

  if (filmLine && video) {
    // 1. Expandir a lo ancho (0.3s)
    setTimeout(() => {
      filmLine.classList.add('expand-width');
    }, 300);

    // 2. Expandir a lo alto y reproducir video (1.0s)
    setTimeout(() => {
      filmLine.classList.add('expand-height');
      filmLine.classList.add('video-visible');
      video.play().catch(()=>{});
    }, 1000);

    // 3. Textos y teléfono entrando secuencialmente (1.6s)
    setTimeout(() => {
      let delay = 0;
      texts.forEach(txt => {
        setTimeout(() => txt.classList.add('visible'), delay);
        delay += 200; // cascada de 0.2s entre textos
      });
      
      // El teléfono entra justo a la mitad de la presentación de textos
      if (phoneEl) {
        setTimeout(() => phoneEl.classList.add('visible'), 500);
      }
    }, 1600);
  }

  /* =====================================================
     3. BUILD-ON-SCROLL: Intersection Observer para secciones post-video
  ===================================================== */
  const buildItems = document.querySelectorAll('.build-item');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('built');
      }
    });
  }, { threshold: 0.15 });

  buildItems.forEach(item => io.observe(item));

  /* =====================================================
     4. INTERCAMBIO DINÁMICO DE IMÁGENES (IMPACTO)
  ===================================================== */
  const dynamicImg = document.getElementById('dynamicStatsImg');
  if (dynamicImg) {
    const images = ['assets/b2b_brain.png', 'assets/b2b_hero.png'];
    let currentIndex = 0;
    
    // Preparar la imagen para transición suave
    dynamicImg.style.transition = 'opacity 0.8s ease';
    
    setInterval(() => {
      dynamicImg.style.opacity = '0'; // Se desvanece
      
      setTimeout(() => {
        currentIndex = (currentIndex + 1) % images.length;
        dynamicImg.src = images[currentIndex];
        dynamicImg.style.opacity = '1'; // Aparece la nueva
      }, 800);
      
    }, 4000); // Rota cada 4 segundos
  }

});
