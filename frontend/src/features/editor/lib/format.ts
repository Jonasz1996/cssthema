import { intlLocale, type Locale } from "@/lib/i18n";

/** Aantal bytes van een tekst in UTF-8, zonder hem te coderen (draait bij elke toets). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** `512 B`, `3,4 KB`, `1,2 MB` (1 KB = 1024 B, zoals de limiet van de server). */
export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${bytes} B`;
  const format = (value: number) =>
    value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${format(bytes / 1024)} KB`;
  return `${format(bytes / (1024 * 1024))} MB`;
}

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Kloktijd `12:04:31`. */
export function formatTime(value: string | Date, locale: Locale): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Datum en tijd, kort: `5 okt 2026, 12:04`. */
export function formatDateTime(value: string | Date, locale: Locale): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** Relatief: `2 minuten geleden`, `gisteren`; onder een minuut `zojuist`/`just now`. */
export function formatRelative(
  value: string | Date,
  locale: Locale,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}
