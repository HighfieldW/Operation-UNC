/* Operation-UNC title.
   Real words fall down the columns of the banner, one letter at a time. Only the cells
   inside the shape of OPERATION-UNC are shown, so the falling words pour into the
   letters. The title forms, holds, fades out and forms again. Hovering over it
   puts a swirling, zooming lens under the cursor. */
(function () {
  "use strict";

  var WORDS = [
    "OPERATION", "UNC", "VIDEO", "EDITOR", "HIRE", "LEAD", "REDDIT", "CLIENT", "CUT",
    "RENDER", "TIMELINE", "FOOTAGE", "RETAINER", "BUDGET", "SCAN", "TARGET", "SIGNAL",
    "INTEL", "PING", "TRACE", "CLIP", "GRADE", "EXPORT", "DEADLINE", "BRIEF", "CREATOR",
    "AGENCY", "PODCAST", "SHORTS", "REEL", "MARKET", "STREAM", "FOUND", "ACCESS",
    "SEARCH", "UPLOAD"
  ];
  var TITLE = "OPERATION-UNC";

  // ---- Tweak these to change the feel --------------------------------------
  var O = {
    cw: 5, ch: 7, cwSmall: 3, chSmall: 4,        // cell size in px (desktop / phone)
    stretch: 1.9, stretchSmall: 1.6,             // how tall the letters are drawn
    floor: 0.95,                                  // brightness of the lit title
    fps: 45,
    minSpeed: 8, maxSpeed: 18,                    // fall speed, cells per second
    formTime: 3.0, fadeInTime: 1.0,               // seconds
    holdTime: 6.0,                                // seconds the title stays clear
    fadeTime: 1.6,                                // seconds to fade out
    lensRadius: 100, lensRadiusSmall: 60,         // hover lens size in px
    zoom: 0.8,                                    // how much the lens spreads things out
    glyphZoom: 1.0,                               // how much letters grow under the lens
    swirl: 1.5,                                   // twist in radians at the centre
    orbit: 14,                                    // px the lens circles around the cursor
    spinSpeed: 2.6                                // radians per second of that circling
  };
  // ----------------------------------------------------------------------------

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var canvas = document.getElementById("hero");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var cw, chh, cols, rows, cssW, cssH, dpr, small, n, lensR;
  var chars, bright, revealed, mask, maskCells, drops;
  var phase = "form", phaseT = 0, alpha = 0;
  var lens = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0, spin: 0 };
  var running = false, last = 0, raf = 0, lastW = 0, lastH = 0;

  function pickWord() { return WORDS[(Math.random() * WORDS.length) | 0]; }

  function newDrop(col, initial) {
    return {
      col: col,
      y: -((Math.random() * rows * (initial ? 0.35 : 1.0)) | 0),
      speed: O.minSpeed + Math.random() * (O.maxSpeed - O.minSpeed),
      acc: 0,
      word: pickWord(),
      i: 0
    };
  }

  // Next letter of a falling stream; a blank separates words (never inside the title shape)
  function consume(d, noGap) {
    var ch;
    if (d.i < d.word.length) { ch = d.word.charAt(d.i); d.i++; return ch; }
    d.word = pickWord();
    d.i = 0;
    if (noGap) { ch = d.word.charAt(0); d.i = 1; return ch; }
    return " ";
  }

  function advance(d) {
    d.y++;
    if (d.y < 0 || d.y >= rows) { consume(d, false); return; }
    var k = d.y * cols + d.col;
    chars[k] = consume(d, mask[k] === 1);
    bright[k] = 1.3;
    if (mask[k]) revealed[k] = 1;
  }

  function buildMask() {
    mask = new Uint8Array(n);
    maskCells = [];

    var lines = small ? ["OPERATION-", "UNC"] : [TITLE];
    var stretch = small ? O.stretchSmall : O.stretch;
    var vh = rows * chh / (cw * stretch);              // height in "cell-width" units
    var oc = document.createElement("canvas");
    oc.width = cols;
    oc.height = rows;
    var c = oc.getContext("2d");
    c.fillStyle = "#000";
    c.fillRect(0, 0, cols, rows);
    c.scale(1, (cw / chh) * stretch);

    var fam = ' "Arial Black", "Helvetica Neue", Arial, sans-serif';
    var gapEm = 0.16;                                  // space between letters
    function lineWidth(l, size) {
      c.font = "900 " + size + "px" + fam;
      var w = 0;
      for (var i = 0; i < l.length; i++) w += c.measureText(l.charAt(i)).width;
      return w + size * gapEm * (l.length - 1);
    }
    var widest = 0;
    lines.forEach(function (l) { widest = Math.max(widest, lineWidth(l, 100)); });
    var fs = Math.min(cols * 0.94 / widest * 100, vh * 0.9 / lines.length);

    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = "#fff";
    lines.forEach(function (l, li) {
      var x = cols / 2 - lineWidth(l, fs) / 2;        // also sets the font to size fs
      var y = vh / 2 + (li - (lines.length - 1) / 2) * fs * 0.98;
      for (var i = 0; i < l.length; i++) {
        var chr = l.charAt(i);
        c.fillText(chr, x, y);
        x += c.measureText(chr).width + fs * gapEm;
      }
    });

    var px = c.getImageData(0, 0, cols, rows).data;
    for (var k = 0; k < n; k++) {
      if (px[k * 4] > 90) { mask[k] = 1; maskCells.push(k); }
    }
  }

  function resetTitle() {
    var k;
    for (k = 0; k < n; k++) { chars[k] = " "; bright[k] = 0; revealed[k] = 0; }
    drops = [];
    for (var c = 0; c < cols; c++) drops.push(newDrop(c, true));
    phase = "form";
    phaseT = 0;
    alpha = 0;
  }

  function step(dt, cycle) {
    var decay = Math.pow(0.96, dt * 60);
    var k, c;
    for (k = 0; k < n; k++) {
      var b = bright[k] * decay;
      if (revealed[k]) { if (b < O.floor) b = O.floor; }
      else if (b < 0.01) b = 0;
      bright[k] = b;
    }
    for (c = 0; c < cols; c++) {
      var d = drops[c];
      d.acc += d.speed * dt;
      while (d.acc >= 1) { d.acc -= 1; advance(d); }
      if (d.y > rows + 2) drops[c] = newDrop(c, false);
    }
    // a few title cells flash and swap to another letter, so the title keeps shifting
    var flashes = Math.ceil(maskCells.length * 0.004 * dt * 60);
    for (var f = 0; f < flashes; f++) {
      k = maskCells[(Math.random() * maskCells.length) | 0];
      if (revealed[k]) {
        var w = pickWord();
        chars[k] = w.charAt((Math.random() * w.length) | 0);
        bright[k] = 1.2;
      }
    }

    // lens follows the cursor smoothly
    var k1 = Math.min(1, dt * 14), k2 = Math.min(1, dt * 7);
    lens.x += (lens.tx - lens.x) * k1;
    lens.y += (lens.ty - lens.y) * k1;
    lens.on += (lens.target - lens.on) * k2;
    lens.spin += dt * O.spinSpeed;

    if (!cycle) return;
    phaseT += dt;
    if (phase === "form") {
      alpha = Math.min(1, phaseT / O.fadeInTime);
      if (phaseT > O.formTime) { phase = "hold"; phaseT = 0; }
    } else if (phase === "hold") {
      alpha = 1;
      if (phaseT > O.holdTime) { phase = "fade"; phaseT = 0; }
    } else {
      alpha = Math.max(0, 1 - phaseT / O.fadeTime);
      if (phaseT > O.fadeTime) resetTitle();
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (alpha <= 0.01) return;

    ctx.globalAlpha = alpha;
    ctx.font = "bold " + Math.min(chh * 0.92, cw / 0.6) + 'px "Courier New", Courier, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,255,90,0.9)";
    ctx.shadowBlur = 8;

    var L = lens.on;
    for (var i = 0; i < maskCells.length; i++) {
      var k = maskCells[i];
      if (!revealed[k]) continue;
      var ch = chars[k];
      if (!ch || ch === " ") continue;
      var b = bright[k];
      var r = (k / cols) | 0;
      var c = k - r * cols;
      var x = (c + 0.5) * cw, y = (r + 0.5) * chh, sc = 1;

      if (L > 0.02) {
        var dx = x - lens.x, dy = y - lens.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < lensR) {
          var t = 1 - d / lensR;
          var f = t * t * (3 - 2 * t) * L;              // 0 at the edge, 1 at the centre
          var a = Math.atan2(dy, dx) + f * O.swirl;     // twist around the cursor
          var rr = d * (1 + O.zoom * f);                // spread outwards (zoom)
          x = lens.x + Math.cos(a) * rr + Math.cos(lens.spin) * O.orbit * f;
          y = lens.y + Math.sin(a) * rr + Math.sin(lens.spin) * O.orbit * f;
          sc = 1 + O.glyphZoom * f;
        }
      }

      ctx.fillStyle = b > 1 ? "#ffffff" : "rgba(110,255,160," + Math.min(1, b + 0.08).toFixed(2) + ")";
      if (sc > 1.01) {
        ctx.setTransform(dpr * sc, 0, 0, dpr * sc, x * dpr, y * dpr);
        ctx.fillText(ch, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else {
        ctx.fillText(ch, x, y);
      }
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function init() {
    var rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.floor(rect.width));
    cssH = Math.max(1, Math.floor(rect.height));
    lastW = rect.width;
    lastH = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    small = cssW < 600;
    cw = small ? O.cwSmall : O.cw;
    chh = small ? O.chSmall : O.ch;
    lensR = small ? O.lensRadiusSmall : O.lensRadius;
    cols = Math.max(1, Math.floor(cssW / cw));
    rows = Math.max(1, Math.floor(cssH / chh));
    n = cols * rows;

    chars = new Array(n);
    bright = new Float32Array(n);
    revealed = new Uint8Array(n);
    buildMask();
    resetTitle();

    if (reduceMotion) {                                // still image: fully formed title
      for (var s = 0; s < 1500; s++) step(0.05, false);
      alpha = 1;
    }
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    var dt = (now - last) / 1000;
    if (dt < 1 / O.fps) return;
    last = now;
    step(Math.min(dt, 0.1), true);
    draw();
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function setLens(e) {
    var r = canvas.getBoundingClientRect();
    lens.tx = e.clientX - r.left;
    lens.ty = e.clientY - r.top;
    if (lens.on < 0.02) { lens.x = lens.tx; lens.y = lens.ty; }
    lens.target = 1;
  }

  if (!reduceMotion) {
    canvas.addEventListener("pointermove", setLens);
    canvas.addEventListener("pointerdown", setLens);
    canvas.addEventListener("pointerleave", function () { lens.target = 0; });
    canvas.addEventListener("pointercancel", function () { lens.target = 0; });
    canvas.addEventListener("pointerup", function (e) { if (e.pointerType !== "mouse") lens.target = 0; });
  }

  var timer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var r = canvas.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      init();
      if (reduceMotion) draw();
    }, 200);
  });

  init();
  if (reduceMotion) {
    draw();
  } else if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start(); else stop();
    }).observe(canvas);
  } else {
    start();
  }
})();
