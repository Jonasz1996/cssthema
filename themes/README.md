# Thema's van jbogaert.be

Deze map bevat de thema's die cssthema op css.jbogaert.be serveert. Upload ze via het dashboard
(*Import* > *Uploaden*, een zip van de map mag ook); dan staan ze in `/var/lib/cssthema/css-files/`.

| Pad | Wat |
|---|---|
| `algemeen.css`, `algemeen.js` | Het algemene thema (stijl van allow en aiverslag) met de netwerkachtergrond. Werkt op elke app, maar is groot (ca. 460 KB). |
| `apps/alg-<app>.css` | Per-app-aanvullingen; laden na het algemene thema. |
| `modules/alg-*.css` | `algemeen.css` in stukken, zodat een app alleen laadt wat hij nodig heeft (30 tot 130 KB, meestal ca. 50 KB, in plaats van 460 KB). |
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
