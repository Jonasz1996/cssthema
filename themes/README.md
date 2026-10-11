# Thema's van jbogaert.be

Deze map bevat de thema's die cssthema op css.jbogaert.be serveert. Upload ze via het dashboard
(*Import* > *Uploaden*, een zip van de map mag ook); dan staan ze in `/var/lib/cssthema/css-files/`.

| Pad | Wat |
|---|---|
| `algemeen.css`, `algemeen.js` | Het algemene thema (stijl van allow en aiverslag) met de netwerkachtergrond. Werkt op elke app, maar is groot (ca. 460 KB). |
| `apps/alg-<app>.css` | Per-app-aanvullingen; laden na het algemene thema. |
| `modules/alg-*.css` | `algemeen.css` in stukken, zodat een app alleen laadt wat hij nodig heeft (30 tot 130 KB, meestal ca. 50 KB, in plaats van 460 KB). |
| `varianten/alg-var-*.css` | Kleurvarianten (Nord, Dracula, Catppuccin, Gruvbox, Oceaan): alleen de `--alg-*`-tokens. |
| `hosts-modules.conf` | Per host de lichte stapel modules, om te importeren op de pagina *Hosts*. |

## Modules

`algemeen.css` blijft de bron. Pas dat bestand aan en maak de modules opnieuw met
`python scripts/themes/modules.py` (CI controleert met `--check` dat ze bij elkaar horen).

- `alg-kern`: tokens, basis, formulieren, tabellen, hulpklassen. Altijd als eerste.
- `alg-fw-<framework>`: `bootstrap`, `tabler`, `adminlte`, `material`, `vue`, `extjs` of `overig`.
  Tabler en AdminLTE horen bovenop `bootstrap`.
- `alg-app-<app>`: het blok van één app uit `algemeen.css` (bv. `alg-app-nextcloud`).

Volgorde voor een host: `alg-kern`, frameworks, `alg-app-*`, daarna `alg-<app>` uit `apps/`.

## Eén regel voor alle hosts

Op de pagina *Hosts* koppel je per hostnaam welke thema's en scripts hij krijgt; `*` geldt voor
elke host zonder eigen koppeling (zet die op `algemeen` + script `algemeen`). Elke proxy host in
NPM krijgt dan dezelfde regel; de pagina toont hem, en hoe je hem gebruikt staat in
`docs/ops/installatie-debian.md` (§ 4, *Eén regel voor alle hosts*).

`hosts-modules.conf` importeer je op die pagina (*Importeren*). De stapels zijn gecontroleerd
door de vastgelegde pagina's van 62 hosts (`vastgelegd-deel1.zip`) met de modules en met het
volledige `algemeen.css` te renderen: pixel-identiek. Meestal was dat alleen de loginpagina.
Ziet een app er na het inloggen anders uit, zet die host dan terug op `algemeen` + `alg-<app>`,
of voeg de ontbrekende `alg-fw-*` toe.

## Kleurvarianten

Een variant verandert alleen de kleuren (de `--alg-*`-tokens) en laadt als **laatste**. Op de
pagina *Hosts* zet je hem onderaan de lijst van een host, of bij `*` voor alle hosts zonder
eigen koppeling. Bijvoorbeeld `alg-kern`, `alg-fw-bootstrap`, `alg-portainer`, `alg-var-nord`.

De bestanden komen uit `scripts/themes/varianten.py` (pas daar de kleuren aan en draai het
script; CI controleert met `--check`). Het script houdt knoppen en statusvlakken op minstens
4.5:1 contrast. Lettertypes en andere bestanden in een thema: gebruik een absolute URL
(`https://css.jbogaert.be/inter.woff2`), want in `/host/<host>.css` wijst een relatieve URL
naar `/host/`.
