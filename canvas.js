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
  var fish = [], ripples = [], drops = [], bursts = [], crowns = [], pellets = [];
  var mouse = { x: -9999, y: -9999, px: -9999, py: -9999, on: false, vel: 0, dx: 0, dy: 0 };
  var running = false, raf = null, nextAmbient = 3;
  var wakeTravel = 0, wakeCool = 0;   // cursor travel / cooldown between wake rings

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
    C.stone     = v("--stone", "#93a498");
    C.stoneLit  = v("--stone-lit", "#b7c3b5");
    C.weed      = v("--weed", "#4c7a58");
    C.weedTip   = v("--weed-tip", "#6d9e72");
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
    /* Bigger fish beat their tails more slowly and cruise a little less
       briskly. Without this every koi swims identically and the size
       variation stops reading as size — it just looks like a zoom level. */
    var slow = 1 / Math.sqrt(scale);

    /* Temperament: some koi are idlers, some are brisk. This is a much wider
       spread than size alone gave, so the school stops moving as one mass. */
    var temper = 0.45 + Math.random() * 1.2;
    var cruise = (0.3 + Math.random() * 0.18) * temper * (1.22 - scale * 0.2);

    var f = {
      pal: pal,
      scale: scale,
      /* Body is 12 joints long, so length is 12*len and width is 2*girth.
         Keep that ratio near 5:1 — at 10:1 they read as eels, which is
         exactly what the first version looked like. */
      len: 5.6 * scale,
      girth: 8.6 * scale,
      slow: slow,
      speed: cruise,
      base: cruise,
      /* Hard ceiling on velocity, and a startle level that decays, so nothing
         can change direction or speed instantaneously. Bigger fish have a
         higher top speed but accelerate and turn more sluggishly. */
      maxSpeed: 2.3 * (0.85 + scale * 0.3) * (0.7 + temper * 0.45),
      startle: 0,
      /* Each fish also breathes its own slow rhythm of effort, and now and
         then takes off for no reason, the way real fish do. */
      temper: temper,
      effortRate: 0.1 + Math.random() * 0.3,
      effortPhase: Math.random() * Math.PI * 2,
      dash: 0,
      heading: Math.random() * Math.PI * 2,
      wander: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      wag: 0.9 + Math.random() * 0.5,
      spine: [],
      depth: Math.min(1, 0.45 + Math.random() * 0.4 + (scale - 1) * 0.12),
    };
    var x = Math.random() * W, y = Math.random() * H;
    for (var i = 0; i < SEG; i++) {
      f.spine.push({ x: x - Math.cos(f.heading) * f.len * i,
                     y: y - Math.sin(f.heading) * f.len * i });
    }
    return f;
  }

  function widthAt(i, f) {
    /* 0 = nose, 1 = tail. Widest just behind the head. The trailing term
       keeps a real caudal peduncle — with a pure sine the body narrowed to
       nothing and the tail fin appeared to float free of the fish. */
    var u = i / (SEG - 1);
    var w = Math.sin(Math.pow(u, 0.6) * Math.PI) * 0.84 + 0.16 * (1 - u * 0.45);
    return Math.max(0.8, w * f.girth * (1 - u * 0.3));
  }

  function updateFish(f, dt) {
    var head = f.spine[0];

    // Wander: a slowly drifting baseline direction.
    f.wander += (Math.random() - 0.5) * 0.22 * dt * 60;
    var ax = Math.cos(f.wander), ay = Math.sin(f.wander);

    /* Flee the cursor.

       Two separate responses, because one number couldn't do both jobs. With
       a single linear falloff the force is ~0 at the edge of the radius, so
       fish only visibly reacted once the cursor was on top of them.

         notice — curved (pow 0.45), so it's already substantial far out.
                  Drives turning and the shove: they veer away early.
         panic  — stays linear, so the flat-out sprint is reserved for a
                  cursor that's genuinely close. */
    f.startle *= Math.max(0, 1 - dt * 1.25);

    var fleeing = 0, panic = 0;
    if (mouse.on) {
      var dx = head.x - mouse.x, dy = head.y - mouse.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var reach = 460 + mouse.vel * 150;     // a fast cursor is noticed sooner
      if (d < reach) {
        var lin = (reach - d) / reach;
        fleeing = Math.min(1, Math.pow(lin, 0.45) * (0.82 + mouse.vel * 0.5));
        panic = Math.min(1, lin * 1.5 * (0.8 + mouse.vel * 0.55));
        var shove = 5.6 * fleeing;
        ax += (dx / d) * shove;
        ay += (dy / d) * shove;
      }
    }

    // Shoved by any wavefront passing over them.
    waveForce(head.x, head.y, _wf, true);
    if (_wf[0] || _wf[1]) {
      ax += _wf[0] * 3.0;
      ay += _wf[1] * 3.0;
      head.x += _wf[0] * 3.4;
      head.y += _wf[1] * 3.4;
    }

    /* Keep them in frame. This is summed with the flee vector rather than
       replacing it — overriding would pin a fleeing fish against the wall and
       it would just mill about next to the cursor. */
    var m = 110;
    if (head.x < m)          ax += (1 - head.x / m) * 2.6;
    else if (head.x > W - m) ax -= (1 - (W - head.x) / m) * 2.6;
    if (head.y < m)          ay += (1 - head.y / m) * 2.6;
    else if (head.y > H - m) ay -= (1 - (H - head.y) / m) * 2.6;

    /* Food beats fear: a fed koi will come back towards the surface even
       with the cursor nearby. Pull scales with proximity so the nearest fish
       commit hardest and the others drift over. */
    var feeding = 0;
    if (pellets.length) {
      var best = null, bd = 1e9;
      for (var pi = 0; pi < pellets.length; pi++) {
        var pl = pellets[pi];
        var pdx = pl.x - head.x, pdy = pl.y - head.y;
        var pd2 = pdx * pdx + pdy * pdy;
        if (pd2 < bd) { bd = pd2; best = pl; }
      }
      var pd = Math.sqrt(bd) || 1;
      if (best && pd < 430) {
        feeding = 1 - pd / 430;
        var pull = 3.4 * feeding;
        ax += ((best.x - head.x) / pd) * pull;
        ay += ((best.y - head.y) / pd) * pull;
        if (pd < f.girth * 1.4) {          // eaten
          best.gone = true;
          addRipple(best.x, best.y, 16 + Math.random() * 12, 0, 0.45, 0.3);
        }
      }
    }

    // A recent splash counts as fear too, and fades out on its own.
    if (f.startle > fleeing) fleeing = f.startle;
    if (f.startle > panic) panic = f.startle;
    if (feeding * 0.8 > panic) panic = feeding * 0.8;
    if (feeding > fleeing) fleeing = feeding;

    var desired = Math.atan2(ay, ax);

    /* Turn toward the desired heading by the short way round, but cap how
       fast the head may swing. Uncapped, a startled fish whipped through
       ~15° a frame and the body had to follow in a hairpin. */
    var diff = Math.atan2(Math.sin(desired - f.heading), Math.cos(desired - f.heading));
    var turn = diff * (0.035 + fleeing * 0.22) * dt * 60;
    var maxTurn = (0.028 + fleeing * 0.05) * Math.min(f.slow, 1.15) * dt * 60;
    if (turn > maxTurn) turn = maxTurn;
    else if (turn < -maxTurn) turn = -maxTurn;
    f.heading += turn;

    // Tail beat — faster when startled. This wiggle is what drives the body.
    f.phase += (0.06 + f.speed * 0.14 + fleeing * 0.16) * f.slow * dt * 60;
    var swim = f.heading + Math.sin(f.phase) * 0.14 * f.wag;

    /* Rate-limited acceleration rather than an exponential snap, then a hard
       clamp. Speeding up is slower than slowing down, which is how a fish
       actually behaves. */
    // Spontaneous dart: roughly once every ten seconds, unprompted.
    f.dash *= Math.max(0, 1 - dt * 0.85);
    if (Math.random() < 0.0018 * dt * 60) f.dash = 0.35 + Math.random() * 0.5;

    // Slow personal rhythm of effort on top of the cruising speed.
    var effort = f.base * (0.72 + 0.4 * Math.sin(t * f.effortRate + f.effortPhase));
    var urge = panic > f.dash ? panic : f.dash;
    var want = effort + urge * (f.maxSpeed - effort);
    var dv = want - f.speed;
    var cap = (dv > 0 ? 0.045 : 0.07) * Math.min(f.slow, 1.2) * dt * 60;
    if (dv > cap) dv = cap;
    else if (dv < -cap) dv = -cap;
    f.speed += dv;
    if (f.speed > f.maxSpeed) f.speed = f.maxSpeed;
    else if (f.speed < 0.08) f.speed = 0.08;

    head.x += Math.cos(swim) * f.speed * dt * 60;
    head.y += Math.sin(swim) * f.speed * dt * 60;

    /* Each joint follows the one ahead at a fixed distance AND may only bend
       so far relative to the joint before it. Distance alone lets the chain
       fold straight back through itself, which is how the fish ended up tying
       themselves in knots. Capping the per-joint bend gives the body a spine
       instead of a rope: 12 joints x 0.17rad allows a ~117 degree arc, enough
       for a graceful turn, not enough to touch its own tail. */
    var MAX_BEND = 0.17;
    for (var i = 1; i < SEG; i++) {
      var a = f.spine[i - 1], b = f.spine[i];
      var ang = Math.atan2(b.y - a.y, b.x - a.x);

      if (i >= 2) {
        var p2 = f.spine[i - 2];
        var ref = Math.atan2(a.y - p2.y, a.x - p2.x);
        var dv = Math.atan2(Math.sin(ang - ref), Math.cos(ang - ref));
        if (dv > MAX_BEND) dv = MAX_BEND;
        else if (dv < -MAX_BEND) dv = -MAX_BEND;
        ang = ref + dv;
      }

      b.x = a.x + Math.cos(ang) * f.len;
      b.y = a.y + Math.sin(ang) * f.len;
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
    var a = f.spine[SEG - 3], b = f.spine[SEG - 2];
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / d, uy = dy / d;
    var nx = -uy, ny = ux;
    var L = f.girth * 1.05, Wd = f.girth * 0.58;
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
      ctx.ellipse(0, 0, f.girth * 0.6, f.girth * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawFish(f) {
    // Shadow on the pond floor, offset by how deep the fish is swimming.
    var off = f.girth * (0.3 + f.depth * 0.45);
    ctx.save();
    ctx.translate(off, off * 1.15);
    fishPath(f);
    ctx.globalAlpha = 0.13 * f.depth;
    ctx.fillStyle = "#04120e";
    ctx.fill();
    ctx.restore();

    var fade = 0.78 + f.depth * 0.22;

    drawTail(f, f.pal.body, 0.55 * fade);
    drawFins(f, f.pal.body, 0.48 * fade);

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

  var baseGrad = null, vignette = null;   // rebuilt on resize / theme change

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
    var cx = 9.0, cy = 6.5;

    for (var y = 0; y < CH; y++) {
      var ny = (y / CH) * 13.0;
      var dy = ny - cy;
      for (var x = 0; x < CW; x++, k++) {
        var nx = (x / CW) * 18.0;
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

  function initFloor() {
    /* Silt and stones never move, so they're baked once into a single texture
       rather than re-drawn every frame — around 150 fills a frame saved.
       Baked at CSS resolution, so slightly soft when upscaled on a retina
       display, which is roughly what a pond bottom looks like anyway. */
    siltCv = document.createElement("canvas");
    siltCv.width = Math.max(64, W);
    siltCv.height = Math.max(48, H);
    var g = siltCv.getContext("2d");

    for (var i = 0; i < 130; i++) {
      var x = Math.random() * W, y = Math.random() * H;
      var r = 20 + Math.random() * (W / 5);
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(0,0,0," + (0.03 + Math.random() * 0.07).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    for (var k = 0; k < stones.length; k++) {
      var st = stones[k];
      g.save();
      g.translate(st.x, st.y);
      g.rotate(st.rot);

      g.beginPath();
      g.ellipse(st.r * 0.18, st.r * 0.22, st.r * 1.08, st.r * st.squash * 1.08, 0, 0, Math.PI * 2);
      g.globalAlpha = 0.18;
      g.fillStyle = "#03120d";
      g.fill();

      g.beginPath();
      g.ellipse(0, 0, st.r, st.r * st.squash, 0, 0, Math.PI * 2);
      g.globalAlpha = 0.62 + st.tone * 0.24;
      g.fillStyle = st.tone > 0.62 ? C.stoneLit : C.stone;
      g.fill();

      // catchlight on the upper edge, so they read as rounded not as discs
      g.beginPath();
      g.ellipse(-st.r * 0.24, -st.r * 0.28, st.r * 0.5, st.r * st.squash * 0.38, 0, 0, Math.PI * 2);
      g.globalAlpha = 0.3;
      g.fillStyle = C.stoneLit;
      g.fill();

      g.restore();
    }
  }

  /* ---- the bottom ----------------------------------------------------------
     Stones and submerged planting. Positions are fixed per resize; only the
     weed sway is animated. All of this sits under the caustics, so the light
     web dapples across it, and under the fish, which swim above it.
     -------------------------------------------------------------------------- */

  var stones = [], weeds = [];

  function makeBottom() {
    stones = [];
    var n = Math.round((W * H) / 26000);
    for (var i = 0; i < n; i++) {
      var r = 3 + Math.random() * Math.random() * 22;       // mostly gravel
      stones.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: r,
        squash: 0.55 + Math.random() * 0.4,
        rot: Math.random() * Math.PI,
        tone: Math.random(),
      });
    }

    weeds = [];
    var wn = Math.max(4, Math.round((W * H) / 130000));
    for (var j = 0; j < wn; j++) {
      var blades = [];
      var nb = 5 + (Math.random() * 6 | 0);
      for (var b = 0; b < nb; b++) {
        blades.push({
          a: Math.random() * Math.PI * 2,
          len: 22 + Math.random() * 48,
          w: 2.2 + Math.random() * 2.6,
          phase: Math.random() * Math.PI * 2,
          bend: 0.25 + Math.random() * 0.5,
        });
      }
      weeds.push({
        x: Math.random() * W,
        y: Math.random() * H,
        phase: Math.random() * Math.PI * 2,
        kick: 0,
        blades: blades,
      });
    }
  }

  function drawWeeds() {
    for (var i = 0; i < weeds.length; i++) {
      var cl = weeds[i];
      waveForce(cl.x, cl.y, _wf, true);
      cl.kick += ((_wf[0] + _wf[1]) * 0.7 - cl.kick) * 0.16;
      for (var b = 0; b < cl.blades.length; b++) {
        var bl = cl.blades[b];
        // every blade in a clump leans with the same slow current…
        var sway = Math.sin(t * 0.6 + cl.phase + bl.phase) * bl.bend;
        // …plus a kick from any wavefront crossing the clump
        sway += cl.kick * bl.bend * 2.4;

        var ux = Math.cos(bl.a), uy = Math.sin(bl.a);
        var nx = -uy, ny = ux;
        var L = bl.len;

        var tipx = cl.x + ux * L + nx * sway * L * 0.45;
        var tipy = cl.y + uy * L + ny * sway * L * 0.45;
        var cxp = cl.x + ux * L * 0.5 + nx * sway * L * 0.3;
        var cyp = cl.y + uy * L * 0.5 + ny * sway * L * 0.3;

        var hw = bl.w * 0.5;
        ctx.beginPath();
        ctx.moveTo(cl.x + nx * hw, cl.y + ny * hw);
        ctx.quadraticCurveTo(cxp + nx * hw * 0.5, cyp + ny * hw * 0.5, tipx, tipy);
        ctx.quadraticCurveTo(cxp - nx * hw * 0.5, cyp - ny * hw * 0.5,
                             cl.x - nx * hw, cl.y - ny * hw);
        ctx.closePath();

        var g = ctx.createLinearGradient(cl.x, cl.y, tipx, tipy);
        g.addColorStop(0, C.weed);
        g.addColorStop(1, C.weedTip);
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* The drifting colour bands on the surface. Factored out so a passing
     wavefront can redraw them distorted inside its own annulus — otherwise
     the shifting colours slide along underneath the rings, completely
     indifferent to them. `x0..h` bounds the fill so the per-ripple redraws
     only touch the ring, not the whole canvas. */
  function sheenBands(x0, y0, w, h) {
    for (var sgi = 0; sgi < 2; sgi++) {
      var ang = 0.5 + sgi * 0.35;
      var off = ((t * (0.035 + sgi * 0.02) + sgi * 0.5) % 1.6) - 0.3;
      var sx = W * off, sy = H * (off * 0.4);
      var sg = ctx.createLinearGradient(sx, sy,
                                        sx + Math.cos(ang) * W * 0.55,
                                        sy + Math.sin(ang) * H * 0.9);
      sg.addColorStop(0, "transparent");
      sg.addColorStop(0.5, C.light);
      sg.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = sg;
      ctx.fillRect(x0, y0, w, h);
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

    drawWeeds();

    if (cCv) {
      renderCaustics();
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";

      ctx.globalAlpha = 0.5;
      ctx.drawImage(cCv, 0, 0, W, H);

      /* A second pass, mirrored as well as offset and rescaled. Offsetting
         alone left the same web visibly repeated; flipping it breaks the
         correlation so the two layers interfere instead. */
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.34;
      ctx.drawImage(cCv, -W * 0.13, -H * 0.17, W * 1.37, H * 1.41);
      ctx.restore();
    }

    /* Ripples bend the light web they pass over. Inside each wavefront's
       annulus the caustic texture is redrawn magnified about the ripple's
       centre, which reads as refraction — without this the rings floated
       over an undisturbed pattern and looked like decals. Limited to the
       larger rings; the cursor wake spawns far too many to do this for all
       of them. */
    if (cCv) {
      var done = 0;
      for (var ri = 0; ri < ripples.length && done < 5; ri++) {
        var rf = ripples[ri];
        if (rf.delay > 0 || rf.r < 46) continue;
        var rk = Math.min(1, rf.life / 1.5);
        var strength = (1 - rk) * (1 - rk) * rf.weight;
        if (strength < 0.08) continue;
        done++;

        var bw = 20 + rf.r * 0.16;
        ctx.save();
        ctx.beginPath();
        ctx.arc(rf.x, rf.y, rf.r + bw, 0, Math.PI * 2);
        ctx.arc(rf.x, rf.y, Math.max(0, rf.r - bw), 0, Math.PI * 2, true);
        ctx.clip("evenodd");

        var mag = 1 + 0.16 * strength;
        ctx.translate(rf.x, rf.y);
        ctx.scale(mag, mag);
        ctx.translate(-rf.x, -rf.y);

        var bx = rf.x - rf.r - bw, by = rf.y - rf.r - bw;
        var bs = (rf.r + bw) * 2;

        ctx.globalAlpha = 0.5 * strength;
        ctx.drawImage(cCv, 0, 0, W, H);
        // and the drifting colour bands, so they buckle with the wave too
        sheenBands(bx, by, bs, bs);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    sheenBands(0, 0, W, H);

    // Depth at the corners.
    if (!vignette) {
      vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.3,
                                          W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
      vignette.addColorStop(0, "transparent");
      vignette.addColorStop(1, "rgba(0,26,20,0.2)");
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---- lily pads ------------------------------------------------------------
     Nothing says "pond" faster. They float on the surface, so they draw over
     the fish rather than under them.
     -------------------------------------------------------------------------- */

  var pads = [];

  function makePads() {
    var n = Math.max(4, Math.min(12, Math.round((W * H) / 165000)));
    pads = [];
    for (var i = 0; i < n; i++) {
      pads.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 27 + Math.random() * 30,
        rot: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        flower: Math.random() < 0.34,
        ox: 0, oy: 0, vx: 0, vy: 0, tilt: 0,   // displaced by passing waves
        buoy: 0,                               // set below, from the radius
      });
    }
  }

  function padBuoyancy() {
    // Smaller pads are lighter and ride the water more freely.
    for (var i = 0; i < pads.length; i++) {
      pads[i].buoy = Math.max(0.35, Math.min(1.5, 38 / pads[i].r));
    }
  }

  function drawPads() {
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      var bob = Math.sin(t * 0.5 + p.phase) * 1.8;
      var drift = Math.sin(t * 0.11 + p.phase) * 6;

      /* Shoved by passing wavefronts, then pulled back — a pad rocking in
         the wake is the clearest read that a splash disturbed the water. */
      /*Response scales with the wave, and inversely with the pad: a big
         pad rides a small ripple almost unmoved, a small one gets tossed. */
      waveForce(p.x + p.ox, p.y + p.oy, _wf, false);
      var give = p.buoy * 4.2;
      p.vx += _wf[0] * give - p.ox * 0.06;
      p.vy += _wf[1] * give - p.oy * 0.06;
      p.vx *= 0.88; p.vy *= 0.88;
      p.ox += p.vx; p.oy += p.vy;
      p.tilt += ((_wf[0] + _wf[1]) * 0.34 * p.buoy - p.tilt) * 0.12;

      ctx.save();
      ctx.translate(p.x + drift + p.ox, p.y + bob + p.oy);
      ctx.rotate(p.rot + Math.sin(t * 0.13 + p.phase) * 0.06 + p.tilt);

      // shadow cast down onto the floor
      ctx.beginPath();
      ctx.moveTo(5, 7);
      ctx.arc(5, 7, p.r, 0.2, Math.PI * 2 - 0.2);
      ctx.closePath();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#03120d";
      ctx.fill();

      // the pad itself, with its characteristic notch
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, p.r, 0.2, Math.PI * 2 - 0.2);
      ctx.closePath();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.pad;
      ctx.fill();
      // A lighter inner sheen plus a darker edge, so the pad has a surface
      // instead of being a flat disc.
      var sheen = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, 0, 0, 0, p.r);
      sheen.addColorStop(0, C.padRim);
      sheen.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = sheen;
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = C.padRim;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // veins
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = C.padRim;
      ctx.lineWidth = 0.9;
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

  /* `sub` is how far down the disturbance reaches: 1 shifts everything
     including the fish and the planting on the bottom, ~0.1 only ruffles
     the surface. The cursor's wake is shallow; a click goes all the way. */
  function addRipple(x, y, max, delay, weight, sub) {
    ripples.push({ x: x, y: y, r: 0, max: max, life: 0, delay: delay || 0,
                   weight: weight == null ? 1 : weight,
                   sub: sub == null ? 1 : sub,
                   seed: Math.random() * 100 });
  }

  /* Outward push from any wavefront currently passing over a point. This is
     what makes a splash disturb the pond rather than just draw circles on
     top of it — fish, food, pads and planting all read from it. */
  function waveForce(x, y, out, subsurface) {
    out[0] = 0; out[1] = 0;
    for (var i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      if (rp.delay > 0 || rp.r < 1) continue;
      var reach = subsurface ? rp.sub : 1;
      if (reach < 0.02) continue;
      var dx = x - rp.x, dy = y - rp.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var band = Math.abs(d - rp.r);
      var width = 22 + rp.r * 0.12;
      if (band > width) continue;
      /* Amplitude scales with the size of the wave, so a small wake ring
         nudges and a big splash ring shoves. Without this every ring pushed
         the same and a click felt no heavier than a mouse sweep. */
      var amp = Math.min(1.7, rp.max / 120);
      var k = (1 - band / width) * (1 - rp.life / 1.5) * rp.weight * reach * amp;
      out[0] += (dx / d) * k;
      out[1] += (dy / d) * k;
    }
  }
  var _wf = [0, 0];

  /* ---- deformable wavefronts ------------------------------------------
     A ring is stored as N radial samples. Dragging the cursor through one
     dents it locally (`def`) and tears the crest (`cut`); the dent then
     spreads to neighbouring samples and decays, and the tear heals. This
     is what lets a ring be disturbed rather than just drawn — previously a
     ring was a procedural circle and nothing in the scene could touch it.

     State is allocated lazily: most wake rings are never touched, and
     those stay on the cheap smooth path. */

  var RN = 36;

  function ensureDeform(rp) {
    if (rp.def) return;
    rp.def = []; rp.cut = []; rp.tmp = [];
    for (var i = 0; i < RN; i++) { rp.def[i] = 0; rp.cut[i] = 0; rp.tmp[i] = 0; }
  }

  function disturbRings(dt) {
    if (!ripples.length) return;
    var moving = Math.sqrt(mouse.dx * mouse.dx + mouse.dy * mouse.dy);

    for (var i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      if (rp.delay > 0 || rp.r < 8) continue;

      // the cursor cutting across this particular crest
      if (mouse.on && moving > 0.4) {
        var dx = mouse.x - rp.x, dy = mouse.y - rp.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var band = 16 + rp.r * 0.12;
        if (Math.abs(d - rp.r) < band) {
          ensureDeform(rp);
          var a = Math.atan2(dy, dx);
          var slot = Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RN) % RN;
          // how much of the cursor's motion is along the radius
          var vr = (mouse.dx * dx / d + mouse.dy * dy / d);
          var bite = Math.min(1, moving / 18);
          // Bounded to a fraction of the radius — an unbounded dent on a
          // small ring turns it inside out rather than denting it.
          var lim = rp.r * 0.2;
          for (var o = -2; o <= 2; o++) {
            var si = (slot + o + RN) % RN;
            var falloff = 1 - Math.abs(o) / 3;
            var nd = rp.def[si] + vr * 0.75 * falloff;
            rp.def[si] = nd > lim ? lim : (nd < -lim ? -lim : nd);
            rp.cut[si] = Math.min(1.3, rp.cut[si] + bite * 0.8 * falloff);
          }
        }
      }

      if (!rp.def) continue;

      // the dent travels around the crest and flattens out; the tear heals
      var spread = 0.2, damp = 1 - dt * 2.2, heal = 1 - dt * 1.5;
      for (var k = 0; k < RN; k++) {
        var prev = rp.def[(k - 1 + RN) % RN], next = rp.def[(k + 1) % RN];
        rp.tmp[k] = rp.def[k] + (prev + next - 2 * rp.def[k]) * spread;
      }
      for (var k2 = 0; k2 < RN; k2++) {
        rp.def[k2] = rp.tmp[k2] * damp;
        rp.cut[k2] *= heal;
      }
    }
  }

  function splash(x, y) {
    // Four rings staggered outward, the leading one much wider than before.
    addRipple(x, y, 230, 0,    1.35, 1);
    addRipple(x, y, 165, 0.07, 1.05, 1);
    addRipple(x, y, 105, 0.15, 0.8, 1);
    addRipple(x, y, 58,  0.24, 0.55, 1);

    // The white burst at the point of impact — this is most of what makes a
    // click feel like it hit water rather than just starting an animation.
    bursts.push({ x: x, y: y, age: 0, life: 0.42, r: 34 });

    /* Throwback spray. Angles are fully random, not evenly spaced — an even
       ring of identical spokes reads as a clock face, not a splash. */
    var nc = 7 + (Math.random() * 4 | 0);
    for (var c = 0; c < nc; c++) {
      crowns.push({
        x: x, y: y,
        a: Math.random() * Math.PI * 2,
        len: 7 + Math.random() * Math.random() * 30,   // mostly short, few long
        speed: 0.7 + Math.random() * 0.8,
        age: 0, life: 0.2 + Math.random() * 0.22,
      });
    }

    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 2.4 + Math.random() * 6.2;
      drops.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 1.2 + Math.random() * 3.2,
        life: 0.45 + Math.random() * 0.5, age: 0,
      });
    }

    // Everything nearby bolts, harder and from further out.
    fish.forEach(function (f) {
      var h = f.spine[0];
      var dx = h.x - x, dy = h.y - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 360) {
        // Point them away and frighten them; the steering and acceleration
        // limits above decide how fast they can actually respond.
        f.wander = Math.atan2(dy, dx);
        var k = 1 - d / 360;
        if (k > f.startle) f.startle = k;
      }
    });
  }

  function updateRipples(dt) {
    disturbRings(dt);
    for (var i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      if (rp.delay > 0) { rp.delay -= dt; continue; }
      rp.life += dt;
      rp.r = rp.max * (1 - Math.pow(1 - Math.min(1, rp.life / 1.5), 2.2));
      if (rp.life > 1.5) ripples.splice(i, 1);
    }
    for (var b = bursts.length - 1; b >= 0; b--) {
      bursts[b].age += dt;
      if (bursts[b].age >= bursts[b].life) bursts.splice(b, 1);
    }
    for (var c = crowns.length - 1; c >= 0; c--) {
      crowns[c].age += dt;
      if (crowns[c].age >= crowns[c].life) crowns.splice(c, 1);
    }
    for (var j = drops.length - 1; j >= 0; j--) {
      var d = drops[j];
      d.age += dt;
      d.x += d.vx; d.y += d.vy;
      d.vx *= 0.94; d.vy *= 0.94;
      if (d.age >= d.life) {
        addRipple(d.x, d.y, 10 + Math.random() * 14, 0, 0.4, 0.5);
        drops.splice(j, 1);
      }
    }
  }

  function drawRipples() {
    ctx.lineCap = "round";
    ripples.forEach(function (rp) {
      if (rp.delay > 0) return;
      var k = Math.min(1, rp.life / 1.5);
      var a = (1 - k) * (1 - k) * 0.78 * rp.weight;
      if (a <= 0.004) return;

      /* An expanding circle reads as a graphic; a real wavefront buckles as
         it travels. Radius is modulated per-angle, and the distortion grows
         with distance from the impact. */
      function sampleR(ang, radius) {
        var warp = 1
          + Math.sin(ang * 3 + rp.seed) * 0.035 * (0.4 + k)
          + Math.sin(ang * 5 - rp.seed * 1.7 + rp.life * 3) * 0.026 * (0.3 + k)
          + Math.sin(ang * 8 + rp.seed * 0.6) * 0.014;
        var rr = radius * warp;
        if (rp.def) {
          // linear blend between the two nearest radial samples
          var f = ((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RN;
          var i0 = Math.floor(f) % RN, i1 = (i0 + 1) % RN, m = f - Math.floor(f);
          rr += rp.def[i0] * (1 - m) + rp.def[i1] * m;
        }
        return rr;
      }

      function cutAt(ang) {
        if (!rp.def) return 0;
        var f = ((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RN;
        var i0 = Math.floor(f) % RN, i1 = (i0 + 1) % RN, m = f - Math.floor(f);
        return rp.cut[i0] * (1 - m) + rp.cut[i1] * m;
      }

      function ring(radius, alpha, width, colour) {
        // Scale detail with size; the cursor wake spawns a lot of small ones.
        var steps = Math.max(10, Math.min(44, Math.round(radius / 4)));
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;

        // Untouched ring: one closed path, as before.
        if (!rp.def) {
          ctx.beginPath();
          for (var si = 0; si <= steps; si++) {
            var ang = (si / steps) * Math.PI * 2;
            var rr = sampleR(ang, radius);
            var px = rp.x + Math.cos(ang) * rr, py = rp.y + Math.sin(ang) * rr;
            if (si === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.globalAlpha = alpha;
          ctx.stroke();
          return;
        }

        /* Torn ring: walk the circumference and stroke only the runs that
           survive, so a crest the cursor has cut through renders as broken
           arcs with faded ends rather than a continuous loop. */
        var open = false;
        for (var sj = 0; sj <= steps; sj++) {
          var a2 = (sj / steps) * Math.PI * 2;
          var c = cutAt(a2);
          if (c > 0.6) {                        // severed here
            if (open) { ctx.stroke(); open = false; }
            continue;
          }
          var r2 = sampleR(a2, radius);
          var qx = rp.x + Math.cos(a2) * r2, qy = rp.y + Math.sin(a2) * r2;
          if (!open) {
            ctx.beginPath();
            ctx.globalAlpha = alpha * (1 - c);
            ctx.moveTo(qx, qy);
            open = true;
          } else {
            ctx.lineTo(qx, qy);
          }
        }
        if (open) ctx.stroke();
      }

      ring(rp.r, a, 2.6 * rp.weight * (1 - k * 0.45), C.light);
      // A darker trailing ring gives the crest some relief — worth it only
      // on the bigger rings.
      if (rp.r > 34) ring(rp.r * 0.88, a * 0.5, 1.1 * rp.weight, C.deep);
    });

    bursts.forEach(function (bu) {
      var k = bu.age / bu.life;
      var r = bu.r * (0.35 + k * 1.9);
      var g = ctx.createRadialGradient(bu.x, bu.y, 0, bu.x, bu.y, r);
      g.addColorStop(0, C.light);
      g.addColorStop(0.35, C.light);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = (1 - k) * (1 - k) * 0.7;
      ctx.fillStyle = g;
      ctx.fillRect(bu.x - r, bu.y - r, r * 2, r * 2);
    });

    crowns.forEach(function (cr) {
      var k = cr.age / cr.life;
      var r0 = 4 + k * cr.len * cr.speed * 2.1;   // travels out with the rings
      var r1 = r0 + cr.len * (1 - k) * 0.42;
      ctx.beginPath();
      ctx.moveTo(cr.x + Math.cos(cr.a) * r0, cr.y + Math.sin(cr.a) * r0);
      ctx.lineTo(cr.x + Math.cos(cr.a) * r1, cr.y + Math.sin(cr.a) * r1);
      ctx.strokeStyle = C.light;
      ctx.globalAlpha = (1 - k) * (1 - k) * 0.6;
      ctx.lineWidth = 1.7 * (1 - k) + 0.3;
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
    mouse.vel *= Math.max(0, 1 - dt * 2.4);
    updateRipples(dt);
    fish.forEach(function (f) { updateFish(f, dt); });

    /* The cursor drags a wake across the surface. Rings are spawned per
       distance travelled rather than per frame, so the trail is even at any
       speed, and they're shallow (sub 0.1) — they ruffle the surface and
       shove the food about but barely reach the fish or the planting. That
       separation is deliberate: only a click should stir the bottom. */
    if (mouse.on && mouse.px > -9000) {
      var mdx = mouse.x - mouse.px, mdy = mouse.y - mouse.py;
      mouse.dx = mdx; mouse.dy = mdy;
      wakeTravel += Math.sqrt(mdx * mdx + mdy * mdy);
      /* Spacing grows with speed and there's a hard cooldown, so a fast
         sweep makes *bigger* rings rather than a dense stack of them.
         Without the cooldown, orbiting quickly spawned ~78 rings a second
         and out-disturbed an actual splash, which defeats the point. */
      wakeCool -= dt;
      var stride = 24 + mouse.vel * 64;
      if (wakeTravel > stride && wakeCool <= 0 && ripples.length < 46) {
        wakeTravel = 0;
        wakeCool = 0.07;
        addRipple(mouse.x, mouse.y,
                  18 + mouse.vel * 52,           // faster cursor, wider ring
                  0,
                  0.18 + mouse.vel * 0.34,
                  0.05 + mouse.vel * 0.28);      // and a little deeper
      }
    }
    if (!mouse.on) { mouse.dx = 0; mouse.dy = 0; }
    mouse.px = mouse.x;
    mouse.py = mouse.y;

    for (var pk = pellets.length - 1; pk >= 0; pk--) {
      var pl = pellets[pk];
      pl.age += dt;
      waveForce(pl.x, pl.y, _wf, false);
      pl.vx += _wf[0] * 0.9;
      pl.vy += _wf[1] * 0.9;
      pl.x += pl.vx; pl.y += pl.vy;
      pl.vx *= 0.97; pl.vy *= 0.97;
      if (pl.gone || pl.age > 30) pellets.splice(pk, 1);
    }

    // Every so often something touches the surface on its own.
    nextAmbient -= dt;
    if (nextAmbient <= 0) {
      nextAmbient = 4 + Math.random() * 7;
      addRipple(Math.random() * W, Math.random() * H, 26 + Math.random() * 30, 0, 0.55, 0.45);
    }
  }

  function draw() {
    drawWater();
    drawWakes();
    fish.forEach(drawFish);
    drawRipples();
    for (var pk = 0; pk < pellets.length; pk++) {
      var pl = pellets[pk];
      var fade = pl.age > 26 ? (30 - pl.age) / 4 : 1;
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = "#c98b3e";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pl.x - pl.r * 0.3, pl.y - pl.r * 0.3, pl.r * 0.42, 0, Math.PI * 2);
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = "#f0c27a";
      ctx.fill();
    }
    /* A meniscus that always sits under the pointer, so the cursor reads as
       touching the water rather than hovering over a picture of it. */
    if (mouse.on) {
      var dr = 11 + mouse.vel * 15;
      var dg = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, dr);
      dg.addColorStop(0, "transparent");
      dg.addColorStop(0.65, "transparent");
      dg.addColorStop(1, C.light);
      ctx.globalAlpha = 0.3 + mouse.vel * 0.3;
      ctx.fillStyle = dg;
      ctx.fillRect(mouse.x - dr, mouse.y - dr, dr * 2, dr * 2);

      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, dr * 0.78, 0, Math.PI * 2);
      ctx.strokeStyle = C.light;
      ctx.globalAlpha = 0.18 + mouse.vel * 0.22;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

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
    vignette = null;
    initCaustics();
    makeBottom();
    initFloor();
    makePads();
    padBuoyancy();
    stock();
  }

  function stock() {
    var pals = palettes();
    var want = Math.max(10, Math.min(34, Math.round((W * H) / 48000)));
    var keep = fish.slice(0, want);
    while (keep.length < want) {
      // Skewed: mostly young fish, the big old ones rare.
      var sc = 0.45 + Math.pow(Math.random(), 1.9) * 1.75;
      keep.push(makeFish(pals[keep.length % pals.length], sc));
    }
    keep.forEach(function (f, i) { f.pal = pals[i % pals.length]; });
    fish = keep;
  }

  readColors();
  resize();

  /* Public API, used by the terminal's `feed` and `koi` commands. */
  window.pond = {
    feed: function (n, x, y) {
      n = Math.max(1, Math.min(80, n | 0 || 18));
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var rad = Math.random() * (x == null ? Math.min(W, H) * 0.3 : 70);
        pellets.push({
          x: (x == null ? W * 0.5 : x) + Math.cos(a) * rad,
          y: (y == null ? H * 0.45 : y) + Math.sin(a) * rad,
          vx: Math.cos(a) * 0.25, vy: Math.sin(a) * 0.25,
          r: 1.6 + Math.random() * 1.6,
          age: 0, gone: false,
        });
      }
      return n;
    },
    count: function () { return fish.length; },
    pellets: function () { return pellets.length; },
    splash: function (x, y) {
      splash(x == null ? W * 0.5 : x, y == null ? H * 0.45 : y);
    },
  };

  // Test hook: off unless something sets the flag first.
  if (window.__POND_DEBUG__) window.__pond = {
    fish: function () { return fish; },
    pads: function () { return pads; },
    weeds: function () { return weeds; },
    ripples: function () { return ripples; },
    food: function () { return pellets; },
  };

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
    if (mouse.on) {
      var mdx = e.clientX - mouse.x, mdy = e.clientY - mouse.y;
      // Smoothed, so one stray jump doesn't spook the whole pond.
      mouse.vel += (Math.min(1, Math.sqrt(mdx * mdx + mdy * mdy) / 26) - mouse.vel) * 0.35;
    }
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
    vignette = null;
    initCaustics();
    initFloor();          // stones are baked in, so they need restyling too
    var pals = palettes();
    fish.forEach(function (f, i) { f.pal = pals[i % pals.length]; });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  window.addEventListener("beforeprint", stop);
})();
