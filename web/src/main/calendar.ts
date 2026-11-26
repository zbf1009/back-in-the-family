const DAYS_PER_YEAR = 365n;

/** Fictional years use floor division, including signed historical birth days. */
export function dateLabel(decimal: string): string {
  const tick = BigInt(decimal);
  const dayIndex = ((tick % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const year = (tick - dayIndex) / DAYS_PER_YEAR + 1n;
  const day = dayIndex + 1n;
  return `Year ${year}, Day ${day}${day === 1n ? ' — Halloween' : ''}`;
}

/** Exact signed decimal formatting; neither dates nor amounts pass through Number. */
export function formatAmount(decimal: string): string {
  const amount = BigInt(decimal);
  const digits = (amount < 0n ? -amount : amount).toString();
  return `${amount < 0n ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatMoney(decimal: string): string {
  const amount = formatAmount(decimal);
  return amount.startsWith('-') ? `-$${amount.slice(1)}` : `$${amount}`;
}
