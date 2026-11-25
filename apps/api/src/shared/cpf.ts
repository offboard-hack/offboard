function checkDigit(digits: string, length: number) {
  let sum = 0;

  for (let index = 0; index < length; index++) {
    sum += Number(digits[index]) * (length + 1 - index);
  }

  const rest = (sum * 10) % 11;

  return rest === 10 ? 0 : rest;
}

export function isValidCpf(digits: string) {
  if (!/^\d{11}$/.test(digits)) return false;

  if (/^(\d)\1{10}$/.test(digits)) return false;

  return (
    checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10])
  );
}
