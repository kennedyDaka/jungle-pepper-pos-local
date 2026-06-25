type OrderNumberSource = {
  physical_order_no?: string | null;
  created_at?: string | null;
};

export type OrderNumberSequence = {
  date: string;
  index: number;
  start: number;
  end: number;
  count: number;
  numbers: number[];
  missing: number[];
};

export type DailyOrderNumberAudit = {
  date: string;
  sequences: OrderNumberSequence[];
  ignored: string[];
};

const RECEIPT_BOOK_JUMP = 10;

function parseOrderNumber(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function localDateKey(value: string | null | undefined) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sequenceMissing(numbers: number[]) {
  const present = new Set(numbers);
  const start = Math.min(...numbers);
  const end = Math.max(...numbers);
  const missing: number[] = [];
  for (let value = start; value <= end; value += 1) {
    if (!present.has(value)) missing.push(value);
  }
  return missing;
}

function buildSequence(date: string, index: number, numbers: number[]): OrderNumberSequence {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  return {
    date,
    index,
    start: sorted[0],
    end: sorted[sorted.length - 1],
    count: numbers.length,
    numbers: sorted,
    missing: sequenceMissing(sorted),
  };
}

export function analyzeDailyOrderNumbers(
  orders: OrderNumberSource[],
  options: { receiptBookJump?: number } = {},
): DailyOrderNumberAudit[] {
  const jump = options.receiptBookJump ?? RECEIPT_BOOK_JUMP;
  const grouped = new Map<string, number[]>();
  const ignoredByDate = new Map<string, string[]>();

  orders.forEach((order) => {
    const date = localDateKey(order.created_at);
    const raw = String(order.physical_order_no ?? "").trim();
    const number = parseOrderNumber(raw);
    if (number === null) {
      if (raw) ignoredByDate.set(date, [...(ignoredByDate.get(date) ?? []), raw]);
      return;
    }
    grouped.set(date, [...(grouped.get(date) ?? []), number]);
  });

  const dates = Array.from(new Set([...grouped.keys(), ...ignoredByDate.keys()])).sort();

  return dates.map((date) => {
    const numbers = [...new Set(grouped.get(date) ?? [])].sort((a, b) => a - b);

    const sequenceBuckets: number[][] = [];
    numbers.forEach((number) => {
      const current = sequenceBuckets[sequenceBuckets.length - 1];
      if (!current?.length) {
        sequenceBuckets.push([number]);
        return;
      }

      const previous = current[current.length - 1];
      const isNewBook = number - previous > jump;
      if (isNewBook) sequenceBuckets.push([number]);
      else current.push(number);
    });

    return {
      date,
      sequences: sequenceBuckets.map((numbers, index) => buildSequence(date, index + 1, numbers)),
      ignored: ignoredByDate.get(date) ?? [],
    };
  });
}

export function findMissingOrderNumbers(orders: OrderNumberSource[]): number[] {
  return analyzeDailyOrderNumbers(orders).flatMap((day) =>
    day.sequences.flatMap((sequence) => sequence.missing),
  );
}

export function formatSequenceRange(sequence: Pick<OrderNumberSequence, "start" | "end">) {
  return sequence.start === sequence.end
    ? String(sequence.start)
    : `${sequence.start}-${sequence.end}`;
}

export function missingOrderNumbersSummary(orders: OrderNumberSource[]): string {
  const audits = analyzeDailyOrderNumbers(orders);
  const missingByDate = audits
    .map((day) => ({
      date: day.date,
      missing: day.sequences.flatMap((sequence) => sequence.missing),
    }))
    .filter((day) => day.missing.length > 0);

  if (missingByDate.length === 0) return "";
  if (missingByDate.length === 1) {
    return `Missing order numbers: ${missingByDate[0].missing.join(", ")}`;
  }

  return `Missing order numbers: ${missingByDate
    .map((day) => `${day.date}: ${day.missing.join(", ")}`)
    .join("; ")}`;
}
