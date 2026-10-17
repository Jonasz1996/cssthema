/*
 * algemeen.js - netwerkachtergrond bij algemeen.css (jbogaert)
 *
 * Bewegende stippen en 0/1-tekens met lijnen tussen buren, lijnen naar de muis, en de muis
 * duwt de deeltjes weg (zoals cssthema, allow en aiverslag). Tekent op één vaste canvas
 * achter de app (z-index -1); algemeen.css maakt de paginaachtergrond doorzichtig zodat
 * het netwerk overal zichtbaar is waar de app geen eigen vlak tekent.
 *
 * Laden: via dezelfde sub_filter als de CSS, na de stylesheet-link, met defer.
 * Uitzetten per app (zonder NPM aan te passen): in CSS  :root { --alg-netwerk: 0; }
 * Bij prefers-reduced-motion: één stilstaand beeld, geen muiseffect.
 * Draait niet in iframes en niet naast een eigen canvas van de app over de hele pagina
 * (allow, aiverslag, de Selkies-bureaubladen). Staat stil als het tabblad verborgen is of
 * de app het netwerk helemaal bedekt (weer). De snelheid hangt af van de tijd, niet van de
 * verversingsfrequentie: op 120/144 Hz hetzelfde tempo, hoogstens ~60 beelden per seconde.
 */
(function () {
  "use strict";

  if (window.__algNetwerk) return;
  try {
    if (window.self !== window.top) return;
  } catch (e) {
    return;
  }
  var root = document.documentElement;
  if (!root || !window.requestAnimationFrame) return;
  window.__algNetwerk = true;

  var MAX = 110;
  var AREA = 14000;
  var LINK = 120;
  var POINTER_LINK = 170;
  var REPEL = 130;
  var REPEL_STEP = 1.2;
  var FRAME_MS = 1000 / 60; // snelheden en tellers hieronder gelden per beeld op 60 Hz
  var KIJK_MS = 3000; // zo vaak nagaan of het netwerk nog gewenst en zichtbaar is
  // punten (deel van breedte en hoogte) waar de app het netwerk kan bedekken
  var PUNTEN = [
    [0.5, 0.5],
    [0.15, 0.15],
    [0.85, 0.15],
    [0.15, 0.85],
    [0.85, 0.85],
  ];
  var MEDIA = /^(IMG|VIDEO|CANVAS|IFRAME|OBJECT|EMBED)$/;

  function uit() {
    var v = getComputedStyle(root).getPropertyValue("--alg-netwerk").trim();
    return v === "0" || v === "uit" || v === "none";
  }

  // Een canvas van de app zelf over (bijna) de hele pagina: allow en aiverslag tekenen hetzelfde
  // netwerk, een Selkies-bureaublad (gimp, kdenlive ...) zijn beeld. Dan geen tweede erbij.
  function eigenCanvas(mijn) {
    var lijst = document.getElementsByTagName("canvas");
    for (var i = 0; i < lijst.length; i++) {
      if (lijst[i] === mijn) continue;
      var r = lijst[i].getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) return true;
    }
    return false;
  }

  // Ondoorzichtig: beeld of video, of een achtergrondkleur zonder transparantie.
  function dicht(el) {
    if (MEDIA.test(el.tagName)) return true;
    var m = /^rgba?\(([^)]*)\)$/.exec(getComputedStyle(el).backgroundColor);
    if (!m) return false;
    var d = m[1].split(/[\s,/]+/);
    return d.length < 4 || parseFloat(d[3]) >= 1;
  }

  // Ligt er op elk punt iets ondoorzichtigs boven het netwerk (body en html niet meegeteld)?
  function bedekt() {
    if (!document.elementsFromPoint) return false;
    for (var i = 0; i < PUNTEN.length; i++) {
      var x = PUNTEN[i][0] * window.innerWidth;
      var y = PUNTEN[i][1] * window.innerHeight;
      var stapel = document.elementsFromPoint(x, y);
      var raak = false;
      for (var j = 0; j < stapel.length && !raak; j++) {
        if (stapel[j] === root || stapel[j] === document.body) break;
        raak = dicht(stapel[j]);
      }
      if (!raak) return false;
    }
    return true;
  }

  function start() {
    if (uit() || document.getElementById("alg-netwerk") || eigenCanvas(null)) return;

    var canvas = document.createElement("canvas");
    canvas.id = "alg-netwerk";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;left:0;top:0;z-index:-1;pointer-events:none;display:block";
    root.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var still = motion ? motion.matches : false;
    var actief = true;
    var verborgen = false;
    var W = 0;
    var H = 0;
    var P = [];
    var mouse = { x: -999, y: -999 };
    var frame = 0;
    var vorige = 0;
    var kijker = 0;

    function deeltje(i) {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.4 + 0.6,
        ch: i % 4 === 0 ? (Math.random() < 0.5 ? "0" : "1") : null,
        t: Math.random() * 200,
      };
    }

    // Canvas op de maat van het venster (CSS-maat uit innerHeight: 100vh is op een gsm de
    // hoogte zonder adresbalk). Bestaande deeltjes schuiven mee; alleen het aantal past zich
    // aan. Zo begint het netwerk niet opnieuw als de adresbalk bij het scrollen verdwijnt.
    function maat() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var oudW = W;
      var oudH = H;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (oudW && oudH) {
        for (var i = 0; i < P.length; i++) {
          P[i].x *= W / oudW;
          P[i].y *= H / oudH;
        }
      }
      var n = Math.min(MAX, Math.floor((W * H) / AREA));
      while (P.length < n) P.push(deeltje(P.length));
      P.length = n;
    }

    // dt: verstreken tijd in beelden van 60 Hz
    function stap(dt) {
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if ((p.x < 0 && p.vx < 0) || (p.x > W && p.vx > 0)) p.vx *= -1;
        if ((p.y < 0 && p.vy < 0) || (p.y > H && p.vy > 0)) p.vy *= -1;
        var dx = p.x - mouse.x;
        var dy = p.y - mouse.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0 && d < REPEL) {
          p.x += (dx / d) * REPEL_STEP * dt;
          p.y += (dy / d) * REPEL_STEP * dt;
        }
        if (p.ch && (p.t += dt) > 120) {
          p.t = 0;
          p.ch = Math.random() < 0.5 ? "0" : "1";
        }
      }
    }

    function teken(metMuis) {
      ctx.clearRect(0, 0, W, H);
      ctx.font = "11px monospace";
      var i, j, a, b, dx, dy, d;
      for (i = 0; i < P.length; i++) {
        a = P[i];
        if (a.ch) {
          ctx.fillStyle = "rgba(200,200,200,.35)";
          ctx.fillText(a.ch, a.x, a.y);
        } else {
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.r, 0, 6.283);
          ctx.fillStyle = "rgba(220,220,220,.55)";
          ctx.fill();
        }
      }
      ctx.lineWidth = 1;
      for (i = 0; i < P.length; i++) {
        a = P[i];
        for (j = i + 1; j < P.length; j++) {
          b = P[j];
          dx = a.x - b.x;
          dy = a.y - b.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            ctx.strokeStyle = "rgba(200,200,200," + (1 - d / LINK) * 0.22 + ")";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (metMuis) {
          dx = a.x - mouse.x;
          dy = a.y - mouse.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d < POINTER_LINK) {
            ctx.strokeStyle = "rgba(255,255,255," + (1 - d / POINTER_LINK) * 0.5 + ")";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }
    }

    function lus(ts) {
      frame = window.requestAnimationFrame(lus);
      // op 120/144 Hz niet elk beeld: zo kost het daar niet meer dan op 60 Hz
      if (vorige && ts - vorige < FRAME_MS - 2) return;
      var dt = vorige ? Math.min((ts - vorige) / FRAME_MS, 3) : 1;
      vorige = ts;
      stap(dt);
      teken(true);
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      vorige = 0;
    }

    function draai() {
      stop();
      if (!actief || verborgen) return;
      if (still) teken(false);
      else if (!document.hidden) frame = window.requestAnimationFrame(lus);
    }

    // Nog gewenst (--alg-netwerk, geen eigen canvas van de app) en zichtbaar (niet weg via
    // CSS, niet bedekt)? Elke KIJK_MS, zolang het tabblad zichtbaar is.
    function kijk() {
      if (!actief || document.hidden) return;
      if (uit() || eigenCanvas(canvas)) {
        actief = false;
        stop();
        clearInterval(kijker);
        root.removeChild(canvas);
        return;
      }
      var nu = getComputedStyle(canvas).display === "none" || bedekt();
      if (nu !== verborgen) {
        verborgen = nu;
        draai();
      }
    }

    var wacht = 0;
    window.addEventListener("resize", function () {
      clearTimeout(wacht);
      wacht = setTimeout(function () {
        if (!actief) return;
        maat();
        draai();
      }, 150);
    });
    window.addEventListener(
      "pointermove",
      function (e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
      },
      { passive: true }
    );
    root.addEventListener("pointerleave", function () {
      mouse.x = -999;
      mouse.y = -999;
    });
    window.addEventListener("blur", function () {
      mouse.x = -999;
      mouse.y = -999;
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stop();
        return;
      }
      kijk();
      if (!frame) draai();
    });
    if (motion && motion.addEventListener) {
      motion.addEventListener("change", function (e) {
        still = e.matches;
        draai();
      });
    }

    maat();
    verborgen = bedekt();
    draai();
    kijker = setInterval(kijk, KIJK_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
