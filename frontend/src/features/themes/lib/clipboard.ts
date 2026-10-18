/**
 * Tekst naar het klembord. `navigator.clipboard` werkt alleen in een veilige context (https of
 * localhost); op een LAN-adres over http valt het terug op een tijdelijk tekstveld met
 * `document.execCommand("copy")`. Geeft `false` als beide niet lukken.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (globalThis.isSecureContext !== false && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Geweigerd (geen focus, permissies): probeer de oude manier.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(area);
  // select() alleen zet niet in elke browser de focus; zonder focus kopieert "copy" niets.
  area.focus({ preventScroll: true });
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  active?.focus();
  return ok;
}
