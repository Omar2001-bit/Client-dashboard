export function formatSignedMoney(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}

export function formatSignedNumber(value: number, formatter: Intl.NumberFormat): string {
  return value > 0 ? `+${formatter.format(value)}` : formatter.format(value);
}

export function formatSignedDecimal(value: number): string {
  const formatted = Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

export function formatPlainDecimal(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function toneClass(value: number): string {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-600";
  return "text-ink/60";
}
