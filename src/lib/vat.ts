export const VAT_RATE = 0.175;

export function vatBreakdownFromInclusive(total: number, rate = VAT_RATE) {
  const inclusiveTotal = Math.max(0, Number(total) || 0);
  const net = Math.round((inclusiveTotal / (1 + rate)) * 100) / 100;
  const vat = Math.round((inclusiveTotal - net) * 100) / 100;

  return { net, vat, rate };
}
