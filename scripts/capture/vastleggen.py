# ruff: noqa: E501  (ingebedde JavaScript)
"""Legt de webinterface van al je diensten vast, als basis voor een thema per dienst.

Per dienst (en per extra pagina die je met `handmatig` vastlegt) bewaart het:

- snapshot.html   de gerenderde DOM zonder scripts, met open shadow roots als
                  <template shadowrootmode="open">, de CSS gelinkt naar ../../_css/
- elementen.json  welke elementen er zijn (tag, klassen, rol), hoe vaak, een selector
                  en de berekende stijl (kleur, achtergrond, rand, radius, font, ...)
- kleuren.json    de meest gebruikte achtergrond-, tekst- en randkleuren
- info.json       titel, frameworks, CSS-variabelen op :root/body, CSP-headers,
                  of algemeen.css/.js geladen werd (en CSP-fouten), shadow-DOM-hosts
- origineel.jpg   desktop zonder je thema
- met-thema.jpg   desktop met het thema dat NPM injecteert (als dat er is)
- mobiel.jpg      390 px breed, met thema

Gebruik (zie README.md):
    python vastleggen.py login --npm http://IP-VAN-NPM:81    # eenmalig, met scherm
    python vastleggen.py alles                               # alle diensten, zonder scherm
    python vastleggen.py handmatig                           # extra pagina's, met scherm

Het resultaat staat in ./vastgelegd/ en in zip-delen van max. 24 MB
(vastgelegd-deel1.zip, ...) die je in de cssthema-thread kan uploaden.

Nodig: Python 3.9+ en Playwright:
    pip install -U playwright
    python -m playwright install chromium
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import hashlib
import html
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

try:
    from playwright.async_api import BrowserContext, Page, async_playwright
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import TimeoutError as PlaywrightTimeout
except ImportError:  # pragma: no cover - alleen een duidelijke melding
    sys.exit(
        "Playwright ontbreekt. Installeer het eenmalig met:\n"
        "  pip install -U playwright\n"
        "  python -m playwright install chromium"
    )

DESKTOP = {"width": 1440, "height": 900}
MOBIEL = {"width": 390, "height": 844}
MAX_HOOGTE = 4000  # px; langere pagina's worden afgeknipt in de screenshot
JPEG_KWALITEIT = 70
DEELGROOTTE_MB = 24

# ---------------------------------------------------------------------------------------
# JavaScript dat in de pagina draait
# ---------------------------------------------------------------------------------------

# Zet de thema-bestanden (links naar de thema-host, /alg-thema/, /__cssthema/) aan of uit,
# zonder herladen. Geeft het aantal thema-links terug.
THEMA_SCHAKELAAR_JS = r"""
(args) => {
  const hosts = args.hosts || [];
  const isThema = (u) => {
    try { const x = new URL(u, document.baseURI);
      return hosts.includes(x.host) || /^\/(alg-thema|__cssthema)\//.test(x.pathname);
    } catch { return false; }
  };
  let n = 0;
  for (const l of document.querySelectorAll('link[rel~="stylesheet"]')) {
    if (isThema(l.href)) { l.disabled = !args.aan; n++; }
  }
  const c = document.getElementById('alg-netwerk');
  if (c) c.style.visibility = args.aan ? '' : 'hidden';
  // Overgangen uit, anders schuiven de kleuren nog na het omschakelen.
  try {
    if (!window.__ctGeenOvergang) {
      window.__ctGeenOvergang = new CSSStyleSheet();
      window.__ctGeenOvergang.replaceSync('*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, window.__ctGeenOvergang];
    }
  } catch {}
  return n;
}
"""

# Hoe het thema er nu voor staat (met thema aan).
THEMA_STATUS_JS = r"""
(args) => {
  const hosts = args.hosts || [];
  const isThema = (u) => {
    try { const x = new URL(u, document.baseURI);
      return hosts.includes(x.host) || /^\/(alg-thema|__cssthema)\//.test(x.pathname);
    } catch { return false; }
  };
  const links = [...document.querySelectorAll('link[rel~="stylesheet"]')]
    .filter((l) => isThema(l.href))
    .map((l) => {
      // Een mislukte of door CSP geblokkeerde link heeft geen of een leeg sheet; een geladen
      // sheet van een ander domein (zonder CORS) is niet leesbaar en gooit een fout.
      let geladen = false;
      try { geladen = !!l.sheet && l.sheet.cssRules.length > 0; } catch { geladen = !!l.sheet; }
      return { href: l.href, geladen };
    });
  const scripts = [...document.querySelectorAll('script[src]')]
    .filter((s) => isThema(s.src)).map((s) => s.src);
  return {
    links, scripts,
    netwerk: !!document.getElementById('alg-netwerk'),
    marker: getComputedStyle(document.documentElement).getPropertyValue('--alg-geladen').trim(),
  };
}
"""

DOM_RUSTIG_JS = r"""
() => new Promise((resolve) => {
  let timer; const klaar = () => { obs.disconnect(); resolve(); };
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(klaar, 500); });
  obs.observe(document, { subtree: true, childList: true, attributes: true });
  timer = setTimeout(klaar, 500);
  setTimeout(klaar, 8000);
})
"""

PAGINA_HOOGTE_JS = r"""
() => Math.max(document.documentElement ? document.documentElement.scrollHeight : 0,
               document.body ? document.body.scrollHeight : 0)
"""

ACTIEF_JS = r"""
() => ({ focus: document.hasFocus(), zichtbaar: document.visibilityState === 'visible' })
"""

# Alles verzamelen: snapshot, elementen, kleuren, info. Draait met het thema UIT.
VERZAMEL_JS = r"""
(opts) => {
  const MAX_EL = opts.maxElementen || 60000;
  const HOSTS = opts.themaHosts || [];
  const ANONIEM = !!opts.anoniem;
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
  const SKIP = new Set(['SCRIPT','NOSCRIPT','TEMPLATE','BASE']);
  const stats = { elementen: 0, shadowRoots: 0, stylesheets: 0, onleesbareCss: [], canvassen: 0, afgekapt: false };

  const isThema = (u) => {
    try { const x = new URL(u, document.baseURI);
      return HOSTS.includes(x.host) || /^\/(alg-thema|__cssthema)\//.test(x.pathname);
    } catch { return false; }
  };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const verberg = (s) => s.replace(/\p{L}/gu, 'x').replace(/\p{N}/gu, '0');
  const tekst = (s) => (ANONIEM ? verberg(s) : s);
  const abs = (css, base) => css.replace(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/g,
    (m, q, u) => { try { return `url("${new URL(u, base).href}")`; } catch { return m; } });

  // ---------- stylesheets (gededupliceerd, Python schrijft ze naar _css/) ----------
  const sheets = []; const sheetIndex = new Map();
  const voegToe = (t) => {
    if (sheetIndex.has(t)) return sheetIndex.get(t);
    sheets.push(t); sheetIndex.set(t, sheets.length - 1); return sheets.length - 1;
  };
  const sheetTekst = (sheet, diepte = 0) => {
    try {
      const base = sheet.href || document.baseURI;
      const delen = [];
      for (const r of sheet.cssRules) {
        if (r instanceof CSSImportRule && r.styleSheet && diepte < 5) {
          const t = sheetTekst(r.styleSheet, diepte + 1);
          if (t !== null) {
            const media = r.media && r.media.mediaText;
            delen.push(media ? `@media ${media} {\n${t}\n}` : t);
            continue;
          }
        }
        delen.push(r.cssText);
      }
      return abs(delen.join('\n'), base);
    } catch { return null; }
  };
  const cssLink = (idx, media) =>
    `<link rel="stylesheet" href="@@CSS:${idx}@@"${media ? ` media="${escAttr(media)}"` : ''}>`;
  const adopted = (root) => (root.adoptedStyleSheets || [])
    .filter((s) => s !== window.__ctGeenOvergang)
    .map((s) => sheetTekst(s)).filter((t) => t !== null)
    .map((t) => { stats.stylesheets++; return cssLink(voegToe(t)); }).join('');

  // ---------- attributen ----------
  const attrs = (el, tag) => {
    let out = '';
    for (const a of el.attributes) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'nonce' || n === 'integrity' || n === 'srcdoc') continue;
      if ((tag === 'input' || tag === 'option') && (n === 'value' || n === 'checked' || n === 'selected')) continue;
      let v = a.value;
      if (/^\s*javascript:/i.test(v)) continue;
      if (/^(src|href|poster|action|data)$/.test(n) && v && !/^(data:|#|blob:)/i.test(v)) {
        try { v = new URL(v, document.baseURI).href; } catch {}
      }
      if (n === 'src' && /^data:/i.test(v) && v.length > 100000) v = '';
      if (v.length > 20000) v = v.slice(0, 20000);
      if (ANONIEM && /^(title|alt|placeholder|aria-label|aria-description)$/.test(n)) v = verberg(v);
      out += ` ${a.name}="${escAttr(v)}"`;
    }
    return out;
  };

  // ---------- serialiseren ----------
  const ser = (node) => {
    if (stats.elementen > MAX_EL) { stats.afgekapt = true; return ''; }
    if (node.nodeType === Node.TEXT_NODE) {
      const p = node.parentNode;
      if (p && p.nodeName === 'STYLE') return node.data;
      if (p && p.nodeName === 'TEXTAREA') return esc(node.data.replace(/\S/g, 'x'));
      return esc(tekst(node.data));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    if (SKIP.has(el.tagName)) return '';
    const tag = el.tagName.toLowerCase();

    if (tag === 'link') {
      const rel = (el.rel || '').toLowerCase();
      if (isThema(el.href)) return '';
      if (/stylesheet/.test(rel)) {
        if (el.disabled) return '';
        const t = el.sheet ? sheetTekst(el.sheet) : null;
        if (t === null) { if (el.href) stats.onleesbareCss.push(el.href); return el.href ? `<link rel="stylesheet" href="${escAttr(el.href)}">` : ''; }
        stats.stylesheets++;
        return cssLink(voegToe(t), el.media && el.media.mediaText);
      }
      if (!/icon/.test(rel)) return '';   // preload, manifest, ... niet nodig
    }
    if (tag === 'meta') {
      const n = ((el.getAttribute('name') || '') + ' ' + (el.getAttribute('http-equiv') || '')).toLowerCase();
      if (/csrf|token|nonce|content-security-policy|xsrf/.test(n)) return '';
    }
    if (tag === 'style') {
      const t = el.sheet ? sheetTekst(el.sheet) : el.textContent;   // CSS-in-JS staat niet altijd in textContent
      if (t === null) return '';
      stats.stylesheets++;
      return cssLink(voegToe(t), el.media);
    }
    if (tag === 'canvas') {
      if (el.id === 'alg-netwerk') return '';
      stats.canvassen++;
      let src = '';
      try { src = el.toDataURL('image/jpeg', 0.6); } catch {}
      const style = escAttr(el.getAttribute('style') || '');
      const cls = escAttr(el.getAttribute('class') || '');
      if (!src || src.length > 400000) return `<div data-ct-canvas="1" class="${cls}" style="${style};width:${el.clientWidth}px;height:${el.clientHeight}px;background:#888"></div>`;
      return `<img data-ct-canvas="1" src="${src}" width="${el.width}" height="${el.height}" class="${cls}" style="${style}">`;
    }
    stats.elementen++;

    let extra = '';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') { if (el.checked) extra = ' checked'; }
      else if (t === 'submit' || t === 'button' || t === 'reset') { if (el.value) extra = ` value="${escAttr(tekst(el.value))}"`; }
      else if (t !== 'password' && t !== 'hidden' && t !== 'file' && el.value) extra = ` value="${escAttr(el.value.replace(/\S/g, 'x'))}"`;
    }
    if (tag === 'option') {
      if (el.selected) extra = ' selected';
    }

    let inner = '';
    if (el.shadowRoot) {
      stats.shadowRoots++;
      inner += `<template shadowrootmode="open">${adopted(el.shadowRoot)}${Array.from(el.shadowRoot.childNodes, ser).join('')}</template>`;
    }
    if (tag === 'iframe') return `<iframe${attrs(el, tag)}></iframe>`;
    inner += Array.from(el.childNodes, ser).join('');
    if (VOID.has(tag)) return `<${tag}${attrs(el, tag)}${extra}>`;
    return `<${tag}${attrs(el, tag)}${extra}>${inner}</${tag}>`;
  };

  let snapshot = '<!DOCTYPE html>' + ser(document.documentElement);
  const docAdopted = adopted(document);
  snapshot = snapshot.includes('</head>') ? snapshot.replace('</head>', docAdopted + '</head>') : snapshot + docAdopted;

  // ---------- alle elementen (ook in open shadow roots) ----------
  const alle = []; const shadowHosts = {};
  const loop = (root, keten) => {
    const kids = root.children || [];
    for (const el of kids) {
      if (alle.length >= MAX_EL) return;
      alle.push([el, keten]);
      if (el.shadowRoot) {
        const t = el.tagName.toLowerCase();
        shadowHosts[t] = (shadowHosts[t] || 0) + 1;
        loop(el.shadowRoot, keten.concat(t));
      }
      loop(el, keten);
    }
  };
  loop(document, []);

  const zichtbaar = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const kort = (s, n = 120) => (s && s.length > n ? s.slice(0, n) + '…' : s);
  const selector = (el) => {
    const delen = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) {
      const t = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}/.test(e.id)) { delen.unshift(`${t}#${CSS.escape(e.id)}`); break; }
      const k = [...e.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      delen.unshift(t + k);
    }
    return delen.join(' > ');
  };
  const sleutel = (el) => {
    const t = el.tagName.toLowerCase();
    let k = t + [...el.classList].slice(0, 6).map((c) => '.' + c).join('');
    const role = el.getAttribute('role'); if (role) k += `[role=${role}]`;
    if (t === 'input') k += `[type=${(el.type || 'text').toLowerCase()}]`;
    return k;
  };
  const categorie = (el) => {
    const t = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const c = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    if (t === 'button' || role === 'button' || (t === 'input' && /^(button|submit|reset)$/.test(el.type)) || /(^|[\s_-])(btn|button)/.test(c)) return 'knop';
    if (/^(input|select|textarea)$/.test(t) || el.isContentEditable || /^(textbox|combobox|switch|checkbox|radio|slider|searchbox|spinbutton|listbox|option)$/.test(role)) return 'invoer';
    if (t === 'dialog' || /dialog/.test(role) || /modal|dialog|popup|popover|tooltip|dropdown|overlay/.test(c)) return 'dialoog';
    if (/^(table|thead|tbody|tfoot|tr|th|td|caption)$/.test(t) || /^(grid|row|cell|columnheader|rowheader|gridcell|table|treegrid)$/.test(role) || /datagrid|grid-row|table/.test(c)) return 'tabel';
    if (/^(nav|header|aside|footer)$/.test(t) || /^(navigation|menubar|menu|menuitem|tab|tablist|tree|treeitem|banner)$/.test(role) || /nav|menu|sidebar|sidenav|drawer|tab|breadcrumb|toolbar|topbar|header/.test(c)) return 'navigatie';
    if (/^h[1-6]$/.test(t) || /title|heading/.test(c)) return 'kop';
    if (/^(alert|status|alertdialog)$/.test(role) || /alert|toast|notif|snackbar|message|callout|banner/.test(c)) return 'melding';
    if (/badge|chip|pill|tag|label|status|indicator/.test(c)) return 'badge';
    if (/card|panel|box|tile|widget|paper|container|section|well/.test(c) || t === 'section' || t === 'fieldset') return 'kaart';
    if (t === 'a') return 'link';
    if (t === 'label' || t === 'legend') return 'invoer';
    return 'overig';
  };
  const stijl = (cs) => ({
    kleur: cs.color,
    achtergrond: cs.backgroundColor,
    achtergrondbeeld: cs.backgroundImage !== 'none' ? kort(cs.backgroundImage, 160) : '',
    rand: parseFloat(cs.borderTopWidth) > 0 ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : '',
    radius: cs.borderRadius !== '0px' ? cs.borderRadius : '',
    font: kort(cs.fontFamily, 80),
    grootte: cs.fontSize,
    gewicht: cs.fontWeight,
    padding: cs.padding !== '0px' ? cs.padding : '',
    schaduw: cs.boxShadow !== 'none' ? kort(cs.boxShadow, 120) : '',
    opaciteit: cs.opacity !== '1' ? cs.opacity : '',
  });

  const groepen = new Map();
  const kleur = { achtergrond: new Map(), tekst: new Map(), rand: new Map() };
  const telKleur = (m, v, k) => {
    let e = m.get(v); if (!e) { e = { aantal: 0, voorbeelden: [] }; m.set(v, e); }
    e.aantal++; if (e.voorbeelden.length < 3 && !e.voorbeelden.includes(k)) e.voorbeelden.push(k);
  };
  let wachtwoordveld = false;
  for (const [el, keten] of alle) {
    let cs; try { cs = getComputedStyle(el); } catch { continue; }
    if (!zichtbaar(el, cs)) continue;
    const k = sleutel(el);
    if (el.tagName === 'INPUT' && el.type === 'password') wachtwoordveld = true;
    let g = groepen.get(k);
    if (!g) {
      const r = el.getBoundingClientRect();
      const txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
      g = {
        sleutel: k, categorie: categorie(el), aantal: 0, selector: selector(el),
        shadow: keten.join(' > '), tekst: kort(tekst(el.tagName === 'INPUT' ? '' : txt), 40),
        maat: `${Math.round(r.width)}x${Math.round(r.height)}`, stijl: stijl(cs),
      };
      groepen.set(k, g);
    }
    g.aantal++;
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') telKleur(kleur.achtergrond, cs.backgroundColor, k);
    const heeftTekst = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    if (heeftTekst) telKleur(kleur.tekst, cs.color, k);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') telKleur(kleur.rand, cs.borderTopColor, k);
  }
  const PER_CAT = { overig: 150 };
  const perCat = {};
  for (const g of groepen.values()) (perCat[g.categorie] = perCat[g.categorie] || []).push(g);
  const elementen = [];
  for (const [cat, lijst] of Object.entries(perCat)) {
    lijst.sort((a, b) => b.aantal - a.aantal);
    elementen.push(...lijst.slice(0, PER_CAT[cat] || 80));
  }
  const topKleuren = (m) => [...m.entries()].sort((a, b) => b[1].aantal - a[1].aantal).slice(0, 40)
    .map(([waarde, e]) => ({ waarde, aantal: e.aantal, voorbeelden: e.voorbeelden }));

  // ---------- CSS-variabelen op :root/html/body/:host ----------
  const varNamen = new Set();
  const scanRegels = (rules, diepte) => {
    if (!rules || diepte > 4) return;
    for (const r of rules) {
      if (r.style && r.selectorText && /(^|,|\s)(:root|html|body|:host)\b/.test(r.selectorText)) {
        for (const p of r.style) if (p.startsWith('--')) varNamen.add(p);
      }
      if (r.cssRules) scanRegels(r.cssRules, diepte + 1);
    }
  };
  for (const s of document.styleSheets) { try { scanRegels(s.cssRules, 0); } catch {} }
  for (const s of document.adoptedStyleSheets || []) { try { scanRegels(s.cssRules, 0); } catch {} }
  const rootCs = getComputedStyle(document.documentElement);
  for (let i = 0; i < rootCs.length; i++) if (rootCs[i].startsWith('--')) varNamen.add(rootCs[i]);
  const bodyCs = document.body ? getComputedStyle(document.body) : rootCs;
  const variabelen = {};
  for (const n of [...varNamen].sort().slice(0, 2500)) {
    const v = (bodyCs.getPropertyValue(n) || rootCs.getPropertyValue(n)).trim();
    variabelen[n] = kort(v, 300);
  }

  // ---------- frameworks ----------
  const fw = [];
  const q = (s) => { try { return document.querySelector(s); } catch { return null; } };
  const rv = (n) => rootCs.getPropertyValue(n).trim();
  if (window.Ext || q('.x-body, .x-viewport')) fw.push('extjs');
  if (rv('--bs-body-bg') || rv('--bs-primary') || q('.btn.btn-primary, .navbar-expand, .navbar-expand-lg, .form-control, .container-fluid')) fw.push('bootstrap');
  if (rv('--tblr-body-bg') || rv('--tblr-primary')) fw.push('tabler');
  if (q('.app-wrapper, .main-sidebar, .content-wrapper')) fw.push('adminlte');
  if (q('[class*="Mui"]')) fw.push('mui');
  if (q('[class*="mat-mdc-"], .mat-toolbar, .mat-drawer, .mat-sidenav')) fw.push('angular-material');
  if (q('[ng-version]')) fw.push('angular');
  if (q('.v-application, .v-app-bar')) fw.push('vuetify');
  if (q('.q-layout, .q-page, .q-btn')) fw.push('quasar');
  if (q('[class*=" el-"], [class^="el-"]')) fw.push('element');
  if (q('[class*=" ant-"], [class^="ant-"]')) fw.push('antd');
  if (q('[class*="pf-c-"], [class*="pf-v5-"], [class*="pf-v6-"], [class*="pf-m-"]')) fw.push('patternfly');
  if (q('.ui.menu, .ui.button, .ui.segment, .ui.form')) fw.push('semantic');
  if (q('.navbar.is-dark, .button.is-primary, .columns > .column, .is-size-1')) fw.push('bulma');
  if (q('[data-v-app]') || window.__VUE__) fw.push('vue');
  if (window.React || q('[data-reactroot]') || (document.getElementById('root') && Object.keys(document.getElementById('root')).some((k) => k.startsWith('__react')))) fw.push('react');
  if (q('[class*="svelte-"]')) fw.push('svelte');
  if (rv('--tw-ring-color') || rv('--tw-shadow')) fw.push('tailwind');
  if (q('[class*="chakra-"]')) fw.push('chakra');
  if (q('[class*="mantine-"]')) fw.push('mantine');
  if (Object.keys(shadowHosts).length) fw.push('shadow-dom');

  const fonts = [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')))].slice(0, 30);
  const de = document.documentElement;
  const info = {
    titel: document.title,
    url: location.href,
    taal: de.lang || '',
    frameworks: fw,
    inlogpagina: wachtwoordveld,
    html: { klassen: kort(de.className && de.className.baseVal === undefined ? de.className : '', 300), kleurschema: rootCs.colorScheme,
            achtergrond: rootCs.backgroundColor, achtergrondbeeld: kort(rootCs.backgroundImage, 200), kleur: rootCs.color, font: kort(rootCs.fontFamily, 120) },
    body: document.body ? { klassen: kort(typeof document.body.className === 'string' ? document.body.className : '', 300), achtergrond: bodyCs.backgroundColor,
            achtergrondbeeld: kort(bodyCs.backgroundImage, 200), kleur: bodyCs.color, font: kort(bodyCs.fontFamily, 120), grootte: bodyCs.fontSize } : null,
    variabelen,
    shadow_hosts: shadowHosts,
    iframes: [...document.querySelectorAll('iframe')].slice(0, 20).map((f) => f.src || '(srcdoc)'),
    fonts,
    aantal_elementen: alle.length,
  };
  return {
    snapshot, sheets, info, stats, elementen,
    kleuren: { achtergrond: topKleuren(kleur.achtergrond), tekst: topKleuren(kleur.tekst), rand: topKleuren(kleur.rand) },
  };
}
"""

# ---------------------------------------------------------------------------------------
# Diensten ophalen
# ---------------------------------------------------------------------------------------

THEMA_LINK_RE = re.compile(r"""(?:href|src)=\\?["']([^"'\\]+?\.(?:css|js))\\?["']""")


def _http_json(url: str, data: dict[str, Any] | None = None, token: str | None = None) -> Any:
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def npm_diensten(npm_url: str, gebruiker: str | None) -> list[dict[str, Any]]:
    """Alle ingeschakelde proxy hosts uit Nginx Proxy Manager (via de NPM-api)."""
    base = npm_url.rstrip("/")
    gebruiker = gebruiker or os.environ.get("NPM_GEBRUIKER") or input("NPM e-mailadres: ").strip()
    wachtwoord = os.environ.get("NPM_WACHTWOORD") or getpass.getpass("NPM wachtwoord (wordt niet bewaard): ")
    try:
        tok = _http_json(f"{base}/api/tokens", {"identity": gebruiker, "secret": wachtwoord})
    except urllib.error.HTTPError as e:
        sys.exit(f"Inloggen bij NPM mislukt ({e.code}). Klopt het adres ({base}) en je wachtwoord?")
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"NPM niet bereikbaar op {base}: {e}. Gebruik het adres van de NPM-beheerpagina, bv. http://192.168.1.10:81")
    if isinstance(tok, dict) and tok.get("requires_2fa"):
        tok = npm_2fa(base, tok.get("challenge_token", ""))
    token = tok.get("token") if isinstance(tok, dict) else None
    if not token:
        sys.exit("NPM gaf geen token terug. Gebruik dan --lijst met een bestand vol URL's.")
    hosts = _http_json(f"{base}/api/nginx/proxy-hosts", token=token)
    diensten = []
    for h in hosts:
        if not h.get("enabled", True):
            continue
        domeinen = [d for d in h.get("domain_names", []) if "*" not in d]
        if not domeinen:
            continue
        schema = "https" if h.get("certificate_id") else "http"
        adv = h.get("advanced_config") or ""
        # Alleen wat we nodig hebben: de ruwe Advanced-config kan geheimen bevatten.
        links = sorted(set(THEMA_LINK_RE.findall(adv))) if "sub_filter" in adv else []
        diensten.append({
            "naam": domeinen[0],
            "url": f"{schema}://{domeinen[0]}/",
            "domeinen": domeinen,
            "authentik": "goauthentik" in adv,
            "thema_links": links,
        })
    diensten.sort(key=lambda d: d["naam"])
    return diensten


def npm_2fa(base: str, challenge: str) -> Any:
    """Tweestapsverificatie van NPM: de code uit je authenticator-app (of een herstelcode)."""
    for poging in range(3):
        code = (os.environ.get("NPM_CODE") if poging == 0 else None) or input("NPM-code uit je authenticator-app: ")
        code = code.strip().replace(" ", "")
        try:
            return _http_json(f"{base}/api/tokens/2fa", {"challenge_token": challenge, "code": code})
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403) and poging < 2:
                print("Die code klopt niet (of is verlopen). Probeer de volgende.")
                continue
            sys.exit(f"Tweestapsverificatie bij NPM mislukt ({e.code}).")
    sys.exit("Tweestapsverificatie bij NPM mislukt.")


def lijst_diensten(pad: Path) -> list[dict[str, Any]]:
    diensten = []
    for regel in pad.read_text(encoding="utf-8").splitlines():
        regel = regel.split("#", 1)[0].strip()
        if not regel:
            continue
        if "://" not in regel:
            regel = "https://" + regel
        host = urlsplit(regel).netloc
        diensten.append({"naam": host, "url": regel, "domeinen": [host], "authentik": False, "thema_links": []})
    return diensten


def diensten_laden(args: argparse.Namespace) -> list[dict[str, Any]]:
    cache = args.map / "diensten.json"
    if args.npm:
        diensten = npm_diensten(args.npm, args.npm_gebruiker)
    elif args.lijst:
        diensten = lijst_diensten(args.lijst)
    elif cache.exists():
        diensten = json.loads(cache.read_text(encoding="utf-8"))
    else:
        sys.exit("Geef --npm http://IP-VAN-NPM:81 of --lijst diensten.txt (één URL per regel).")
    cache.write_text(json.dumps(diensten, indent=2, ensure_ascii=False), encoding="utf-8")
    alleen = [p.strip().lower() for p in (args.alleen or "").split(",") if p.strip()]
    overslaan = [p.strip().lower() for p in (args.overslaan or "").split(",") if p.strip()]
    gekozen = [
        d for d in diensten
        if (not alleen or any(p in d["naam"].lower() for p in alleen))
        and not any(p in d["naam"].lower() for p in overslaan)
    ]
    print(f"{len(gekozen)} diensten (van {len(diensten)} in diensten.json)")
    return gekozen


def thema_hosts(diensten: list[dict[str, Any]], extra: list[str]) -> list[str]:
    hosts = set(extra)
    for d in diensten:
        for link in d.get("thema_links", []):
            if "://" in link:
                hosts.add(urlsplit(link).netloc)
    return sorted(h for h in hosts if h)


# ---------------------------------------------------------------------------------------
# Browser
# ---------------------------------------------------------------------------------------


async def browser_starten(pw: Any, args: argparse.Namespace, headless: bool) -> BrowserContext:
    args.profiel.mkdir(parents=True, exist_ok=True)
    try:
        return await pw.chromium.launch_persistent_context(
            str(args.profiel),
            channel="chromium",
            headless=headless,
            viewport=DESKTOP,
            locale="en-US",
            color_scheme="dark" if args.kleurschema == "donker" else "light",
            ignore_https_errors=True,
            service_workers="block",
        )
    except PlaywrightError as e:
        if not headless and ("display" in str(e).lower() or "xserver" in str(e).lower()):
            sys.exit("Deze stap opent een browservenster: start hem op een computer met scherm.")
        if "Executable doesn't exist" in str(e):
            sys.exit("Chromium ontbreekt: python -m playwright install chromium")
        raise


def diensten_pagina(map_: Path, diensten: list[dict[str, Any]]) -> Path:
    rijen = "\n".join(
        f'<li><a href="{html.escape(d["url"])}" target="_blank">{html.escape(d["naam"])}</a>'
        + (' <span>Authentik</span>' if d.get("authentik") else "")
        + "</li>"
        for d in diensten
    )
    pad = map_ / "diensten.html"
    pad.write_text(
        "<!doctype html><meta charset=utf-8><title>Diensten</title>"
        "<style>body{font:15px system-ui;background:#1b1b1b;color:#ddd;margin:2rem}"
        "a{color:#9cf}li{margin:.3rem 0}span{font-size:12px;color:#999;border:1px solid #555;"
        "border-radius:4px;padding:0 4px}</style>"
        "<h1>Diensten</h1><p>Open een dienst, log in waar nodig (Authentik en de eigen login van de app), "
        "en sluit het tabblad. Log niet in op wachtwoordkluizen. Klaar? Sluit de browser of druk Enter in de terminal.</p>"
        f"<ol>{rijen}</ol>",
        encoding="utf-8",
    )
    return pad


async def wacht_op_enter_of_sluiten(ctx: BrowserContext, vraag: str) -> str | None:
    """Enter-tekst uit de terminal, of None als de browser gesloten werd."""
    loop = asyncio.get_running_loop()
    klaar: asyncio.Future[str | None] = loop.create_future()

    def lees() -> None:
        try:
            t = input(vraag)
        except EOFError:
            t = "q"
        loop.call_soon_threadsafe(lambda: klaar.done() or klaar.set_result(t))

    threading.Thread(target=lees, daemon=True).start()
    ctx.on("close", lambda *_: klaar.done() or klaar.set_result(None))
    return await klaar


async def wacht_rustig(page: Page) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=10_000)
    except PlaywrightTimeout:
        pass
    try:
        await page.evaluate(DOM_RUSTIG_JS)
    except PlaywrightError:
        pass
    await page.wait_for_timeout(500)


async def screenshot(page: Page, pad: Path) -> None:
    try:
        hoogte = await page.evaluate(PAGINA_HOOGTE_JS)
    except PlaywrightError:
        hoogte = 0
    vp = page.viewport_size or DESKTOP
    if hoogte > MAX_HOOGTE:
        await page.screenshot(path=str(pad), type="jpeg", quality=JPEG_KWALITEIT, full_page=True,
                              clip={"x": 0, "y": 0, "width": vp["width"], "height": MAX_HOOGTE})
    else:
        await page.screenshot(path=str(pad), type="jpeg", quality=JPEG_KWALITEIT, full_page=True)


def slug(tekst: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", tekst.lower()).strip("-")
    return s[:60] or "start"


def is_authentik_login(url: str) -> bool:
    """Doorgestuurd naar de login van Authentik (forward auth)?"""
    return "outpost.goauthentik.io" in url or "/if/flow/" in urlsplit(url).path


# ---------------------------------------------------------------------------------------
# Eén pagina vastleggen
# ---------------------------------------------------------------------------------------


async def pagina_vastleggen(
    page: Page, doel: Path, uit: Path, hosts: list[str], args: argparse.Namespace,
    csp_fouten: list[str], extra_info: dict[str, Any],
) -> dict[str, Any]:
    """Legt de huidige toestand van `page` vast in `doel` (zonder te herladen)."""
    doel.mkdir(parents=True, exist_ok=True)
    thema = await page.evaluate(THEMA_STATUS_JS, {"hosts": hosts})
    heeft_thema = bool(thema["links"] or thema["scripts"])
    if heeft_thema:
        await screenshot(page, doel / "met-thema.jpg")

    await page.evaluate(THEMA_SCHAKELAAR_JS, {"hosts": hosts, "aan": False})
    await page.wait_for_timeout(700)
    data = await page.evaluate(VERZAMEL_JS, {"themaHosts": hosts, "anoniem": args.anoniem})
    await screenshot(page, doel / "origineel.jpg")
    await page.evaluate(THEMA_SCHAKELAAR_JS, {"hosts": hosts, "aan": True})

    # CSS naar _css/<hash>.css; de snapshot linkt ernaar.
    css_map = uit / "_css"
    css_map.mkdir(parents=True, exist_ok=True)
    namen = []
    for tekst in data["sheets"]:
        h = hashlib.sha256(tekst.encode("utf-8", "replace")).hexdigest()[:16]
        bestand = css_map / f"{h}.css"
        if not bestand.exists():
            bestand.write_text(tekst, encoding="utf-8", errors="replace")
        namen.append(f"{h}.css")
    diepte = len(doel.relative_to(uit).parts)
    prefix = "../" * diepte + "_css/"
    snapshot = re.sub(r"@@CSS:(\d+)@@", lambda m: prefix + namen[int(m.group(1))], data["snapshot"])
    (doel / "snapshot.html").write_text(snapshot, encoding="utf-8", errors="replace")
    (doel / "css.json").write_text(json.dumps(sorted(set(namen))), encoding="utf-8")
    (doel / "elementen.json").write_text(json.dumps(data["elementen"], indent=1, ensure_ascii=False), encoding="utf-8")
    (doel / "kleuren.json").write_text(json.dumps(data["kleuren"], indent=1, ensure_ascii=False), encoding="utf-8")

    vp = page.viewport_size or DESKTOP
    try:
        await page.set_viewport_size(MOBIEL)
        await page.wait_for_timeout(1000)
        await screenshot(page, doel / "mobiel.jpg")
    finally:
        await page.set_viewport_size(vp)

    info = {
        **data["info"],
        **extra_info,
        "thema": {**thema, "csp_fouten": csp_fouten[:10]},
        "stats": data["stats"],
        "vastgelegd": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (doel / "info.json").write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
    return info


def csp_luisteraar(page: Page) -> list[str]:
    fouten: list[str] = []

    def op_console(msg: Any) -> None:
        t = msg.text
        if "Content Security Policy" in t or "Content-Security-Policy" in t:
            fouten.append(t[:400])

    page.on("console", op_console)
    return fouten


async def dienst_vastleggen(
    ctx: BrowserContext, dienst: dict[str, Any], uit: Path, hosts: list[str],
    args: argparse.Namespace, sem: asyncio.Semaphore,
) -> dict[str, Any]:
    naam = dienst["naam"]
    doel = uit / slug(naam) / "start"
    samenvatting: dict[str, Any] = {"naam": naam, "url": dienst["url"], "map": f"{slug(naam)}/start"}
    if (doel / "info.json").exists() and not args.opnieuw:
        oud = json.loads((doel / "info.json").read_text(encoding="utf-8"))
        return {**samenvatting, "status": oud.get("status", "ok"), "titel": oud.get("titel", ""),
                "frameworks": oud.get("frameworks", []), "thema": oud.get("thema", {}), "overgeslagen": True}
    async with sem:
        page = await ctx.new_page()
        csp = csp_luisteraar(page)
        t0 = time.monotonic()
        try:
            resp = await page.goto(dienst["url"], wait_until="load", timeout=45_000)
            await wacht_rustig(page)
            headers = resp.headers if resp else {}
            http_status = resp.status if resp else None
            ctype = headers.get("content-type", "")
            extra = {
                "dienst": naam,
                "start_url": dienst["url"],
                "http_status": http_status,
                "headers": {k: headers[k] for k in ("content-security-policy", "x-frame-options", "server", "x-powered-by", "content-type") if k in headers},
                "npm": {"authentik": dienst.get("authentik", False), "thema_links": dienst.get("thema_links", [])},
            }
            if ctype and "html" not in ctype:
                status = "geen-html"
                doel.mkdir(parents=True, exist_ok=True)
                (doel / "info.json").write_text(json.dumps({**extra, "status": status}, indent=1), encoding="utf-8")
                return {**samenvatting, "status": status, "titel": ctype}
            if is_authentik_login(page.url):
                status = "authentik-login"
                doel.mkdir(parents=True, exist_ok=True)
                await screenshot(page, doel / "origineel.jpg")
                (doel / "info.json").write_text(json.dumps({**extra, "status": status, "url": page.url}, indent=1), encoding="utf-8")
                return {**samenvatting, "status": status, "titel": await page.title()}
            info = await pagina_vastleggen(page, doel, uit, hosts, args, csp, extra)
            status = "inlogpagina" if info.get("inlogpagina") else ("http-" + str(http_status) if http_status and http_status >= 400 else "ok")
            info["status"] = status
            info["duur_s"] = round(time.monotonic() - t0, 1)
            (doel / "info.json").write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
            return {**samenvatting, "status": status, "titel": info.get("titel", ""),
                    "frameworks": info.get("frameworks", []), "thema": info.get("thema", {})}
        except Exception as e:  # noqa: BLE001 - één kapotte dienst mag de rest niet stoppen
            doel.mkdir(parents=True, exist_ok=True)
            fout = f"{type(e).__name__}: {str(e).splitlines()[0][:300] if str(e) else ''}"
            (doel / "info.json").write_text(json.dumps({"dienst": naam, "status": "fout", "fout": fout}, indent=1), encoding="utf-8")
            return {**samenvatting, "status": "fout", "fout": fout}
        finally:
            await page.close()


# ---------------------------------------------------------------------------------------
# Overzicht en zips
# ---------------------------------------------------------------------------------------


def overzicht_schrijven(uit: Path, resultaten: list[dict[str, Any]]) -> None:
    oud: dict[str, Any] = {}
    pad = uit / "overzicht.json"
    if pad.exists():
        for r in json.loads(pad.read_text(encoding="utf-8")):
            oud[r["naam"]] = r
    for r in resultaten:
        oud[r["naam"]] = r
    alles = sorted(oud.values(), key=lambda r: r["naam"])
    pad.write_text(json.dumps(alles, indent=1, ensure_ascii=False), encoding="utf-8")

    def rij(r: dict[str, Any]) -> str:
        m = r.get("map", "")
        thema = r.get("thema") or {}
        geladen = [link for link in thema.get("links", []) if link.get("geladen")]
        thema_txt = ("ja" if geladen else ("geblokkeerd" if thema.get("links") else "-"))
        if thema.get("csp_fouten"):
            thema_txt += " (CSP)"
        img = f'<a href="{m}/origineel.jpg"><img src="{m}/origineel.jpg" loading="lazy"></a>' if (uit / m / "origineel.jpg").exists() else ""
        img2 = f'<a href="{m}/met-thema.jpg"><img src="{m}/met-thema.jpg" loading="lazy"></a>' if (uit / m / "met-thema.jpg").exists() else ""
        snap = f'<a href="{m}/snapshot.html">snapshot</a>' if (uit / m / "snapshot.html").exists() else ""
        return (f"<tr><td><a href=\"{html.escape(r['url'])}\">{html.escape(r['naam'])}</a><br><small>{html.escape(r.get('titel') or '')}</small></td>"
                f"<td class=s-{html.escape(r['status'])}>{html.escape(r['status'])}<br><small>{html.escape(r.get('fout', ''))}</small></td>"
                f"<td>{html.escape(', '.join(r.get('frameworks') or []))}</td><td>{thema_txt}</td><td>{img}</td><td>{img2}</td><td>{snap}</td></tr>")

    (uit / "overzicht.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Vastgelegde diensten</title><style>"
        "body{font:14px system-ui;background:#1b1b1b;color:#ddd;margin:1.5rem}a{color:#9cf}"
        "table{border-collapse:collapse}td,th{border-bottom:1px solid #333;padding:.4rem;vertical-align:top;text-align:left}"
        "img{width:220px;border:1px solid #444}.s-ok{color:#8d8}.s-fout,.s-authentik-login{color:#f88}.s-inlogpagina{color:#fc6}"
        "small{color:#999}</style><h1>Vastgelegde diensten</h1>"
        f"<p>{len(alles)} diensten. Status <b>authentik-login</b> of <b>inlogpagina</b>: log in met "
        "<code>python vastleggen.py login</code> en draai <code>alles --opnieuw --alleen naam</code>.</p>"
        "<table><tr><th>Dienst</th><th>Status</th><th>Frameworks</th><th>Thema</th><th>Origineel</th><th>Met thema</th><th></th></tr>"
        + "\n".join(rij(r) for r in alles) + "</table>",
        encoding="utf-8",
    )


def inpakken(uit: Path, deelgrootte_mb: int) -> list[Path]:
    """Zip-delen van max. ~deelgrootte_mb; elke dienst met zijn eigen CSS in hetzelfde deel."""
    limiet = deelgrootte_mb * 1024 * 1024
    for oud in uit.parent.glob(f"{uit.name}-deel*.zip"):
        oud.unlink()
    diensten = sorted(p for p in uit.iterdir() if p.is_dir() and p.name != "_css")
    delen: list[Path] = []
    zf: zipfile.ZipFile | None = None
    css_in_deel: set[str] = set()

    def nieuw_deel() -> zipfile.ZipFile:
        nonlocal css_in_deel
        pad = uit.parent / f"{uit.name}-deel{len(delen) + 1}.zip"
        delen.append(pad)
        css_in_deel = set()
        z = zipfile.ZipFile(pad, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6)
        for naam in ("overzicht.html", "overzicht.json"):
            if (uit / naam).exists():
                z.write(uit / naam, f"{uit.name}/{naam}")
        return z

    for d in diensten:
        if zf is None or (zf.fp is not None and zf.fp.tell() > limiet):
            if zf is not None:
                zf.close()
            zf = nieuw_deel()
        for f in sorted(d.rglob("*")):
            if f.is_file():
                zf.write(f, f"{uit.name}/{f.relative_to(uit).as_posix()}")
                if f.name == "css.json":
                    for css in json.loads(f.read_text(encoding="utf-8")):
                        if css not in css_in_deel and (uit / "_css" / css).exists():
                            zf.write(uit / "_css" / css, f"{uit.name}/_css/{css}")
                            css_in_deel.add(css)
    if zf is not None:
        zf.close()
    return delen


# ---------------------------------------------------------------------------------------
# Commando's
# ---------------------------------------------------------------------------------------


async def cmd_login(args: argparse.Namespace) -> None:
    diensten = diensten_laden(args)
    pagina = diensten_pagina(args.map, diensten)
    async with async_playwright() as pw:
        ctx = await browser_starten(pw, args, headless=False)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(pagina.resolve().as_uri())
        print("\nEr staat een browservenster open met al je diensten.")
        print("Log in op Authentik en op de apps met een eigen login. Niet op wachtwoordkluizen.")
        print(f"Je logins blijven in {args.profiel} (deel die map met niemand).")
        await wacht_op_enter_of_sluiten(ctx, "Klaar? Druk Enter (of sluit de browser). ")
        try:
            await ctx.close()
        except PlaywrightError:
            pass
    print("Opgeslagen. Volgende stap: python vastleggen.py alles")


async def cmd_alles(args: argparse.Namespace) -> None:
    diensten = diensten_laden(args)
    hosts = thema_hosts(diensten, args.thema_host or [])
    if hosts:
        print("Thema-host(s): " + ", ".join(hosts))
    args.uit.mkdir(parents=True, exist_ok=True)
    resultaten: list[dict[str, Any]] = []
    sem = asyncio.Semaphore(max(1, args.parallel))
    async with async_playwright() as pw:
        ctx = await browser_starten(pw, args, headless=not args.zichtbaar)
        try:
            taken = [asyncio.ensure_future(dienst_vastleggen(ctx, d, args.uit, hosts, args, sem)) for d in diensten]
            for i, taak in enumerate(asyncio.as_completed(taken), 1):
                r = await taak
                resultaten.append(r)
                extra = r.get("fout", "") or r.get("titel", "")
                print(f"[{i:>3}/{len(diensten)}] {r['status']:<16} {r['naam']}  {extra[:70]}")
                if i % 10 == 0:
                    overzicht_schrijven(args.uit, resultaten)
        finally:
            overzicht_schrijven(args.uit, resultaten)
            await ctx.close()
    tel: dict[str, int] = {}
    for r in resultaten:
        tel[r["status"]] = tel.get(r["status"], 0) + 1
    print("\nKlaar: " + ", ".join(f"{v}x {k}" for k, v in sorted(tel.items())))
    if tel.get("authentik-login") or tel.get("inlogpagina"):
        print("Diensten met 'authentik-login' of 'inlogpagina' zagen alleen een loginscherm.")
        print("  Log in met: python vastleggen.py login")
        print("  en herhaal die: python vastleggen.py alles --opnieuw --alleen naam1,naam2")
    afronden(args)


async def cmd_handmatig(args: argparse.Namespace) -> None:
    diensten = diensten_laden(args) if (args.npm or args.lijst or (args.map / "diensten.json").exists()) else []
    hosts = thema_hosts(diensten, args.thema_host or [])
    args.uit.mkdir(parents=True, exist_ok=True)
    resultaten: list[dict[str, Any]] = []
    async with async_playwright() as pw:
        ctx = await browser_starten(pw, args, headless=False)
        csp: dict[Page, list[str]] = {}

        def nieuwe_pagina(p: Page) -> None:
            csp[p] = csp_luisteraar(p)

        ctx.on("page", nieuwe_pagina)
        for p in ctx.pages:
            nieuwe_pagina(p)
        start = ctx.pages[0] if ctx.pages else await ctx.new_page()
        if diensten:
            await start.goto(diensten_pagina(args.map, diensten).resolve().as_uri())
        print("\nOpen een pagina, zet hem in de toestand die je wil (menu open, dialoog open, ...)")
        print("en druk Enter in deze terminal om het actieve tabblad vast te leggen. q + Enter = stoppen.")
        while True:
            antwoord = await wacht_op_enter_of_sluiten(ctx, "Enter = vastleggen, q = stoppen: ")
            if antwoord is None or antwoord.strip().lower() == "q":
                break
            page = await actief_tabblad(ctx)
            if page is None or page.url.startswith(("about:", "file:", "chrome:")):
                print("  Geen dienst in het actieve tabblad.")
                continue
            deel = urlsplit(page.url)
            naam = deel.netloc
            pad = slug((deel.path + " " + deel.fragment).strip(" /")) or "start"
            doel = args.uit / slug(naam) / pad
            n = 2
            while (doel / "info.json").exists():
                doel = args.uit / slug(naam) / f"{pad}-{n}"
                n += 1
            try:
                info = await pagina_vastleggen(page, doel, args.uit, hosts, args, csp.get(page, []),
                                               {"dienst": naam, "handmatig": True})
                info["status"] = "inlogpagina" if info.get("inlogpagina") else "ok"
                (doel / "info.json").write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
                print(f"  Vastgelegd: {doel.relative_to(args.uit)}  ({info.get('titel', '')[:60]})")
                resultaten.append({"naam": f"{naam} {doel.name}", "url": page.url, "map": doel.relative_to(args.uit).as_posix(),
                                   "status": info["status"], "titel": info.get("titel", ""),
                                   "frameworks": info.get("frameworks", []), "thema": info.get("thema", {})})
            except Exception as e:  # noqa: BLE001
                print(f"  Mislukt: {type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ''}")
        overzicht_schrijven(args.uit, resultaten)
        try:
            await ctx.close()
        except PlaywrightError:
            pass
    afronden(args)


async def actief_tabblad(ctx: BrowserContext) -> Page | None:
    zichtbaar = None
    for p in reversed(ctx.pages):
        try:
            s = await p.evaluate(ACTIEF_JS)
        except PlaywrightError:
            continue
        if s["focus"]:
            return p
        if s["zichtbaar"] and zichtbaar is None:
            zichtbaar = p
    return zichtbaar


def afronden(args: argparse.Namespace) -> None:
    if args.geen_zip:
        return
    delen = inpakken(args.uit, args.deelgrootte)
    print(f"\nResultaat: {args.uit.resolve()}  (open overzicht.html)")
    for d in delen:
        print(f"  {d.name}  {d.stat().st_size / 1024 / 1024:.1f} MB")
    if delen:
        print("Upload de zip-delen in de cssthema-thread.")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Legt de webinterface van al je diensten vast voor een thema per dienst.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Voorbeeld:\n  python vastleggen.py login --npm http://192.168.1.10:81\n  python vastleggen.py alles\n  python vastleggen.py handmatig",
    )
    p.add_argument("commando", choices=["login", "alles", "handmatig", "inpakken"])
    p.add_argument("--npm", help="adres van de NPM-beheerpagina, bv. http://192.168.1.10:81")
    p.add_argument("--npm-gebruiker", help="e-mailadres voor NPM (anders gevraagd)")
    p.add_argument("--lijst", type=Path, help="tekstbestand met één URL per regel (in plaats van --npm)")
    p.add_argument("--alleen", help="alleen diensten waarvan de naam dit bevat (komma-gescheiden)")
    p.add_argument("--overslaan", help="diensten overslaan waarvan de naam dit bevat (komma-gescheiden)")
    p.add_argument("--opnieuw", action="store_true", help="ook diensten die al vastgelegd zijn opnieuw doen")
    p.add_argument("--parallel", type=int, default=3, help="aantal diensten tegelijk (standaard 3)")
    p.add_argument("--thema-host", action="append", help="host van je thema-bestanden, bv. css.jbogaert.be (wordt anders uit NPM gehaald)")
    p.add_argument("--anoniem", action="store_true", help="alle tekst vervangen door xxx (structuur en stijl blijven)")
    p.add_argument("--kleurschema", choices=["licht", "donker"], default="licht", help="prefers-color-scheme van de browser")
    p.add_argument("--zichtbaar", action="store_true", help="'alles' met browservenster (om te kijken wat er gebeurt)")
    p.add_argument("--map", type=Path, default=Path("."), help="werkmap (diensten.json, profiel, resultaat)")
    p.add_argument("--profiel", type=Path, help="browserprofiel met je logins (standaard <map>/cssthema-profiel)")
    p.add_argument("--uit", type=Path, help="resultaatmap (standaard <map>/vastgelegd)")
    p.add_argument("--deelgrootte", type=int, default=DEELGROOTTE_MB, help="max. grootte per zip-deel in MB")
    p.add_argument("--geen-zip", action="store_true", help="geen zip-delen maken")
    args = p.parse_args()
    for stroom in (sys.stdout, sys.stderr):
        try:
            stroom.reconfigure(errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    args.map.mkdir(parents=True, exist_ok=True)
    args.profiel = args.profiel or args.map / "cssthema-profiel"
    args.uit = args.uit or args.map / "vastgelegd"

    if args.commando == "inpakken":
        afronden(args)
        return
    commando = {"login": cmd_login, "alles": cmd_alles, "handmatig": cmd_handmatig}[args.commando]
    try:
        asyncio.run(commando(args))
    except KeyboardInterrupt:
        print("\nGestopt. Wat al klaar was staat in de resultaatmap; 'alles' gaat de volgende keer verder.")


if __name__ == "__main__":
    main()
