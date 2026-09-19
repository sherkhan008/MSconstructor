/**
 * Russian count agreement: 1 полка, 2–4 полки, 5–20 полок, 21 полка…
 * Shelf counts are customer-facing in several places (catalog cards, cart
 * lines), so the rule lives here once instead of a hardcoded "полок" next to
 * every number.
 */
export function shelvesLabel(count: number): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;

  if (abs > 10 && abs < 20) return `${count} полок`;
  if (last === 1) return `${count} полка`;
  if (last >= 2 && last <= 4) return `${count} полки`;
  return `${count} полок`;
}
