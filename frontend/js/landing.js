document.addEventListener('DOMContentLoaded', () => {

  /* =====================================================
     1. MODALES LEGALES
  ===================================================== */
  const openModal  = (m) => { if (m) { m.style.display = 'flex'; m.offsetHeight; m.classList.add('active'); } };
  const closeModal = (m) => { if (m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } };
  const tm = document.getElementById('termsModal');
  const pm = document.getElementById('privacyModal');
  document.getElementById('linkTerms')?.addEventListener('click',   (e) => { e.preventDefault(); openModal(tm); });
  document.getElementById('linkPrivacy')?.addEventListener('click',  (e) => { e.preventDefault(); openModal(pm); });
  document.getElementById('closeTerms')?.addEventListener('click',  () => closeModal(tm));
  document.getElementById('closePrivacy')?.addEventListener('click', () => closeModal(pm));
  [tm, pm].forEach(m => m?.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));


  /* =====================================================
     2. MOTOR CINEMATOGRÁFICO — AUTOMÁTICO (TIME-DRIVEN)
  ===================================================== */
  const filmLine = document.getElementById('filmLine');
  const video    = document.getElementById('heroVideo');
  const texts    = document.querySelectorAll('.float-text');
  const phoneEl  = document.getElementById('cinematicPhone');

  if (filmLine && video) {
    setTimeout(() => { filmLine.classList.add('expand-width'); }, 300);

    setTimeout(() => {
      filmLine.classList.add('expand-height');
      filmLine.classList.add('video-visible');
      video.play().catch(() => {});
    }, 1000);

    setTimeout(() => {
      let delay = 0;
      texts.forEach(txt => {
        setTimeout(() => txt.classList.add('visible'), delay);
        delay += 200;
      });
      if (phoneEl) setTimeout(() => phoneEl.classList.add('visible'), 500);
    }, 1600);
  }


  /* =====================================================
     3. BUILD-ON-SCROLL (Intersection Observer)
  ===================================================== */
  const buildItems = document.querySelectorAll('.build-item');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('built'); });
  }, { threshold: 0.15 });
  buildItems.forEach(item => io.observe(item));


  /* =====================================================
     4. INTERCAMBIO DINÁMICO DE IMÁGENES
  ===================================================== */
  const dynamicImg = document.getElementById('dynamicStatsImg');
  if (dynamicImg) {
    const images = ['assets/b2b_brain.png', 'assets/b2b_hero.png'];
    let currentIndex = 0;
    dynamicImg.style.transition = 'opacity 0.8s ease';
    setInterval(() => {
      dynamicImg.style.opacity = '0';
      setTimeout(() => {
        currentIndex = (currentIndex + 1) % images.length;
        dynamicImg.src = images[currentIndex];
        dynamicImg.style.opacity = '1';
      }, 800);
    }, 4000);
  }


  /* =====================================================
     5. MOTOR 3D — INCLINACIÓN DE TARJETAS CON EL RATÓN
     Las tarjetas se inclinan en 3D siguiendo el cursor
     con reflejo de luz dinámico que sigue al ratón.
  ===================================================== */
  const tiltCards = document.querySelectorAll('.feat-card, .video-container');
  const MAX_TILT  = 14;

  tiltCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x    = e.clientX - rect.left;
      const y    = e.clientY - rect.top;
      const cx   = rect.width  / 2;
      const cy   = rect.height / 2;
      const rotY =  ((x - cx) / cx) * MAX_TILT;
      const rotX = -((y - cy) / cy) * MAX_TILT;

      card.style.transform  = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.04)`;
      card.style.transition = 'transform 0.08s ease';
      card.style.setProperty('--glow-x', `${(x / rect.width)  * 100}%`);
      card.style.setProperty('--glow-y', `${(y / rect.height) * 100}%`);
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform  = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)';
      card.style.transition = 'transform 0.7s cubic-bezier(0.23, 1, 0.32, 1)';
    });
  });


  /* =====================================================
     6. PARALLAX — EL FONDO SIGUE AL RATÓN (suave)
  ===================================================== */
  let mouseX = 0, mouseY = 0, curX = 0, curY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  (function parallaxLoop() {
    curX += (mouseX - curX) * 0.05;
    curY += (mouseY - curY) * 0.05;
    document.body.style.backgroundPosition =
      `${50 + curX * 4}% ${50 + curY * 4}%, ` +
      `${50 + curX * 4}% ${50 + curY * 4}%, ` +
      `${curX * -12}px ${curY * -12}px`;
    requestAnimationFrame(parallaxLoop);
  })();


  /* =====================================================
     7. CANVAS NEURAL — LÍNEAS Y NODOS VIVOS
     60 partículas que flotan, se conectan con líneas
     doradas/cobre y pulsan como paquetes de datos.
     El cursor ATRAE a los nodos hacia él en tiempo real.
  ===================================================== */
  const canvas = document.getElementById('neuralCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Crear nodos
  const NUM_NODES = 65;
  const MAX_DIST  = 175;
  const nodes = Array.from({ length: NUM_NODES }, () => ({
    x:     Math.random() * window.innerWidth,
    y:     Math.random() * window.innerHeight,
    vx:    (Math.random() - 0.5) * 0.55,
    vy:    (Math.random() - 0.5) * 0.55,
    r:     Math.random() * 2.2 + 0.8,
    pulse: 0,
  }));

  // Disparar pulsos de energía cada 380ms
  setInterval(() => {
    nodes[Math.floor(Math.random() * nodes.length)].pulse = 1.0;
  }, 380);

  // Seguimiento del cursor para atraer nodos
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });

  function drawNeural() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mover cada nodo
    nodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;

      // Rebotar en bordes
      if (n.x < 0 || n.x > canvas.width)  n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;

      // Atracción suave al cursor
      const ddx = mx - n.x, ddy = my - n.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist < 220) {
        n.x += ddx * 0.003;
        n.y += ddy * 0.003;
      }

      // Dibujar nodo con glow
      const gAlpha  = n.pulse > 0 ? 0.95 : 0.5;
      const gRadius = n.r * (n.pulse > 0 ? 4 : 2);
      const grad    = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, gRadius * 3);
      grad.addColorStop(0,   `rgba(220, 180, 60, ${gAlpha})`);
      grad.addColorStop(0.4, `rgba(190, 140, 40, ${gAlpha * 0.4})`);
      grad.addColorStop(1,   `rgba(212, 175, 55, 0)`);

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (n.pulse > 0 ? 3 : 1), 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Bajar el pulso paulatinamente
      if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - 0.018);
    });

    // Trazar líneas entre nodos cercanos
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d  = Math.sqrt(dx * dx + dy * dy);

        if (d < MAX_DIST) {
          const alpha  = (1 - d / MAX_DIST) * 0.38;
          const pulsed = (a.pulse + b.pulse) * 0.5;

          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = pulsed > 0
            ? `rgba(255, 245, 200, ${alpha + pulsed * 0.55})`
            : `rgba(190, 145, 50, ${alpha})`;
          ctx.lineWidth = pulsed > 0 ? 1.8 : 0.7;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(drawNeural);
  }

  drawNeural();

});
