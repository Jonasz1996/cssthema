# Aanmelden op het dashboard en accountreset

Standaard heeft het dashboard geen login (`AUTH_MODE=geen`): wie in `TRUSTED_PROXIES` zit, mag alles. Met `AUTH_MODE=lokaal` krijgt het dashboard eigen accounts met een wachtwoord en verplichte MFA (een code uit een authenticator-app zoals Aegis, Google Authenticator, 1Password of Bitwarden). De CSS- en JS-bestanden voor je apps blijven altijd zonder login bereikbaar.

Accounts beheer je op de server met `cssthema-account` (als root, in de cssthema-container).

## Aanzetten

Eerst het eerste account maken, dan de login aanzetten. Zet op de eerste regel je eigen e-mailadres in plaats van het voorbeeld:

```bash
EMAIL=naam@voorbeeld.be
cssthema-account nieuw "$EMAIL"
AUTH_MODE=lokaal bash /opt/cssthema/deploy/debian/install.sh
```

`cssthema-account nieuw` toont een tijdelijk wachtwoord (24 uur geldig). Open daarna het dashboard en meld je aan met je e-mailadres en dat wachtwoord. Je kiest dan meteen een eigen wachtwoord (minstens 10 tekens) en scant een QR-code met je authenticator-app. Vanaf dan vraagt het dashboard bij elke aanmelding je wachtwoord en de code uit de app. Een aanmelding blijft 12 uur geldig.

Weer uitzetten: `AUTH_MODE=geen bash /opt/cssthema/deploy/debian/install.sh`. De accounts blijven bewaard.

## Kan niet inloggen (wachtwoord vergeten, telefoon kwijt)

Op de loginpagina staat de knop **Wachtwoord vergeten of kan niet inloggen?**. Daar vul je je e-mailadres in en toont de pagina het commando dat je systeembeheerder op de server uitvoert, bijvoorbeeld:

```bash
cssthema-account reset naam@voorbeeld.be
```

De pagina stuurt daarvoor niets naar de server: ze zegt dus niet of een e-mailadres een account heeft.

Wat `reset` doet:

- maakt een nieuw tijdelijk wachtwoord (24 uur geldig) en toont het; de beheerder geeft het aan de gebruiker;
- wist de MFA van het account;
- meldt het account overal af (oude sessies werken niet meer);
- heft een tijdelijke blokkering op.

Daarna meldt de gebruiker zich aan met het tijdelijke wachtwoord, kiest een nieuw wachtwoord en stelt MFA opnieuw in, zoals bij een nieuw account.

## Alle commando's

| Commando | Wat |
|---|---|
| `cssthema-account nieuw <e-mail>` | nieuw account met tijdelijk wachtwoord (rol `admin`; `--rol editor` of `--rol viewer` kan ook, maar rollen worden nog niet afgedwongen) |
| `cssthema-account reset <e-mail>` | tijdelijk wachtwoord, MFA gewist, overal afgemeld |
| `cssthema-account lijst` | alle accounts, met rol en of MFA ingesteld is |
| `cssthema-account uitschakelen <e-mail>` | account blokkeren en afmelden |
| `cssthema-account inschakelen <e-mail>` | geblokkeerd account weer toelaten |

## Goed om te weten

- Na 10 foute pogingen (wachtwoord of code) is een account 15 minuten geblokkeerd. De loginpagina zegt dan hetzelfde als bij een fout wachtwoord. `reset` heft de blokkering meteen op.
- Instellingen in `/etc/cssthema/cssthema.env`: `SESSION_HOURS` (standaard 12) en `TEMP_PASSWORD_HOURS` (standaard 24). Daarna `bash /opt/cssthema/deploy/debian/install.sh`.
- De sessiecookie is ondertekend met `SECRET_KEY`. Een nieuwe `SECRET_KEY` meldt iedereen af.
- Open je het dashboard over gewoon http op het LAN, dan gaan wachtwoord en code onversleuteld over je netwerk. Achter NPM met https niet.
- Elke aanmelding, reset en wijziging komt in het auditlog (`audit_logs`, acties `account.*`).
