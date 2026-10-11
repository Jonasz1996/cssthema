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
 * Draait niet in iframes en stopt als het tabblad niet zichtbaar is.
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

  function uit() {
    var v = getComputedStyle(root).getPropertyValue("--alg-netwerk").trim();
    return v === "0" || v === "uit" || v === "none";
  }

  function start() {
    if (uit() || document.getElementById("alg-netwerk")) return;

    var canvas = document.createElement("canvas");
    canvas.id = "alg-netwerk";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;display:block";
    root.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var still = motion ? motion.matches : false;
    var W = 0;
    var H = 0;
    var P = [];
    var mouse = { x: -999, y: -999 };
    var frame = 0;

    function maak() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(MAX, Math.floor((W * H) / AREA));
      P = [];
      for (var i = 0; i < n; i++) {
        P.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: Math.random() * 1.4 + 0.6,
          ch: i % 4 === 0 ? (Math.random() < 0.5 ? "0" : "1") : null,
          t: Math.random() * 200,
        });
      }
    }

    function stap() {
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        var dx = p.x - mouse.x;
        var dy = p.y - mouse.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0 && d < REPEL) {
          p.x += (dx / d) * REPEL_STEP;
          p.y += (dy / d) * REPEL_STEP;
        }
        if (p.ch && ++p.t > 120) {
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

    function lus() {
      stap();
      teken(true);
      frame = window.requestAnimationFrame(lus);
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    }

    function draai() {
      stop();
      if (still) teken(false);
      else if (!document.hidden) frame = window.requestAnimationFrame(lus);
    }

    var wacht = 0;
    window.addEventListener("resize", function () {
      clearTimeout(wacht);
      wacht = setTimeout(function () {
        maak();
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
      if (document.hidden) stop();
      else if (!frame) draai();
    });
    if (motion && motion.addEventListener) {
      motion.addEventListener("change", function (e) {
        still = e.matches;
        draai();
      });
    }

    maak();
    draai();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
