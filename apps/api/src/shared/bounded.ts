export const bounded = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value) || 0));
