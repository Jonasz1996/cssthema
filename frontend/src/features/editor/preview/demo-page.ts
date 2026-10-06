/**
 * Ingebouwde demo-pagina voor de preview (fase 1 heeft nog geen snapshots van echte apps):
 * een generieke beheer-app met kop, zijbalk, knoppen, meldingen, kaarten, tabel, formulier,
 * tabs, dialoog en login-blok, zodat elk thema iets laat zien.
 *
 * De basisstijl staat volledig in `:where(…)` (specificiteit 0): elke regel uit het thema wint.
 * Hij lijkt op een neutrale, ongethemede app (licht, systeemlettertype). Alle tekst wordt
 * ge-escaped; er staat geen script in (de CSP laat alleen de bridge toe).
 */

export interface DemoTexts {
  brand: string;
  navOverview: string;
  navServices: string;
  navSettings: string;
  search: string;
  sidebarTitle: string;
  menuDashboard: string;
  menuUsers: string;
  menuFiles: string;
  menuLogs: string;
  breadcrumb: string;
  title: string;
  lead: string;
  paletteTitle: string;
  alertInfo: string;
  alertSuccess: string;
  alertWarning: string;
  alertDanger: string;
  buttonPrimary: string;
  buttonSecondary: string;
  buttonDanger: string;
  buttonDisabled: string;
  link: string;
  cardTitle: string;
  cardText: string;
  cardAction: string;
  tableTitle: string;
  colName: string;
  colStatus: string;
  colCpu: string;
  colUpdated: string;
  statusOnline: string;
  statusWarning: string;
  statusOffline: string;
  formTitle: string;
  fieldName: string;
  fieldEmail: string;
  fieldRole: string;
  fieldNotes: string;
  optionAdmin: string;
  optionUser: string;
  checkboxLabel: string;
  radioA: string;
  radioB: string;
  submit: string;
  loginTitle: string;
  loginUser: string;
  loginPassword: string;
  loginButton: string;
  loginForgot: string;
  tabsTitle: string;
  tabOne: string;
  tabTwo: string;
  tabThree: string;
  tabPanel: string;
  dialogTitle: string;
  dialogText: string;
  dialogConfirm: string;
  dialogCancel: string;
  progressLabel: string;
  codeTitle: string;
  footer: string;
}

/** Tekens die in HTML-tekst en attributen veilig moeten. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Palet-tokens die de demo als kleurstalen toont (bestaan ze niet, dan blijft het vlak leeg). */
const SWATCHES = [
  "bg",
  "surface",
  "fg",
  "muted",
  "accent",
  "accent-fg",
  "success",
  "warning",
  "danger",
  "border",
];

/** Neutrale basisstijl met specificiteit 0. */
export const DEMO_BASE_CSS = `
:where(html){color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1f2328;background:#f6f7f9}
:where(body){margin:0}
:where(a){color:#0b62d6}
:where(h1){font-size:1.7rem;margin:.2rem 0 .4rem}
:where(h2){font-size:1.15rem;margin:1.6rem 0 .6rem}
:where(h3){font-size:1rem;margin:0 0 .4rem}
:where(.topbar){display:flex;align-items:center;gap:16px;padding:10px 18px;background:#24292f;color:#fff}
:where(.topbar a){color:#fff;text-decoration:none}
:where(.brand){font-weight:700;margin-right:8px}
:where(.topnav){display:flex;gap:14px;flex-wrap:wrap}
:where(.topnav a[aria-current]){text-decoration:underline;text-underline-offset:6px}
:where(.topbar input){margin-left:auto;max-width:220px}
:where(.layout){display:grid;grid-template-columns:210px minmax(0,1fr);min-height:calc(100vh - 100px)}
:where(.sidebar){background:#fff;border-right:1px solid #d0d7de;padding:14px}
:where(.sidebar-title){font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:#57606a;margin:10px 0 6px}
:where(.menu){list-style:none;margin:0;padding:0}
:where(.menu a){display:block;padding:6px 10px;border-radius:6px;color:inherit;text-decoration:none}
:where(.menu a.active){background:#eaeef2;font-weight:600}
:where(.content){padding:18px 24px 40px;min-width:0}
:where(.breadcrumb){font-size:.85rem;color:#57606a}
:where(.lead){color:#57606a;max-width:62ch}
:where(.palette){display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
:where(.swatch){display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.7rem;color:#57606a}
:where(.swatch i){display:block;width:38px;height:28px;border-radius:6px;border:1px solid rgba(0,0,0,.15)}
:where(.alert){padding:10px 14px;border-radius:8px;border:1px solid;margin:8px 0}
:where(.alert-info){background:#ddf4ff;border-color:#54aeff}
:where(.alert-success){background:#dafbe1;border-color:#4ac26b}
:where(.alert-warning){background:#fff8c5;border-color:#d4a72c}
:where(.alert-danger){background:#ffebe9;border-color:#ff8182}
:where(.buttons){display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0}
:where(button,.btn){font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #d0d7de;background:#f6f8fa;color:#24292f;cursor:pointer}
:where(.btn-primary){background:#1f883d;border-color:#1a7f37;color:#fff}
:where(.btn-danger){color:#cf222e}
:where(button:disabled){opacity:.5;cursor:default}
:where(.cards){display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
:where(.card){background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:14px}
:where(.badge){display:inline-block;font-size:.75rem;padding:1px 8px;border-radius:999px;background:#eaeef2}
:where(.badge-ok){background:#dafbe1;color:#116329}
:where(.badge-warn){background:#fff8c5;color:#7d4e00}
:where(.badge-err){background:#ffebe9;color:#a40e26}
:where(table){width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d7de}
:where(th,td){text-align:left;padding:8px 10px;border-bottom:1px solid #d0d7de}
:where(th){background:#f6f8fa;font-size:.85rem}
:where(.split){display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:start}
:where(form,.login){background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:14px}
:where(label){display:block;font-size:.85rem;margin:8px 0 3px}
:where(input,select,textarea){font:inherit;box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px;background:#fff;color:inherit}
:where(input[type=checkbox],input[type=radio]){width:auto}
:where(.inline){display:flex;gap:14px;align-items:center;flex-wrap:wrap}
:where(.inline label){display:inline-flex;gap:6px;align-items:center;margin:8px 0}
:where([role=tablist]){display:flex;gap:4px;border-bottom:1px solid #d0d7de}
:where([role=tab]){border:0;border-bottom:2px solid transparent;border-radius:0;background:none}
:where([role=tab][aria-selected=true]){border-bottom-color:#fd8c73;font-weight:600}
:where(.tab-panel){padding:12px 2px}
:where(.dialog-stage){position:relative;padding:28px;border-radius:10px;background:rgba(27,31,36,.45)}
:where(.modal){max-width:380px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);overflow:hidden}
:where(.modal header,.modal footer){display:flex;align-items:center;gap:8px;padding:10px 14px}
:where(.modal header){border-bottom:1px solid #d0d7de;justify-content:space-between}
:where(.modal footer){border-top:1px solid #d0d7de;justify-content:flex-end}
:where(.modal p){padding:0 14px}
:where(progress){width:100%}
:where(pre){background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:10px;overflow:auto}
:where(kbd){border:1px solid #d0d7de;border-bottom-width:2px;border-radius:4px;padding:0 5px;font-size:.85em}
:where(.footer){padding:12px 24px;border-top:1px solid #d0d7de;color:#57606a;font-size:.85rem}
@media (max-width:700px){:where(.layout){grid-template-columns:1fr}:where(.sidebar){border-right:0;border-bottom:1px solid #d0d7de}:where(.topbar input){display:none}}
`.trim();

/** De `<body>`-inhoud van de demo-app. */
export function demoBodyHtml(texts: DemoTexts): string {
  const e = (key: keyof DemoTexts) => escapeHtml(texts[key]);
  const swatches = SWATCHES.map(
    (name) =>
      `<span class="swatch"><i style="background:var(--ct-${name},transparent)"></i>${escapeHtml(name)}</span>`,
  ).join("");
  const rows = [
    ["proxmox", "ok", "statusOnline", "12 %", "2 min"],
    ["nextcloud", "warn", "statusWarning", "64 %", "1 u"],
    ["jellyfin", "ok", "statusOnline", "8 %", "3 u"],
    ["grafana", "err", "statusOffline", "–", "1 d"],
  ] as const;
  const tableRows = rows
    .map(
      ([name, tone, status, cpu, updated]) =>
        `<tr><td><a href="#">${name}</a></td><td><span class="badge badge-${tone}">${e(status)}</span></td><td>${cpu}</td><td>${updated}</td></tr>`,
    )
    .join("");
  const cards = ["CPU", "RAM", "Disk"]
    .map(
      (label, index) =>
        `<article class="card"><h3>${label} · ${e("cardTitle")}</h3><p>${e("cardText")}</p>` +
        `<p><span class="badge ${index === 2 ? "badge-warn" : "badge-ok"}">${[32, 61, 87][index]} %</span></p>` +
        `<button type="button" class="btn">${e("cardAction")}</button></article>`,
    )
    .join("");

  return `<div class="app">
<header class="topbar">
<a class="brand" href="#">&#9670; ${e("brand")}</a>
<nav class="topnav" aria-label="${e("brand")}"><a href="#" aria-current="page">${e("navOverview")}</a><a href="#">${e("navServices")}</a><a href="#">${e("navSettings")}</a></nav>
<input type="search" placeholder="${e("search")}" aria-label="${e("search")}">
<button type="button" class="btn btn-icon" aria-label="JB">JB</button>
</header>
<div class="layout">
<aside class="sidebar">
<h2 class="sidebar-title">${e("sidebarTitle")}</h2>
<ul class="menu"><li><a class="active" href="#">${e("menuDashboard")}</a></li><li><a href="#">${e("menuUsers")}</a></li><li><a href="#">${e("menuFiles")}</a></li><li><a href="#">${e("menuLogs")}</a></li></ul>
</aside>
<main class="content">
<nav class="breadcrumb">${e("breadcrumb")}</nav>
<h1>${e("title")}</h1>
<p class="lead">${e("lead")}</p>
<section class="palette" aria-label="${e("paletteTitle")}">${swatches}</section>
<div class="alert alert-info" role="note">${e("alertInfo")}</div>
<div class="alert alert-success" role="note">${e("alertSuccess")}</div>
<div class="alert alert-warning" role="note">${e("alertWarning")}</div>
<div class="alert alert-danger" role="note">${e("alertDanger")}</div>
<div class="buttons">
<button type="button" class="btn btn-primary">${e("buttonPrimary")}</button>
<button type="button" class="btn">${e("buttonSecondary")}</button>
<button type="button" class="btn btn-danger">${e("buttonDanger")}</button>
<button type="button" class="btn" disabled>${e("buttonDisabled")}</button>
<a href="#">${e("link")}</a>
</div>
<div class="cards">${cards}</div>
<h2>${e("tableTitle")}</h2>
<table class="table"><thead><tr><th>${e("colName")}</th><th>${e("colStatus")}</th><th>${e("colCpu")}</th><th>${e("colUpdated")}</th></tr></thead><tbody>${tableRows}</tbody></table>
<div class="split">
<form class="form" action="#">
<h2>${e("formTitle")}</h2>
<label for="demo-name">${e("fieldName")}</label><input id="demo-name" value="Jonas">
<label for="demo-email">${e("fieldEmail")}</label><input id="demo-email" type="email" placeholder="naam@voorbeeld.be">
<label for="demo-role">${e("fieldRole")}</label><select id="demo-role"><option>${e("optionAdmin")}</option><option>${e("optionUser")}</option></select>
<label for="demo-notes">${e("fieldNotes")}</label><textarea id="demo-notes" rows="3"></textarea>
<div class="inline"><label><input type="checkbox" checked> ${e("checkboxLabel")}</label><label><input type="radio" name="demo-r" checked> ${e("radioA")}</label><label><input type="radio" name="demo-r"> ${e("radioB")}</label></div>
<button type="submit" class="btn btn-primary">${e("submit")}</button>
</form>
<div class="login">
<h2>${e("loginTitle")}</h2>
<label for="demo-user">${e("loginUser")}</label><input id="demo-user" autocomplete="off">
<label for="demo-pass">${e("loginPassword")}</label><input id="demo-pass" type="password" value="geheim">
<p><button type="button" class="btn btn-primary">${e("loginButton")}</button> <a href="#">${e("loginForgot")}</a></p>
</div>
</div>
<h2>${e("tabsTitle")}</h2>
<div class="tabs"><div role="tablist" aria-label="${e("tabsTitle")}"><button type="button" role="tab" aria-selected="true">${e("tabOne")}</button><button type="button" role="tab" aria-selected="false">${e("tabTwo")}</button><button type="button" role="tab" aria-selected="false">${e("tabThree")}</button></div>
<div class="tab-panel" role="tabpanel">${e("tabPanel")}</div></div>
<div class="dialog-stage"><div class="modal" role="dialog" aria-label="${e("dialogTitle")}">
<header><h3>${e("dialogTitle")}</h3><button type="button" aria-label="&#215;">&#215;</button></header>
<p>${e("dialogText")}</p>
<footer><button type="button" class="btn">${e("dialogCancel")}</button><button type="button" class="btn btn-primary">${e("dialogConfirm")}</button></footer>
</div></div>
<h2>${e("codeTitle")}</h2>
<label for="demo-progress">${e("progressLabel")}</label><progress id="demo-progress" max="100" value="62">62 %</progress>
<pre><code>.x-panel-header {
  background: var(--ct-surface);
}</code></pre>
<p><kbd>Ctrl</kbd> + <kbd>S</kbd></p>
</main>
</div>
<footer class="footer">${e("footer")}</footer>
</div>`;
}
