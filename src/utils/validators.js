export function isValidCNP(value) {
  if (!value) {
    return false;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 13) {
    return false;
  }
  const control = '279146358279';
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * Number(control[i]);
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 10 ? 1 : remainder;
  if (checkDigit !== Number(digits[12])) {
    return false;
  }
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
