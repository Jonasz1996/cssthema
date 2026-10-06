# UI-componenten (stijl: aiverslag)

Bouwstenen voor alle schermen van cssthema, in de look van
[aiverslag](https://github.com/Jonasz1996/aiverslag): donker, alles monospace, glazen kaarten
met een draaiende rand en een deeltjesnetwerk op de achtergrond. Alleen dark mode.

```tsx
import { Button, Card, PageHeader, Tag, toast } from "@/components/ui";
```

Een levend overzicht van alles hieronder staat in de dev-server op **`/dev/ui`**
(`pnpm dev`; de route bestaat niet in een productie-build).

## Ontwerptokens

Op `:root` in `src/styles/globals.css` als `--ui-*`, in Tailwind beschikbaar als:

| Tailwind                             | Waarde                             | Gebruik                     |
| ------------------------------------ | ---------------------------------- | --------------------------- |
| `text-fg`                            | `#ddd`                             | gewone tekst                |
| `text-heading`                       | `#fff`                             | koppen, nadruk              |
| `text-muted` / `text-dim`            | `#999` / `#777`                    | hints, labels / meta        |
| `bg-btn` / `bg-btn-hover`            | `#7a7a7a` / `#9b9b9b`              | primaire knop               |
| `text-ok` / `text-err` / `text-mid`  | `#8fd6a4` / `#e58b8b` / `#e6b56b`  | status (alleen voor status) |
| `text-code` / `text-term`            | `#d6e6ff` / `#9cffb0`              | code / terminal             |
| `border-line` / `border-line-strong` | wit 8 % / 14 %                     | randen                      |
| `shadow-glow` / `shadow-card`        |                                    | knop-hover / kaart          |
| `font-mono` (= `font-sans`)          | `ui-monospace, "Cascadia Code", …` | alles                       |

z-index: achtergrond 0 · app 1 · dialoog 65 · toasts 66 · effecten 70 · flits 75.
De `--ct-*`-variabelen horen bij de thema's van gebruikers, niet bij deze UI.

## Componenten

### Knoppen — `button.tsx`

- `Button` — `variant`: `primary` (grijs, standaard) · `alt` (glas) · `danger` (glas, rode
  hover) · `mini` (klein, voor rijen en tabs). `size`: `default` · `sm` · `icon`. `tone` (vooral
  voor `mini`): `ok` (groene hover) · `danger` (rode hover). Ripple bij klik (niet bij `mini`,
  uit te zetten met `ripple={false}`, nooit bij reduced motion). `type="button"` is standaard.
  De "aan"-stijl volgt uit `aria-pressed`, `aria-selected` of `aria-current="page"`.
- `ButtonLink` — router-`Link` in knopstijl (standaard `alt`); `active` zet `aria-current="page"`.
- `buttonVariants(...)` — de klassen zelf, voor andere elementen.
- `useRipple(enabled)` — de ripple voor eigen klikbare elementen.

### Kaart — `card.tsx`

- `Card` — glazen kaart met draaiende rand (`<section>`); `tilt` = licht meekantelen met de muis.
- `TerminalBar command="cssthema themes"` — drie bolletjes + `root@jbogaert:~# <command>`;
  `children` komen rechts. `TERMINAL_PROMPT` is de prompt.
- `CardBody` — binnenmarge (smaller onder 520 px).
- `CardTitle` — titel met glanzende `shine`-animatie (`as="h2"` mogelijk).
- `Hint cursor` — grijze toelichting, optioneel met knipperende `Cursor`.
- `PageHeader title hint actions` — standaardkop van een pagina; zet ook `document.title`.

De app-shell rendert al één `Card` met terminalbalk en navigatie: een pagina begint gewoon met
`<PageHeader>` en zet zo nodig het commando met `useShellCommand("cssthema edit proxmox")`
(`src/app/shell-command.ts`).

### Status en lijsten

- `Tag tone` — pil. `default` grijs · `ok` groen · `warn` rode rand ("actie nodig") · `err`
  rood gevuld (fout) · `mid` oranje (gewijzigd / gemiddeld).
- `ItemRow severity title label tags meta actions` — lijstrij met gekleurde linkerrand
  (`default` · `ok` · `mid` · `err`); `children` = toelichting. Geef een `ref` door voor
  `fx.remove(el)`.
- `Category title count meta storageKey` — uitklapbare groep met rand (▸/▾), standaard open.
  `Details summary` — lichte uitklapper zonder rand, standaard dicht. Beide: gecontroleerd met
  `open` + `onOpenChange`, of zelfstandig met `defaultOpen`; `storageKey` bewaart open/dicht.
- `KpiGrid` + `Kpi label value sub tone` — tegels (`tone`: `ok` · `mid` · `bad`), als `<dl>`.
- `Table columns rows rowKey empty caption scroll` — compacte tabel; `null`/`""` → `-`;
  `scroll` begrenst de hoogte (42vh) met een vaste kop.
- `Callout tone title actions` — opvallend blok (samenvatting, oproep tot actie).
- `Empty` — lege toestand · `Loading label` — "Laden…" (standaard) met cursor (`role="status"`).

### Formulieren — `field.tsx`

- `Field label hint error id` — koppelt label, hint en fout automatisch aan het veld erin
  (`id`, `aria-describedby`, `aria-invalid`).
- `Input`, `Textarea`, `Select` — donkere velden; werken ook los van `Field`.
- `Checkbox label` — klein grijs label, het hele label is klikbaar.
- `Label` — los label in hoofdletters.

### Navigatie en overlays

- `Tabs id items value onValueChange label` + `TabPanel id value selected` — tabs als
  mini-knoppen; pijltjes, Home en End (WAI-ARIA tabs-patroon). `tabIds()` geeft de ids.
- `Dialog open onClose title command description footer size initialFocus dismissible` —
  modale kaart met terminalbalk (`size`: `sm` 520 · `md` 760 · `lg` 980). Focus blijft binnen,
  Esc/overlay/✕ sluiten (niet als `dismissible={false}`), focus gaat terug naar de opener, de
  rest van de app is `inert`. Geneste dialogen: Esc sluit alleen de bovenste.
- `ConfirmDialog open title confirmLabel tone busy onConfirm onCancel` — vervangt
  `window.confirm`; focus start op "Annuleren".
- `toast(msg)`, `toast.ok`, `toast.err`, `toast.mid` (optie `duration`, 0 = blijft) — meldingen
  rechtsonder; `<Toaster />` staat al in de app-shell. Hoogstens 5, hover pauzeert. Ze staan in
  vaste `aria-live`-regio's (fouten `assertive`, de rest `polite`); geef een toast geen eigen
  `role`.

### Code — `code.tsx`

- `Pre` — codeblok in lichtblauw · `Code` — inline code.
- `Terminal lines label` — zwart venster met groene tekst; `lines: { text, kind }[]` met
  `kind`: `out` · `cmd` (wit) · `dim` · `ok` · `err`. Scrolt mee, `role="log"`.

## Effecten — `src/lib/fx.ts`

```ts
import { fx } from "@/lib/fx";

await fx.remove(rowElement); // verwijderen: bliksem + flits, dan shake + vonken + zap
fx.publish(buttonElement); // publiceren: vonken + kleine explosie
fx.rollback(buttonElement); // rollback: blauwe vonken
fx.bolt(x, y);
fx.sparkle(x, y);
fx.explode(x, y, k);
fx.flash(color);
fx.shake();
await fx.zap(el);
fx.unzap(el); // als verwijderen toch mislukte
```

Eén canvas `#fx-top` en een flitslaag `#fx-flash` worden bij het eerste effect aangemaakt; de
lus draait alleen zolang er iets beweegt. Bij `prefers-reduced-motion` doet alles niets (en
resolven `zap`/`remove` meteen).

## Achtergrond — `src/lib/particles.ts`

`<BackgroundCanvas mode>` (in de shell): `running` (beweegt), `paused` (stilstaand beeld,
gedimd; standaard op de editorroute zodat Monaco de CPU krijgt) of `off` (schakelaar in de
navigatiebalk, bewaard in `localStorage`, en altijd bij reduced motion). Pauzeert vanzelf als
het tabblad verborgen is.

## Teksten

Alle UI-teksten via `t("<namespace>.<sleutel>")` uit `src/lib/i18n.ts`; de bestanden staan in
`src/locales/{nl,en}/<namespace>.json` (Nederlands is standaard). Meervoud met `tc()` en
sleutels `<basis>_one` / `<basis>_other`.

In een component: `const { t, tc, locale } = useI18n();`. Zo rendert de component opnieuw bij
een taalwissel, zonder remount: focus, ingevulde velden, open dialogen en de editor blijven
staan. De losse `t()` / `tc()` zijn voor code buiten het renderen (event-handlers, `toast(…)`).
