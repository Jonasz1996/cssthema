/** Schaal waarmee een viewport van `width` px in `available` px past (nooit groter dan 1). */
export function previewScale(available: number, width: number): number {
  if (available <= 0 || width <= 0) return 1;
  return Math.min(1, available / width);
}

/**
 * Hoogte van de virtuele viewport. Bij een voorinstelling (desktop/tablet/mobiel) telt vooral
 * de breedte: de iframe vult dan de hele hoogte van het paneel (minstens de nominale hoogte),
 * zodat er na het schalen geen lege ruimte onder de demo blijft. Een eigen maat blijft exact.
 */
export function previewFrameHeight(
  nominal: number,
  availableHeight: number,
  scale: number,
  fill: boolean,
): number {
  if (!fill || availableHeight <= 0 || scale <= 0) return nominal;
  return Math.max(nominal, Math.floor(availableHeight / scale));
}
