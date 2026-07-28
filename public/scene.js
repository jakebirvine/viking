/* ==========================================================================
   scene.js — the scroll-driven landscaping animation behind the page.
   As you scroll, a bare block gets excavated, poured, walled, turfed,
   planted and lit, while the sky runs from morning through to dusk.
   Pure canvas 2D, no dependencies, nothing loaded from disk.
   ========================================================================== */
(function () {
  'use strict';

  var cv = document.getElementById('scene');
  if (!cv) return;
  var ctx = cv.getContext('2d', { alpha: false });

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- state */
  var W = 0, H = 0, HZ = 0, CX = 0, GB = 0, DPR = 1, small = false;
  var target = 0, p = 0, t = 0, lastStage = -1;

  // scroll windows for each build stage — kept in sync with the stage rail
  var STAGES = [
    { key: 'walk',  a: 0.00, b: 0.10 },
    { key: 'dig',   a: 0.10, b: 0.28 },
    { key: 'pour',  a: 0.28, b: 0.45 },
    { key: 'wall',  a: 0.45, b: 0.58 },
    { key: 'turf',  a: 0.58, b: 0.72 },
    { key: 'plant', a: 0.72, b: 0.87 },
    { key: 'done',  a: 0.87, b: 1.00 }
  ];

  var STATE = { p: 0, stage: 0 };
  window.Scene = { state: STATE, stages: STAGES };

  /* --------------------------------------------------------------- helpers */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  // eased 0..1 progress through an arbitrary window of the scroll
  function win(a, b) { return smooth((p - a) / (b - a)); }
  function st(i) { return win(STAGES[i].a, STAGES[i].b); }

  function mul32(s) {
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      var r = Math.imul(s ^ s >>> 15, 1 | s);
      r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
  }

  function hex(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(c1, c2, k) {
    return 'rgb(' + Math.round(lerp(c1[0], c2[0], k)) + ',' +
                    Math.round(lerp(c1[1], c2[1], k)) + ',' +
                    Math.round(lerp(c1[2], c2[2], k)) + ')';
  }
  function mixArr(c1, c2, k) {
    return [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)];
  }
  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
  }

  /* ------------------------------------------------- yard perspective grid
     u: -1 (left) .. 1 (right) across the block
     d:  0 (at the horizon) .. 1 (bottom of the screen)                     */
  function P(u, d) {
    var dd = Math.pow(clamp(d, 0, 1), 1.22);
    var y = HZ + GB * dd;
    var w = 0.34 + 0.92 * dd;
    return [CX + u * (W * 0.60) * w, y];
  }
  function quad(u0, d0, u1, d1) {
    var a = P(u0, d0), b = P(u1, d0), c = P(u1, d1), e = P(u0, d1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]);
    ctx.closePath();
  }
  // vertical size of one "unit" at depth d, so props shrink into the distance
  function scaleAt(d) { return GB * (0.16 + 0.44 * Math.pow(clamp(d, 0, 1), 1.1)); }

  /* --------------------------------------------------------- sky palettes */
  var SKY = [
    { p: 0.00, top: hex('#3D7FB4'), mid: hex('#8CBBDC'), bot: hex('#D9E7EC') },
    { p: 0.32, top: hex('#2E6FA8'), mid: hex('#7FB4DA'), bot: hex('#C4DCEA') },
    { p: 0.60, top: hex('#3B6E9E'), mid: hex('#93B2CC'), bot: hex('#EBC793') },
    { p: 0.84, top: hex('#2C3F6B'), mid: hex('#8A6588'), bot: hex('#E0824C') },
    { p: 1.00, top: hex('#0B1327'), mid: hex('#22284C'), bot: hex('#4A3A55') }
  ];
  function skyNow() {
    var i = 0;
    while (i < SKY.length - 2 && p > SKY[i + 1].p) i++;
    var a = SKY[i], b = SKY[i + 1];
    var k = smooth((p - a.p) / (b.p - a.p));
    return { top: mixArr(a.top, b.top, k), mid: mixArr(a.mid, b.mid, k), bot: mixArr(a.bot, b.bot, k) };
  }
  // 1 = full daylight, 0 = night. Drives every ground colour.
  function daylight() { return 1 - smooth((p - 0.68) / 0.30) * 0.78; }

  /* ------------------------------------------------------ seeded scatter  */
  var clouds = [], specks = [], weeds = [], birds = [], mowStripes = 14;

  function buildRandoms() {
    var r = mul32(20260728);
    clouds = [];
    var nC = small ? 5 : 9;
    for (var i = 0; i < nC; i++) {
      clouds.push({
        x: r(), y: 0.06 + r() * 0.52, s: 0.5 + r() * 1.1,
        v: 0.004 + r() * 0.010, puffs: 3 + ((r() * 4) | 0), seed: r() * 1000
      });
    }

    specks = [];
    var nS = small ? 130 : 300;
    for (var j = 0; j < nS; j++) {
      specks.push({ u: r() * 2.4 - 1.2, d: r(), s: 0.4 + r() * 1.5, a: 0.05 + r() * 0.18 });
    }

    weeds = [];
    for (var k = 0; k < (small ? 16 : 30); k++) {
      weeds.push({ u: r() * 2.2 - 1.1, d: 0.08 + r() * 0.9, h: 0.5 + r() * 0.9, lean: r() * 0.6 - 0.3, n: 3 + ((r() * 4) | 0) });
    }

    birds = [];
    for (var m = 0; m < 5; m++) {
      birds.push({ x: r(), y: 0.10 + r() * 0.26, v: 0.012 + r() * 0.02, s: 0.6 + r() * 0.8, ph: r() * 6.28 });
    }
  }

  /* ================================================================= SKY  */
  function drawSky(sky) {
    var g = ctx.createLinearGradient(0, 0, 0, HZ + GB * 0.1);
    g.addColorStop(0, rgba(sky.top, 1));
    g.addColorStop(0.55, rgba(sky.mid, 1));
    g.addColorStop(1, rgba(sky.bot, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HZ + GB * 0.12);
  }

  function drawSun(sky) {
    var k = clamp(p / 0.96, 0, 1.15);
    var x = lerp(W * 0.14, W * 0.90, k);
    var y = HZ - Math.sin(Math.PI * clamp(k * 0.92 + 0.04, 0, 1)) * (HZ * 0.80) - HZ * 0.04;
    var day = daylight();
    var r = W < 700 ? 26 : 38;

    // warm halo, stronger the lower the sun sits
    var low = smooth((p - 0.45) / 0.45);
    var glow = ctx.createRadialGradient(x, y, 0, x, y, r * (5 + low * 5));
    glow.addColorStop(0, 'rgba(255,226,168,' + (0.34 * day + low * 0.22) + ')');
    glow.addColorStop(0.4, 'rgba(255,186,110,' + (0.14 * day + low * 0.14) + ')');
    glow.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * (5 + low * 5), 0, 6.2832); ctx.fill();

    ctx.fillStyle = mix(hex('#FFF6DC'), hex('#FF9A4D'), low);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();

    // the moon takes over once the sun is under
    var night = smooth((p - 0.86) / 0.14);
    if (night > 0.01) {
      var mx = W * 0.22, my = HZ * 0.30, mr = r * 0.62;
      ctx.globalAlpha = night;
      var mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 5);
      mg.addColorStop(0, 'rgba(215,228,255,.20)');
      mg.addColorStop(1, 'rgba(215,228,255,0)');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, mr * 5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#E9EEFB';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();
      ctx.fillStyle = rgba(sky.top, 1);
      ctx.beginPath(); ctx.arc(mx - mr * 0.42, my - mr * 0.22, mr * 0.92, 0, 6.2832); ctx.fill();

      // a handful of stars
      ctx.fillStyle = 'rgba(255,255,255,' + (night * 0.8) + ')';
      var rs = mul32(7);
      for (var i = 0; i < 46; i++) {
        var sx = rs() * W, sy = rs() * HZ * 0.72;
        var tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.0012 + i));
        ctx.globalAlpha = night * tw * 0.85;
        ctx.fillRect(sx, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawClouds(sky) {
    var day = daylight();
    var lit = mixArr(hex('#FFFFFF'), hex('#FFC98F'), smooth((p - 0.5) / 0.4));
    var shade = mixArr(hex('#C6D6E4'), hex('#6C5570'), smooth((p - 0.5) / 0.45));

    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var drift = reduce ? 0 : t * c.v * 0.00004;
      var x = ((c.x + drift + p * 0.05 * c.s) % 1.32) * W * 1.15 - W * 0.12;
      var y = c.y * HZ * 0.78;
      var s = c.s * (small ? 26 : 40);
      var r = mul32(c.seed | 0);

      ctx.globalAlpha = 0.30 + 0.42 * day;
      for (var j = 0; j < c.puffs; j++) {
        var ox = (j - c.puffs / 2) * s * 0.7 + r() * s * 0.3;
        var oy = r() * s * 0.28 - s * 0.1;
        var rad = s * (0.55 + r() * 0.55);
        ctx.fillStyle = rgba(shade, 0.5);
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy + rad * 0.22, rad, rad * 0.62, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = rgba(lit, 0.85);
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rad, rad * 0.58, 0, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBirds() {
    if (reduce) return;
    var a = 0.35 * daylight() + 0.1;
    ctx.strokeStyle = 'rgba(30,38,46,' + a + ')';
    ctx.lineWidth = 1.6;
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i];
      var x = ((b.x + t * b.v * 0.00006) % 1.25) * W * 1.2 - W * 0.1;
      var y = b.y * HZ + Math.sin(t * 0.0009 + b.ph) * 9;
      var s = b.s * (small ? 5 : 7);
      var fl = Math.sin(t * 0.007 + b.ph) * 0.4 + 0.6;
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x - s * 0.5, y - s * fl, x, y);
      ctx.quadraticCurveTo(x + s * 0.5, y - s * fl, x + s, y);
      ctx.stroke();
    }
  }

  /* ============================================================== DISTANCE */
  // the You Yangs, more or less
  function ridge(seed, amp, yOff, col, alpha) {
    var r = mul32(seed);
    var pts = 9, base = HZ - GB * yOff;
    ctx.beginPath();
    ctx.moveTo(-10, HZ + 4);
    for (var i = 0; i <= pts; i++) {
      var x = (i / pts) * (W + 20) - 10;
      var h = (Math.sin(i * 1.7 + seed) * 0.5 + 0.5) * amp + r() * amp * 0.55;
      var y = base - h;
      if (i === 0) ctx.lineTo(x, y);
      else {
        var px = ((i - 0.5) / pts) * (W + 20) - 10;
        ctx.quadraticCurveTo(px, y + amp * 0.28, x, y);
      }
    }
    ctx.lineTo(W + 10, HZ + 4);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawHills(sky) {
    var day = daylight();
    var far = mixArr(mixArr(hex('#5C7E8E'), sky.bot, 0.45), hex('#161E2E'), 1 - day);
    var near = mixArr(mixArr(hex('#41603F'), sky.bot, 0.22), hex('#101A18'), 1 - day);
    ridge(3, GB * 0.30, 0.02, rgba(far, 1), 0.75);
    ridge(11, GB * 0.19, 0.00, rgba(near, 1), 0.85);
  }

  function gumTree(x, y, s, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.1, s * 0.075);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - s * 0.06, y - s * 0.45, x + s * 0.03, y - s * 0.72);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, s * 0.045);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.01, y - s * 0.5); ctx.lineTo(x - s * 0.24, y - s * 0.78);
    ctx.moveTo(x + s * 0.02, y - s * 0.58); ctx.lineTo(x + s * 0.26, y - s * 0.84);
    ctx.stroke();
    ctx.fillStyle = col;
    var blobs = [[0.03, 0.86, 0.30], [-0.24, 0.80, 0.22], [0.27, 0.86, 0.21], [0.0, 0.98, 0.20]];
    for (var i = 0; i < blobs.length; i++) {
      ctx.beginPath();
      ctx.ellipse(x + s * blobs[i][0], y - s * blobs[i][1], s * blobs[i][2], s * blobs[i][2] * 0.78, 0, 0, 6.2832);
      ctx.fill();
    }
  }

  function drawTreeline(sky) {
    var day = daylight();
    var col = rgba(mixArr(mixArr(hex('#33502F'), sky.bot, 0.12), hex('#0B1310'), 1 - day), 0.95);
    var r = mul32(91);
    var n = small ? 7 : 12;
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * (W + 120) - 60 + (r() - 0.5) * 40;
      var s = GB * (0.16 + r() * 0.13);
      gumTree(x, HZ + GB * 0.035, s, col);
    }
  }

  /* ================================================================ GROUND */
  function drawGround(sky) {
    var day = daylight();
    var dirtFar = mixArr(hex('#6E5A44'), hex('#1B1710'), 1 - day);
    var dirtNear = mixArr(hex('#4A3A29'), hex('#120F0A'), 1 - day);

    var g = ctx.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, rgba(dirtFar, 1));
    g.addColorStop(1, rgba(dirtNear, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, HZ - 1, W, H - HZ + 1);

    // grit
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    for (var i = 0; i < specks.length; i++) {
      var s = specks[i], pt = P(s.u, s.d);
      ctx.globalAlpha = s.a * (0.5 + day * 0.5);
      ctx.fillRect(pt[0], pt[1], s.s * (0.5 + s.d), s.s * (0.4 + s.d * 0.6));
    }
    ctx.globalAlpha = 1;
  }

  function drawWeeds() {
    // dead grass and rubbish on the bare block, gone once the digger's been
    var alive = 1 - st(1);
    if (alive < 0.02) return;
    var day = daylight();
    ctx.globalAlpha = alive;
    for (var i = 0; i < weeds.length; i++) {
      var wd = weeds[i], pt = P(wd.u, wd.d), s = scaleAt(wd.d) * 0.20 * wd.h;
      ctx.strokeStyle = rgba(mixArr(hex('#8A8355'), hex('#241F14'), 1 - day), 0.75);
      ctx.lineWidth = Math.max(0.8, s * 0.12);
      for (var j = 0; j < wd.n; j++) {
        var sp = (j / (wd.n - 1) - 0.5) * s * 0.9;
        ctx.beginPath();
        ctx.moveTo(pt[0] + sp, pt[1]);
        ctx.quadraticCurveTo(pt[0] + sp + wd.lean * s * 0.5, pt[1] - s * 0.6, pt[0] + sp + wd.lean * s, pt[1] - s);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------------------- fence  */
  function drawFence() {
    var a = smooth(p / 0.06);
    if (a < 0.01) return;
    var day = daylight();
    var l = P(-1.25, 0.055), r = P(1.25, 0.055);
    var h = GB * 0.155;

    ctx.globalAlpha = a;
    var g = ctx.createLinearGradient(0, l[1] - h, 0, l[1]);
    g.addColorStop(0, rgba(mixArr(hex('#8D9187'), hex('#1A1E1B'), 1 - day), 1));
    g.addColorStop(1, rgba(mixArr(hex('#6B7068'), hex('#10130F'), 1 - day), 1));
    ctx.fillStyle = g;
    ctx.fillRect(l[0], l[1] - h, r[0] - l[0], h);

    // colorbond ribs
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.lineWidth = 1;
    var step = Math.max(9, (r[0] - l[0]) / 90);
    for (var x = l[0]; x < r[0]; x += step) {
      ctx.beginPath(); ctx.moveTo(x, l[1] - h); ctx.lineTo(x, l[1]); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(l[0], l[1] - h, r[0] - l[0], h * 0.09);
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- excavation  */
  var SLAB = { u0: -0.90, u1: 0.10, d0: 0.30, d1: 1.02 };
  var LAWN = { u0: 0.13, u1: 0.97, d0: 0.24, d1: 1.02 };
  var BED  = { d0: 0.075, d1: 0.185 };

  function drawTrench() {
    var dig = st(1), fill = st(2);
    var open = dig * (1 - fill * 0.98);
    if (open < 0.02) return;
    var day = daylight();
    ctx.globalAlpha = open;
    quad(SLAB.u0, SLAB.d0, SLAB.u1, SLAB.d1);
    ctx.fillStyle = rgba(mixArr(hex('#2A2015'), hex('#0A0806'), 1 - day), 1);
    ctx.fill();
    // cut face along the top edge
    var a = P(SLAB.u0, SLAB.d0), b = P(SLAB.u1, SLAB.d0);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(a[0], a[1] - GB * 0.012, b[0] - a[0], GB * 0.012);
    ctx.globalAlpha = 1;
  }

  function drawSpoilPile() {
    var grow = st(1), gone = st(3);
    var a = grow * (1 - gone);
    if (a < 0.02) return;
    var day = daylight();
    var pt = P(1.02, 0.55), s = scaleAt(0.55) * 0.62 * grow;
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(mixArr(hex('#5A4632'), hex('#161109'), 1 - day), 1);
    ctx.beginPath();
    ctx.moveTo(pt[0] - s * 1.5, pt[1]);
    ctx.quadraticCurveTo(pt[0] - s * 0.6, pt[1] - s * 1.05, pt[0] + s * 0.1, pt[1] - s * 0.72);
    ctx.quadraticCurveTo(pt[0] + s * 0.8, pt[1] - s * 1.0, pt[0] + s * 1.5, pt[1]);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,200,.06)';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // mini excavator, drawn facing right in local units of `s`
  function excavator(x, y, s, day) {
    var dark = rgba(mixArr(hex('#2A2E28'), hex('#0A0C09'), 1 - day), 1);
    var body = rgba(mixArr(hex('#E2A83A'), hex('#4A3A16'), 1 - day), 1);
    var body2 = rgba(mixArr(hex('#B98526'), hex('#33280F'), 1 - day), 1);
    var swing = reduce ? 0.2 : (Math.sin(t * 0.0026) * 0.5 + 0.5);

    ctx.save();
    ctx.translate(x, y);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 1.5, s * 0.20, 0, 0, 6.2832); ctx.fill();

    // tracks
    ctx.fillStyle = dark;
    rrect(-s * 1.30, -s * 0.52, s * 2.6, s * 0.52, s * 0.24); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    for (var i = 0; i < 7; i++) rrect(-s * 1.22 + i * s * 0.34, -s * 0.46, s * 0.12, s * 0.40, s * 0.04), ctx.fill();

    // house + cab
    ctx.fillStyle = body;
    rrect(-s * 1.05, -s * 1.35, s * 1.75, s * 0.85, s * 0.14); ctx.fill();
    ctx.fillStyle = body2;
    rrect(-s * 1.05, -s * 0.70, s * 1.75, s * 0.20, s * 0.06); ctx.fill();
    ctx.fillStyle = body;
    rrect(-s * 0.55, -s * 2.05, s * 1.05, s * 0.75, s * 0.13); ctx.fill();
    ctx.fillStyle = 'rgba(150,200,225,.62)';
    rrect(-s * 0.42, -s * 1.94, s * 0.72, s * 0.50, s * 0.08); ctx.fill();
    ctx.fillStyle = dark;
    rrect(-s * 0.60, -s * 2.14, s * 1.15, s * 0.13, s * 0.06); ctx.fill();

    // boom + dipper + bucket
    var a1 = -1.05 + swing * 0.30;
    var jx = s * 0.55, jy = -s * 1.55;
    var ex = jx + Math.cos(a1) * s * 1.45, ey = jy + Math.sin(a1) * s * 1.45;
    var a2 = 0.85 - swing * 0.55;
    var bx = ex + Math.cos(a2) * s * 1.25, by = ey + Math.sin(a2) * s * 1.25;

    ctx.strokeStyle = body; ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.26;
    ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.lineWidth = s * 0.20;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke();

    ctx.fillStyle = dark;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(0.5 + swing * 0.7);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(s * 0.52, s * 0.10);
    ctx.lineTo(s * 0.44, s * 0.62); ctx.lineTo(-s * 0.12, s * 0.44);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function rrect(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawDigger() {
    // drives on during the dig, works, then trundles off before the pour
    var k = win(0.075, 0.30);
    if (k <= 0.001 || k >= 0.999) return;
    var day = daylight();
    var u, fade = 1;
    if (k < 0.30)      { u = lerp(-1.7, -0.35, k / 0.30); }
    else if (k < 0.72) { u = lerp(-0.35, 0.35, (k - 0.30) / 0.42); }
    else               { u = lerp(0.35, 1.8, (k - 0.72) / 0.28); fade = 1 - smooth((k - 0.88) / 0.12); }

    var d = 0.62;
    var pt = P(u, d);
    var s = scaleAt(d) * 0.30;
    var bob = reduce ? 0 : Math.sin(t * 0.012) * s * 0.03;
    ctx.globalAlpha = fade;
    excavator(pt[0], pt[1] + bob, s, day);
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------------------- slab   */
  function drawFormwork(alpha) {
    if (alpha < 0.02) return;
    var day = daylight();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba(mixArr(hex('#B08A55'), hex('#2C2213'), 1 - day), 1);
    ctx.lineWidth = Math.max(2, GB * 0.010);
    quad(SLAB.u0, SLAB.d0, SLAB.u1, SLAB.d1);
    ctx.stroke();
    // pegs
    ctx.lineWidth = Math.max(1.5, GB * 0.006);
    for (var i = 0; i <= 5; i++) {
      var u = lerp(SLAB.u0, SLAB.u1, i / 5);
      var a = P(u, SLAB.d0);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - GB * 0.03); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawSlab() {
    var pour = st(2);
    if (pour < 0.01) { drawFormwork(win(0.22, 0.30)); return; }
    var day = daylight();

    drawFormwork(clamp(win(0.22, 0.30) - st(3) * 1.2, 0, 1));

    var lx = P(SLAB.u0, SLAB.d1)[0], rx = P(SLAB.u1, SLAB.d1)[0];
    var edge = lerp(lx - 10, rx + 10, smooth(pour));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HZ - GB * 0.2, edge, H);
    ctx.clip();

    quad(SLAB.u0, SLAB.d0, SLAB.u1, SLAB.d1);
    var g = ctx.createLinearGradient(0, P(0, SLAB.d0)[1], 0, H);
    g.addColorStop(0, rgba(mixArr(hex('#B9BCB2'), hex('#2B2F2C'), 1 - day), 1));
    g.addColorStop(1, rgba(mixArr(hex('#9DA096'), hex('#1E211F'), 1 - day), 1));
    ctx.fillStyle = g;
    ctx.fill();

    // broom finish
    ctx.strokeStyle = 'rgba(0,0,0,.05)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 22; i++) {
      var d = lerp(SLAB.d0, SLAB.d1, i / 22);
      var a = P(SLAB.u0, d), b = P(SLAB.u1, d);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    // control joints
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.lineWidth = Math.max(1.5, GB * 0.005);
    [0.36, 0.70].forEach(function (f) {
      var d2 = lerp(SLAB.d0, SLAB.d1, f);
      var a2 = P(SLAB.u0, d2), b2 = P(SLAB.u1, d2);
      ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
    });
    var uj = lerp(SLAB.u0, SLAB.u1, 0.5);
    var ja = P(uj, SLAB.d0), jb = P(uj, SLAB.d1);
    ctx.beginPath(); ctx.moveTo(ja[0], ja[1]); ctx.lineTo(jb[0], jb[1]); ctx.stroke();
    ctx.restore();

    // wet sheen at the leading edge while it's still going down
    var wet = 1 - smooth((p - STAGES[2].a) / (STAGES[2].b - STAGES[2].a + 0.10));
    if (wet > 0.02 && pour < 0.995) {
      ctx.save();
      ctx.beginPath(); ctx.rect(Math.max(0, edge - GB * 0.35), HZ - GB * 0.2, GB * 0.35, H); ctx.clip();
      quad(SLAB.u0, SLAB.d0, SLAB.u1, SLAB.d1);
      ctx.fillStyle = 'rgba(190,205,210,' + (0.30 * wet) + ')';
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------------------------------------------- retaining wall    */
  function drawWall() {
    var k = st(3);
    if (k < 0.01) return;
    var day = daylight();
    var l = P(-1.05, BED.d1), r = P(1.05, BED.d1);
    var course = GB * 0.036;
    var wood = mixArr(hex('#7A5A3A'), hex('#1D1409'), 1 - day);

    for (var i = 0; i < 3; i++) {
      var kk = smooth((k - i * 0.26) / 0.42);
      if (kk <= 0) break;
      var y = l[1] - course * (i + 1);
      var h = course * kk;
      ctx.fillStyle = rgba(mixArr(wood, hex('#000000'), i * 0.07), 1);
      ctx.fillRect(l[0], y + (course - h), r[0] - l[0], h);
      ctx.fillStyle = 'rgba(255,225,180,.07)';
      ctx.fillRect(l[0], y + (course - h), r[0] - l[0], Math.min(h, course * 0.22));
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(l[0], y + course - 1.5, r[0] - l[0], 1.5);
    }
    // posts
    ctx.fillStyle = rgba(mixArr(hex('#5E442B'), hex('#140E07'), 1 - day), 1);
    var n = small ? 4 : 7;
    for (var j = 0; j <= n; j++) {
      var x = lerp(l[0], r[0], j / n);
      var ph = course * 3 * smooth(k / 0.5);
      ctx.fillRect(x - GB * 0.008, l[1] - ph, GB * 0.016, ph);
    }
  }

  function drawGardenBed() {
    var k = st(5);
    if (k < 0.01) return;
    var day = daylight();
    ctx.globalAlpha = k;
    quad(-1.05, BED.d0, 1.05, BED.d1);
    ctx.fillStyle = rgba(mixArr(hex('#4A3323'), hex('#120C07'), 1 - day), 1);
    ctx.fill();
    // mulch chips
    var r = mul32(404);
    ctx.fillStyle = 'rgba(255,220,170,.10)';
    for (var i = 0; i < (small ? 40 : 90); i++) {
      var pt = P(r() * 2.1 - 1.05, lerp(BED.d0, BED.d1, r()));
      ctx.fillRect(pt[0], pt[1], 3, 1.4);
    }
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------------------- turf   */
  function drawTurf() {
    var k = st(4);
    if (k < 0.01) return;
    var day = daylight();

    var lx = P(LAWN.u0, LAWN.d1)[0], rx = P(LAWN.u1, LAWN.d1)[0];
    var edge = lerp(lx - 6, rx + 8, smooth(k));

    ctx.save();
    ctx.beginPath(); ctx.rect(0, HZ - GB * 0.2, edge, H); ctx.clip();

    quad(LAWN.u0, LAWN.d0, LAWN.u1, LAWN.d1);
    var g = ctx.createLinearGradient(0, P(0, LAWN.d0)[1], 0, H);
    g.addColorStop(0, rgba(mixArr(hex('#5E9B4A'), hex('#132318'), 1 - day), 1));
    g.addColorStop(1, rgba(mixArr(hex('#3F7A34'), hex('#0C1810'), 1 - day), 1));
    ctx.fillStyle = g;
    ctx.fill();

    // mow stripes
    ctx.save();
    quad(LAWN.u0, LAWN.d0, LAWN.u1, LAWN.d1); ctx.clip();
    for (var i = 0; i < mowStripes; i++) {
      if (i % 2) continue;
      var u0 = lerp(LAWN.u0, LAWN.u1, i / mowStripes);
      var u1 = lerp(LAWN.u0, LAWN.u1, (i + 1) / mowStripes);
      quad(u0, LAWN.d0, u1, LAWN.d1);
      ctx.fillStyle = 'rgba(255,255,255,.045)';
      ctx.fill();
    }
    ctx.restore();

    // turf joins on the freshly-laid part
    ctx.strokeStyle = 'rgba(0,0,0,.10)';
    ctx.lineWidth = 1;
    for (var j = 1; j < 8; j++) {
      var d = lerp(LAWN.d0, LAWN.d1, j / 8);
      var a = P(LAWN.u0, d), b = P(LAWN.u1, d);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();

    // the roll being run out
    if (k > 0.02 && k < 0.98) {
      var d2 = lerp(LAWN.d0, LAWN.d1, 0.55);
      var y = P(0, d2)[1];
      var s = scaleAt(d2) * 0.16;
      ctx.save();
      ctx.translate(edge, y);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(0, s * 0.05, s * 1.15, s * 0.22, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = rgba(mixArr(hex('#4C8A3C'), hex('#0F1C12'), 1 - day), 1);
      rrect(-s * 0.85, -s * 1.7, s * 1.7, s * 1.7, s * 0.24); ctx.fill();
      ctx.fillStyle = rgba(mixArr(hex('#6FAE58'), hex('#16281A'), 1 - day), 1);
      ctx.beginPath(); ctx.ellipse(s * 0.85, -s * 0.85, s * 0.28, s * 0.85, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.4;
      for (var q = 0; q < 4; q++) {
        var ang = t * 0.004 + q * 1.57;
        ctx.beginPath();
        ctx.moveTo(s * 0.85, -s * 0.85);
        ctx.lineTo(s * 0.85 + Math.cos(ang) * s * 0.24, -s * 0.85 + Math.sin(ang) * s * 0.78);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------ planting & path */
  var PLANTS = [
    { u: -0.86, d: 0.13, k: 'tree',  s: 1.35, t: 0.00 },
    { u: -0.55, d: 0.14, k: 'shrub', s: 0.95, t: 0.10 },
    { u: -0.28, d: 0.12, k: 'grass', s: 0.85, t: 0.18 },
    { u: -0.02, d: 0.15, k: 'shrub', s: 1.05, t: 0.06 },
    { u:  0.24, d: 0.12, k: 'grass', s: 0.75, t: 0.26 },
    { u:  0.50, d: 0.15, k: 'shrub', s: 0.90, t: 0.14 },
    { u:  0.78, d: 0.13, k: 'grass', s: 0.95, t: 0.32 },
    { u:  0.96, d: 0.16, k: 'tree',  s: 1.15, t: 0.22 },
    { u:  0.62, d: 0.86, k: 'shrub', s: 1.20, t: 0.40 },
    { u: -0.97, d: 0.72, k: 'grass', s: 1.10, t: 0.46 }
  ];

  function plant(pt, s, kind, day, grow) {
    var green = rgba(mixArr(hex('#4F8F41'), hex('#101E14'), 1 - day), 1);
    var green2 = rgba(mixArr(hex('#79B463'), hex('#1A2C1C'), 1 - day), 1);
    var bark = rgba(mixArr(hex('#4E3A28'), hex('#100B07'), 1 - day), 1);
    s *= grow;

    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(pt[0], pt[1], s * 0.62, s * 0.13, 0, 0, 6.2832); ctx.fill();

    if (kind === 'tree') {
      ctx.strokeStyle = bark; ctx.lineWidth = Math.max(1.4, s * 0.11); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pt[0], pt[1]); ctx.lineTo(pt[0] + s * 0.05, pt[1] - s * 1.05); ctx.stroke();
      ctx.fillStyle = green;
      ctx.beginPath(); ctx.ellipse(pt[0] + s * 0.05, pt[1] - s * 1.35, s * 0.62, s * 0.55, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = green2;
      ctx.beginPath(); ctx.ellipse(pt[0] - s * 0.16, pt[1] - s * 1.48, s * 0.34, s * 0.30, 0, 0, 6.2832); ctx.fill();
    } else if (kind === 'shrub') {
      ctx.fillStyle = green;
      ctx.beginPath(); ctx.ellipse(pt[0], pt[1] - s * 0.34, s * 0.55, s * 0.42, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = green2;
      ctx.beginPath(); ctx.ellipse(pt[0] - s * 0.14, pt[1] - s * 0.46, s * 0.30, s * 0.24, 0, 0, 6.2832); ctx.fill();
    } else {
      ctx.strokeStyle = green2; ctx.lineWidth = Math.max(1, s * 0.075); ctx.lineCap = 'round';
      for (var i = 0; i < 7; i++) {
        var f = (i / 6 - 0.5) * 1.7;
        var sway = reduce ? 0 : Math.sin(t * 0.0016 + pt[0] * 0.02 + i) * s * 0.07;
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1]);
        ctx.quadraticCurveTo(pt[0] + f * s * 0.28, pt[1] - s * 0.55, pt[0] + f * s * 0.55 + sway, pt[1] - s * 0.95);
        ctx.stroke();
      }
    }
  }

  function drawPlants() {
    var k = st(5);
    if (k < 0.01) return;
    var day = daylight();
    for (var i = 0; i < PLANTS.length; i++) {
      var pl = PLANTS[i];
      var grow = smooth((k - pl.t) / 0.55);
      if (grow <= 0) continue;
      plant(P(pl.u, pl.d), scaleAt(pl.d) * 0.55 * pl.s, pl.k, day, grow);
    }
  }

  function drawSteppers() {
    var k = smooth((st(5) - 0.15) / 0.6);
    if (k < 0.01) return;
    var day = daylight();
    ctx.globalAlpha = k;
    for (var i = 0; i < 5; i++) {
      var d = lerp(0.34, 0.92, i / 4);
      var w = scaleAt(d) * 0.30, h = w * 0.32;
      var pt = P(0.30, d);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      rrect(pt[0] - w / 2 + 2, pt[1] - h / 2 + 2, w, h, h * 0.28); ctx.fill();
      ctx.fillStyle = rgba(mixArr(hex('#8E9088'), hex('#1D211E'), 1 - day), 1);
      rrect(pt[0] - w / 2, pt[1] - h / 2, w, h, h * 0.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------- handover: lights   */
  function drawSetting() {
    var k = st(6);
    if (k < 0.02) return;
    var day = daylight();
    var pt = P(-0.48, 0.66), s = scaleAt(0.66) * 0.34 * smooth(k / 0.6);
    if (s < 1) return;

    ctx.save();
    ctx.translate(pt[0], pt[1]);
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 1.5, s * 0.22, 0, 0, 6.2832); ctx.fill();

    var frame = rgba(mixArr(hex('#4B4034'), hex('#12100C'), 1 - day), 1);
    var cush = rgba(mixArr(hex('#C6BFAE'), hex('#2E2C26'), 1 - day), 1);
    // lounge
    ctx.fillStyle = frame; rrect(-s * 1.45, -s * 0.55, s * 1.6, s * 0.5, s * 0.1); ctx.fill();
    ctx.fillStyle = cush;  rrect(-s * 1.38, -s * 0.72, s * 1.46, s * 0.26, s * 0.1); ctx.fill();
    ctx.fillStyle = frame; rrect(-s * 1.45, -s * 1.20, s * 0.22, s * 0.62, s * 0.08); ctx.fill();
    // fire pit / table
    ctx.fillStyle = frame; rrect(s * 0.10, -s * 0.42, s * 0.90, s * 0.40, s * 0.08); ctx.fill();
    var fire = smooth((p - 0.90) / 0.08);
    if (fire > 0.02) {
      var fl = reduce ? 1 : (0.8 + Math.sin(t * 0.011) * 0.2);
      ctx.globalAlpha = fire * fl;
      var fg = ctx.createRadialGradient(s * 0.55, -s * 0.5, 0, s * 0.55, -s * 0.5, s * 1.5);
      fg.addColorStop(0, 'rgba(255,186,86,.85)');
      fg.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.5, s * 1.5, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawFestoon() {
    var k = st(6);
    if (k < 0.02) return;
    var day = daylight();
    var lit = smooth((p - 0.86) / 0.10);

    var post = P(0.06, 0.34);
    var anchor = P(-1.15, BED.d1);
    var ph = GB * 0.30 * smooth(k / 0.5);

    // post
    ctx.strokeStyle = rgba(mixArr(hex('#4E4237'), hex('#12100C'), 1 - day), 1);
    ctx.lineWidth = Math.max(2, GB * 0.012);
    ctx.beginPath(); ctx.moveTo(post[0], post[1]); ctx.lineTo(post[0], post[1] - ph); ctx.stroke();

    var x1 = anchor[0], y1 = anchor[1] - GB * 0.20;
    var x2 = post[0], y2 = post[1] - ph;
    var sag = GB * 0.09;

    ctx.strokeStyle = 'rgba(20,24,18,' + (0.55 * k) + ')';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + sag, x2, y2);
    ctx.stroke();

    var n = small ? 7 : 11;
    for (var i = 1; i < n; i++) {
      var f = i / n;
      var mx = lerp(lerp(x1, (x1 + x2) / 2, f), lerp((x1 + x2) / 2, x2, f), f);
      var my = lerp(lerp(y1, (y1 + y2) / 2 + sag, f), lerp((y1 + y2) / 2 + sag, y2, f), f);
      var flick = reduce ? 1 : 0.85 + Math.sin(t * 0.003 + i * 1.4) * 0.15;
      var a = lit * flick;
      if (a > 0.03) {
        var g = ctx.createRadialGradient(mx, my + 5, 0, mx, my + 5, GB * 0.05);
        g.addColorStop(0, 'rgba(255,215,150,' + (0.55 * a) + ')');
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(mx, my + 5, GB * 0.05, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = lit > 0.1 ? 'rgba(255,232,180,' + (0.5 + 0.5 * a) + ')' : 'rgba(120,124,112,.7)';
      ctx.beginPath(); ctx.arc(mx, my + 5, Math.max(2, GB * 0.009), 0, 6.2832); ctx.fill();
    }

    // spike lights along the path
    for (var j = 0; j < 4; j++) {
      var d = lerp(0.40, 0.95, j / 3);
      var pt = P(0.11, d), s = scaleAt(d) * 0.16;
      ctx.strokeStyle = 'rgba(40,44,36,' + (0.7 * k) + ')';
      ctx.lineWidth = Math.max(1.2, s * 0.09);
      ctx.beginPath(); ctx.moveTo(pt[0], pt[1]); ctx.lineTo(pt[0], pt[1] - s); ctx.stroke();
      if (lit > 0.05) {
        var lg = ctx.createRadialGradient(pt[0], pt[1] - s, 0, pt[0], pt[1] - s, s * 2.2);
        lg.addColorStop(0, 'rgba(255,214,150,' + (0.5 * lit) + ')');
        lg.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(pt[0], pt[1] - s, s * 2.2, 0, 6.2832); ctx.fill();
      }
    }
  }

  /* ------------------------------------------------------------- ambience */
  function drawAmbience(sky) {
    var dusk = smooth((p - 0.62) / 0.34);
    if (dusk > 0.01) {
      var g = ctx.createLinearGradient(0, HZ - GB * 0.4, 0, H);
      g.addColorStop(0, 'rgba(255,150,70,' + (0.10 * dusk) + ')');
      g.addColorStop(1, 'rgba(20,24,55,' + (0.28 * dusk) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, HZ - GB * 0.4, W, H - HZ + GB * 0.4);
    }
    // haze along the horizon line
    var hg = ctx.createLinearGradient(0, HZ - GB * 0.22, 0, HZ + GB * 0.10);
    hg.addColorStop(0, rgba(sky.bot, 0));
    hg.addColorStop(0.6, rgba(sky.bot, 0.20));
    hg.addColorStop(1, rgba(sky.bot, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, HZ - GB * 0.22, W, GB * 0.32);
  }

  /* =================================================================== RUN */
  function render() {
    var sky = skyNow();

    drawSky(sky);
    drawSun(sky);
    drawClouds(sky);
    drawBirds();
    drawHills(sky);
    drawTreeline(sky);

    drawGround(sky);
    drawFence();
    drawWeeds();
    drawTrench();
    drawSlab();
    drawTurf();
    drawGardenBed();
    drawWall();
    drawSteppers();
    drawPlants();
    drawSpoilPile();
    drawDigger();
    drawSetting();
    drawFestoon();
    drawAmbience(sky);
  }

  function scrollProgress() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  }

  function stageFor(v) {
    for (var i = STAGES.length - 1; i >= 0; i--) if (v >= STAGES[i].a) return i;
    return 0;
  }

  function resize() {
    // measure the element itself (CSS sizes it via inset:0) rather than trusting
    // innerWidth — a backgrounded tab can report 0 before the first paint
    var w = cv.clientWidth || window.innerWidth;
    var h = cv.clientHeight || window.innerHeight;
    if (!w || !h) return false;

    small = w < 760;
    DPR = Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2);
    W = w;
    H = h;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    HZ = Math.round(H * (small ? 0.46 : 0.50));
    GB = H - HZ;
    CX = W * 0.5;
    buildRandoms();
    return true;
  }

  function frame(now) {
    t = now || 0;
    // pick up any size change the observer missed (first paint, tab restore)
    if (cv.clientWidth && cv.clientWidth !== W) resize();
    p += (target - p) * (reduce ? 1 : 0.10);
    if (Math.abs(target - p) < 0.0002) p = target;
    STATE.p = p;
    var s = stageFor(p);
    if (s !== lastStage) {
      lastStage = s;
      STATE.stage = s;
      window.dispatchEvent(new CustomEvent('scenestage', { detail: { stage: s, key: STAGES[s].key } }));
    }
    render();
    if (!reduce) requestAnimationFrame(frame);
  }

  function onScroll() {
    target = scrollProgress();
    if (reduce) { p = target; frame(t); }
  }

  // resizing the canvas clears it, so repaint straight away rather than waiting
  // on the next rAF — which never arrives while the tab is backgrounded
  function refresh() {
    if (!resize()) return;
    onScroll();
    if (!reduce) render();   // in reduce mode onScroll() has already painted
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(refresh).observe(cv);
  } else {
    var rTimer;
    window.addEventListener('resize', function () {
      clearTimeout(rTimer);
      rTimer = setTimeout(refresh, 120);
    }, { passive: true });
  }
  window.addEventListener('orientationchange', function () { setTimeout(refresh, 200); });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('load', refresh);

  resize();
  onScroll();
  p = target;
  STATE.p = p;
  // paint once up front: an alpha:false bitmap starts opaque black, and waiting
  // for the first rAF would show that black for a frame
  if (W && H) render();
  if (reduce) frame(0); else requestAnimationFrame(frame);
})();
