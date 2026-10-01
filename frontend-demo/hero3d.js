/**
 * hero3d.js — lightweight Three.js particle globe for the Foundry landing page.
 *
 * Creates a rotating sphere of particles with connecting lines, resembling a
 * data-network globe. Gracefully no-ops if Three.js fails to load or the canvas
 * is missing.
 */

(function initHero3D() {
  // Wait for Three.js to be available (loaded via defer)
  function tryInit() {
    const canvas = document.getElementById("heroCanvas");
    if (!canvas || !window.THREE) return;

    const THREE = window.THREE;

    /* ── Renderer ────────────────────────────────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.offsetWidth || window.innerWidth, canvas.offsetHeight || window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    /* ── Scene & Camera ──────────────────────────────────────────────────── */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, canvas.offsetWidth / canvas.offsetHeight, 0.1, 1000);
    camera.position.set(0, 0, 3.8);

    /* ── Particles on a sphere ───────────────────────────────────────────── */
    const COUNT = 600;
    const positions = new Float32Array(COUNT * 3);
    const colors    = new Float32Array(COUNT * 3);
    const radius    = 1.5;

    const palette = [
      new THREE.Color("#3987e5"),
      new THREE.Color("#5b6df8"),
      new THREE.Color("#a78bfa"),
      new THREE.Color("#d95926"),
      new THREE.Color("#ffffff"),
    ];

    for (let i = 0; i < COUNT; i++) {
      // Fibonacci sphere distribution for even spread
      const phi   = Math.acos(1 - 2 * (i + 0.5) / COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      positions[i * 3]     = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const c = palette[i % palette.length];
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.028,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    scene.add(points);

    /* ── Connecting arc lines (sparse, beautiful) ────────────────────────── */
    const linePositions = [];
    const threshold = 0.32; // only draw lines between nearby points

    for (let i = 0; i < COUNT; i++) {
      for (let j = i + 1; j < COUNT; j++) {
        const dx = positions[i * 3]     - positions[j * 3];
        const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
        const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
        const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < threshold) {
          linePositions.push(
            positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
            positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]
          );
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));

    const lineMat = new THREE.LineBasicMaterial({
      color: 0x3987e5,
      transparent: true,
      opacity: 0.12,
    });

    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    /* ── Resize handling ─────────────────────────────────────────────────── */
    function onResize() {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", onResize, { passive: true });

    /* ── Animation loop ──────────────────────────────────────────────────── */
    let running = true;

    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);

      const t = performance.now() * 0.0001;
      points.rotation.y = t * 0.55;
      points.rotation.x = Math.sin(t * 0.3) * 0.12;
      lines.rotation.y  = points.rotation.y;
      lines.rotation.x  = points.rotation.x;

      renderer.render(scene, camera);
    }

    animate();

    // Stop rendering when the hero is no longer visible (saves GPU when in app)
    const observer = new IntersectionObserver((entries) => {
      running = entries[0].isIntersecting;
      if (running) animate();
    }, { threshold: 0.01 });
    observer.observe(canvas);
  }

  // Three.js is loaded with `defer` — poll until it's ready
  let attempts = 0;
  const check = setInterval(() => {
    attempts++;
    if (window.THREE || attempts > 50) {
      clearInterval(check);
      tryInit();
    }
  }, 100);
})();
