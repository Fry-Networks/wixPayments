type KeyWithOrder = { sourceOrderNumber?: string };

function normalizeOrderNumber(value?: string): {
  numeric?: number;
  raw: string;
} {
  const raw = value?.trim() ?? "";
  if (/^\d+$/.test(raw)) {
    return { numeric: Number(raw), raw };
  }
  return { raw };
}

export function sortKeysByOrderNumber<T extends KeyWithOrder>(keys: T[]): T[] {
  return [...keys].sort((a, b) => {
    const left = normalizeOrderNumber(a.sourceOrderNumber);
    const right = normalizeOrderNumber(b.sourceOrderNumber);
    if (left.numeric !== undefined || right.numeric !== undefined) {
      if (left.numeric === undefined) return 1;
      if (right.numeric === undefined) return -1;
      return left.numeric - right.numeric;
    }
    return left.raw.localeCompare(right.raw);
  });
}
