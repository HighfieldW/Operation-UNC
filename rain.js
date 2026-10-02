/* Operation-UNC: falling words.
   Real words fall down each column, one letter at a time. Cells inside the title
   shape stay lit once a word has passed through them, so the falling words
   themselves spell out OPERATION-UNC. A second, dimmer layer runs behind the page. */
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
  var BUCKETS = 16;
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function pickWord() { return WORDS[(Math.random() * WORDS.length) | 0]; }

  function Rain(canvas, o) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;

    var cw, chh, cols, rows, cssW, cssH, dpr, small, n;
    var chars, bright, revealed, mask, maskCells, drops, colors;
    var running = false, last = 0, raf = 0, lastW = 0, lastH = 0;

    function newDrop(col, initial) {
      var spread = initial ? o.startSpread : o.restartSpread;
      return {
        col: col,
        y: -((Math.random() * rows * spread) | 0),
        speed: o.minSpeed + Math.random() * (o.maxSpeed - o.minSpeed),
        acc: 0,
        word: pickWord(),
        i: 0
      };
    }

    // Next letter for a falling stream; a blank separates words (except inside the title shape)
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
      if (!o.title) return;

      var lines = small ? ["OPERATION-", "UNC"] : [TITLE];
      var stretch = small ? 1 : o.stretch;
      var vh = rows * chh / (cw * stretch);            // height in "cell-width" units
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
        var x = cols / 2 - lineWidth(l, fs) / 2;       // also sets the font to size fs
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

    function step(dt) {
      var decay = Math.pow(o.decay, dt * 60);
      var k, b, c;
      for (k = 0; k < n; k++) {
        b = bright[k] * decay;
        if (revealed[k]) { if (b < o.floor) b = o.floor; }
        else if (b < 0.01) b = 0;
        bright[k] = b;
      }
      for (c = 0; c < cols; c++) {
        var d = drops[c];
        d.acc += d.speed * dt;
        while (d.acc >= 1) { d.acc -= 1; advance(d); }
        if (d.y > rows + 2) drops[c] = newDrop(c, false);
      }
      // title cells now and then flash and swap to another letter, so the title keeps shifting
      if (maskCells.length) {
        var flashes = Math.ceil(maskCells.length * 0.004 * dt * 60);
        for (var f = 0; f < flashes; f++) {
          k = maskCells[(Math.random() * maskCells.length) | 0];
          if (revealed[k]) {
            var w = pickWord();
            chars[k] = w.charAt((Math.random() * w.length) | 0);
            bright[k] = 1.2;
          }
        }
      }
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = "bold " + Math.min(chh * 0.92, cw / 0.6) + 'px "Courier New", Courier, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 0;

      var k, b, ch, r, c;
      for (k = 0; k < n; k++) {
        b = bright[k];
        if (b < 0.03) continue;
        if (revealed[k]) continue;               // title cells are drawn in the second pass
        ch = chars[k];
        if (ch === " ") continue;
        r = (k / cols) | 0;
        c = k - r * cols;
        ctx.fillStyle = b > 1 ? o.headColor : colors[Math.min(BUCKETS - 1, (b * BUCKETS) | 0)];
        ctx.fillText(ch, (c + 0.5) * cw, (r + 0.5) * chh);
      }

      if (maskCells.length) {
        ctx.shadowColor = "rgba(0,255,90,0.9)";
        ctx.shadowBlur = 8;
        for (var i = 0; i < maskCells.length; i++) {
          k = maskCells[i];
          if (!revealed[k]) continue;
          ch = chars[k];
          if (!ch || ch === " ") continue;
          b = bright[k];
          r = (k / cols) | 0;
          c = k - r * cols;
          ctx.fillStyle = b > 1 ? "#ffffff" : "rgba(110,255,160," + Math.min(1, b + 0.08).toFixed(2) + ")";
          ctx.fillText(ch, (c + 0.5) * cw, (r + 0.5) * chh);
        }
        ctx.shadowBlur = 0;
      }
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
      cw = small ? o.cwSmall : o.cw;
      chh = small ? o.chSmall : o.ch;
      cols = Math.max(1, Math.floor(cssW / cw));
      rows = Math.max(1, Math.floor(cssH / chh));
      n = cols * rows;

      chars = new Array(n);
      for (var k = 0; k < n; k++) chars[k] = " ";
      bright = new Float32Array(n);
      revealed = new Uint8Array(n);
      buildMask();

      drops = [];
      for (var c = 0; c < cols; c++) drops.push(newDrop(c, true));

      colors = [];
      for (var i = 0; i < BUCKETS; i++) {
        colors.push("rgba(0,255,90," + (((i + 1) / BUCKETS) * o.opacity).toFixed(3) + ")");
      }

      var warm = reduceMotion ? Math.max(o.prefill, o.title ? 1500 : 300) : o.prefill;
      for (var s = 0; s < warm; s++) step(0.05);
    }

    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      var dt = (now - last) / 1000;
      if (dt < 1 / o.fps) return;
      last = now;
      step(Math.min(dt, 0.1));
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

    var timer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var r = canvas.getBoundingClientRect();
        var tall = o.fixedTall ? 120 : 1;           // ignore phone address-bar height changes
        if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < tall) return;
        init();
        if (reduceMotion) draw();
      }, 200);
    });

    return {
      begin: function () {
        init();
        if (reduceMotion) { draw(); return; }
        if (o.pauseOffscreen && "IntersectionObserver" in window) {
          new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) start(); else stop();
          }).observe(canvas);
        } else {
          start();
        }
      }
    };
  }

  var bg = document.getElementById("bg");
  var hero = document.getElementById("hero");

  if (bg) {
    var r1 = Rain(bg, {
      cw: 12, ch: 16, cwSmall: 10, chSmall: 14,
      opacity: 0.24, headColor: "rgba(190,255,205,0.5)",
      decay: 0.982, floor: 0, fps: 30,
      minSpeed: 6, maxSpeed: 16, startSpread: 1.4, restartSpread: 0.9,
      prefill: 500, title: false, fixedTall: true, pauseOffscreen: false
    });
    if (r1) r1.begin();
  }

  if (hero) {
    var r2 = Rain(hero, {
      cw: 5, ch: 8, cwSmall: 4, chSmall: 6,
      opacity: 0.2, headColor: "rgba(200,255,215,0.4)",
      decay: 0.975, floor: 0.95, fps: 40,
      minSpeed: 7, maxSpeed: 15, startSpread: 0.35, restartSpread: 1.1,
      prefill: 0, title: true, stretch: 1.6, fixedTall: false, pauseOffscreen: true
    });
    if (r2) r2.begin();
  }
})();
