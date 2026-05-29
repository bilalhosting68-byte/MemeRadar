export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export const toFiniteInt = (value: unknown): number | null => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
};

export const calculateBuyRatio = (
  buys: number | null | undefined,
  sells: number | null | undefined,
): number | null => {
  const safeBuys = buys ?? 0;
  const safeSells = sells ?? 0;
  const total = safeBuys + safeSells;

  if (total <= 0) {
    return null;
  }

  return safeBuys / total;
};

export const percentChange = (from: number, to: number): number => {
  if (from === 0) {
    return 0;
  }

  return ((to - from) / from) * 100;
};

export const roundTo = (value: number, decimals = 2): number => {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
};
