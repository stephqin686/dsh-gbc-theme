/* =========================================================================
   GBC / 绌恒伄绠?鈥?dynamic wallpaper engine
   A single canvas scene + a DOM typography layer. No dependencies.

   The scene is deliberately edge-weighted: the centre stays quiet so the
   same artwork can live behind the DSH chat column without hurting reading.
   ========================================================================= */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgba(hex, a) {
    if (!hex) return 'rgba(0,0,0,' + a + ')';
    if (hex.charAt(0) !== '#') return hex;
    var h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  var PALETTES = {
    live: {
      name: 'live',
      bg: ['#04060b', '#07101f', '#0b0a14', '#17060a'],
      sun: ['#ff4030', '#e1121f', '#860510'],
      sunOffset: '#0b2bd6',
      city: '#07080e',
      cityFar: '#0b0e18',
      bridge: '#101522',
      horizon: '#190a10',
      stage: '#05060a',
      star: '#dff4ff',
      dust: '#c9f3ff',
      ember: '#ff5a2a',
      cloud: null,
      beam: ['#d90e2c', '#85c9dc', '#76bd53', '#e34d8d', '#eeda01'],
      type: '#f4f1e8',
      red: '#e1121f',
      blue: '#1338e8',
      cyan: '#00d9ff',
      black: '#05060a',
      white: '#f4f1e8',
      cut: '#07101f',
      halftone: 'rgba(0,0,0,0.5)',
      vignette: 'rgba(0,0,0,0.5)'
    },
    sky: {
      name: 'sky',
      bg: ['#9ec9dd', '#c6e1ec', '#e8edf0', '#f3e6d5'],
      sun: ['#ff5a4a', '#e1121f', '#a90a16'],
      sunOffset: '#1338e8',
      city: '#aab5c0',
      cityFar: '#c0cad3',
      bridge: '#8997a6',
      horizon: '#ded7cb',
      stage: '#b6c0c7',
      star: null,
      dust: '#ffffff',
      ember: '#ff6a3a',
      cloud: 'rgba(255,255,255,0.72)',
      beam: ['#d90e2c', '#4aa9c4', '#5a9d42', '#d94b85', '#c9a900'],
      type: '#0b1020',
      red: '#e1121f',
      blue: '#1338e8',
      cyan: '#087e9b',
      black: '#0b1020',
      white: '#ffffff',
      cut: '#c6e1ec',
      halftone: 'rgba(10,16,32,0.36)',
      vignette: 'rgba(255,250,240,0.4)'
    },
    noise: {
      name: 'noise',
      bg: ['#e9e5da', '#e3dfd4', '#f1ede3', '#ded8cb'],
      sun: ['#111111', '#111111', '#333333'],
      sunOffset: '#e1121f',
      city: '#151515',
      cityFar: '#2a2a2a',
      bridge: '#111111',
      horizon: '#c9c3b7',
      stage: '#1a1a1a',
      star: null,
      dust: '#333333',
      ember: '#e1121f',
      cloud: null,
      beam: ['#111111', '#111111', '#111111', '#e1121f', '#111111'],
      type: '#0a0a0a',
      red: '#e1121f',
      blue: '#0a0a0a',
      cyan: '#0a0a0a',
      black: '#0a0a0a',
      white: '#f4f1e8',
      cut: '#e3dfd4',
      halftone: 'rgba(0,0,0,0.55)',
      vignette: 'rgba(0,0,0,0.18)'
    }
  };

  var MODES = ['live', 'sky', 'noise'];

  function Wallpaper(root, opts) {
    opts = opts || {};
    this.root = root;
    this.opts = opts;
    this.dsh = !!opts.dsh;
    this.standalone = opts.standalone !== false;
    this.canvas = root.querySelector('.gbc-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.hud = root.querySelector('.gbc-hud');
    this.mode = opts.mode && PALETTES[opts.mode] ? opts.mode : this.initialMode();
    this.bpm = opts.bpm || 148;
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.paused = false;
    this.chromeHidden = false;
    this.t = opts.time || 0;
    this.last = performance.now();
    this.lastBeat = -1;
    this.beatUntil = 0;
    this.pluckStart = -99;
    this.pluckStrength = 0;
    this.glitchUntil = 0;
    this.nextGlitch = 8 + Math.random() * 6;
    this.emberAcc = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.bursts = [];
    this.rng = mulberry32(0x0c0ffee);
    this.lowPower = false;
    this.frameTimes = [];
    if (opts.hud === false) root.setAttribute('data-hud', 'off');

    if (this.dsh) root.classList.add('is-dsh');
    this.tick = this.tick.bind(this);
    this.resize();
    this.bind();
    this.setMode(this.mode, true);
    this.draw();

    if (this.reduced) {
      this.t = 2.4;
      this.draw();
    } else {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  Wallpaper.prototype.initialMode = function () {
    try {
      var saved = localStorage.getItem('gbc-wallpaper-mode');
      if (saved && PALETTES[saved]) return saved;
    } catch (e) { /* storage may be blocked */ }
    if (this.dsh) {
      var dark = document.body && document.body.hasAttribute('data-ds-dark-theme');
      return dark ? 'live' : 'sky';
    }
    var hour = new Date().getHours();
    return hour >= 7 && hour < 17 ? 'sky' : 'live';
  };

  Wallpaper.prototype.resize = function () {
    this.w = Math.max(320, window.innerWidth || 1280);
    this.h = Math.max(320, window.innerHeight || 720);
    var dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1 : 1.5);
    // Keep the backing store under ~3.1M device pixels. A 4K wallpaper is
    // still crisp at 1x, while a Retina 1440p display gets ~1.5x.
    var maxPixels = 1920 * 1080 * 1.5;
    dpr = Math.min(dpr, Math.sqrt(maxPixels / (this.w * this.h)));
    this.dpr = Math.max(1, dpr);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.palette = PALETTES[this.mode];
    this.layoutScene();
    this.buildGrain();
    this.buildPattern();
    this.buildBackdrop();
    this.buildVines();
    this.buildCrowd();
    this.buildParticles();
    if (this.paused || this.reduced) this.draw();
  };

  Wallpaper.prototype.layoutScene = function () {
    var w = this.w, h = this.h, m = Math.min(w, h);
    var portrait = h > w * 1.05;
    this.layout = {
      horizon: h * (portrait ? 0.72 : 0.735),
      sun: {
        x: w * (this.dsh ? 0.835 : portrait ? 0.77 : 0.805),
        y: h * (portrait ? 0.27 : 0.335),
        r: m * (portrait ? 0.255 : 0.235)
      },
      box: {
        x: w * (this.dsh ? 0.685 : portrait ? 0.55 : 0.615),
        y: h * (portrait ? 0.4 : 0.405),
        s: m * (portrait ? 0.16 : this.dsh ? 0.142 : 0.148)
      },
      stringY: h * (this.dsh ? 0.625 : 0.655),
      mic: { x0: w * (this.dsh ? 0.245 : 0.17), y0: h * 1.03, x1: w * (this.dsh ? 0.19 : 0.115), y1: h * 0.58 }
    };
  };

  Wallpaper.prototype.buildGrain = function () {
    var size = 160;
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var g = c.getContext('2d');
    var img = g.createImageData(size, size);
    var rng = mulberry32(0x51ce);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 110 + Math.floor(rng() * 145);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(rng() * 42);
    }
    g.putImageData(img, 0, 0);
    this.root.style.setProperty('--grain', 'url(' + c.toDataURL('image/png') + ')');
  };

  Wallpaper.prototype.buildPattern = function () {
    var s = 7;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var g = c.getContext('2d');
    g.fillStyle = this.palette.halftone;
    g.beginPath();
    g.arc(s * 0.5, s * 0.5, this.palette.name === 'noise' ? 1.35 : 1.05, 0, TAU);
    g.fill();
    this.dotTile = c;
    this.dotPattern = this.ctx.createPattern(c, 'repeat');
  };

  Wallpaper.prototype.buildBackdrop = function () {
    var pad = 70;
    var w = this.w, h = this.h;
    var c = document.createElement('canvas');
    c.width = Math.round((w + pad * 2) * this.dpr);
    c.height = Math.round((h + pad * 2) * this.dpr);
    var g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.translate(pad, pad);
    this.drawSky(g, w, h);
    this.drawCity(g, w, h);
    this.drawBridge(g, w, h);
    this.drawStageFloor(g, w, h);
    this.drawBackdropHalftone(g, w, h);
    this.backdrop = { canvas: c, pad: pad };
  };

  Wallpaper.prototype.drawSky = function (g, w, h) {
    var p = this.palette;
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, p.bg[0]);
    grad.addColorStop(0.42, p.bg[1]);
    grad.addColorStop(0.72, p.bg[2]);
    grad.addColorStop(1, p.bg[3]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    var rng = mulberry32(0x1234abcd + (p.name === 'sky' ? 9 : p.name === 'noise' ? 17 : 0));
    if (p.star) {
      g.save();
      for (var i = 0; i < 210; i++) {
        var x = rng() * w;
        var y = rng() * h * 0.7;
        var r = 0.35 + rng() * 1.15;
        var a = 0.18 + rng() * 0.72;
        g.fillStyle = rgba(p.star, a);
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        if (r > 1.2 && rng() > 0.65) {
          g.strokeStyle = rgba(p.star, a * 0.55);
          g.lineWidth = 0.5;
          g.beginPath();
          g.moveTo(x - 3, y); g.lineTo(x + 3, y);
          g.moveTo(x, y - 3); g.lineTo(x, y + 3);
          g.stroke();
        }
      }
      // faint galaxy band
      var neb = g.createLinearGradient(w * 0.1, 0, w * 0.9, h * 0.8);
      neb.addColorStop(0, 'rgba(24,56,120,0)');
      neb.addColorStop(0.45, 'rgba(32,76,150,0.14)');
      neb.addColorStop(0.62, 'rgba(110,20,90,0.1)');
      neb.addColorStop(1, 'rgba(10,10,30,0)');
      g.fillStyle = neb;
      g.fillRect(0, 0, w, h * 0.8);
      g.restore();
    }

    if (p.cloud) {
      g.save();
      for (var k = 0; k < 11; k++) {
        var cx = rng() * w * 1.1 - w * 0.05;
        var cy = h * (0.12 + rng() * 0.5);
        var cw = w * (0.08 + rng() * 0.19);
        var ch = cw * (0.16 + rng() * 0.1);
        var cg = g.createRadialGradient(cx, cy, 0, cx, cy, cw);
        cg.addColorStop(0, p.cloud);
        cg.addColorStop(0.55, rgba('#ffffff', 0.22));
        cg.addColorStop(1, rgba('#ffffff', 0));
        g.fillStyle = cg;
        g.beginPath();
        g.ellipse(cx, cy, cw, ch, rng() * 0.4 - 0.2, 0, TAU);
        g.fill();
      }
      g.restore();
    }

    if (p.name === 'noise') {
      // rough ink wash / xerox bands
      g.save();
      g.globalAlpha = 0.1;
      for (var b = 0; b < 6; b++) {
        g.fillStyle = b % 2 ? '#111' : '#ffffff';
        g.fillRect(0, h * (0.18 + b * 0.09), w, h * 0.03);
      }
      g.restore();
    }
  };

  Wallpaper.prototype.drawCity = function (g, w, h) {
    var p = this.palette;
    var hy = this.layout.horizon;
    var rng = mulberry32(0x991177);
    var i, x, bw, bh;
    g.save();
    // low glow from the city / stage
    var cityGlow = g.createLinearGradient(0, hy - h * 0.16, 0, hy + 8);
    cityGlow.addColorStop(0, this.palette.name === 'noise' ? 'rgba(0,0,0,0)' : 'rgba(225,18,31,0)');
    cityGlow.addColorStop(0.72, this.palette.name === 'noise' ? 'rgba(0,0,0,0.08)' : 'rgba(225,18,31,0.09)');
    cityGlow.addColorStop(1, this.palette.name === 'noise' ? 'rgba(0,0,0,0.16)' : 'rgba(255,110,50,0.18)');
    g.fillStyle = cityGlow;
    g.fillRect(0, hy - h * 0.16, w, h * 0.16 + 8);
    g.fillStyle = p.cityFar;
    for (i = 0; i < 42; i++) {
      x = rng() * w;
      bw = 11 + rng() * 42;
      bh = 8 + rng() * 64;
      g.fillRect(x, hy - bh, bw, bh);
    }
    g.fillStyle = p.city;
    for (i = 0; i < 38; i++) {
      x = rng() * w;
      bw = 7 + rng() * 30;
      bh = 12 + rng() * 92;
      g.fillRect(x, hy - bh, bw, bh);
      if (p.name === 'live') {
        var cols = Math.max(1, Math.floor(bw / 7));
        var rows = Math.max(1, Math.floor(bh / 9));
        for (var cx = 0; cx < cols; cx++) {
          for (var cy = 0; cy < rows; cy++) {
            if (rng() > 0.72) {
              g.fillStyle = rng() > 0.55 ? 'rgba(255,199,120,0.38)' : 'rgba(120,220,255,0.25)';
              g.fillRect(x + 2 + cx * 7, hy - bh + 4 + cy * 9, 1.6, 1.6);
            }
          }
        }
        g.fillStyle = p.city;
      }
      if (rng() > 0.8) {
        g.fillRect(x + bw * 0.5, hy - bh - 10 - rng() * 14, 1, 10 + rng() * 14);
      }
    }
    // horizon line
    g.fillStyle = rgba(p.horizon, 0.9);
    g.fillRect(0, hy, w, 1);
    g.restore();
  };

  Wallpaper.prototype.drawBridge = function (g, w, h) {
    var p = this.palette;
    var hy = this.layout.horizon;
    var bx = w * (this.dsh ? 0.9 : 0.86);
    var top = h * 0.34;
    var deck = hy - 9;
    g.save();
    g.strokeStyle = rgba(p.bridge, p.name === 'sky' ? 0.75 : 0.9);
    g.lineWidth = 1;
    // deck
    g.beginPath();
    g.moveTo(w * 0.62, deck);
    g.lineTo(w, deck - h * 0.012);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w * 0.62, deck + 5);
    g.lineTo(w, deck - h * 0.007);
    g.stroke();
    // main tower
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(bx - 9, deck);
    g.lineTo(bx - 2, top);
    g.lineTo(bx + 2, top);
    g.lineTo(bx + 9, deck);
    g.stroke();
    // cross beams
    g.lineWidth = 0.7;
    for (var i = 1; i < 7; i++) {
      var y = lerp(deck, top, i / 7);
      var span = lerp(9, 2, i / 7) * 2.2;
      g.beginPath();
      g.moveTo(bx - span, y);
      g.lineTo(bx + span, y);
      g.stroke();
    }
    // cables
    g.lineWidth = 0.55;
    for (var c = 0; c < 8; c++) {
      var t = c / 7;
      var dx = lerp(bx, w * 0.64, t);
      g.beginPath();
      g.moveTo(bx, top + 4);
      g.quadraticCurveTo(lerp(bx, dx, 0.55), top + (deck - top) * 0.5, dx, deck);
      g.stroke();
    }
    // second tower in the distance
    g.globalAlpha = 0.5;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(w * 0.985, deck);
    g.lineTo(w * 0.99, h * 0.46);
    g.lineTo(w * 1.005, h * 0.46);
    g.lineTo(w * 1.012, deck);
    g.stroke();
    g.restore();
  };

  Wallpaper.prototype.drawStageFloor = function (g, w, h) {
    var p = this.palette;
    var hy = this.layout.horizon;
    var top = h * 0.795;
    g.save();
    var grad = g.createLinearGradient(0, hy, 0, h);
    grad.addColorStop(0, rgba(p.stage, 0.25));
    grad.addColorStop(0.55, rgba(p.stage, 0.9));
    grad.addColorStop(1, p.stage);
    g.fillStyle = grad;
    g.fillRect(0, hy, w, h - hy);

    // warm stage bounce behind the crowd
    g.save();
    var bounce = g.createRadialGradient(w * 0.5, h * 1.04, 0, w * 0.5, h * 1.04, h * 0.44);
    bounce.addColorStop(0, this.palette.name === 'noise' ? 'rgba(0,0,0,0.12)' : 'rgba(255,74,30,0.2)');
    bounce.addColorStop(0.45, this.palette.name === 'noise' ? 'rgba(0,0,0,0.06)' : 'rgba(225,18,31,0.08)');
    bounce.addColorStop(1, 'rgba(225,18,31,0)');
    g.fillStyle = bounce;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.restore();

    // perspective stage boards
    g.strokeStyle = this.palette.name === 'noise' ? 'rgba(0,0,0,0.18)' : 'rgba(160,220,255,0.07)';
    g.lineWidth = 1;
    for (var i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(w * 0.5, hy + 4);
      g.lineTo(w * 0.5 + i * w * 0.075, h);
      g.stroke();
    }
    for (var j = 0; j < 7; j++) {
      var y = lerp(hy + 10, h, j / 6);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }

    // stage lip / truss
    g.fillStyle = 'rgba(4,5,8,0.82)';
    g.fillRect(0, top, w, h - top);
    g.strokeStyle = rgba(p.cyan, p.name === 'live' ? 0.28 : 0.18);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, top);
    g.lineTo(w, top);
    g.stroke();

    // speaker stacks at the edges
    this.drawSpeaker(g, w * 0.018, top + 8, w * 0.075, h * 0.2, p);
    this.drawSpeaker(g, w * 0.915, top + 18, w * 0.07, h * 0.17, p);

    // cables
    g.strokeStyle = this.palette.name === 'noise' ? 'rgba(0,0,0,0.5)' : 'rgba(8,10,16,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w * 0.12, h * 1.01);
    g.bezierCurveTo(w * 0.2, h * 0.93, w * 0.36, h * 0.99, w * 0.42, h * 0.94);
    g.bezierCurveTo(w * 0.5, h * 0.9, w * 0.58, h * 1.02, w * 0.7, h * 0.97);
    g.stroke();
    g.restore();
  };

  Wallpaper.prototype.drawSpeaker = function (g, x, y, w, h, p) {
    if (w < 20) return;
    g.save();
    g.fillStyle = p.name === 'noise' ? 'rgba(0,0,0,0.9)' : 'rgba(3,4,7,0.94)';
    roundRect(g, x, y, w, h, 3);
    g.fill();
    g.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.8)' : 'rgba(190,235,255,0.12)';
    g.lineWidth = 1;
    g.stroke();
    var r = Math.min(w * 0.32, h * 0.16);
    for (var i = 0; i < 2; i++) {
      var cy = y + h * (i === 0 ? 0.32 : 0.7);
      g.beginPath();
      g.arc(x + w * 0.5, cy, r, 0, TAU);
      g.fillStyle = 'rgba(0,0,0,0.8)';
      g.fill();
      g.strokeStyle = 'rgba(160,220,255,0.16)';
      g.stroke();
      g.beginPath();
      g.arc(x + w * 0.5, cy, r * 0.35, 0, TAU);
      g.fillStyle = 'rgba(130,190,220,0.1)';
      g.fill();
    }
    g.restore();
  };

  Wallpaper.prototype.drawBackdropHalftone = function (g, w, h) {
    var p = this.palette;
    g.save();
    g.globalAlpha = p.name === 'noise' ? 0.2 : 0.13;
    g.fillStyle = g.createPattern(this.dotTile, 'repeat');
    g.fillRect(0, h * 0.36, w, h * 0.64);
    g.globalAlpha = p.name === 'noise' ? 0.12 : 0.07;
    g.fillRect(0, 0, w, h * 0.36);
    g.restore();
  };

  Wallpaper.prototype.buildVines = function () {
    var w = this.w, h = this.h, m = Math.min(w, h);
    var self = this;
    function make(origin, angle, len, width, depth, seed) {
      var rng = mulberry32(seed);
      var branches = [];
      function grow(x, y, a, l, wd, d) {
        var pts = [];
        var n = 11;
        for (var i = 0; i < n; i++) {
          a += (rng() - 0.5) * 0.24;
          x += Math.cos(a) * (l / n);
          y += Math.sin(a) * (l / n);
          pts.push({ x: x, y: y, u: (i + 1) / n });
        }
        branches.push({ pts: pts, width: wd, depth: d, seed: rng() * 1000 });
        if (d > 0) {
          grow(x, y, a - 0.58 - rng() * 0.22, l * 0.58, wd * 0.62, d - 1);
          if (rng() > 0.34) grow(x, y, a + 0.5 + rng() * 0.3, l * 0.48, wd * 0.55, d - 1);
        }
      }
      grow(origin[0], origin[1], angle, len, width, depth);
      return branches;
    }
    this.vines = [
      { branches: make([-w * 0.015, h * 1.05], -1.27, m * 0.56, 10, 3, 31), delay: 0.3 },
      { branches: make([w * 1.03, -h * 0.04], 2.44, m * 0.43, 8, 2, 77), delay: 1.0 },
      { branches: make([w * 1.03, h * 1.05], -1.88, m * 0.3, 6.5, 2, 113), delay: 1.6 }
    ];
  };

  Wallpaper.prototype.buildCrowd = function () {
    var rng = mulberry32(0x777);
    var n = this.lowPower ? 48 : 86;
    this.crowd = [];
    for (var i = 0; i < n; i++) {
      this.crowd.push({
        x: rng() * this.w,
        s: 0.55 + rng() * 1.15,
        arm: rng() > 0.42,
        phone: rng() > 0.72,
        phase: rng() * TAU,
        lean: (rng() - 0.5) * 0.22
      });
    }
  };

  Wallpaper.prototype.buildParticles = function () {
    var rng = mulberry32(0xabc123);
    var n = this.lowPower ? 48 : 96;
    this.dust = [];
    for (var i = 0; i < n; i++) {
      this.dust.push({
        x: rng() * this.w,
        y: rng() * this.h,
        r: 0.35 + rng() * 1.4,
        v: 3 + rng() * 12,
        p: rng() * TAU,
        a: 0.15 + rng() * 0.5
      });
    }
    this.embers = [];
    this.shards = [];
    for (var j = 0; j < 18; j++) {
      this.shards.push({
        x: rng() * this.w,
        y: rng() * this.h,
        vx: (rng() - 0.5) * 6,
        vy: 3 + rng() * 10,
        rot: rng() * TAU,
        vr: (rng() - 0.5) * 0.5,
        s: 2 + rng() * 7,
        a: 0.08 + rng() * 0.25
      });
    }
    this.bursts = [];
  };

  Wallpaper.prototype.bind = function () {
    var self = this;
    this.onResize = function () { self.resize(); };
    this.onPointer = function (e) {
      var x = (e.clientX / self.w) * 2 - 1;
      var y = (e.clientY / self.h) * 2 - 1;
      self.pointer.tx = clamp(x, -1, 1);
      self.pointer.ty = clamp(y, -1, 1);
      self.showHud();
    };
    this.onClick = function (e) {
      if (e.target && e.target.closest && e.target.closest('.gbc-hud')) return;
      self.pluck(1.25);
      self.emitBurst(e.clientX / self.w, e.clientY / self.h);
      self.triggerGlitch(0.12);
    };
    this.onKey = function (e) {
      if (e.altKey && (e.key === 'g' || e.key === 'G')) {
        if (self.dsh) self.cycleMode();
        else if (self.hud) self.hud.classList.toggle('is-open');
        return;
      }
      if (self.dsh) return;
      if (e.key === 'm' || e.key === 'M') {
        self.cycleMode();
      } else if (e.key === 'h' || e.key === 'H') {
        self.toggleChrome();
      } else if (e.code === 'Space') {
        e.preventDefault();
        self.pluck(1.3);
        self.emitBurst(0.5, 0.56);
      } else if (e.key === 'p' || e.key === 'P') {
        self.togglePause();
      }
    };
    this.onVisibility = function () {
      if (document.hidden) {
        self.stop();
      } else if (!self.reduced && !self.paused && !self.raf) {
        self.last = performance.now();
        self.raf = requestAnimationFrame(self.tick);
      }
    };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    window.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKey);
    if (this.standalone) {
      window.addEventListener('pointerdown', this.onClick);
    }
    if (this.hud) {
      this.hud.querySelectorAll('[data-mode]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          self.setMode(b.getAttribute('data-mode'));
        });
      });
      this.hud.querySelectorAll('[data-action]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var a = b.getAttribute('data-action');
          if (a === 'pause') self.togglePause();
          if (a === 'hide') self.toggleChrome();
        });
      });
    }
    this.hudHideTimer = setTimeout(function () { self.root.classList.add('is-idle'); }, 5200);
  };

  Wallpaper.prototype.showHud = function () {
    this.root.classList.remove('is-idle');
    clearTimeout(this.hudHideTimer);
    var self = this;
    this.hudHideTimer = setTimeout(function () { self.root.classList.add('is-idle'); }, 4200);
  };

  Wallpaper.prototype.setMode = function (mode, silent) {
    if (!PALETTES[mode]) return;
    this.mode = mode;
    this.root.setAttribute('data-mode', mode);
    this.palette = PALETTES[mode];
    this.buildPattern();
    this.buildBackdrop();
    if (this.hud) {
      this.hud.querySelectorAll('[data-mode]').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-mode') === mode);
      });
    }
    if (!silent) {
      try { localStorage.setItem('gbc-wallpaper-mode', mode); } catch (e) { /* ignore */ }
      if (this.reduced || this.paused) this.draw();
    }
    this.root.dispatchEvent(new CustomEvent('gbc-mode', { detail: mode }));
  };

  Wallpaper.prototype.cycleMode = function () {
    var i = MODES.indexOf(this.mode);
    this.setMode(MODES[(i + 1) % MODES.length]);
  };

  Wallpaper.prototype.toggleChrome = function () {
    this.chromeHidden = !this.chromeHidden;
    this.root.classList.toggle('is-chrome-hidden', this.chromeHidden);
    if (!this.chromeHidden) this.showHud();
  };

  Wallpaper.prototype.togglePause = function () {
    this.paused = !this.paused;
    if (this.paused) {
      this.stop();
    } else if (!this.raf && !this.reduced) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    if (this.hud) {
      var b = this.hud.querySelector('[data-action="pause"]');
      if (b) b.textContent = this.paused ? 'PLAY' : 'PAUSE';
    }
  };

  Wallpaper.prototype.stop = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  Wallpaper.prototype.destroy = function () {
    this.stop();
    clearTimeout(this.hudHideTimer);
    clearTimeout(this.glitchTimer);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKey);
    if (this.standalone) window.removeEventListener('pointerdown', this.onClick);
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    if (this.root) delete this.root.__gbcInstance;
  };

  Wallpaper.prototype.pluck = function (strength) {
    this.pluckStart = this.t;
    this.pluckStrength = strength || 1;
  };

  Wallpaper.prototype.triggerGlitch = function (seconds) {
    if (this.reduced) return;
    this.glitchUntil = Math.max(this.glitchUntil, this.t + (seconds || 0.18));
    this.root.classList.add('is-glitching');
    var self = this;
    clearTimeout(this.glitchTimer);
    this.glitchTimer = setTimeout(function () { self.root.classList.remove('is-glitching'); }, 190);
  };

  Wallpaper.prototype.emitBurst = function (nx, ny) {
    if (this.reduced || this.lowPower) return;
    var x = nx * this.w, y = ny * this.h;
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * TAU;
      var sp = 40 + Math.random() * 260;
      this.bursts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.5 + Math.random() * 0.8,
        age: 0,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 8,
        s: 2 + Math.random() * 6
      });
    }
  };

  Wallpaper.prototype.tick = function (now) {
    var self = this;
    if (self.paused || self.reduced) { self.raf = 0; return; }
    var dt = Math.min(0.05, (now - self.last) / 1000);
    self.last = now;
    self.t += dt;
    self.pointer.x = lerp(self.pointer.x, self.pointer.tx, 0.055);
    self.pointer.y = lerp(self.pointer.y, self.pointer.ty, 0.055);
    self.root.style.setProperty('--mx', self.pointer.x.toFixed(3));
    self.root.style.setProperty('--my', self.pointer.y.toFixed(3));

    var beat = self.t * self.bpm / 60;
    var bi = Math.floor(beat);
    if (bi !== self.lastBeat) {
      self.lastBeat = bi;
      if (bi % 2 === 0) self.pluck(0.42);
      if (bi % 4 === 0) {
        self.root.classList.add('is-beat');
        self.beatUntil = self.t + 0.14;
      }
      if (bi % 32 === 0 && bi > 0) self.triggerGlitch(0.22);
    }
    if (self.beatUntil && self.t > self.beatUntil) {
      self.beatUntil = 0;
      self.root.classList.remove('is-beat');
    }
    if (self.t > self.nextGlitch) {
      self.nextGlitch = self.t + 9 + Math.random() * 9;
      self.triggerGlitch(0.18);
    }
    self.draw();
    self.raf = requestAnimationFrame(self.tick);
  };

  Wallpaper.prototype.draw = function () {
    var ctx = this.ctx;
    var w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.drawBackdrop(ctx);
    this.drawPaints(ctx);
    this.drawSun(ctx);
    this.drawBeams(ctx);
    this.drawGuitar(ctx);
    this.drawBox(ctx);
    this.drawThornFrame(ctx);
    this.drawString(ctx);
    this.drawParticles(ctx);
    this.drawCrowd(ctx);
    this.drawMic(ctx);
    this.drawStageLights(ctx);
    this.drawGlitch(ctx);
  };

  Wallpaper.prototype.drawBackdrop = function (ctx) {
    if (!this.backdrop) return;
    var pad = this.backdrop.pad;
    var ox = this.pointer.x * -10;
    var oy = this.pointer.y * -7;
    ctx.drawImage(this.backdrop.canvas, -pad + ox, -pad + oy, this.w + pad * 2, this.h + pad * 2);

    // low haze that drifts independently from the static plate
    var p = this.palette;
    var hy = this.layout.horizon;
    var haze = ctx.createLinearGradient(0, hy - this.h * 0.2, 0, this.h);
    haze.addColorStop(0, rgba(p.red, 0));
    haze.addColorStop(0.45, rgba(p.red, p.name === 'live' ? 0.05 : 0.03));
    haze.addColorStop(1, rgba(p.red, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = haze;
    ctx.fillRect(0, hy - this.h * 0.2, this.w, this.h);
    ctx.restore();
  };

  Wallpaper.prototype.drawPaints = function (ctx) {
    var p = this.palette;
    var w = this.w, h = this.h;
    var t = this.t;
    var cols = p.name === 'noise'
      ? ['#e1121f', '#111111', '#111111', '#e1121f', '#111111']
      : [p.beam[0], p.beam[1], p.beam[2], p.beam[3], p.beam[4]];
    var xs = [0.1, 0.275, 0.455, 0.635, 0.815];
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'screen';
    for (var i = 0; i < 5; i++) {
      var x = w * xs[i] + Math.sin(t * 0.18 + i * 1.7) * 7;
      var len = h * (0.035 + 0.035 * ((i * 7) % 5) / 4) + Math.sin(t * 0.25 + i) * 8;
      var width = w * (0.0018 + i * 0.00035);
      var a = p.name === 'noise' ? 0.55 : 0.62;
      var grad = ctx.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0, rgba(cols[i], a));
      grad.addColorStop(0.72, rgba(cols[i], a * 0.8));
      grad.addColorStop(1, rgba(cols[i], 0.06));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - width, -10);
      ctx.lineTo(x + width, -10);
      ctx.lineTo(x + width * 0.55, len);
      ctx.lineTo(x - width * 0.55, len);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, len, width * 2.6, 0, TAU);
      ctx.fill();
      for (var s = 0; s < 4; s++) {
        var sx = x + (Math.sin(i * 13.7 + s * 4.1) * width * 12);
        var sy = len + Math.cos(i * 9.1 + s * 2.3) * width * 8 + s * width * 1.8;
        ctx.fillStyle = rgba(cols[i], a * 0.55);
        ctx.beginPath();
        ctx.arc(sx, sy, width * (0.4 + (s % 3) * 0.25), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawGuitar = function (ctx) {
    var p = this.palette;
    var w = this.w, h = this.h;
    var base = { x: w * 0.025, y: h * 1.16 };
    var tip = { x: w * 0.285, y: h * 0.47 };
    var dx = tip.x - base.x, dy = tip.y - base.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    var rot = Math.atan2(dy, dx) + Math.PI / 2;
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.rotate(rot);

    // body (mostly out of frame)
    ctx.fillStyle = p.name === 'noise' ? 'rgba(10,10,10,0.95)' : 'rgba(4,6,10,0.92)';
    ctx.beginPath();
    ctx.ellipse(0, 112, 132, 172, 0, 0, TAU);
    ctx.fill();

    // neck
    var ng = ctx.createLinearGradient(-36, 0, 36, 0);
    ng.addColorStop(0, p.name === 'noise' ? '#111' : '#111820');
    ng.addColorStop(0.42, p.name === 'noise' ? '#2a2a2a' : '#2d3942');
    ng.addColorStop(0.62, p.name === 'noise' ? '#0a0a0a' : '#090d12');
    ng.addColorStop(1, p.name === 'noise' ? '#111' : '#141b22');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.moveTo(-34, 0);
    ctx.lineTo(-22, -len * 0.7);
    ctx.lineTo(22, -len * 0.7);
    ctx.lineTo(34, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.8)' : 'rgba(190,240,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // frets
    ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.5)' : 'rgba(220,245,255,0.11)';
    ctx.lineWidth = 0.8;
    for (var i = 1; i <= 16; i++) {
      var y = -len * 0.7 * (i / 17);
      var half = lerp(34, 22, i / 17) * 0.92;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
    }

    // pearl inlays
    if (p.name !== 'noise') {
      ctx.fillStyle = 'rgba(235,245,240,0.2)';
      for (var inl = 1; inl <= 5; inl++) {
        ctx.beginPath();
        ctx.arc(0, -len * 0.7 * (inl / 6), 2.4, 0, TAU);
        ctx.fill();
      }
    }

    // strings
    for (var s = 0; s < 6; s++) {
      var sx = -15 + s * 6;
      ctx.strokeStyle = s === 0 ? rgba(p.red, 0.35) : rgba(p.white, 0.13);
      ctx.lineWidth = s === 0 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx * 0.68, -len * 0.7);
      ctx.stroke();
    }

    // headstock
    var hy = -len * 0.7;
    var hg = ctx.createLinearGradient(-46, hy, 46, hy - 100);
    hg.addColorStop(0, p.name === 'noise' ? '#111' : '#18222b');
    hg.addColorStop(0.5, p.name === 'noise' ? '#222' : '#0a0f15');
    hg.addColorStop(1, p.name === 'noise' ? '#111' : '#1d2831');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(-22, hy);
    ctx.lineTo(-38, hy - 14);
    ctx.lineTo(-46, hy - 48);
    ctx.lineTo(-38, hy - 76);
    ctx.lineTo(-29, hy - 98);
    ctx.lineTo(-19, hy - 105);
    ctx.lineTo(19, hy - 105);
    ctx.lineTo(29, hy - 98);
    ctx.lineTo(38, hy - 76);
    ctx.lineTo(46, hy - 48);
    ctx.lineTo(38, hy - 14);
    ctx.lineTo(22, hy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.8)' : 'rgba(190,240,255,0.24)';
    ctx.stroke();

    // nut
    ctx.strokeStyle = p.name === 'noise' ? '#555' : 'rgba(235,245,240,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22, hy + 1.5);
    ctx.lineTo(22, hy + 1.5);
    ctx.stroke();

    // headstock mark
    ctx.save();
    ctx.fillStyle = p.name === 'noise' ? 'rgba(255,255,255,0.35)' : 'rgba(244,241,232,0.55)';
    ctx.font = '15px Anton, "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '1px';
    ctx.fillText('TOGE', 0, hy - 58);
    ctx.restore();

    // tuning pegs
    for (var k = 0; k < 6; k++) {
      var side = k < 3 ? -1 : 1;
      var py = hy - 30 - (k % 3) * 27;
      var px = side * 45;
      ctx.fillStyle = p.name === 'noise' ? '#333' : 'rgba(208,224,226,0.72)';
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = p.name === 'noise' ? '#222' : 'rgba(110,130,138,0.8)';
      ctx.beginPath();
      ctx.arc(px - side * 2, py, 1.3, 0, TAU);
      ctx.fill();
    }

    // rim lights
    if (p.name !== 'noise') {
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = rgba(p.red, 0.35);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-37, 0);
      ctx.lineTo(-25, -len * 0.7);
      ctx.lineTo(-43, hy - 18);
      ctx.lineTo(-50, hy - 92);
      ctx.stroke();
      ctx.strokeStyle = rgba(p.cyan, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(37, 0);
      ctx.lineTo(25, -len * 0.7);
      ctx.lineTo(43, hy - 18);
      ctx.stroke();
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawStageLights = function (ctx) {
    var p = this.palette;
    var w = this.w, h = this.h;
    var t = this.t;
    var y = h * 0.81;
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'screen';
    var line = ctx.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0, rgba(p.red, 0));
    line.addColorStop(0.2, rgba(p.red, 0.28));
    line.addColorStop(0.5, rgba(p.cyan, 0.22));
    line.addColorStop(0.8, rgba(p.beam[3], 0.24));
    line.addColorStop(1, rgba(p.beam[4], 0));
    ctx.fillStyle = line;
    ctx.fillRect(0, y, w, 1.2);
    for (var i = 0; i < 5; i++) {
      var x = w * (0.14 + i * 0.18);
      var a = 0.14 + Math.abs(Math.sin(t * 0.7 + i * 1.8)) * 0.2;
      var g = ctx.createRadialGradient(x, y, 0, x, y, 50);
      g.addColorStop(0, rgba(p.beam[i], a));
      g.addColorStop(1, rgba(p.beam[i], 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 50, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawSun = function (ctx) {
    var p = this.palette;
    var s = this.layout.sun;
    var beat = this.t * this.bpm / 60;
    var pulse = Math.pow(1 - (beat % 1), 5);
    var r = s.r * (1 + pulse * 0.014);
    var x = s.x + this.pointer.x * 5;
    var y = s.y + this.pointer.y * 4;
    ctx.save();
    ctx.translate(x, y);

    // offset print plate
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'screen';
    ctx.fillStyle = rgba(p.sunOffset, p.name === 'noise' ? 0.9 : 0.5);
    ctx.beginPath();
    ctx.arc(-r * 0.055, r * 0.04, r, 0, TAU);
    ctx.fill();
    ctx.restore();

    // halo
    var halo = ctx.createRadialGradient(0, 0, r * 0.72, 0, 0, r * 1.42);
    halo.addColorStop(0, rgba(p.red, p.name === 'noise' ? 0.08 : 0.28));
    halo.addColorStop(0.55, rgba(p.red, 0.09));
    halo.addColorStop(1, rgba(p.red, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.42, 0, TAU);
    ctx.fill();
    ctx.restore();

    // disc
    var grad = ctx.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.04, 0, 0, r);
    grad.addColorStop(0, p.sun[0]);
    grad.addColorStop(0.58, p.sun[1]);
    grad.addColorStop(1, p.sun[2]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();

    // halftone + rings
    ctx.save();
    ctx.globalAlpha = p.name === 'noise' ? 0.22 : 0.17;
    ctx.fillStyle = ctx.createPattern(this.dotTile, 'repeat');
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    for (var i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.22 + i * 0.14), 0, TAU);
      ctx.stroke();
    }

    // torn print bands
    var cuts = p.name === 'noise' ? [0.18, -0.28] : [-0.06, 0.26, 0.48];
    ctx.fillStyle = rgba(p.cut, p.name === 'live' ? 0.82 : 0.9);
    for (var c = 0; c < cuts.length; c++) {
      var cy = r * cuts[c] + Math.sin(this.t * 0.35 + c) * 2;
      var ch = r * (0.018 + c * 0.012);
      ctx.fillRect(-r, cy, r * 2, ch);
    }

    // a thin red scan line
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-r * 1.03, -1, r * 2.06, 1.3);
    ctx.restore();

    // lens flare (not on the xerox mode)
    if (p.name !== 'noise') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      var fl = ctx.createLinearGradient(-r * 2.3, 0, r * 2.3, 0);
      fl.addColorStop(0, 'rgba(255,255,255,0)');
      fl.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      fl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fl;
      ctx.fillRect(-r * 2.3, -1, r * 4.6, 2);
      var flare = [[-1.65, 0.09, p.cyan], [-0.9, 0.06, p.red], [1.1, 0.08, p.ember], [1.7, 0.05, p.blue]];
      for (var f = 0; f < flare.length; f++) {
        ctx.fillStyle = rgba(flare[f][2], flare[f][1]);
        ctx.beginPath();
        ctx.arc(r * flare[f][0], Math.sin(this.t * 0.3 + f) * r * 0.02, r * 0.06, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // a red rim light on the lower-left
    ctx.strokeStyle = rgba(p.name === 'noise' ? '#e1121f' : p.sun[0], 0.5);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0.45, 2.3);
    ctx.stroke();
    ctx.restore();
  };

  Wallpaper.prototype.drawBeams = function (ctx) {
    var p = this.palette;
    var w = this.w, h = this.h;
    var t = this.t;
    var alpha = this.dsh ? 0.62 : 1;
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'screen';
    for (var i = 0; i < 5; i++) {
      var ox = w * (0.14 + i * 0.18);
      var oy = h * 1.06;
      var tx = ox + Math.sin(t * 0.2 + i * 1.63) * w * 0.085;
      var ty = h * 0.03;
      var half = w * (0.032 + i * 0.004);
      var col = p.beam[i];
      var a = (p.name === 'noise' ? 0.045 : 0.15) * alpha;
      var g = ctx.createLinearGradient(ox, oy, tx, ty);
      g.addColorStop(0, rgba(col, a * 1.25));
      g.addColorStop(0.55, rgba(col, a * 0.45));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ox - half * 0.25, oy);
      ctx.lineTo(ox + half * 0.25, oy);
      ctx.lineTo(tx + half, ty);
      ctx.lineTo(tx - half, ty);
      ctx.closePath();
      ctx.fill();

      // hot core
      ctx.fillStyle = rgba(col, a * 0.75);
      ctx.beginPath();
      ctx.moveTo(ox - 3, oy);
      ctx.lineTo(ox + 3, oy);
      ctx.lineTo(tx + 9, ty);
      ctx.lineTo(tx - 9, ty);
      ctx.closePath();
      ctx.fill();

      // source lamp
      var lamp = ctx.createRadialGradient(ox, oy, 0, ox, oy, w * 0.055);
      lamp.addColorStop(0, rgba(col, 0.55 * alpha));
      lamp.addColorStop(0.3, rgba(col, 0.16 * alpha));
      lamp.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = lamp;
      ctx.beginPath();
      ctx.arc(ox, oy, w * 0.055, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawBox = function (ctx) {
    var p = this.palette;
    var b = this.layout.box;
    var t = this.t;
    var s = b.s;
    var beat = t * this.bpm / 60;
    var pulse = Math.pow(1 - (beat % 1), 6);
    var cx = b.x + this.pointer.x * 8;
    var cy = b.y + this.pointer.y * 6 + Math.sin(t * 0.55) * 5;

    // floor shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, this.h * 0.805, s * 1.35, s * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    var ry = 0.62 + Math.sin(t * 0.18) * 0.11;
    var rx = -0.36 + Math.sin(t * 0.13) * 0.05;
    var cosY = Math.cos(ry), sinY = Math.sin(ry);
    var cosX = Math.cos(rx), sinX = Math.sin(rx);
    var verts = [];
    var corners = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
    ];
    for (var i = 0; i < 8; i++) {
      var vx = corners[i][0], vy = corners[i][1], vz = corners[i][2];
      var x1 = vx * cosY - vz * sinY;
      var z1 = vx * sinY + vz * cosY;
      var y1 = vy * cosX - z1 * sinX;
      var z2 = vy * sinX + z1 * cosX;
      var persp = 1 / (1 + z2 * 0.2);
      verts.push({
        x: cx + x1 * s * persp,
        y: cy - y1 * s * persp,
        z: z2
      });
    }

    var faces = [
      { ix: [4, 5, 6, 7], shade: 0.1 },
      { ix: [0, 3, 7, 4], shade: 0.24 },
      { ix: [1, 5, 6, 2], shade: 0.2 },
      { ix: [3, 2, 6, 7], shade: 0.34 },
      { ix: [0, 1, 2, 3], shade: 0.42 }
    ];
    faces.sort(function (a, b2) {
      var za = 0, zb = 0;
      for (var k = 0; k < 4; k++) { za += verts[a.ix[k]].z; zb += verts[b2.ix[k]].z; }
      return zb - za;
    });

    ctx.save();
    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      ctx.beginPath();
      ctx.moveTo(verts[face.ix[0]].x, verts[face.ix[0]].y);
      for (var k2 = 1; k2 < 4; k2++) ctx.lineTo(verts[face.ix[k2]].x, verts[face.ix[k2]].y);
      ctx.closePath();
      var fg = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
      fg.addColorStop(0, 'rgba(7,12,22,' + face.shade * 0.55 + ')');
      fg.addColorStop(1, 'rgba(7,12,22,' + face.shade + ')');
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = rgba(p.cyan, 0.18);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();

    // flame inside the open box, before the front edges for depth
    var flameBase = cy + s * 0.72;
    var flick = Math.sin(t * 8.1) * 0.5 + Math.sin(t * 13.7 + 1.2) * 0.5;
    var fh = s * (0.58 + flick * 0.05);
    var fw = s * 0.16;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var flameGlow = ctx.createRadialGradient(cx, flameBase - fh * 0.35, 1, cx, flameBase - fh * 0.35, fh * 0.95);
    flameGlow.addColorStop(0, 'rgba(255,90,26,0.26)');
    flameGlow.addColorStop(1, 'rgba(255,40,10,0)');
    ctx.fillStyle = flameGlow;
    ctx.beginPath();
    ctx.arc(cx, flameBase - fh * 0.35, fh * 0.95, 0, TAU);
    ctx.fill();

    var outerFlame = ctx.createLinearGradient(0, flameBase - fh, 0, flameBase);
    outerFlame.addColorStop(0, 'rgba(255,120,30,0)');
    outerFlame.addColorStop(0.35, 'rgba(255,90,20,0.55)');
    outerFlame.addColorStop(0.8, 'rgba(255,40,12,0.7)');
    outerFlame.addColorStop(1, 'rgba(255,30,10,0.1)');
    ctx.fillStyle = outerFlame;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(t * 6.3) * s * 0.02, flameBase - fh);
    ctx.bezierCurveTo(cx + fw * 1.2, flameBase - fh * 0.62, cx + fw * 0.95, flameBase - fh * 0.18, cx + s * 0.02, flameBase);
    ctx.bezierCurveTo(cx - fw * 0.95, flameBase - fh * 0.18, cx - fw * 1.2, flameBase - fh * 0.62, cx + Math.sin(t * 6.3) * s * 0.02, flameBase - fh);
    ctx.fill();

    var innerFlame = ctx.createLinearGradient(0, flameBase - fh * 0.72, 0, flameBase);
    innerFlame.addColorStop(0, 'rgba(255,250,220,0.95)');
    innerFlame.addColorStop(0.55, 'rgba(255,215,120,0.8)');
    innerFlame.addColorStop(1, 'rgba(255,110,40,0.05)');
    ctx.fillStyle = innerFlame;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(t * 6.3) * s * 0.012, flameBase - fh * 0.72);
    ctx.bezierCurveTo(cx + fw * 0.6, flameBase - fh * 0.42, cx + fw * 0.5, flameBase - fh * 0.12, cx, flameBase);
    ctx.bezierCurveTo(cx - fw * 0.5, flameBase - fh * 0.12, cx - fw * 0.6, flameBase - fh * 0.42, cx + Math.sin(t * 6.3) * s * 0.012, flameBase - fh * 0.72);
    ctx.fill();
    ctx.restore();
    this.flamePoint = { x: cx, y: flameBase - fh * 0.55 };

    // edges: wide glow, medium, hot core
    var edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'lighter';
    for (var pass = 0; pass < 3; pass++) {
      ctx.lineWidth = pass === 0 ? 8 : pass === 1 ? 2.3 : 0.9;
      for (var e = 0; e < edges.length; e++) {
        var a = verts[edges[e][0]], b2 = verts[edges[e][1]];
        var hot = e === 4 || e === 7;
        var col = p.name === 'noise' ? '#0a0a0a' : hot ? p.red : p.cyan;
        var al = pass === 0 ? 0.085 : pass === 1 ? 0.34 : 0.9;
        ctx.strokeStyle = rgba(col, al * (1 + pulse * 0.25));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // open-top rim plane
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    ctx.lineTo(verts[4].x, verts[4].y);
    ctx.lineTo(verts[5].x, verts[5].y);
    ctx.lineTo(verts[1].x, verts[1].y);
    ctx.closePath();
    ctx.fillStyle = rgba(p.cyan, 0.035);
    ctx.fill();
    ctx.strokeStyle = rgba(p.cyan, 0.35);
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // crown light from the open box on every 4th bar
    var phase = (beat / 4) % 1;
    if (phase < 0.18) {
      var beamA = (1 - phase / 0.18) * 0.11;
      var bg = ctx.createLinearGradient(0, cy - s, 0, this.h * 0.04);
      bg.addColorStop(0, rgba(p.cyan, beamA));
      bg.addColorStop(1, rgba(p.cyan, 0));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.52, cy - s * 0.5);
      ctx.lineTo(cx + s * 0.52, cy - s * 0.5);
      ctx.lineTo(cx + s * 1.3, this.h * 0.04);
      ctx.lineTo(cx - s * 1.3, this.h * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  Wallpaper.prototype.drawThornFrame = function (ctx) {
    var p = this.palette;
    var t = this.t;
    var w = this.w, h = this.h;
    var branches = [
      {
        p0: [-0.02 * w, 1.045 * h], p1: [0.045 * w, 0.82 * h], p2: [0.015 * w, 0.56 * h], p3: [0.125 * w, 0.355 * h],
        width: 13, delay: 0.15, seed: 3
      },
      {
        p0: [1.035 * w, -0.045 * h], p1: [0.925 * w, 0.075 * h], p2: [0.97 * w, 0.285 * h], p3: [0.79 * w, 0.46 * h],
        width: 11, delay: 0.85, seed: 11
      }
    ];
    function cubic(p0, p1, p2, p3, u) {
      var iu = 1 - u;
      return {
        x: iu * iu * iu * p0[0] + 3 * iu * iu * u * p1[0] + 3 * iu * u * u * p2[0] + u * u * u * p3[0],
        y: iu * iu * iu * p0[1] + 3 * iu * iu * u * p1[1] + 3 * iu * u * u * p2[1] + u * u * u * p3[1]
      };
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var b = 0; b < branches.length; b++) {
      var br = branches[b];
      var g = easeOutCubic(clamp((t - br.delay) / 2.8, 0, 1));
      if (g <= 0) continue;
      var pts = [];
      var steps = 46;
      var last = Math.max(2, Math.floor(steps * g));
      for (var i = 0; i <= last; i++) {
        var u = i / steps;
        var pt = cubic(br.p0, br.p1, br.p2, br.p3, u);
        var sway = Math.sin(t * 0.42 + u * 7 + br.seed) * (1.4 + 4 * u) * (1 - u * 0.35);
        var swayY = Math.cos(t * 0.33 + u * 5 + br.seed) * 1.1;
        pts.push({ x: pt.x + sway, y: pt.y + swayY, u: u });
      }
      if (pts.length < 2) continue;

      // atmospheric under-glow
      ctx.save();
      ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'screen';
      ctx.strokeStyle = rgba(p.red, p.name === 'noise' ? 0.04 : 0.08);
      ctx.lineWidth = br.width * 2.6;
      ctx.beginPath();
      for (var q = 0; q < pts.length; q++) {
        if (q === 0) ctx.moveTo(pts[q].x, pts[q].y); else ctx.lineTo(pts[q].x, pts[q].y);
      }
      ctx.stroke();
      ctx.restore();

      // black body
      ctx.strokeStyle = p.name === 'noise' ? '#0a0a0a' : 'rgba(3,4,7,0.99)';
      ctx.lineWidth = br.width;
      ctx.beginPath();
      for (var q2 = 0; q2 < pts.length; q2++) {
        if (q2 === 0) ctx.moveTo(pts[q2].x, pts[q2].y); else ctx.lineTo(pts[q2].x, pts[q2].y);
      }
      ctx.stroke();

      // two-sided rim light
      if (p.name !== 'noise') {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (var side = -1; side <= 1; side += 2) {
          ctx.strokeStyle = rgba(side < 0 ? p.cyan : p.red, side < 0 ? 0.48 : 0.38);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (var q3 = 1; q3 < pts.length; q3++) {
            var a = pts[q3 - 1], c = pts[q3];
            var dx = c.x - a.x, dy = c.y - a.y;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            var nx = -dy / len, ny = dx / len;
            var x = c.x + nx * side * br.width * 0.38;
            var y = c.y + ny * side * br.width * 0.38;
            if (q3 === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // thorns and nodes
      var thornEvery = br.width > 10 ? 3 : 4;
      for (var k = 2; k < pts.length - 1; k += thornEvery) {
        var a2 = pts[k - 1], c2 = pts[k + 1];
        var ang = Math.atan2(c2.y - a2.y, c2.x - a2.x);
        var normal = ang + Math.PI * 0.5;
        var sgn = (k % (thornEvery * 2) === 0) ? 1 : -1;
        var tipLen = (br.width > 10 ? 28 : 18) + (k % 5) * 3 + Math.sin(t * 1.6 + k) * 2;
        var baseX = pts[k].x, baseY = pts[k].y;
        var tipX = baseX + Math.cos(normal) * sgn * tipLen;
        var tipY = baseY + Math.sin(normal) * sgn * tipLen;
        ctx.beginPath();
        ctx.moveTo(baseX - Math.cos(ang) * (br.width * 0.55), baseY - Math.sin(ang) * (br.width * 0.55));
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(baseX + Math.cos(ang) * (br.width * 0.55), baseY + Math.sin(ang) * (br.width * 0.55));
        ctx.closePath();
        ctx.fillStyle = p.name === 'noise' ? '#0a0a0a' : 'rgba(3,4,7,0.99)';
        ctx.fill();
        ctx.strokeStyle = rgba(sgn > 0 ? p.cyan : p.red, 0.72);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.fillStyle = rgba(sgn > 0 ? p.cyan : p.red, 0.85);
        ctx.beginPath();
        ctx.arc(tipX, tipY, 1.5, 0, TAU);
        ctx.fill();
      }

      // terminal glow
      if (g > 0.85) {
        var lastPt = pts[pts.length - 1];
        var tipCol = b === 0 ? p.red : b === 1 ? p.cyan : p.beam[4];
        var gg = ctx.createRadialGradient(lastPt.x, lastPt.y, 0, lastPt.x, lastPt.y, 26);
        gg.addColorStop(0, rgba(tipCol, 0.55));
        gg.addColorStop(1, rgba(tipCol, 0));
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, 26, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(tipCol, 0.9);
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, 2.4 + Math.sin(t * 3 + b) * 0.6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawVines = function (ctx) {
    var p = this.palette;
    var t = this.t;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var v = 0; v < this.vines.length; v++) {
      var vine = this.vines[v];
      var g = easeOutCubic(clamp((t - vine.delay) / 3.0, 0, 1));
      if (g <= 0) continue;
      for (var b = 0; b < vine.branches.length; b++) {
        var branch = vine.branches[b];
        var n = Math.max(2, Math.ceil(branch.pts.length * g));
        var pts = branch.pts.slice(0, n);
        if (pts.length < 2) continue;
        ctx.beginPath();
        for (var i = 0; i < pts.length; i++) {
          var sway = Math.sin(t * 0.55 + i * 0.62 + branch.seed) * 1.4 * (i / pts.length);
          var x = pts[i].x + sway;
          var y = pts[i].y + Math.cos(t * 0.42 + i * 0.5 + branch.seed) * 0.8;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = p.name === 'noise' ? 'rgba(10,10,10,0.96)' : 'rgba(3,4,7,0.98)';
        ctx.lineWidth = Math.max(1.1, branch.width * (1 - (b / vine.branches.length) * 0.12));
        ctx.stroke();

        if (p.name !== 'noise') {
          // a soft red under-glow, then a two-sided rim so black vines still read
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.strokeStyle = rgba(p.red, 0.09);
          ctx.lineWidth = Math.max(4, branch.width * 1.5);
          ctx.stroke();
          ctx.strokeStyle = rgba(b.depth === 0 ? p.cyan : p.red, 0.42);
          ctx.lineWidth = 1.15;
          ctx.beginPath();
          for (var j = 0; j < pts.length; j++) {
            var sx = pts[j].x + Math.sin(t * 0.55 + j * 0.62 + branch.seed) * 1.4 * (j / pts.length) - 2.1;
            var sy = pts[j].y + Math.cos(t * 0.42 + j * 0.5 + branch.seed) * 0.8 - 0.8;
            if (j === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
          ctx.strokeStyle = rgba(p.red, 0.2);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (var j2 = 0; j2 < pts.length; j2++) {
            var sx2 = pts[j2].x + Math.sin(t * 0.55 + j2 * 0.62 + branch.seed) * 1.4 * (j2 / pts.length) + 2;
            var sy2 = pts[j2].y + Math.cos(t * 0.42 + j2 * 0.5 + branch.seed) * 0.8;
            if (j2 === 0) ctx.moveTo(sx2, sy2); else ctx.lineTo(sx2, sy2);
          }
          ctx.stroke();
          ctx.restore();
        }

        // thorns
        if (g > 0.42) {
          for (var k = 3; k < pts.length - 1; k += 3) {
            var a = pts[k - 1], c = pts[k + 1];
            var ang = Math.atan2(c.y - a.y, c.x - a.x) + Math.PI * 0.5;
            var side = (k % 2 === 0) ? 1 : -1;
            var tip = 15 + (branch.seed % 9) + Math.sin(t * 1.7 + k + branch.seed) * 2;
            var bx = pts[k].x, by = pts[k].y;
            ctx.beginPath();
            ctx.moveTo(bx - Math.cos(ang) * 4.2, by - Math.sin(ang) * 4.2);
            ctx.lineTo(bx + Math.cos(ang) * side * tip, by + Math.sin(ang) * side * tip);
            ctx.lineTo(bx + Math.cos(ang) * 4.2, by + Math.sin(ang) * 4.2);
            ctx.closePath();
            ctx.fillStyle = p.name === 'noise' ? '#0a0a0a' : 'rgba(4,5,8,0.98)';
            ctx.fill();
            ctx.strokeStyle = rgba(k % 3 === 0 ? p.red : p.cyan, 0.72);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = rgba(k % 3 === 0 ? p.red : p.cyan, 0.65);
            ctx.beginPath();
            ctx.arc(bx + Math.cos(ang) * side * tip, by + Math.sin(ang) * side * tip, 1.3, 0, TAU);
            ctx.fill();
          }
        }

        // terminal tips glow
        if (branch.depth === 0 && g > 0.8) {
          var last = pts[pts.length - 1];
          var tipCol = b % 3 === 0 ? p.red : b % 3 === 1 ? p.cyan : p.beam[4];
          var tr = 1.6 + Math.sin(t * 3.1 + b) * 0.6;
          var glow = ctx.createRadialGradient(last.x, last.y, 0, last.x, last.y, 12);
          glow.addColorStop(0, rgba(tipCol, 0.55));
          glow.addColorStop(1, rgba(tipCol, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(last.x, last.y, 12, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba(tipCol, 0.9);
          ctx.beginPath();
          ctx.arc(last.x, last.y, tr, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawString = function (ctx) {
    var p = this.palette;
    var w = this.w, h = this.h;
    var y0 = this.layout.stringY;
    var age = Math.max(0, this.t - this.pluckStart);
    var amp = this.pluckStrength * Math.exp(-age * 2.1) * (w / 1920) * 30;
    var phase = age * 21;
    var yAt = function (x) {
      return y0 + amp * Math.sin((x / w) * Math.PI * 2 * 2.15 + phase) * Math.sin(Math.PI * x / w);
    };
    var segs = 64;

    ctx.save();
    ctx.lineCap = 'round';
    // red / blue ghost strings
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(p.red, 0.35);
    ctx.beginPath();
    for (var i = 0; i <= segs; i++) {
      var x = (i / segs) * w;
      if (i === 0) ctx.moveTo(x, yAt(x) + 1.6); else ctx.lineTo(x, yAt(x) + 1.6);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(p.blue, 0.3);
    ctx.beginPath();
    for (var j = 0; j <= segs; j++) {
      var x2 = (j / segs) * w;
      if (j === 0) ctx.moveTo(x2, yAt(x2) - 1.6); else ctx.lineTo(x2, yAt(x2) - 1.6);
    }
    ctx.stroke();

    // hot core
    if (p.name !== 'noise') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(p.cyan, 0.1 + Math.min(0.18, amp / 180));
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (var k = 0; k <= segs; k++) {
        var x3 = (k / segs) * w;
        if (k === 0) ctx.moveTo(x3, yAt(x3)); else ctx.lineTo(x3, yAt(x3));
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = rgba(p.type, 0.9);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (var q = 0; q <= segs; q++) {
      var x4 = (q / segs) * w;
      if (q === 0) ctx.moveTo(x4, yAt(x4)); else ctx.lineTo(x4, yAt(x4));
    }
    ctx.stroke();

    // a second, quieter string just below — the six-string gesture without noise
    ctx.strokeStyle = rgba(p.type, 0.28);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (var q2 = 0; q2 <= segs; q2++) {
      var x5 = (q2 / segs) * w;
      var y5 = y0 + 5 + amp * 0.55 * Math.sin((x5 / w) * Math.PI * 2 * 2.15 + phase + 0.7) * Math.sin(Math.PI * x5 / w);
      if (q2 === 0) ctx.moveTo(x5, y5); else ctx.lineTo(x5, y5);
    }
    ctx.stroke();

    // end pegs
    var pegY = y0;
    for (var e = 0; e < 2; e++) {
      var px = e === 0 ? 10 : w - 10;
      var pg = ctx.createLinearGradient(px - 7, pegY - 9, px + 7, pegY + 9);
      pg.addColorStop(0, p.name === 'noise' ? '#222' : '#d8eef3');
      pg.addColorStop(0.5, p.name === 'noise' ? '#0a0a0a' : '#5d7480');
      pg.addColorStop(1, p.name === 'noise' ? '#222' : '#1a2228');
      ctx.fillStyle = pg;
      roundRect(ctx, px - 5, pegY - 8, 10, 16, 4);
      ctx.fill();
      ctx.strokeStyle = rgba(p.red, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px - 8, pegY);
      ctx.lineTo(px + 8, pegY);
      ctx.stroke();
    }

    // floating guitar pick
    var pickX = w * (this.dsh ? 0.56 : 0.44) + Math.sin(this.t * 0.32) * 13;
    var pickY = y0 - h * 0.058 + Math.cos(this.t * 0.27) * 8;
    var pickS = Math.min(w, h) * 0.056;
    ctx.save();
    ctx.translate(pickX, pickY);
    ctx.rotate(-0.62 + Math.sin(this.t * 0.4) * 0.08);
    // offset print shadow
    ctx.save();
    ctx.translate(4, 5);
    ctx.beginPath();
    ctx.moveTo(-pickS * 0.05, -pickS * 0.52);
    ctx.bezierCurveTo(pickS * 0.52, -pickS * 0.48, pickS * 0.52, pickS * 0.05, pickS * 0.16, pickS * 0.3);
    ctx.lineTo(0, pickS * 0.54);
    ctx.lineTo(-pickS * 0.16, pickS * 0.3);
    ctx.bezierCurveTo(-pickS * 0.52, pickS * 0.05, -pickS * 0.52, -pickS * 0.48, -pickS * 0.05, -pickS * 0.52);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-pickS * 0.05, -pickS * 0.52);
    ctx.bezierCurveTo(pickS * 0.52, -pickS * 0.48, pickS * 0.52, pickS * 0.05, pickS * 0.16, pickS * 0.3);
    ctx.lineTo(0, pickS * 0.54);
    ctx.lineTo(-pickS * 0.16, pickS * 0.3);
    ctx.bezierCurveTo(-pickS * 0.52, pickS * 0.05, -pickS * 0.52, -pickS * 0.48, -pickS * 0.05, -pickS * 0.52);
    ctx.closePath();
    ctx.fillStyle = p.name === 'noise' ? '#111' : p.red;
    ctx.fill();
    ctx.strokeStyle = rgba(p.white, 0.9);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.strokeStyle = rgba(p.blue, p.name === 'noise' ? 0.2 : 0.6);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '7px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOGE', 0, 0);
    ctx.restore();

    ctx.restore();
  };

  Wallpaper.prototype.drawParticles = function (ctx) {
    var p = this.palette;
    var t = this.t;
    var w = this.w, h = this.h;
    var dt = 1 / 60;

    // dust
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'lighter';
    for (var i = 0; i < this.dust.length; i++) {
      var d = this.dust[i];
      d.y -= d.v * dt;
      d.x += Math.sin(t * 0.4 + d.p) * 3 * dt;
      if (d.y < -8) { d.y = h + 8; d.x = Math.random() * w; }
      var a = d.a * (0.55 + 0.45 * Math.sin(t * 0.8 + d.p));
      ctx.fillStyle = rgba(p.dust, a);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // embers from the box flame
    if (this.flamePoint && p.name !== 'sky' && !this.lowPower) {
      this.emberAcc += 9 * dt;
      while (this.emberAcc >= 1 && this.embers.length < 56) {
        this.emberAcc -= 1;
        this.embers.push({
          x: this.flamePoint.x + (Math.random() - 0.5) * 18,
          y: this.flamePoint.y + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 18,
          vy: -22 - Math.random() * 40,
          life: 1.4 + Math.random() * 2.2,
          age: 0,
          r: 0.6 + Math.random() * 1.8
        });
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'lighter';
    for (var e = this.embers.length - 1; e >= 0; e--) {
      var em = this.embers[e];
      em.age += dt;
      if (em.age > em.life) { this.embers.splice(e, 1); continue; }
      em.x += em.vx * dt + Math.sin(t * 2 + e) * 0.3;
      em.y += em.vy * dt;
      em.vy *= 0.995;
      var k = 1 - em.age / em.life;
      ctx.fillStyle = rgba(p.ember, 0.7 * k);
      ctx.beginPath();
      ctx.arc(em.x, em.y, em.r * (0.6 + k * 0.7), 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // slow glass shards
    ctx.save();
    for (var s = 0; s < this.shards.length; s++) {
      var sh = this.shards[s];
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.rot += sh.vr * dt;
      if (sh.y > h + 20) { sh.y = -20; sh.x = Math.random() * w; }
      if (sh.x > w + 20) sh.x = -20;
      if (sh.x < -20) sh.x = w + 20;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.rot);
      ctx.beginPath();
      ctx.moveTo(0, -sh.s);
      ctx.lineTo(sh.s * 0.7, sh.s * 0.4);
      ctx.lineTo(-sh.s * 0.5, sh.s * 0.6);
      ctx.closePath();
      ctx.fillStyle = p.name === 'noise' ? 'rgba(0,0,0,0.12)' : rgba(p.cyan, sh.a * 0.32);
      ctx.fill();
      ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.3)' : rgba(p.white, sh.a);
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // click burst
    for (var b = this.bursts.length - 1; b >= 0; b--) {
      var bu = this.bursts[b];
      bu.age += dt;
      if (bu.age > bu.life) { this.bursts.splice(b, 1); continue; }
      bu.vy += 520 * dt;
      bu.x += bu.vx * dt;
      bu.y += bu.vy * dt;
      bu.rot += bu.vr * dt;
      var fade = 1 - bu.age / bu.life;
      ctx.save();
      ctx.translate(bu.x, bu.y);
      ctx.rotate(bu.rot);
      ctx.beginPath();
      ctx.moveTo(0, -bu.s);
      ctx.lineTo(bu.s * 0.7, bu.s * 0.5);
      ctx.lineTo(-bu.s * 0.6, bu.s * 0.4);
      ctx.closePath();
      ctx.fillStyle = rgba(p.white, fade * 0.5);
      ctx.fill();
      ctx.strokeStyle = rgba(p.red, fade);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  };

  Wallpaper.prototype.drawCrowd = function (ctx) {
    var p = this.palette;
    var t = this.t;
    var w = this.w, h = this.h;
    var beat = t * this.bpm / 60;
    var pulse = Math.pow(1 - (beat % 1), 4);
    ctx.save();

    // back-light haze so the silhouettes read against the stage
    ctx.save();
    ctx.globalCompositeOperation = p.name === 'noise' ? 'source-over' : 'screen';
    var back = ctx.createRadialGradient(w * 0.5, h * 1.02, 0, w * 0.5, h * 1.02, h * 0.3);
    back.addColorStop(0, p.name === 'noise' ? 'rgba(0,0,0,0.1)' : 'rgba(255,120,50,0.2)');
    back.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = back;
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.restore();

    for (var i = 0; i < this.crowd.length; i++) {
      var c = this.crowd[i];
      var sway = Math.sin(t * 1.05 + c.phase) * 2.2;
      var x = c.x + sway;
      var y = h + 8 - Math.sin(t * 0.8 + c.phase) * 1.5;
      var s = c.s;
      var armLift = c.arm ? 22 * s + (c.arm ? pulse * 4 : 0) : 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(c.lean);
      // body
      ctx.fillStyle = p.name === 'noise' ? '#0a0a0a' : 'rgba(2,3,5,0.96)';
      ctx.beginPath();
      ctx.moveTo(-17 * s, 0);
      ctx.quadraticCurveTo(-14 * s, -34 * s, 0, -36 * s);
      ctx.quadraticCurveTo(14 * s, -34 * s, 17 * s, 0);
      ctx.closePath();
      ctx.fill();
      // head
      ctx.beginPath();
      ctx.arc(0, -43 * s, 7.2 * s, 0, TAU);
      ctx.fill();
      // rim light
      if (p.name !== 'noise') {
        ctx.strokeStyle = rgba(p.cyan, 0.3);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(0, -43 * s, 7.2 * s, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        ctx.strokeStyle = rgba(p.red, 0.22);
        ctx.beginPath();
        ctx.moveTo(-16 * s, -2);
        ctx.quadraticCurveTo(-13 * s, -32 * s, 0, -35 * s);
        ctx.stroke();
      }
      if (c.arm) {
        var hx = 12 * s;
        var hy = -52 * s - armLift;
        ctx.strokeStyle = p.name === 'noise' ? '#0a0a0a' : 'rgba(2,3,5,0.96)';
        ctx.lineWidth = 4.2 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(9 * s, -31 * s);
        ctx.quadraticCurveTo(16 * s, -43 * s, hx, hy);
        ctx.stroke();
        ctx.fillStyle = p.name === 'noise' ? '#0a0a0a' : 'rgba(2,3,5,0.96)';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2 * s, 0, TAU);
        ctx.fill();
        if (c.phone) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          var pg = ctx.createRadialGradient(hx, hy - 2, 0, hx, hy - 2, 7 * s);
          pg.addColorStop(0, 'rgba(255,248,210,0.95)');
          pg.addColorStop(0.25, 'rgba(255,240,180,0.5)');
          pg.addColorStop(1, 'rgba(255,240,180,0)');
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(hx, hy - 2, 7 * s, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,252,235,0.95)';
          ctx.beginPath();
          ctx.arc(hx, hy - 2, 1.5 * s, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // phone lights along the barrier — a live-house detail that reads even
    // when the silhouettes themselves disappear into the dark
    if (p.name === 'live') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (var pl = 0; pl < 28; pl++) {
        var px = w * (0.02 + 0.96 * (pl / 27)) + Math.sin(t * 1.1 + pl * 1.7) * 3;
        var py = h - 20 - ((pl * 37) % 64);
        var pc = pl % 7 === 0 ? p.red : pl % 7 === 2 ? p.cyan : pl % 7 === 4 ? p.beam[4] : '#fff3cf';
        var pg2 = ctx.createRadialGradient(px, py, 0, px, py, 9);
        pg2.addColorStop(0, rgba(pc, 0.55 + Math.sin(t * 2 + pl) * 0.15));
        pg2.addColorStop(0.3, rgba(pc, 0.18));
        pg2.addColorStop(1, rgba(pc, 0));
        ctx.fillStyle = pg2;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(pc, 0.9);
        ctx.beginPath();
        ctx.arc(px, py, 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // two very close silhouettes frame the bottom corners
    if (p.name !== 'noise') {
      var fg = [[w * 0.025, 1.65, 0.5], [w * 0.975, 1.5, -0.5]];
      for (var f2 = 0; f2 < fg.length; f2++) {
        var fx = fg[f2][0], fs = fg[f2][1], tilt = fg[f2][2];
        ctx.save();
        ctx.translate(fx, h + 10);
        ctx.rotate(tilt * 0.015);
        ctx.fillStyle = 'rgba(1,2,4,0.98)';
        ctx.beginPath();
        ctx.moveTo(-38 * fs, 0);
        ctx.quadraticCurveTo(-30 * fs, -100 * fs, 0, -108 * fs);
        ctx.quadraticCurveTo(30 * fs, -100 * fs, 38 * fs, 0);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -122 * fs, 19 * fs, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(p.cyan, 0.2);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, -122 * fs, 19 * fs, Math.PI * 1.03, Math.PI * 1.97);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  };

  Wallpaper.prototype.drawMic = function (ctx) {
    var p = this.palette;
    var m = this.layout.mic;
    var t = this.t;
    var w = this.w, h = this.h;
    ctx.save();
    ctx.lineCap = 'round';
    // stand
    var grad = ctx.createLinearGradient(m.x1, m.y1, m.x0, m.y0);
    grad.addColorStop(0, p.name === 'noise' ? '#222' : '#2a333a');
    grad.addColorStop(0.5, p.name === 'noise' ? '#0a0a0a' : '#05070a');
    grad.addColorStop(1, p.name === 'noise' ? '#222' : '#11161b');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(m.x0, m.y0);
    ctx.lineTo(m.x1, m.y1);
    ctx.stroke();

    // boom arm
    var topX = m.x1 + w * 0.055;
    var topY = m.y1 - h * 0.025;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(m.x1, m.y1);
    ctx.quadraticCurveTo(m.x1 + w * 0.02, m.y1 - h * 0.05, topX, topY);
    ctx.stroke();

    // mic capsule
    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(-0.62);
    ctx.fillStyle = p.name === 'noise' ? '#111' : '#080b10';
    roundRect(ctx, -8, -13, 16, 27, 8);
    ctx.fill();
    ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.8)' : 'rgba(190,240,255,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.4)' : 'rgba(190,240,255,0.12)';
    for (var i = -5; i <= 5; i += 2.5) {
      ctx.beginPath();
      ctx.moveTo(-6, i);
      ctx.lineTo(6, i);
      ctx.stroke();
    }
    ctx.restore();

    // cable on the floor
    ctx.strokeStyle = p.name === 'noise' ? 'rgba(0,0,0,0.6)' : 'rgba(4,5,8,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.x0, h * 0.985);
    ctx.bezierCurveTo(w * 0.1, h * 0.93, w * 0.26, h * 1.02, w * 0.36, h * 0.97);
    ctx.stroke();

    // a little breathing red LED on the stand
    ctx.fillStyle = rgba(p.red, 0.5 + Math.sin(t * 2.2) * 0.3);
    ctx.beginPath();
    ctx.arc(m.x1 + 2, m.y1 + h * 0.09, 1.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  Wallpaper.prototype.drawGlitch = function (ctx) {
    if (this.t > this.glitchUntil) return;
    var p = this.palette;
    var w = this.w, h = this.h;
    var seed = Math.floor(this.glitchUntil * 1000);
    var rng = mulberry32(seed);
    ctx.save();
    for (var i = 0; i < 5; i++) {
      var y = rng() * h;
      var bh = 2 + rng() * 26;
      ctx.fillStyle = i % 2 === 0 ? rgba(p.red, 0.07) : rgba(p.cyan, 0.05);
      ctx.fillRect(0, y, w, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, y + bh, w, 1);
    }
    // a single scan tear
    var ty = rng() * h;
    ctx.fillStyle = rgba(p.white, 0.08);
    ctx.fillRect(0, ty, w, 2);
    ctx.restore();
  };

  function mount(host, opts) {
    host = host || document.body;
    var root = host.querySelector ? host.querySelector('.gbc-wallpaper') : null;
    if (!root) {
      console.warn('[gbc-wallpaper] markup not found in host');
      return null;
    }
    if (root.__gbcInstance) return root.__gbcInstance;
    var instance = new Wallpaper(root, opts || {});
    root.__gbcInstance = instance;
    return instance;
  }

  window.GBCWallpaper = {
    mount: mount,
    version: '1.0.0',
    modes: MODES.slice()
  };
})();

