export function findMissingOrderNumbers(orders: { physical_order_no?: string | null }[]): number[] {
  const nums: number[] = [];
  for (const order of orders) {
    if (order.physical_order_no) {
      const n = parseInt(order.physical_order_no, 10);
      if (!isNaN(n)) nums.push(n);
    }
  }
  if (nums.length < 2) return [];
  nums.sort((a, b) => a - b);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const present = new Set(nums);
  const missing: number[] = [];
  for (let i = min; i <= max; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

export function missingOrderNumbersSummary(
  orders: { physical_order_no?: string | null }[],
): string {
  const missing = findMissingOrderNumbers(orders);
  if (missing.length === 0) return "";
  if (missing.length <= 5) return `Missing order numbers: ${missing.join(", ")}`;
  const prefix = missing.slice(0, 5);
  return `Missing order numbers: ${prefix.join(", ")}... (+${missing.length - 5} more)`;
}
