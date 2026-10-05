import { intlLocale, type Locale } from "@/lib/i18n";

/**
 * Getallen en tijden in de taal van de UI (`nl-BE` / `en-GB`): bestandsgroottes ("3,4 KB") en
 * relatieve tijden ("5 minuten geleden", "gisteren").
 */

const KB = 1024;
const MB = KB * 1024;

/** `512 B`, `3,4 KB`, `1,2 MB` (KB = 1024 bytes, zoals de limiet van de server). */
export function formatBytes(bytes: number, locale: Locale): string {
  const tag = intlLocale(locale);
  if (!Number.isFinite(bytes) || bytes < KB) {
    return `${Math.max(0, Math.round(bytes || 0)).toLocaleString(tag)} B`;
  }
  const [value, unit] = bytes < MB ? [bytes / KB, "KB"] : [bytes / MB, "MB"];
  return `${value.toLocaleString(tag, { maximumFractionDigits: 1 })} ${unit}`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Relatieve tijd t.o.v. `now`, kort ("nu", "5 min. geleden", "gisteren"): minuten, uren, dagen,
 * en vanaf een week de datum zelf. Toekomstige tijden (klokverschil) tellen als "nu".
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  locale: Locale,
  now: number = Date.now(),
): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto", style: "short" });
  if (seconds < MINUTE) return rtf.format(0, "second");
  if (seconds < HOUR) return rtf.format(-Math.floor(seconds / MINUTE), "minute");
  if (seconds < DAY) return rtf.format(-Math.floor(seconds / HOUR), "hour");
  if (seconds < WEEK) {
    // Kalenderdagen (zodat gisteren 23:00 om 08:00 "gisteren" is, niet "9 uur geleden").
    const days = calendarDaysBetween(time, now);
    return rtf.format(-Math.max(1, days), "day");
  }
  return formatDate(iso, locale);
}

function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / (DAY * 1000));
}

/** Datum ("5 okt 2026"). */
export function formatDate(iso: string | null | undefined, locale: Locale): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(time);
}

/** Datum en tijd voluit, voor een `title` of `<time>` ("5 okt 2026, 12:04"). */
export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
}
