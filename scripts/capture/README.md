# Diensten vastleggen

`vastleggen.py` loopt al je diensten af en bewaart per dienst alles wat nodig is om er een eigen CSS- (en eventueel JS-)thema voor te maken. De lijst van diensten komt uit Nginx Proxy Manager.

Per dienst (map `vastgelegd/<dienst>/start/`):

| bestand | inhoud |
|---|---|
| `snapshot.html` | de gerenderde pagina zonder scripts, ook wat in shadow DOM zit (Home Assistant, Authentik). De CSS staat in `vastgelegd/_css/` |
| `elementen.json` | welke elementen er zijn (tag, klassen, rol), hoe vaak, een selector en hun stijl: kleur, achtergrond, rand, radius, font |
| `kleuren.json` | de meest gebruikte achtergrond-, tekst- en randkleuren |
| `info.json` | titel, frameworks (Bootstrap, ExtJS, Vuetify ...), CSS-variabelen op `:root`, CSP-headers, of `algemeen.css`/`.js` geladen werd |
| `origineel.jpg` | desktop zonder je thema |
| `met-thema.jpg` | desktop met het thema dat NPM nu injecteert |
| `mobiel.jpg` | 390 px breed, met thema |

`vastgelegd/overzicht.html` toont alle diensten met hun status en screenshots.

## Installeren

Op een computer met scherm (Windows, Linux of macOS), met Python 3.9 of nieuwer:

```bash
pip install -U playwright
python -m playwright install chromium
```

Zet `vastleggen.py` in een lege map en open daar een terminal. Op Windows werkt `py` ook waar hier `python` staat.

## 1. Inloggen (eenmalig)

```bash
python vastleggen.py login --npm http://IP-VAN-NPM:81
```

- Het vraagt je NPM-e-mailadres, -wachtwoord en, als je tweestapsverificatie aan hebt, de code uit je authenticator-app. Daarna haalt het alle proxy hosts op. Wachtwoord en code worden niet bewaard; de lijst wel, in `diensten.json`.
- Er opent een browser met al je diensten als links. Log in op Authentik en op de apps met een eigen login (Proxmox, Home Assistant ...). **Niet** op wachtwoordkluizen zoals Vaultwarden.
- Klaar: druk Enter in de terminal of sluit de browser. De logins blijven in de map `cssthema-profiel`. Deel die map met niemand.

## 2. Alles vastleggen

```bash
python vastleggen.py alles
```

Dit draait zonder venster, drie diensten tegelijk. Gestopt (Ctrl+C)? Opnieuw starten gaat verder waar het was. Op het einde staan er zip-delen van maximaal 24 MB naast de map: `vastgelegd-deel1.zip`, `vastgelegd-deel2.zip` ...

Zie je in `overzicht.html` diensten met **authentik-login** of **inlogpagina**? Dan zag het script alleen een loginscherm. Log daar in met stap 1 (zonder `--npm`) en herhaal ze:

```bash
python vastleggen.py login
python vastleggen.py alles --opnieuw --alleen proxmox,homeassistant
```

## 3. Extra pagina's (optioneel)

De startpagina toont niet alles: instellingen, dialogen, open menu's. Leg die met de hand vast:

```bash
python vastleggen.py handmatig
```

Open een pagina in het venster, zet ze zoals je wil (menu open, dialoog open) en druk Enter in de terminal: het actieve tabblad wordt vastgelegd in `vastgelegd/<dienst>/<pad>/`. `q` + Enter stopt en maakt de zips opnieuw.

## 4. Doorsturen

Upload de zip-delen in de cssthema-thread.

## Wat er wel en niet in zit

- Geen cookies, wachtwoorden of tokens: wachtwoordvelden en verborgen velden zijn leeg, CSRF-tokens weg, ingevulde velden vervangen door `xxx`.
- De tekst op de pagina's staat er wel in, net als in de screenshots. Wil je dat niet: `--anoniem` vervangt alle tekst door `xxx`, en de structuur en stijl blijven. Een dienst helemaal overslaan: `--overslaan vaultwarden,bitwarden`.
- Uit NPM komt alleen de lijst: domein, of Authentik ervoor staat, en welke thema-bestanden de `sub_filter` laadt. De rest van je Advanced-config wordt niet bewaard.

## Handige opties

| optie | wat |
|---|---|
| `--alleen a,b` / `--overslaan a,b` | alleen of juist niet de diensten waarvan de naam dat bevat |
| `--opnieuw` | ook diensten die al klaar zijn opnieuw doen |
| `--parallel 5` | meer diensten tegelijk |
| `--zichtbaar` | `alles` met venster, om mee te kijken |
| `--kleurschema donker` | de browser vraagt een donker thema (prefers-color-scheme) |
| `--lijst diensten.txt` | in plaats van NPM: één URL per regel |
| `--thema-host css.jbogaert.be` | als het script je thema-host niet uit NPM haalt |
| `python vastleggen.py inpakken` | alleen de zip-delen opnieuw maken |
