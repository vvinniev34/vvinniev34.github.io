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
  /* Three stacked canvases, so nothing is composited that hasn't changed.

       bg     the pond floor. Painted once at resize, never touched again.
       light  the water surface, and everything that IS the surface: the
              caustic texture, and every wavefront — its swell, its crest,
              and the spray an impact throws up. Rendered below full
              resolution and stretched by the compositor, because all of it
              is soft and low-frequency.
       fg     things floating in or on the water rather than being it:
              weeds, koi, droplets, food, lily pads.

     The rule is what something IS, not when it was written. Ripples used
     to be split across both layers in four separate passes, which is why
     they never looked like one thing.

     Previously all of this was one canvas doing seven full-canvas fills a
     frame; the two remaining blits are gone entirely now. */
  function layer(name) {
    var c = document.createElement("canvas");
    c.className = "pond pond--" + name;
    c.setAttribute("aria-hidden", "true");
    document.body.insertBefore(c, document.body.firstChild);
    return c;
  }
  var fgCv = layer("fg"), lightCv = layer("light"), bgCv = layer("bg");

  var ctx = fgCv.getContext("2d");
  var bgCtx = bgCv.getContext("2d");
  var lightCtx = lightCv.getContext("2d");
  if (!ctx || !bgCtx || !lightCtx) return;

  /* Removing the sheen bands and a caustic pass freed enough budget to
     render the surface closer to full resolution, which matters now that
     the ripple crests live on this layer. */
  var LIGHT_SCALE = 0.7;
  /* The surface is its own canvas, so skipping a frame simply leaves the
     previous one on screen. Ripples expand over seconds, not frames — at
     30Hz the difference is invisible and it halves the layer's cost. */
  var lightPhase = 0;
  var cv = fgCv;                      // pointer position is read off this one

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var TAU = Math.PI * 2;
  var W = 0, H = 0, dpr = 1, t = 0;
  var fish = [], ripples = [], spray = [], pellets = [];
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
    C.wave      = v("--wave", "rgba(255,255,255,.95)");
    C.accent    = v("--accent", "#b4451f");
    C.cream     = v("--koi-cream", "#fdfaf4");
    C.dark      = v("--koi-dark", "#2c2a26");
    C.pad       = v("--pad", "#5d8f6b");
    C.padRim    = v("--pad-rim", "#7fb287");
    C.lotus     = v("--lotus", "#f6e3ea");
    C.strider   = v("--strider", "#3d4a42");
    C.stone     = v("--stone", "#93a498");
    C.stoneLit  = v("--stone-lit", "#b7c3b5");
    C.weed      = v("--weed", "#4c7a58");
    C.weedTip   = v("--weed-tip", "#6d9e72");
    C.algae     = v("--algae", "#4f7a53");
    C.detritus  = v("--detritus", "#6b6047");
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
    var cruise = (0.44 + Math.random() * 0.26) * temper * (1.22 - scale * 0.2);

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
      maxSpeed: 2.8 * (0.85 + scale * 0.3) * (0.7 + temper * 0.45),
      startle: 0,
      rise: 0,          // counts down while the fish is at the surface
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

    /* Every so often a koi comes up for air. It rises, breaks the surface —
       which is where a good share of the pond's ripples come from — and
       settles back down. Ripples having a visible cause is the point. */
    if (f.rise > 0) {
      f.rise -= dt;
      if (f.rise <= 0) f.rise = 0;
    } else if (Math.random() < 0.018 * dt) {
      f.rise = 1.1 + Math.random() * 0.9;
      addRipple(f.spine[0].x, f.spine[0].y,
                26 + f.girth * 5, 0,
                0.16 + f.scale * 0.12, 0.3);
    }

    var fleeing = 0, panic = 0;
    if (mouse.on) {
      toroidal(head.x - mouse.x, head.y - mouse.y, _td);
      var dx = _td[0], dy = _td[1];
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

    /* Food beats fear: a fed koi will come back towards the surface even
       with the cursor nearby. Pull scales with proximity so the nearest fish
       commit hardest and the others drift over. */
    var feeding = 0;
    if (pellets.length) {
      var best = null, bd = 1e9, bestDx = 0, bestDy = 0;
      for (var pi = 0; pi < pellets.length; pi++) {
        var pl = pellets[pi];
        toroidal(pl.x - head.x, pl.y - head.y, _td);
        var pd2 = _td[0] * _td[0] + _td[1] * _td[1];
        if (pd2 < bd) { bd = pd2; best = pl; bestDx = _td[0]; bestDy = _td[1]; }
      }
      var pd = Math.sqrt(bd) || 1;
      if (best && pd < 430) {
        feeding = 1 - pd / 430;
        var pull = 3.4 * feeding;
        ax += (bestDx / pd) * pull;
        ay += (bestDy / pd) * pull;
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
    var maxTurn = (0.036 + fleeing * 0.055) * Math.min(f.slow, 1.15) * dt * 60;
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
    if (Math.random() < 0.0034 * dt * 60) f.dash = 0.35 + Math.random() * 0.55;

    // Slow personal rhythm of effort on top of the cruising speed.
    var effort = f.base * (0.72 + 0.4 * Math.sin(t * f.effortRate + f.effortPhase));
    var urge = panic > f.dash ? panic : f.dash;
    var want = effort + urge * (f.maxSpeed - effort);
    var dv = want - f.speed;
    var cap = (dv > 0 ? 0.055 : 0.08) * Math.min(f.slow, 1.2) * dt * 60;
    if (dv > cap) dv = cap;
    else if (dv < -cap) dv = -cap;
    f.speed += dv;
    if (f.speed > f.maxSpeed) f.speed = f.maxSpeed;
    else if (f.speed < 0.08) f.speed = 0.08;

    head.x += Math.cos(swim) * f.speed * dt * 60;
    head.y += Math.sin(swim) * f.speed * dt * 60;

    /* Wrap at the boundary itself. The whole spine shifts together, since
       moving the head alone would stretch the body across the screen.
       Waiting until the fish was fully clear of the edge left it missing
       for about three seconds, which is why the wrap was invisible — the
       far side is drawn as well now (see drawFishWrapped), so crossing is
       seamless and this can happen the instant the head passes the edge. */
    if (head.x < 0)      shiftFish(f, W, 0);
    else if (head.x > W) shiftFish(f, -W, 0);
    if (head.y < 0)      shiftFish(f, 0, H);
    else if (head.y > H) shiftFish(f, 0, -H);

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

  /* Shortest vector between two points on a pond that wraps. Without this
     a fish whose head has just crossed the right edge reads as a whole
     screen away from a cursor at the left edge, even though its tail is
     right there — so it would not flee from something visibly on top of
     it. Everything that reasons about distance has to agree the pond is a
     torus, not just the drawing. */
  var _td = [0, 0];
  function toroidal(dx, dy, out) {
    if (dx > W * 0.5) dx -= W; else if (dx < -W * 0.5) dx += W;
    if (dy > H * 0.5) dy -= H; else if (dy < -H * 0.5) dy += H;
    out[0] = dx; out[1] = dy;
  }

  function shiftFish(f, dx, dy) {
    for (var i = 0; i < SEG; i++) { f.spine[i].x += dx; f.spine[i].y += dy; }
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

  /* bodyOutline() walks 13 joints doing a normalise (and a sqrt) each,
     and fishPath() was calling it fresh for the shadow, the body and the
     clip — three times per fish, plus again for every edge ghost. Cached
     against a frame counter instead. */
  var frameId = 0;

  function fishPath(f) {
    if (f._outFrame !== frameId) {
      f._outline = bodyOutline(f);
      f._outFrame = frameId;
    }
    ctx.beginPath();
    smoothShape(f._outline);
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
    ctx.beginPath();
    for (var side = -1; side <= 1; side += 2) {
      var ox = p.x - (dy / d) * w * side * 0.5;
      var oy = p.y + (dx / d) * w * side * 0.5;
      ctx.moveTo(ox + f.girth * 0.6, oy);
      ctx.ellipse(ox, oy, f.girth * 0.6, f.girth * 0.22, ang + side * 0.85, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawFish(f) {
    // Shadow on the pond floor, offset by how deep the fish is swimming.
    var surf = f.rise > 0 ? Math.min(1, f.rise * 1.6) : 0;
    var off = f.girth * (0.3 + f.depth * 0.45) * (1 - surf * 0.55);
    ctx.save();
    ctx.translate(off, off * 1.15);
    fishPath(f);
    ctx.globalAlpha = 0.13 * f.depth;
    ctx.fillStyle = "#04120e";
    ctx.fill();
    ctx.restore();

    var fade = Math.min(1, 0.78 + f.depth * 0.22 + surf * 0.15);

    drawTail(f, f.pal.body, 0.55 * fade);
    drawFins(f, f.pal.body, 0.48 * fade);

    fishPath(f);
    ctx.globalAlpha = 0.96 * fade;
    ctx.fillStyle = f.pal.body;
    ctx.fill();

    /* Markings are clipped to the body so they read as patches rather than
       blobs. clip() is one of the more expensive canvas operations, and
       below a certain size the markings are a few pixels across and the
       clip changes nothing anyone can see — so only the largest koi pay
       for it. Threshold raised from girth 5.5 to 9, which takes most of
       the school off the clipped path. */
    if (f.girth < 13) {
      ctx.globalAlpha = 0.8 * fade;
      ctx.fillStyle = f.pal.patch;
      var sp = f.spine[4];
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, f.girth * 0.5, f.girth * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
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
    }

    // Eyes. Small, but they're most of what makes a blob read as a fish.
    var e = f.spine[2], ep = f.spine[1], en = f.spine[3];
    var edx = en.x - ep.x, edy = en.y - ep.y;
    var ed = Math.sqrt(edx * edx + edy * edy) || 1;
    var enx = -edy / ed, eny = edx / ed;
    var eo = widthAt(2, f) * 0.6, er = Math.max(0.6, f.girth * 0.15);
    ctx.globalAlpha = 0.72 * fade;
    ctx.fillStyle = "#17140f";
    ctx.beginPath();
    for (var q = -1; q <= 1; q += 2) {
      ctx.moveTo(e.x + enx * eo * q + er, e.y + eny * eo * q);
      ctx.arc(e.x + enx * eo * q, e.y + eny * eo * q, er, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  /* A fish straddling an edge has to be drawn on both sides, or it
     vanishes at one boundary and appears at the other. Only fish actually
     near an edge pay for the second draw. */
  function drawFishWrapped(f) {
    drawFish(f);

    var span = (SEG - 1) * f.len + f.girth * 3;
    var hx = f.spine[0].x, hy = f.spine[0].y;
    var dx = 0, dy = 0;
    if (hx < span) dx = W; else if (hx > W - span) dx = -W;
    if (hy < span) dy = H; else if (hy > H - span) dy = -H;

    if (dx) { ctx.save(); ctx.translate(dx, 0);  drawFish(f); ctx.restore(); }
    if (dy) { ctx.save(); ctx.translate(0, dy);  drawFish(f); ctx.restore(); }
    if (dx && dy) { ctx.save(); ctx.translate(dx, dy); drawFish(f); ctx.restore(); }
  }

  /* ---- water -------------------------------------------------------------- */


  function initBackdrop() {
    /* Everything that never changes — the water gradient, the silt, the
       stones, the corner vignette — is baked into one image at resize.
       These were three separate full-canvas operations every frame. */
    var g = bgCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var base = g.createRadialGradient(W * 0.45, H * 0.42, Math.min(W, H) * 0.05,
                                      W * 0.45, H * 0.42, Math.max(W, H) * 0.78);
    base.addColorStop(0, C.pond);
    base.addColorStop(1, C.deep);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

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
      g.beginPath();
      g.ellipse(-st.r * 0.24, -st.r * 0.28, st.r * 0.5, st.r * st.squash * 0.38, 0, 0, Math.PI * 2);
      g.globalAlpha = 0.3;
      g.fillStyle = C.stoneLit;
      g.fill();
      g.restore();
    }

    /* Matted algae. A real pond floor is mostly green — submerged growth
       covers almost everything — and ours was bare silt with stones on it.
       Irregular overlapping blobs rather than neat circles, because
       nothing on a pond bottom has an outline. */
    for (var al = 0; al < 44; al++) {
      var ax = Math.random() * W, ay = Math.random() * H;
      var ar = 50 + Math.random() * 190;
      g.globalAlpha = 0.05 + Math.random() * 0.09;
      g.fillStyle = C.algae;
      g.beginPath();
      for (var lobe = 0; lobe < 6; lobe++) {
        var la = (lobe / 6) * Math.PI * 2 + Math.random() * 0.5;
        var lr = ar * (0.45 + Math.random() * 0.55);
        var lx = ax + Math.cos(la) * ar * 0.35;
        var ly = ay + Math.sin(la) * ar * 0.35;
        g.moveTo(lx + lr, ly);
        g.ellipse(lx, ly, lr, lr * (0.5 + Math.random() * 0.5),
                  Math.random() * Math.PI, 0, Math.PI * 2);
      }
      g.fill();
    }

    /* Submerged rosettes: static low growth, distinct from the blades that
       sway. Most pond planting doesn't move much. */
    /* Low growth. These used to radiate evenly in all directions at a
       uniform length, which reads as an asterisk rather than a plant.
       Now each clump leans one way, the blades fan within an arc rather
       than a full circle, and their lengths vary a lot. */
    for (var rz = 0; rz < 46; rz++) {
      var rx = Math.random() * W, ry = Math.random() * H;
      var blades = 5 + (Math.random() * 8 | 0);
      var reach = 12 + Math.random() * 38;
      var lean = Math.random() * Math.PI * 2;
      var fan = 0.7 + Math.random() * 1.9;          // not the full circle
      g.globalAlpha = 0.22 + Math.random() * 0.26;
      g.strokeStyle = Math.random() > 0.45 ? C.weed : C.algae;
      g.lineWidth = 0.8 + Math.random() * 1.5;
      g.beginPath();
      for (var bl2 = 0; bl2 < blades; bl2++) {
        var ba = lean + (Math.random() - 0.5) * fan;
        var blen = reach * (0.3 + Math.random() * Math.random() * 1.2);
        var bend = (Math.random() - 0.5) * 1.1;     // real curve, not a spoke
        g.moveTo(rx, ry);
        g.quadraticCurveTo(rx + Math.cos(ba + bend) * blen * 0.55,
                           ry + Math.sin(ba + bend) * blen * 0.55,
                           rx + Math.cos(ba) * blen,
                           ry + Math.sin(ba) * blen);
      }
      g.stroke();
    }

    /* Sunken leaves and twigs. */
    g.globalAlpha = 0.3;
    g.fillStyle = C.detritus;
    g.beginPath();
    for (var lf = 0; lf < 70; lf++) {
      var fx2 = Math.random() * W, fy2 = Math.random() * H;
      var fr2 = 3 + Math.random() * 7;
      g.moveTo(fx2 + fr2, fy2);
      g.ellipse(fx2, fy2, fr2, fr2 * (0.3 + Math.random() * 0.3),
                Math.random() * Math.PI, 0, Math.PI * 2);
    }
    g.fill();

    g.globalAlpha = 0.26;
    g.strokeStyle = C.detritus;
    g.lineWidth = 1.5;
    g.beginPath();
    for (var tw = 0; tw < 14; tw++) {
      var tx = Math.random() * W, ty = Math.random() * H;
      var ta = Math.random() * Math.PI * 2, tl = 24 + Math.random() * 60;
      g.moveTo(tx, ty);
      g.quadraticCurveTo(tx + Math.cos(ta) * tl * 0.5 + 8, ty + Math.sin(ta) * tl * 0.5,
                         tx + Math.cos(ta) * tl, ty + Math.sin(ta) * tl);
    }
    g.stroke();

    g.globalAlpha = 1;
    var vg = g.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.3,
                                    W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    vg.addColorStop(0, "transparent");
    vg.addColorStop(1, "rgba(0,26,20,0.2)");
    g.globalAlpha = 1;
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  /* ---- the bottom ----------------------------------------------------------
     Stones and submerged planting. Positions are fixed per resize; only the
     weed sway is animated. All of this sits under the caustics, so the light
     web dapples across it, and under the fish, which swim above it.
     -------------------------------------------------------------------------- */

  var stones = [], weeds = [];

  function makeBottom() {
    stones = [];
    /* Stones gather into beds on a real pond floor; scattered uniformly
       they read as noise. Each bed drops a cluster, plus a thin scatter
       everywhere else. */
    var beds = Math.round((W * H) / 190000);
    for (var b = 0; b < beds; b++) {
      var bx = Math.random() * W, by = Math.random() * H;
      var spread = 60 + Math.random() * 130;
      var count = 10 + (Math.random() * 22 | 0);
      for (var c = 0; c < count; c++) {
        var ba = Math.random() * Math.PI * 2;
        var bd = Math.pow(Math.random(), 0.7) * spread;
        stones.push({
          x: bx + Math.cos(ba) * bd,
          y: by + Math.sin(ba) * bd,
          r: 3 + Math.random() * Math.random() * 20,
          squash: 0.55 + Math.random() * 0.4,
          rot: Math.random() * Math.PI,
          tone: Math.random(),
        });
      }
    }
    var loose = Math.round((W * H) / 24000);
    for (var i = 0; i < loose; i++) {
      stones.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 2 + Math.random() * Math.random() * 14,
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
      var reach = 0;
      for (var bb = 0; bb < blades.length; bb++) reach = Math.max(reach, blades[bb].len);
      weeds.push({
        x: Math.random() * W,
        y: Math.random() * H,
        phase: Math.random() * Math.PI * 2,
        kick: 0,
        reach: reach,
        blades: blades,
      });
    }
  }

  function drawWeeds() {
    for (var i = 0; i < weeds.length; i++) {
      var cl = weeds[i];
      waveForce(cl.x, cl.y, _wf, true);
      cl.kick += ((_wf[0] + _wf[1]) * 0.7 - cl.kick) * 0.16;

      /* One gradient for the whole clump rather than one per blade — this
         was allocating ~100 gradient objects every frame. */
      var clumpFill = ctx.createLinearGradient(cl.x, cl.y, cl.x, cl.y - cl.reach);
      clumpFill.addColorStop(0, C.weed);
      clumpFill.addColorStop(1, C.weedTip);
      ctx.beginPath();
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
        ctx.moveTo(cl.x + nx * hw, cl.y + ny * hw);
        ctx.quadraticCurveTo(cxp + nx * hw * 0.5, cyp + ny * hw * 0.5, tipx, tipy);
        ctx.quadraticCurveTo(cxp - nx * hw * 0.5, cyp - ny * hw * 0.5,
                             cl.x - nx * hw, cl.y - ny * hw);
        ctx.closePath();

      }
      // one fill for the whole clump
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = clumpFill;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* The drifting colour bands on the surface. Factored out so a passing
     wavefront can redraw them distorted inside its own annulus — otherwise
     the shifting colours slide along underneath the rings, completely
     indifferent to them. `x0..h` bounds the fill so the per-ripple redraws
     only touch the ring, not the whole canvas. */
  /* ---- the animated light layer -----------------------------------------
     Caustics, the swell thrown off by each ripple, and the drifting sheen
     bands all used to be composited straight onto the main canvas: five
     full-canvas operations a frame, ~33M pixel writes at retina. They are
     all soft, low-frequency light, so they are now rendered into a buffer
     at a third of the resolution and blitted up once — a ninth of the fill
     cost, and one composite instead of five.
     -------------------------------------------------------------------------- */

  var LW = 0, LH = 0;

  function initLight() {
    LW = Math.max(64, Math.round(W * LIGHT_SCALE));
    LH = Math.max(48, Math.round(H * LIGHT_SCALE));
    lightCv.width = LW;
    lightCv.height = LH;
    // Draw in page coordinates; the transform handles the downscale.
    lightCtx.setTransform(LW / W, 0, 0, LH / H, 0, 0);
  }

  function drawLight() {
    var g = lightCtx;
    if (!g) return;
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;

    /* Nothing here but ripples.

       This layer used to also carry a caustic field: a procedural sine
       pattern with a ~600px wavelength, redrawn across the whole screen
       every frame. Those were the big soft swirls in the background, and
       they were never ripples — no identity, no state, nothing that could
       be disturbed by the cursor or by anything else. They were also the
       single most expensive thing on the page. Every mark on the surface
       is now an actual wavefront, which means all of it deforms, tears and
       interferes. */

    drawWavefronts(g);


    g.globalAlpha = 1;
  }

  function drawWater() {
    // The floor is its own canvas and never repaints; the light is its own
    // canvas and paints itself. Nothing to composite here any more.
    lightPhase ^= 1;
    if (lightPhase) drawLight();
    drawWeeds();
  }

  /* ---- lily pads ------------------------------------------------------------
     Nothing says "pond" faster. They float on the surface, so they draw over
     the fish rather than under them.
     -------------------------------------------------------------------------- */

  var pads = [];

  /* ---- water striders ------------------------------------------------
     Small insects skating on the surface. They rest, then dart, and each
     dart dimples the water — which is the other half of where the pond's
     ambient ripples come from. Their feet leave the four little dimples
     that make a strider recognisable from above.
     -------------------------------------------------------------------------- */

  var bugs = [];

  function makeBugs() {
    var n = Math.max(5, Math.min(14, Math.round((W * H) / 165000)));
    bugs = [];
    for (var i = 0; i < n; i++) {
      bugs.push({
        x: Math.random() * W,
        y: Math.random() * H,
        a: Math.random() * TAU,
        v: 0,
        wait: Math.random() * 12,
        trail: [],
        panicCool: 0,
        size: 0.8 + Math.random() * 0.5,
      });
    }
  }

  function updateBugs(dt) {
    for (var i = 0; i < bugs.length; i++) {
      var b = bugs[i];

      // skitter away if the cursor comes near
      toroidal(mouse.x - b.x, mouse.y - b.y, _td);
      var fx = _td[0], fy = _td[1];
      var fd = Math.sqrt(fx * fx + fy * fy) || 1;
      b.panicCool -= dt;
      if (mouse.on && fd < 130) {
        b.a = Math.atan2(-fy, -fx) + (Math.random() - 0.5) * 0.6;
        if (b.v < 3.2) {
          b.v = 3.6;
          /* Rate-limited: sweeping the cursor across the pond startles
             every strider it passes, and without this each one emitted a
             ring per frame of contact. Twenty of them doing that filled
             the ripple budget and crowded out the cursor's own wake. */
          if (b.panicCool <= 0) { b.panicCool = 1.4; dimple(b); }
        }
        b.wait = 0.25;
      }

      b.v *= Math.max(0, 1 - dt * 7);        // a dart is short and sharp
      b.wait -= dt;
      if (b.wait <= 0) {
        b.wait = 5 + Math.random() * 12;      // long rests, short darts
        b.a += (Math.random() - 0.5) * 1.8;
        b.v = 2.2 + Math.random() * 2.4;
        dimple(b);
      }

      b.x += Math.cos(b.a) * b.v;
      b.y += Math.sin(b.a) * b.v;

      // carried by any wavefront crossing them, like the food and the pads
      waveForce(b.x, b.y, _wf, false);
      b.x += _wf[0] * 2.2;
      b.y += _wf[1] * 2.2;

      /* A short wake behind it while it is actually moving. Drawn as a
         fading trail rather than spawned as ripples — one ripple per dart
         is right, but twenty striders each emitting a stream of them would
         bury the surface. */
      if (b.v > 0.5) {
        b.trail.push(b.x, b.y);
        if (b.trail.length > 14) b.trail.splice(0, 2);
      } else if (b.trail.length) {
        b.trail.splice(0, 2);
      }

      // wrap, like everything else on the surface
      if (b.x < 0)      { b.x += W; b.trail.length = 0; }
      else if (b.x > W) { b.x -= W; b.trail.length = 0; }
      if (b.y < 0)      { b.y += H; b.trail.length = 0; }
      else if (b.y > H) { b.y -= H; b.trail.length = 0; }
    }
  }

  function dimple(b) {
    /* Nudged up so a dart actually registers, but deliberately still the
       faintest thing on the water — a strider weighs nothing. Roughly a
       fifth the strength of a koi breaking the surface and a sixth the
       size of one, so it reads as an insect rather than an event. */
    addRipple(b.x, b.y, 20 + Math.random() * 26, 0,
              0.18 + Math.random() * 0.14, 0.12);
  }

  function drawBugs() {
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = C.light;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (var w = 0; w < bugs.length; w++) {
      var tr = bugs[w].trail;
      if (tr.length < 4) continue;
      ctx.moveTo(tr[0], tr[1]);
      for (var q2 = 2; q2 < tr.length; q2 += 2) ctx.lineTo(tr[q2], tr[q2 + 1]);
      ctx.lineTo(bugs[w].x, bugs[w].y);
    }
    ctx.stroke();

    for (var i = 0; i < bugs.length; i++) {
      var b = bugs[i];
      var s = b.size;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);

      // four footprints dimpling the surface film — one path, one fill
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.light;
      ctx.beginPath();
      for (var q = 0; q < 4; q++) {
        var lx = (q < 2 ? 4.5 : -3.5) * s;
        var ly = (q % 2 ? 5.5 : -5.5) * s;
        ctx.moveTo(lx + 2.1 * s, ly);
        ctx.ellipse(lx, ly, 2.1 * s, 1.7 * s, 0, 0, TAU);
      }
      ctx.fill();

      // legs — likewise one path, one stroke
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = C.strider;
      ctx.lineWidth = 0.7 * s;
      ctx.beginPath();
      for (var l = 0; l < 4; l++) {
        ctx.moveTo(0, 0);
        ctx.lineTo((l < 2 ? 4.5 : -3.5) * s, (l % 2 ? 5.5 : -5.5) * s);
      }
      ctx.stroke();

      // body
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = C.strider;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.1 * s, 1.1 * s, 0, 0, TAU);
      ctx.fill();

      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- duckweed ---------------------------------------------------------
     Drifts of tiny floating leaves. They cost almost nothing and they do
     something no other element does: they make the water's movement
     legible. A wavefront passing underneath visibly carries them, so you
     can read the shape of a ripple from what it moves rather than only
     from the ring itself.
     -------------------------------------------------------------------------- */

  var weed2 = [];

  function makeDuckweed() {
    weed2 = [];
    var drifts = Math.max(2, Math.min(5, Math.round((W * H) / 420000)));
    for (var d = 0; d < drifts; d++) {
      var cx = Math.random() * W, cy = Math.random() * H;
      var spread = 70 + Math.random() * 130;
      var n = 10 + (Math.random() * 18 | 0);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, r = Math.pow(Math.random(), 0.6) * spread;
        weed2.push({
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          vx: 0, vy: 0,
          r: 1.6 + Math.random() * 2.2,
          rot: Math.random() * TAU,
          tone: Math.random(),
        });
      }
    }
  }

  var weedPhase = 0;

  function updateDuckweed(dt) {
    /* ~150 leaves each sampling every live ripple is the biggest physics
       cost in the scene. Half the mat is updated per frame, alternating;
       a leaf drifts a fraction of a pixel a frame so nobody can tell. */
    weedPhase ^= 1;
    for (var i = 0; i < weed2.length; i++) {
      var p = weed2[i];
      if ((i & 1) === weedPhase) { p.x += p.vx; p.y += p.vy; continue; }
      waveForce(p.x, p.y, _wf, false);
      p.vx += _wf[0] * 1.5;
      p.vy += _wf[1] * 1.5;
      // a slow prevailing drift, so a mat is never completely static
      p.vx += Math.cos(t * 0.05 + p.rot) * 0.004;
      p.vy += Math.sin(t * 0.04 + p.rot) * 0.004;
      p.vx *= 0.93; p.vy *= 0.93;
      p.x += p.vx; p.y += p.vy;
      if (p.x < -20) p.x += W + 40; else if (p.x > W + 20) p.x -= W + 40;
      if (p.y < -20) p.y += H + 40; else if (p.y > H + 20) p.y -= H + 40;
    }
  }

  function drawDuckweed() {
    /* Two fills for the whole mat instead of one per leaf. At ~200 leaves
       this was the single largest source of draw calls on the page. */
    ctx.globalAlpha = 0.8;
    for (var pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? C.padRim : C.pad;
      ctx.beginPath();
      for (var i = 0; i < weed2.length; i++) {
        var p = weed2[i];
        if ((p.tone > 0.7) !== !!pass) continue;
        // near-round anyway, and arc() is cheaper than ellipse()
        ctx.moveTo(p.x + p.r, p.y);
        ctx.arc(p.x, p.y, p.r, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

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
      /* A pad floats; it is not on a spring. The restoring force used to
         be stiff (0.06) and heavily damped (0.88), so a pad shoved by a
         wave snapped back in under half a second like something on
         elastic. Softer and far less damped now: it drifts back over a
         couple of seconds, overshooting and settling, the way something
         buoyant actually does. */
      /* Coupling was 4.2, which meant a pad did not get nudged by a
         passing wave — it got towed by it, riding the wavefront over
         150px out before the spring could do anything. What looked like
         "not drifting back" was really "dragged much too far first".
         A nudge now, with a spring soft enough to take its time. */
      /* A pad is anchored by a stem to the bottom. It should rock and bob
         where it sits, not be shunted around the pond.

         Softening the spring did not fix the "snapping back" because the
         spring was never the problem: coupling was high enough to throw a
         pad 90px, and any oscillator crosses its midpoint at A*omega — a
         90px swing passes through centre at ~10px a frame however gentle
         the spring is. The snap WAS the amplitude. So: much less travel,
         and the energy goes into tilt instead, which is what a moored
         pad actually does in a wave. */
      var give = p.buoy * 0.16;
      p.vx += _wf[0] * give - p.ox * 0.02;
      p.vy += _wf[1] * give - p.oy * 0.02;
      p.vx *= 0.97; p.vy *= 0.97;
      p.ox += p.vx; p.oy += p.vy;
      /* Clamped. Unbounded this reached 85 degrees — the pad stood on its
         edge. A pad on a wave tips a few degrees. */
      var wantTilt = (_wf[0] + _wf[1]) * 0.8 * p.buoy;
      if (wantTilt > 0.2) wantTilt = 0.2;
      else if (wantTilt < -0.2) wantTilt = -0.2;
      p.tilt += (wantTilt - p.tilt) * 0.045;

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
      ctx.beginPath();
      for (var v = 0; v < 7; v++) {
        var a = 0.6 + (v / 6) * (Math.PI * 2 - 1.2);
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * p.r * 0.88, Math.sin(a) * p.r * 0.88);
      }
      ctx.stroke();

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
  /* Water thrown off the surface: torn foam, flung droplets, the spray a
     rebound sends back up. Three separate systems, three update loops and
     three draw passes, differing only in size, shape and lifetime. One
     thing now — the same move as every ripple being one thing regardless
     of what made it. */
  function sprayBurst(x, y, n, o) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var sp = o.speed * (0.5 + Math.random());
      spray.push({
        x: x + Math.cos(a) * (o.offset || 0) * Math.random(),
        y: y + Math.sin(a) * (o.offset || 0) * Math.random(),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: o.r * (0.6 + Math.random() * 0.8),
        squash: o.squash, rot: Math.random() * TAU,
        ring: !!o.ring, age: 0,
        life: o.life * (0.7 + Math.random() * 0.6),
        /* Thrown water goes up as well as out. From directly above that
           reads as a droplet swelling to its peak and shrinking as it
           falls — the whole of the arc, from this angle. */
        arc: !!o.arc,
        // and they don't all leave the rim on the same frame
        delay: (o.delay || 0) + Math.random() * (o.scatter || 0),
      });
    }
  }

  function addRipple(x, y, max, delay, weight, sub) {
    /* Deform state is allocated up front for every ripple, not lazily on
       first contact. Lazily meant a ring switched rendering path the moment
       the cursor touched it, so a disturbed ring was drawn by different
       code than an untouched one. */
    var def = [], cut = [], tmp = [];
    for (var i = 0; i < RN; i++) { def[i] = 0; cut[i] = 0; tmp[i] = 0; }
    ripples.push({ x: x, y: y, r: 0, max: max, life: 0, delay: delay || 0,
                   weight: weight == null ? 1 : weight,
                   sub: sub == null ? 1 : sub,
                   seed: Math.random() * 100,
                   def: def, cut: cut, tmp: tmp });
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
      var width = 22 + rp.r * 0.12;
      /* Reject on squared distance first. Only points actually inside the
         annulus pay for a sqrt, and with ~160 callers a frame against
         every live ripple most of them are nowhere near one. */
      var d2 = dx * dx + dy * dy;
      var outer = rp.r + width;
      if (d2 > outer * outer) continue;
      var inner = rp.r - width;
      if (inner > 0 && d2 < inner * inner) continue;
      var d = Math.sqrt(d2) || 1;
      var band = Math.abs(d - rp.r);
      /* Amplitude scales with the size of the wave, so a small wake ring
         nudges and a big splash ring shoves. Without this every ring pushed
         the same and a click felt no heavier than a mouse sweep. */
      var amp = Math.min(1.7, rp.max / 120);
      var k = (1 - band / width) * (1 - rp.life / RIPPLE_LIFE) * rp.weight * reach * amp;
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

  /* How long a ring lives. Was 1.5s with a (1-k)^2 fade, which meant a ring
     was effectively invisible past ~40% of its life — so everything that
     disturbed one was happening to a ring nobody could see. */
  var RIPPLE_LIFE = 2.8;

  function dentRing(rp, ang, amount, spread) {
    var slot = Math.floor(((ang + TAU) % TAU) / TAU * RN) % RN;
    var lim = rp.r * 0.2;
    for (var o = -spread; o <= spread; o++) {
      var si = (slot + o + RN) % RN;
      var fall = 1 - Math.abs(o) / (spread + 1);
      var nd = rp.def[si] + amount * fall;
      rp.def[si] = nd > lim ? lim : (nd < -lim ? -lim : nd);
    }
  }

  /* Where two wavefronts cross, each buckles the other. Two expanding
     circles intersect at theta +/- acos(...) from the line joining their
     centres; that is where the interference goes. Previously ripples
     passed through one another as though the other were not there. */
  function crossRings(dt) {
    for (var i = 0; i < ripples.length; i++) {
      var A = ripples[i];
      if (A.delay > 0 || A.r < 12) continue;
      for (var j = i + 1; j < ripples.length; j++) {
        var B = ripples[j];
        if (B.delay > 0 || B.r < 12) continue;

        var dx = B.x - A.x, dy = B.y - A.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1 || d > A.r + B.r || d < Math.abs(A.r - B.r)) continue;

        var th = Math.atan2(dy, dx);
        var ka = Math.pow(1 - Math.min(1, A.life / RIPPLE_LIFE), 1.1);
        var kb = Math.pow(1 - Math.min(1, B.life / RIPPLE_LIFE), 1.1);

        var ca = (d * d + A.r * A.r - B.r * B.r) / (2 * d * A.r);
        if (ca >= -1 && ca <= 1) {
          var aa = Math.acos(ca);
          var amtA = B.weight * kb * 26 * dt;
          dentRing(A, th + aa, amtA, 2);
          dentRing(A, th - aa, amtA, 2);
        }

        var cb = (d * d + B.r * B.r - A.r * A.r) / (2 * d * B.r);
        if (cb >= -1 && cb <= 1) {
          var ab = Math.acos(cb);
          var amtB = A.weight * ka * 26 * dt;
          dentRing(B, th + Math.PI + ab, amtB, 2);
          dentRing(B, th + Math.PI - ab, amtB, 2);
        }
      }
    }
  }

  function disturbRings(dt) {
    crossRings(dt);
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
            rp.cut[si] = Math.min(1.3, rp.cut[si] + bite * 0.5 * falloff);
          }
        }
      }

      // the dent travels around the crest and flattens out; the tear heals
      var spread = 0.2, damp = 1 - dt * 1.1, heal = 1 - dt * 0.8;
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
    /* One ring. Four staggered ones read as a target rather than a wave —
       they sit concentric and evenly spaced, which water never does. The
       only other ring comes from the rebound a beat later, at a different
       size and a different moment, so the two never look like a pair. */
    addRipple(x, y, 230, 0, 1.35, 1);

    /* Foam torn off the rim, and droplets flung out of it. */
    /* Foam lingers on the rim and dissolves there, rather than flying
       off alongside the droplets. */
    sprayBurst(x, y, 13, { speed: 0.9, r: 3.8, squash: 0.6,
                           life: 0.7, offset: 24, scatter: 0.05 });
    sprayBurst(x, y, 24, { speed: 4.2, r: 1.9, squash: 1, life: 0.6,
                           ring: true, arc: true, scatter: 0.07 });

    /* The rebound — water driven back up the middle falls in again a beat
       later. It is just the same two primitives with a delay on them; no
       separate machinery for it any more. */
    addRipple(x, y, 95, 0.45, 0.5, 0.55);
    sprayBurst(x, y, 7, { speed: 1.6, r: 1.6, squash: 1, life: 0.5,
                          ring: true, arc: true, delay: 0.45, scatter: 0.05 });

    /* Striders sit on the surface film, so a splash throws them harder
       than it does anything swimming under it. They were previously the
       only thing in the pond that ignored it entirely. */
    for (var bi = 0; bi < bugs.length; bi++) {
      var bg = bugs[bi];
      toroidal(bg.x - x, bg.y - y, _td);
      var bdx = _td[0], bdy = _td[1];
      var bd = Math.sqrt(bdx * bdx + bdy * bdy) || 1;
      if (bd < 420) {
        var kick = 1 - bd / 420;
        bg.a = Math.atan2(bdy, bdx) + (Math.random() - 0.5) * 0.5;
        bg.v = Math.max(bg.v, 2.2 + kick * 3.4);
        bg.wait = 0.2 + Math.random() * 0.5;
        if (bg.panicCool <= 0) { bg.panicCool = 1.4; dimple(bg); }
      }
    }

    // Everything nearby bolts, harder and from further out.
    fish.forEach(function (f) {
      var h = f.spine[0];
      toroidal(h.x - x, h.y - y, _td);
      var dx = _td[0], dy = _td[1];
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
      rp.r = rp.max * (1 - Math.pow(1 - Math.min(1, rp.life / RIPPLE_LIFE), 2.2));
      if (rp.life > RIPPLE_LIFE) ripples.splice(i, 1);
    }
    for (var sk = spray.length - 1; sk >= 0; sk--) {
      var sp = spray[sk];
      if (sp.delay > 0) { sp.delay -= dt; continue; }
      sp.age += dt;
      /* Lightly coupled to the wave field, so the cursor's current and
         passing wavefronts tug at spray in flight. Kept low: at 1.2 a
         droplet was shoved again every frame the splash's own ring swept
         over it, and rode the wavefront clean off the screen. */
      waveForce(sp.x, sp.y, _wf, false);
      sp.vx += _wf[0] * 0.3;
      sp.vy += _wf[1] * 0.3;
      sp.x += sp.vx; sp.y += sp.vy;
      sp.vx *= 0.92; sp.vy *= 0.92;
      if (sp.age >= sp.life) {
        // a droplet that lands rings the water; foam just dissolves
        if (sp.ring) addRipple(sp.x, sp.y, 10 + Math.random() * 14, 0, 0.4, 0.5);
        spray.splice(sk, 1);
      }
    }
  }

  /* ---- wavefronts --------------------------------------------------------
     One ripple, drawn once, as one thing. It used to be four passes in two
     places: a swell gradient and a trough gradient in the light layer, and
     a crest stroke and a shadow stroke somewhere else entirely. They are
     all the same physical feature — a band of lifted water — so they are
     one routine now.

     The soft band carries the mass of the wave and the stroke draws its
     edge, which is also where the per-angle dents and tears show up.
     -------------------------------------------------------------------------- */


  /* Per-angle geometry for one ripple, computed once a frame and shared by
     all four of its strokes. Each stroke used to re-derive the same three
     sines and the same def/cut interpolation for every point, so three
     quarters of that trig was redundant. */

  var _warp = [], _defA = [], _cutA = [], _steps = 0;

  function cacheRing(rp, k) {
    _steps = Math.max(10, Math.min(30, Math.round(rp.r / 6)));
    for (var i = 0; i <= _steps; i++) {
      var ang = (i / _steps) * TAU;
      _warp[i] = 1
        + Math.sin(ang * 3 + rp.seed) * 0.035 * (0.4 + k)
        + Math.sin(ang * 5 - rp.seed * 1.7 + rp.life * 3) * 0.026 * (0.3 + k)
        + Math.sin(ang * 8 + rp.seed * 0.6) * 0.014;

      var f = (ang / TAU) * RN;
      var i0 = Math.floor(f) % RN, i1 = (i0 + 1) % RN, m = f - Math.floor(f);
      _defA[i] = rp.def[i0] * (1 - m) + rp.def[i1] * m;
      _cutA[i] = rp.cut[i0] * (1 - m) + rp.cut[i1] * m;
    }
  }

  /* One crest line. Walks the circumference and strokes the runs that
     survive, so a torn ring comes out as separate arcs. An untouched ring
     has cut[] all zero and simply emits one unbroken run — same code. */
  function crest(g, rp, radius, alpha, width, colour) {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineJoin = "round";
    var open = false;
    for (var i = 0; i <= _steps; i++) {
      var c = _cutA[i];
      if (c > 0.6) {
        if (open) { g.stroke(); open = false; }
        continue;
      }
      var ang = (i / _steps) * TAU;
      var r = radius * _warp[i] + _defA[i];
      var px = rp.x + Math.cos(ang) * r, py = rp.y + Math.sin(ang) * r;
      if (!open) {
        g.beginPath();
        g.globalAlpha = alpha * (1 - c);
        g.moveTo(px, py);
        open = true;
      } else {
        g.lineTo(px, py);
      }
    }
    if (open) g.stroke();
  }

  /* The body of a wave.

     This used to be two radial gradients centred on the ripple — perfect
     circles that never read def[] or cut[]. Since the soft body is the
     visually dominant part of a large ripple, that meant dragging the
     cursor through one did nothing you could see: the thin crest dented
     while the broad shape it sat in stayed perfectly round.

     It is now drawn with the same deformed path as the crest, just wide
     and faint. The whole wave buckles and tears together, and concentric
     strokes are cheaper than a 500px gradient fill besides. */
  function swell(g, rp, k) {
    var ws = Math.pow(1 - k, 1.1) * rp.weight;
    if (ws < 0.04) return;
    var band = 4 + rp.r * 0.16;

    /* A ring narrower than its own band has no annulus to draw. Stroking
       one anyway painted a 5px-wide circle of the darkest pond colour
       around a 1px radius — a solid dark dot at the centre. Since every
       ripple is born at r≈0, every single one flashed a black speck
       before it grew. That is where they came from. */
    if (rp.r < band * 1.4) return;

    /* Light only, and stroked along the deformed path rather than filled
       as a circular gradient — so a dented ring's body dents with it.
       Width is capped (a 230px ripple was painting a 61px-wide band around
       its whole circumference) and bounded by the radius, so a small ring
       can never be over-stroked into a blob. */
    var body = Math.min(band * 1.5, 34, rp.r * 0.9);
    crest(g, rp, rp.r, 0.34 * ws, body, C.light);
  }

  /* ---- wavefronts --------------------------------------------------------
     One ripple, drawn once, as one thing. It used to be four passes in two
     places: a swell gradient and a trough gradient in the light layer, and
     a crest stroke and a shadow stroke somewhere else entirely. They are
     all the same physical feature — a band of lifted water — so they are
     one routine now.

     The soft band carries the mass of the wave and the stroke draws its
     edge, which is also where the per-angle dents and tears show up.
     -------------------------------------------------------------------------- */


  /* Radius of a ripple at a given angle: its own procedural buckle, plus
     whatever the cursor has dented into it. */
  function sampleR(rp, ang, radius, k) {
    var warp = 1
      + Math.sin(ang * 3 + rp.seed) * 0.035 * (0.4 + k)
      + Math.sin(ang * 5 - rp.seed * 1.7 + rp.life * 3) * 0.026 * (0.3 + k)
      + Math.sin(ang * 8 + rp.seed * 0.6) * 0.014;
    var f = ((ang + TAU) % TAU) / TAU * RN;
    var i0 = Math.floor(f) % RN, i1 = (i0 + 1) % RN, m = f - Math.floor(f);
    return radius * warp + rp.def[i0] * (1 - m) + rp.def[i1] * m;
  }

  function cutAt(rp, ang) {
    var f = ((ang + TAU) % TAU) / TAU * RN;
    var i0 = Math.floor(f) % RN, i1 = (i0 + 1) % RN, m = f - Math.floor(f);
    return rp.cut[i0] * (1 - m) + rp.cut[i1] * m;
  }

  /* One crest line. Walks the circumference and strokes the runs that
     survive, so a torn ring comes out as separate arcs. An untouched ring
     has cut[] all zero and simply emits one unbroken run — same code. */
  /* ---- wavefronts --------------------------------------------------------
     Every ripple goes through exactly this, with no exceptions and no
     budget that some of them miss out on. Ambient, cursor wake and splash
     differ only in the three numbers they were created with: how big, how
     strong, and how deep the disturbance reaches.
     -------------------------------------------------------------------------- */

  function drawWavefronts(g) {
    g.lineCap = "round";

    for (var i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      if (rp.delay > 0) continue;
      var k = Math.min(1, rp.life / RIPPLE_LIFE);

      cacheRing(rp, k);          // once, for all four strokes below
      if (rp.r > 4) swell(g, rp, k);

      /* Clamped: a splash ring's weight is 1.35, so this came out at 1.13
         and every heavy ring sat pinned at the canvas maximum, losing the
         distinction between a big one and a very big one. */
      var a = Math.min(1, Math.pow(1 - k, 1.25) * 0.88 * rp.weight);
      if (a <= 0.004 || rp.r < 4) continue;
      // and the crest itself, likewise with no dark companion
      var lw = (1.9 * rp.weight + 0.5) * (1 - k * 0.35);
      crest(g, rp, rp.r, a * 0.95, lw, C.wave);
    }

    g.globalAlpha = 1;
  }

  function drawRipples() {
    ctx.lineCap = "round";
    /* All spray in one path: torn foam, flung droplets and rebound alike.
       Flat, with no shadow under them — the offset shadow read as a solid
       three-dimensional object in an otherwise flat scene. */
    if (spray.length) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = C.wave;
      ctx.beginPath();
      for (var si = 0; si < spray.length; si++) {
        var sp2 = spray[si];
        if (sp2.delay > 0) continue;
        var u = sp2.age / sp2.life;
        var rr = sp2.arc
          ? sp2.r * (0.45 + Math.sin(Math.PI * u) * 0.85) * (1 - u * 0.5)
          : sp2.r * (1 - u);
        if (rr <= 0.05) continue;
        ctx.moveTo(sp2.x + rr, sp2.y);
        ctx.ellipse(sp2.x, sp2.y, rr, rr * sp2.squash, sp2.rot, 0, TAU);
      }
      ctx.fill();
    }

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
    updateDuckweed(dt);
    updateBugs(dt);

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
      if (wakeTravel > stride && wakeCool <= 0) {
        wakeTravel = 0;
        wakeCool = 0.07;
        /* If the pond is at capacity, evict the faintest ring rather than
           skipping this one. The cursor's own wake is the most important
           feedback on the page and must never be the thing that loses. */
        if (ripples.length >= 46) {
          var worst = 0, worstScore = Infinity;
          for (var ei = 0; ei < ripples.length; ei++) {
            var er = ripples[ei];
            var score = er.weight * (1 - Math.min(1, er.life / RIPPLE_LIFE));
            if (score < worstScore) { worstScore = score; worst = ei; }
          }
          ripples.splice(worst, 1);
        }
        addRipple(mouse.x, mouse.y,
                  18 + mouse.vel * 52,           // faster cursor, wider ring
                  0,
                  0.3 + mouse.vel * 0.45,
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
    /* Ambient ripples are now the pond's resting motion, so they arrive
       often rather than occasionally. They are ordinary ripples: the same
       kind the cursor makes and a click makes, so they dent, tear and get
       dragged about exactly the same way. */
    /* Ambient ripples are the entire surface now, so they arrive often and
       at a spread of sizes — mostly small, occasionally broad. Every one is
       an ordinary ripple: it dents, tears, interferes with its neighbours
       and answers to the cursor exactly like the ones you make yourself. */
    /* No more ripples from nowhere. What is left is the occasional bubble
       working its way up out of the planting — everything else on the
       surface now comes from a koi surfacing or a strider darting, both of
       which you can watch happen. */
    nextAmbient -= dt;
    if (nextAmbient <= 0 && weeds.length && ripples.length < 40) {
      nextAmbient = 1.3 + Math.random() * 3;
      var wd = weeds[(Math.random() * weeds.length) | 0];
      addRipple(wd.x + (Math.random() - 0.5) * 40,
                wd.y + (Math.random() - 0.5) * 40,
                16 + Math.random() * 18, 0,
                0.12 + Math.random() * 0.1, 0.2);
    }
  }

  function draw() {
    frameId++;
    ctx.clearRect(0, 0, W, H);
    drawWater();
    drawWakes();
    fish.forEach(drawFishWrapped);
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

    drawDuckweed();      // floating leaves, carried by the waves
    drawBugs();          // striders on the surface film
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
    /* A soft, out-of-focus backdrop does not need full retina. Every fill
       and the per-frame clear both scale with this, so it is the single
       biggest lever on the page. */
    dpr = Math.min(window.devicePixelRatio || 1, 1.35);
    W = Math.max(1, window.innerWidth || 1200);
    H = Math.max(1, window.innerHeight || 800);

    fgCv.width = W * dpr;  fgCv.height = H * dpr;
    bgCv.width = W * dpr;  bgCv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initLight();
    makeBottom();
    initBackdrop();
    makePads();
    padBuoyancy();
    makeDuckweed();
    makeBugs();
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
    bugs: function () { return bugs; },
    size: function () { return { W: W, H: H }; },
    caustic: function () { return { img: cImg, w: CW, h: CH, scale: CW / W }; },
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
    initBackdrop();       // stones and water tone are baked in
    var pals = palettes();
    fish.forEach(function (f, i) { f.pal = pals[i % pals.length]; });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  window.addEventListener("beforeprint", stop);
})();
