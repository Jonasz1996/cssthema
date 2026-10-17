# De regel in alle proxy hosts zetten

`regel.py` zet de regel van cssthema in de *Advanced*-tab van je proxy hosts in Nginx Proxy Manager, via de NPM-api. Zo hoef je hem niet ± 100 keer te plakken. Per host haalt het de oude thema-regels weg en zet het de regel in de plaats. Al de rest van *Advanced* blijft staan: Authentik, je eigen `location`-blokken, commentaar.

Nodig: Python 3.9 of nieuwer, verder niets. Draai het op een machine die de beheerpagina van NPM bereikt, bv. de LXC: `python3 /opt/cssthema/scripts/npm/regel.py ...`.

## Voor je begint

`css.jbogaert.be` wijst al naar cssthema en de koppeling `*` bestaat (stap 4 en 5 van [docs/ops/uitrol.md](../../docs/ops/uitrol.md)):

```bash
curl -sI 'https://css.jbogaert.be/host/*.css'   # 200, content-type: text/css
```

Komt de CSS nog van de oude server, dan laadt elke app na de regel een bestand dat daar niet bestaat: alle thema's weg, terwijl NPM de hosts gewoon *Online* meldt. Het script kijkt dit ook zelf na. Klopt het niet, dan zegt de proefrun dat, en vraagt `--toepassen` of je toch wilt doorgaan.

## Zo ga je te werk

1. **Proefrun.** Die verandert niets in NPM:

   ```bash
   python3 regel.py --npm http://IP-VAN-NPM:81 \
     --basis https://css.jbogaert.be --dashboard cssthema.jbogaert.be \
     --uitsluiten authentik.jbogaert.be,nginx.jbogaert.be,allow.jbogaert.be,aiverslag.jbogaert.be,vaultwarden \
     --hosts-conf oude-links.conf
   ```

   Het script vraagt je NPM-e-mailadres en -wachtwoord, en de code uit je authenticator-app als je tweestapsverificatie aan hebt. Niets daarvan wordt bewaard. Daarna toont het per host wat er verandert (een diff) en een samenvatting: *gewijzigd*, *al goed* en *overgeslagen*, met de reden.

   `--hosts-conf` schrijft in `oude-links.conf` welke thema's en scripts de oude regel per host laadde. Gebruik het alleen in deze stap: bestaat het bestand al, dan stopt het script, zodat dit overzicht van vóór de wijziging blijft.

2. **Oude links bewaren.** Bij de uitrol plakte je in stap 4 al `themes/hosts-modules.conf` bij **Hosts → Importeren**; de andere hosts volgen `*`. `oude-links.conf` is dan alleen naslag: wat elke host vroeger laadde. Plak het dus niet in zijn geheel bij *Importeren*. Dan vervangen de oude links (bv. `proxmox.css`, zonder script) de modules uit `hosts-modules.conf`, want *Bestaande overschrijven* staat standaard aan, en krijgt elke host die nu `*` volgt weer zijn oude thema. Wil je dat voor een paar hosts toch, plak dan alleen hun regels, met *Bestaande overschrijven* uit.

3. **Eén host.** Gebruik dezelfde opties zonder `--hosts-conf`, plus `--host proxmox100.jbogaert.be --toepassen`, en kijk of de app er goed uitziet.

4. **De rest.** Dezelfde opties zonder `--hosts-conf`, plus `--toepassen` (zonder `--host`). Hosts die al goed staan, blijven ongemoeid.

Bij `--toepassen` bewaart het script eerst de huidige *Advanced*-tekst van elke host die verandert in `npm-advanced-backup-<datum>-<tijd>.json`. Alleen jij kan dat bestand lezen; deel het niet, want *Advanced* kan wachtwoorden of tokens bevatten. Na elke host kijkt het of NPM de host nog *Online* meldt. Keurt nginx de nieuwe config af, dan zet het de oude meteen terug en stopt het.

**Terugzetten:**

```bash
python3 regel.py --npm http://IP-VAN-NPM:81 --terugzetten npm-advanced-backup-20261017-201500.json
```

Met `--host <naam>` zet je er één terug. Dit overschrijft *Advanced* van die hosts met de versie uit de back-up.

## Wat het verandert

Weg, alleen op server-niveau (niet binnen een `location`):

- `sub_filter`-regels met links naar je CSS-domein (`--basis`), naar cssthema, naar `/alg-thema/` of met `$host`;
- `sub_filter_once` en `proxy_set_header Accept-Encoding ""`;
- een oude `location ^~ /alg-thema/ { … }`;
- een eerder blok `# cssthema` … `# /cssthema`.

Erbij: de regel uit cssthema (pagina **Hosts**), op de plaats van de eerste oude regel, anders achteraan. Hosts met een `location ^~ /alg-thema/` of met links naar `/alg-thema/` (apps met een strenge CSP) krijgen de variant via het eigen domein, **alleen CSS**. Met `--met-script` krijgen die ook het script; doe dat alleen per app (`--host`) en nooit bij een wachtwoordkluis. Staat de variant met script er al, dan blijft die zo.

## Wat het overslaat

| reden | wat je doet |
|---|---|
| `nooit: domein van --basis`, `nooit: dashboard` | niets: die krijgen de regel nooit |
| `uitgesloten (--uitsluiten)` | niets. `--uitsluiten vault` slaat elke host over waarvan de naam `vault` bevat |
| `uitgeschakeld in NPM`, `offline in NPM` | eerst de host in NPM in orde brengen, dan opnieuw |
| `handmatig nakijken: sub_filter binnen een eigen location /` of `… location / met Authentik` | haal in die `location / { … }` de thema-regels weg (`sub_filter`, `sub_filter_once`, `proxy_set_header Accept-Encoding ""`) en draai het script opnieuw. Alleen als het het oude snippet uit *Import → Scripts* is (zonder Authentik), mag het hele blok weg: dan komt de `location /` van NPM terug, met de Access List |
| `handmatig nakijken: sub_filter met andere links (theme-park.dev)` | een `sub_filter` die niet van cssthema is: zelf beslissen. Zijn het toch oude thema-links (bv. een IP van je oude CSS-server), geef dat domein mee met `--oud-domein 192.168.0.164:18358` |
| `handmatig nakijken: ongewone opmaak …` | zelden: het script is niet zeker dat de regel op server-niveau komt. Zet de oude thema-regels elk op een eigen regel, buiten elke `location`, en draai het opnieuw, of pas *Advanced* met de hand aan |

## Opties

| optie | wat |
|---|---|
| `--npm URL` | adres van de NPM-beheerpagina, bv. `http://192.168.1.10:81` |
| `--npm-gebruiker` | je NPM-e-mailadres (anders gevraagd). Ook via `NPM_GEBRUIKER`, `NPM_WACHTWOORD` en `NPM_CODE`, zoals bij `vastleggen.py` |
| `--basis URL` | `PUBLIC_BASE_URL` van cssthema |
| `--dashboard HOSTS` | `DASHBOARD_HOST` van cssthema (komma's of spaties) |
| `--uitsluiten a,b` | hosts waarvan de naam dat bevat niet aanraken; zet daar dezelfde hosts in als in `EXCLUDED_HOSTS` |
| `--oud-domein a,b` | extra domeinen waarvan links als oude thema-links tellen |
| `--host NAAM` | alleen deze host |
| `--hosts-conf BESTAND` | de oude links per host, als naslag (altijd een nieuw bestand) |
| `--met-script` | ook het script voor apps via het eigen domein |
| `--toepassen` | echt veranderen (anders alleen tonen) |
| `--backup BESTAND` | eigen naam voor de back-up |
| `--terugzetten BESTAND` | een back-up terugzetten |

Het script toont nooit de volledige *Advanced*-tekst: alleen de gewijzigde regels, met één regel ervoor en erna.

Tests: `cd backend && uv run pytest ../scripts/npm -q`.
