/* ============================================================================
   canvas.js — a koi pond, seen from above, behind your name.

   The fish steer by a chain of spine points that trail the head, which is
   what gives them the S-curve as they turn. They wander on their own, flee
   the cursor, and scatter when you click — which also drops a splash.

   Colours all come from CSS variables (--pond, --accent, --koi-cream …) so
   the pond restyles itself with the light/dark toggle.

   Set `heroCanvas: false` in resume.js to remove it.
   ========================================================================== */

(function () {
  "use strict";

  var R = typeof RESUME !== "undefined" ? RESUME : null;
  if (!R || R.heroCanvas === false) return;

  // The pond is a fixed, full-viewport backdrop: it stays put while the page
  // scrolls over it, so the fish are visible the whole way down.
  var cv = document.createElement("canvas");
  cv.className = "pond";
  cv.setAttribute("aria-hidden", "true");
  document.body.insertBefore(cv, document.body.firstChild);

  var ctx = cv.getContext("2d");
  if (!ctx) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, dpr = 1, t = 0;
  var fish = [], ripples = [], drops = [];
  var mouse = { x: -9999, y: -9999, on: false };
  var running = false, raf = null, nextAmbient = 3;

  /* ---- palette ------------------------------------------------------------ */

  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var out = (cs.getPropertyValue(name) || "").trim();
      return out || fallback;
    }
    C.pond      = v("--pond", "#e9efec");
    C.deep      = v("--pond-deep", "#d4e0db");
    C.light     = v("--pond-light", "rgba(255,255,255,.55)");
    C.accent    = v("--accent", "#b4451f");
    C.cream     = v("--koi-cream", "#fdfaf4");
    C.dark      = v("--koi-dark", "#2c2a26");
    C.pad       = v("--pad", "#5d8f6b");
    C.padRim    = v("--pad-rim", "#7fb287");
    C.lotus     = v("--lotus", "#f6e3ea");
    C.caustic   = v("--caustic", "236, 255, 246").split(",").map(Number);
  }

  /* Koi varieties, loosely. Each is [body, patch] plus how blotchy it is. */
  function palettes() {
    return [
      { body: C.cream,  patch: C.accent, spots: 3 },   // kohaku
      { body: C.accent, patch: C.cream,  spots: 2 },   // orange
      { body: C.cream,  patch: C.dark,   spots: 2 },   // bekko
      { body: C.dark,   patch: C.accent, spots: 3 },   // showa
      { body: C.cream,  patch: C.accent, spots: 1 },   // mostly white
    ];
  }

  /* ---- geometry helpers --------------------------------------------------- */

  function smoothShape(pts) {
    // Quadratic through midpoints — keeps the body from looking polygonal.
    if (pts.length < 3) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2;
      var my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  /* ---- fish --------------------------------------------------------------- */

  var SEG = 13;

  function makeFish(pal, scale) {
    var f = {
      pal: pal,
      /* Body is 12 joints long, so length is 12*len and width is 2*girth.
         Keep that ratio near 5:1 — at 10:1 they read as eels, which is
         exactly what the first version looked like. */
      len: 5.6 * scale,
      girth: 8.6 * scale,
      speed: 0.42 + Math.random() * 0.3,
      base: 0.42 + Math.random() * 0.3,
      heading: Math.random() * Math.PI * 2,
      wander: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      wag: 0.9 + Math.random() * 0.5,
      spine: [],
      depth: 0.55 + Math.random() * 0.45,   // how far under the surface
    };
    var x = Math.random() * W, y = Math.random() * H;
    for (var i = 0; i < SEG; i++) {
      f.spine.push({ x: x - Math.cos(f.heading) * f.len * i,
                     y: y - Math.sin(f.heading) * f.len * i });
    }
    return f;
  }

  function widthAt(i, f) {
    // 0 = nose, 1 = tail tip. Widest just behind the head.
    var u = i / (SEG - 1);
    var w = Math.sin(Math.pow(u, 0.62) * Math.PI) * f.girth;
    return Math.max(0.6, w * (1 - u * 0.45));
  }

  function updateFish(f, dt) {
    var head = f.spine[0];

    // Wander: a slowly drifting baseline direction.
    f.wander += (Math.random() - 0.5) * 0.22 * dt * 60;
    var ax = Math.cos(f.wander), ay = Math.sin(f.wander);

    // Flee the cursor.
    var fleeing = 0;
    if (mouse.on) {
      var dx = head.x - mouse.x, dy = head.y - mouse.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d < 240) {
        fleeing = (240 - d) / 240;
        ax += (dx / d) * fleeing * 3.2;
        ay += (dy / d) * fleeing * 3.2;
      }
    }

    /* Keep them in frame. This is summed with the flee vector rather than
       replacing it — overriding would pin a fleeing fish against the wall and
       it would just mill about next to the cursor. */
    var m = 110;
    if (head.x < m)          ax += (1 - head.x / m) * 2.6;
    else if (head.x > W - m) ax -= (1 - (W - head.x) / m) * 2.6;
    if (head.y < m)          ay += (1 - head.y / m) * 2.6;
    else if (head.y > H - m) ay -= (1 - (H - head.y) / m) * 2.6;

    var desired = Math.atan2(ay, ax);

    // Turn toward the desired heading by the short way round.
    var diff = Math.atan2(Math.sin(desired - f.heading), Math.cos(desired - f.heading));
    f.heading += diff * (0.035 + fleeing * 0.22) * dt * 60;

    // Tail beat — faster when startled. This wiggle is what drives the body.
    f.phase += (0.13 + f.speed * 0.06 + fleeing * 0.2) * dt * 60;
    var swim = f.heading + Math.sin(f.phase) * 0.14 * f.wag;

    f.speed += ((f.base + fleeing * 3.0) - f.speed) * 0.09 * dt * 60;

    head.x += Math.cos(swim) * f.speed * dt * 60;
    head.y += Math.sin(swim) * f.speed * dt * 60;

    // Each joint follows the one ahead at a fixed distance.
    for (var i = 1; i < SEG; i++) {
      var a = f.spine[i - 1], b = f.spine[i];
      var vx = b.x - a.x, vy = b.y - a.y;
      var dist = Math.sqrt(vx * vx + vy * vy) || 1;
      b.x = a.x + (vx / dist) * f.len;
      b.y = a.y + (vy / dist) * f.len;
    }
  }

  function bodyOutline(f) {
    var left = [], right = [];
    for (var i = 0; i < SEG; i++) {
      var p = f.spine[i];
      var prev = f.spine[Math.max(0, i - 1)];
      var next = f.spine[Math.min(SEG - 1, i + 1)];
      var dx = next.x - prev.x, dy = next.y - prev.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / d, ny = dx / d;
      var w = widthAt(i, f);
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }
    return left.concat(right.reverse());
  }

  function fishPath(f) {
    ctx.beginPath();
    smoothShape(bodyOutline(f));
    ctx.closePath();
  }

  function drawTail(f, color, alpha) {
    // A flared, translucent caudal fin trailing the last few joints.
    var a = f.spine[SEG - 3], b = f.spine[SEG - 1];
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / d, uy = dy / d;
    var nx = -uy, ny = ux;
    var L = f.girth * 1.5, Wd = f.girth * 1.05;
    var tipx = b.x + ux * L, tipy = b.y + uy * L;

    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.quadraticCurveTo(b.x + ux * L * 0.5 + nx * Wd * 0.7,
                         b.y + uy * L * 0.5 + ny * Wd * 0.7,
                         tipx + nx * Wd, tipy + ny * Wd);
    ctx.quadraticCurveTo(tipx, tipy, tipx - nx * Wd, tipy - ny * Wd);
    ctx.quadraticCurveTo(b.x + ux * L * 0.5 - nx * Wd * 0.7,
                         b.y + uy * L * 0.5 - ny * Wd * 0.7,
                         b.x, b.y);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawFins(f, color, alpha) {
    var i = 3;
    var p = f.spine[i], prev = f.spine[i - 1], next = f.spine[i + 1];
    var dx = next.x - prev.x, dy = next.y - prev.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ang = Math.atan2(dy, dx);
    var w = widthAt(i, f);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    [1, -1].forEach(function (s) {
      ctx.save();
      ctx.translate(p.x - (dy / d) * w * s * 0.5, p.y + (dx / d) * w * s * 0.5);
      ctx.rotate(ang + s * 0.85);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.girth * 0.85, f.girth * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawFish(f) {
    // Shadow on the pond floor, offset by how deep the fish is swimming.
    var off = 5 + f.depth * 7;
    ctx.save();
    ctx.translate(off, off * 1.15);
    fishPath(f);
    ctx.globalAlpha = 0.13 * f.depth;
    ctx.fillStyle = "#04120e";
    ctx.fill();
    ctx.restore();

    var fade = 0.78 + f.depth * 0.22;

    drawTail(f, f.pal.body, 0.3 * fade);
    drawFins(f, f.pal.body, 0.35 * fade);

    fishPath(f);
    ctx.globalAlpha = 0.96 * fade;
    ctx.fillStyle = f.pal.body;
    ctx.fill();

    // Patches, clipped to the body so they read as markings.
    ctx.save();
    fishPath(f);
    ctx.clip();
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = f.pal.patch;
    for (var s = 0; s < f.pal.spots; s++) {
      var idx = 1 + Math.floor(((s + 0.7) / (f.pal.spots + 0.4)) * (SEG - 4));
      var p = f.spine[idx];
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, f.girth * (0.85 - s * 0.13), f.girth * 0.62,
                  f.phase * 0.02 + s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Eyes. Small, but they're most of what makes a blob read as a fish.
    var e = f.spine[2], ep = f.spine[1], en = f.spine[3];
    var edx = en.x - ep.x, edy = en.y - ep.y;
    var ed = Math.sqrt(edx * edx + edy * edy) || 1;
    var enx = -edy / ed, eny = edx / ed;
    var eo = widthAt(2, f) * 0.6, er = Math.max(0.6, f.girth * 0.15);
    ctx.globalAlpha = 0.72 * fade;
    ctx.fillStyle = "#17140f";
    for (var q = -1; q <= 1; q += 2) {
      ctx.beginPath();
      ctx.arc(e.x + enx * eo * q, e.y + eny * eo * q, er, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  /* ---- water -------------------------------------------------------------- */

  var baseGrad = null;   // rebuilt only on resize / theme change

  /* ---- caustics ------------------------------------------------------------
     The bright shifting web on the bottom of a pond. Interfering sine waves
     pushed through a high power, which collapses the smooth field into thin
     filaments — that filament network is the thing that actually reads as
     "water" rather than "grey gradient". Computed into a small buffer
     (roughly W/9) and scaled up, because at full resolution this would cost
     a million sines a frame.
     -------------------------------------------------------------------------- */

  var cCv = null, cCtx = null, cImg = null, CW = 0, CH = 0;

  function initCaustics() {
    CW = Math.max(48, Math.min(200, Math.round(W / 9)));
    CH = Math.max(32, Math.min(140, Math.round(H / 9)));
    cCv = document.createElement("canvas");
    cCv.width = CW;
    cCv.height = CH;
    cCtx = cCv.getContext("2d");
    cImg = cCtx.createImageData(CW, CH);

    // Colour is constant; only the alpha channel changes per frame.
    var d = cImg.data, r = C.caustic[0], g = C.caustic[1], b = C.caustic[2];
    for (var i = 0; i < CW * CH; i++) {
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
    }
  }

  function renderCaustics() {
    var d = cImg.data, k = 0;
    var t1 = t * 0.55, t2 = t * 0.42, t3 = t * 0.70, t4 = t * 0.90;
    var cx = 4.5, cy = 3.0;

    for (var y = 0; y < CH; y++) {
      var ny = (y / CH) * 6.0;
      var dy = ny - cy;
      for (var x = 0; x < CW; x++, k++) {
        var nx = (x / CW) * 9.0;
        var dx = nx - cx;
        var v = Math.sin(nx + t1)
              + Math.sin(ny * 1.13 - t2)
              + Math.sin((nx + ny) * 0.78 + t3)
              + Math.sin(Math.sqrt(dx * dx + dy * dy) * 1.6 - t4);

        var f = Math.abs(Math.sin(v * 0.8));
        var f2 = f * f, f4 = f2 * f2;      // f^8 — sharpens bands into threads
        d[k * 4 + 3] = (f4 * f4 * 255) | 0;
      }
    }
    cCtx.putImageData(cImg, 0, 0);
  }

  /* ---- pond floor ----------------------------------------------------------
     Static mottling so the water has something to be transparent *to*.
     Generated once per resize.
     -------------------------------------------------------------------------- */

  var siltCv = null;

  function initSilt() {
    siltCv = document.createElement("canvas");
    var sw = Math.max(64, Math.round(W / 3));
    var sh = Math.max(48, Math.round(H / 3));
    siltCv.width = sw;
    siltCv.height = sh;
    var g = siltCv.getContext("2d");
    for (var i = 0; i < 110; i++) {
      var x = Math.random() * sw, y = Math.random() * sh;
      var r = 6 + Math.random() * (sw / 7);
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(0,0,0," + (0.03 + Math.random() * 0.07).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function drawWater() {
    if (!baseGrad) {
      baseGrad = ctx.createRadialGradient(W * 0.45, H * 0.42, Math.min(W, H) * 0.05,
                                          W * 0.45, H * 0.42, Math.max(W, H) * 0.78);
      baseGrad.addColorStop(0, C.pond);
      baseGrad.addColorStop(1, C.deep);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, W, H);

    if (siltCv) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(siltCv, 0, 0, W, H);
    }

    if (cCv) {
      renderCaustics();
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cCv, 0, 0, W, H);
      // A second pass, offset and scaled differently, so the web doesn't
      // read as one tiling pattern.
      ctx.globalAlpha = 0.3;
      ctx.drawImage(cCv, -W * 0.18, -H * 0.12, W * 1.42, H * 1.36);
    }

    ctx.globalAlpha = 1;
  }

  /* ---- lily pads ------------------------------------------------------------
     Nothing says "pond" faster. They float on the surface, so they draw over
     the fish rather than under them.
     -------------------------------------------------------------------------- */

  var pads = [];

  function makePads() {
    var n = Math.max(2, Math.min(7, Math.round((W * H) / 300000)));
    pads = [];
    for (var i = 0; i < n; i++) {
      pads.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 20 + Math.random() * 26,
        rot: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        flower: Math.random() < 0.34,
      });
    }
  }

  function drawPads() {
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      var bob = Math.sin(t * 0.5 + p.phase) * 1.8;
      var drift = Math.sin(t * 0.11 + p.phase) * 6;

      ctx.save();
      ctx.translate(p.x + drift, p.y + bob);
      ctx.rotate(p.rot + Math.sin(t * 0.13 + p.phase) * 0.06);

      // shadow cast down onto the floor
      ctx.beginPath();
      ctx.moveTo(5, 7);
      ctx.arc(5, 7, p.r, 0.42, Math.PI * 2 - 0.42);
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#03120d";
      ctx.fill();

      // the pad itself, with its characteristic notch
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, p.r, 0.42, Math.PI * 2 - 0.42);
      ctx.closePath();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = C.pad;
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = C.padRim;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // veins
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = C.padRim;
      ctx.lineWidth = 0.8;
      for (var v = 0; v < 7; v++) {
        var a = 0.6 + (v / 6) * (Math.PI * 2 - 1.2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * p.r * 0.88, Math.sin(a) * p.r * 0.88);
        ctx.stroke();
      }

      if (p.flower) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = C.lotus;
        for (var q = 0; q < 6; q++) {
          var ang = (q / 6) * Math.PI * 2 + p.phase;
          ctx.save();
          ctx.translate(Math.cos(ang) * p.r * 0.2, Math.sin(ang) * p.r * 0.2);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r * 0.26, p.r * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = "#e8c66a";
        ctx.beginPath();
        ctx.arc(0, 0, p.r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- ripples & splashes ------------------------------------------------- */

  function addRipple(x, y, max, delay, weight) {
    ripples.push({ x: x, y: y, r: 0, max: max, life: 0, delay: delay || 0,
                   weight: weight == null ? 1 : weight });
  }

  function splash(x, y) {
    addRipple(x, y, 120, 0,    1);
    addRipple(x, y, 82,  0.09, 0.75);
    addRipple(x, y, 48,  0.18, 0.5);

    for (var i = 0; i < 12; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 1.6 + Math.random() * 3.4;
      drops.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 1 + Math.random() * 2.2,
        life: 0.42 + Math.random() * 0.4, age: 0,
      });
    }

    // Everything nearby bolts.
    fish.forEach(function (f) {
      var h = f.spine[0];
      var dx = h.x - x, dy = h.y - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 260) {
        f.heading = Math.atan2(dy, dx);
        f.wander = f.heading;
        f.speed = 3.4 * (1 - d / 260) + 0.8;
      }
    });
  }

  function updateRipples(dt) {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      if (rp.delay > 0) { rp.delay -= dt; continue; }
      rp.life += dt;
      rp.r = rp.max * (1 - Math.pow(1 - Math.min(1, rp.life / 1.5), 2.2));
      if (rp.life > 1.5) ripples.splice(i, 1);
    }
    for (var j = drops.length - 1; j >= 0; j--) {
      var d = drops[j];
      d.age += dt;
      d.x += d.vx; d.y += d.vy;
      d.vx *= 0.94; d.vy *= 0.94;
      if (d.age >= d.life) {
        addRipple(d.x, d.y, 10 + Math.random() * 14, 0, 0.4);
        drops.splice(j, 1);
      }
    }
  }

  function drawRipples() {
    ctx.lineCap = "round";
    ripples.forEach(function (rp) {
      if (rp.delay > 0) return;
      var k = Math.min(1, rp.life / 1.5);
      var a = (1 - k) * (1 - k) * 0.5 * rp.weight;
      if (a <= 0.004) return;

      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = C.light;
      ctx.globalAlpha = a;
      ctx.lineWidth = 1.6 * rp.weight * (1 - k * 0.5);
      ctx.stroke();

      // A darker trailing ring gives the crest some relief.
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r * 0.88, 0, Math.PI * 2);
      ctx.strokeStyle = C.deep;
      ctx.globalAlpha = a * 0.5;
      ctx.lineWidth = 1.1 * rp.weight;
      ctx.stroke();
    });

    drops.forEach(function (d) {
      var k = 1 - d.age / d.life;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * k, 0, Math.PI * 2);
      ctx.fillStyle = C.light;
      ctx.globalAlpha = 0.55 * k;
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  }

  /* Wake: a soft ring where each fish is pushing water. */
  function drawWakes() {
    fish.forEach(function (f) {
      var h = f.spine[0];
      ctx.beginPath();
      ctx.ellipse(h.x, h.y, f.girth * 3.4, f.girth * 2.6, f.heading, 0, Math.PI * 2);
      ctx.strokeStyle = C.light;
      ctx.globalAlpha = 0.1;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  /* ---- loop --------------------------------------------------------------- */

  function step(dt) {
    t += dt;
    updateRipples(dt);
    fish.forEach(function (f) { updateFish(f, dt); });

    // Every so often something touches the surface on its own.
    nextAmbient -= dt;
    if (nextAmbient <= 0) {
      nextAmbient = 4 + Math.random() * 7;
      addRipple(Math.random() * W, Math.random() * H, 26 + Math.random() * 30, 0, 0.55);
    }
  }

  function draw() {
    drawWater();
    drawWakes();
    fish.forEach(drawFish);
    drawRipples();
    drawPads();          // floating on the surface, so over the fish
  }

  var last = 0;
  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  /* ---- setup -------------------------------------------------------------- */

  function resize() {
    // Fixed to the viewport, so that's what we size to — not the document.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth || 1200);
    H = Math.max(1, window.innerHeight || 800);
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseGrad = null;
    initCaustics();
    initSilt();
    makePads();
    stock();
  }

  function stock() {
    var pals = palettes();
    var want = Math.max(6, Math.min(18, Math.round((W * H) / 92000)));
    var keep = fish.slice(0, want);
    while (keep.length < want) {
      keep.push(makeFish(pals[keep.length % pals.length], 0.72 + Math.random() * 0.5));
    }
    keep.forEach(function (f, i) { f.pal = pals[i % pals.length]; });
    fish = keep;
  }

  readColors();
  resize();

  if (reduced) {
    for (var k = 0; k < 220; k++) step(0.016);   // let them spread out
    draw();
  } else {
    start();
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { readColors(); resize(); }, 180);
  });

  // The canvas is fixed to the viewport, so client coordinates are already
  // pond coordinates — no offset maths, and no recalculating on scroll.
  window.addEventListener("pointermove", function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.on = true;
  }, { passive: true });

  document.addEventListener("pointerleave", function () { mouse.on = false; });

  /* Click the water to splash. The canvas is pointer-events:none, so this
     listens on the window and skips anything you were actually trying to use
     — otherwise every link click and keystroke in the terminal throws water. */
  window.addEventListener("pointerdown", function (e) {
    if (e.target && e.target.closest &&
        e.target.closest("a, button, input, textarea, select, .term")) return;
    splash(e.clientX, e.clientY);
    if (reduced) { step(0.016); draw(); }
  }, { passive: true });
  document.addEventListener("visibilitychange", function () {
    document.hidden ? stop() : start();
  });

  new MutationObserver(function () {
    readColors();
    baseGrad = null;
    initCaustics();
    var pals = palettes();
    fish.forEach(function (f, i) { f.pal = pals[i % pals.length]; });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  window.addEventListener("beforeprint", stop);
})();
