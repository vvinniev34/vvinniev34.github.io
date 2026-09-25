/* ============================================================================
   canvas.js — the drifting field behind your name.

   A few hundred particles following a slowly-rotating flow field, leaving
   short trails in your accent colour. They bend away from the cursor. No
   library, no assets, ~1kb of state.

   Set `heroCanvas: false` in resume.js to remove it.
   ========================================================================== */

(function () {
  "use strict";

  var R = typeof RESUME !== "undefined" ? RESUME : null;
  if (!R || R.heroCanvas === false) return;

  var masthead = document.querySelector(".masthead");
  if (!masthead) return;

  var cv = document.createElement("canvas");
  cv.className = "hero__canvas";
  cv.setAttribute("aria-hidden", "true");
  masthead.insertBefore(cv, masthead.firstChild);

  var ctx = cv.getContext("2d");
  if (!ctx) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, dpr = 1;
  var parts = [];
  var t = 0;
  var mouse = { x: -9999, y: -9999, on: false };
  var running = false, raf = null;

  /* Read the live theme colours so the field recolours with the toggle. */
  var accent = "#b4451f", bg = "#faf8f4";
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    accent = (cs.getPropertyValue("--accent") || accent).trim();
    bg = (cs.getPropertyValue("--bg") || bg).trim();
  }

  function resize() {
    // Measure the canvas as CSS lays it out (it bleeds wider than the text
    // column) rather than imposing a size and fighting the stylesheet.
    var r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Density scales with area so phones don't melt.
    var target = Math.round(Math.min(520, (W * H) / 2600));
    parts = [];
    for (var i = 0; i < target; i++) parts.push(spawn());

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function spawn(p) {
    p = p || {};
    p.x = Math.random() * W;
    p.y = Math.random() * H;
    p.px = p.x;
    p.py = p.y;
    p.life = 60 + Math.random() * 180;
    p.w = Math.random() < 0.12 ? 1.3 : 0.6;   // a few heavier strands
    return p;
  }

  /* Cheap smooth field — not true Perlin, but it reads the same at this scale. */
  function angleAt(x, y, time) {
    var a = Math.sin(x * 0.0042 + time) * Math.cos(y * 0.0049 - time * 0.7);
    var b = Math.sin((x + y) * 0.0027 + time * 1.4) * 0.6;
    var c = Math.cos(y * 0.0033 - time * 0.45) * 0.4;
    return (a + b + c) * Math.PI;
  }

  /* Trails need the previous frame to survive, so everything is drawn onto an
     offscreen buffer that we fade slightly each tick, then blit across. */
  var buf = document.createElement("canvas");
  var bctx = buf.getContext("2d");

  function ensureBuffer() {
    if (buf.width === cv.width && buf.height === cv.height) return;
    buf.width = cv.width;
    buf.height = cv.height;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.fillStyle = bg;
    bctx.fillRect(0, 0, W, H);
  }

  /* One simulation tick: advance every particle and draw its segment. */
  function advance() {
    t += 0.0016;
    ensureBuffer();

    // Fade what's already there, so old trail segments decay away.
    bctx.globalCompositeOperation = "source-over";
    bctx.globalAlpha = 0.055;
    bctx.fillStyle = bg;
    bctx.fillRect(0, 0, W, H);
    bctx.globalAlpha = 1;
    bctx.lineCap = "round";

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var ang = angleAt(p.x, p.y, t);
      var vx = Math.cos(ang) * 1.15;
      var vy = Math.sin(ang) * 1.15;

      if (mouse.on) {
        var dx = p.x - mouse.x, dy = p.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 26000 && d2 > 0.5) {
          var f = (26000 - d2) / 26000, d = Math.sqrt(d2);
          vx += (dx / d) * f * 3.6;
          vy += (dy / d) * f * 3.6;
        }
      }

      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy;
      p.life--;

      if (p.life <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
        spawn(p);
        continue;
      }

      bctx.beginPath();
      bctx.moveTo(p.px, p.py);
      bctx.lineTo(p.x, p.y);
      bctx.strokeStyle = accent;
      bctx.globalAlpha = p.w > 1 ? 0.3 : 0.13;
      bctx.lineWidth = p.w;
      bctx.stroke();
    }
  }

  function blit() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(buf, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame() {
    if (!running) return;
    advance();
    blit();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  /* ---- wiring ------------------------------------------------------------ */

  readColors();
  resize();

  if (reduced) {
    // Settle the field, then paint it once — the shape without the motion.
    for (var k = 0; k < 140; k++) advance();
    blit();
  } else {
    start();
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      readColors();
      resize();
      buf.width = 0;          // force the buffer to rebuild at the new size
    }, 180);
  });

  masthead.addEventListener("pointermove", function (e) {
    var r = cv.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.on = true;
  });
  masthead.addEventListener("pointerleave", function () { mouse.on = false; });

  // Don't burn battery when it isn't on screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      es[0].isIntersecting ? start() : stop();
    }, { threshold: 0 }).observe(masthead);
  }
  document.addEventListener("visibilitychange", function () {
    document.hidden ? stop() : start();
  });

  // Recolour when the theme toggle flips.
  new MutationObserver(function () {
    readColors();
    buf.width = 0;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  window.addEventListener("beforeprint", stop);
})();
