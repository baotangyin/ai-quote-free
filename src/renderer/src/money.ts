/**
 * Convert yuan (元) to cents (分)
 * @param y - amount in yuan (can be number or string)
 * @returns amount in cents (分), using Math.round to handle floating point
 * @throws if input is invalid (NaN, non-numeric string)
 */
export function yuanToCents(y: number | string): number {
  let num: number;

  if (typeof y === 'string') {
    // Validate that the string is a valid number format
    const trimmed = y.trim();
    if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid yuan amount: "${y}"`);
    }
    num = parseFloat(trimmed);
    if (isNaN(num)) {
      throw new Error(`Invalid yuan amount: "${y}"`);
    }
  } else if (typeof y === 'number') {
    num = y;
    if (isNaN(num)) {
      throw new Error('Invalid yuan amount: NaN');
    }
  } else {
    // Reject null, undefined, and any other non-number/non-string type
    throw new Error(`Invalid yuan amount: ${String(y)}`);
  }

  if (!Number.isFinite(num)) {
    throw new Error(`Invalid yuan amount: ${num}`);
  }

  return Math.round(num * 100);
}

/**
 * Convert cents (分) to yuan (元)
 * @param c - amount in cents
 * @returns amount in yuan
 */
export function centsToYuan(c: number): number {
  return c / 100;
}

/**
 * Format a number with 2 decimal places, a thousands separator, and a
 * leading minus sign — but only when the *rounded* value is actually
 * non-zero. This avoids displaying "-0.00" for small negative inputs
 * (e.g. -0.001) that round down to zero.
 * @param value - the numeric value to format (already in display units)
 * @returns formatted string like "-1,000.00" or "0.00" (never "-0.00")
 */
function formatSigned(value: number): string {
  const absValue = Math.abs(value);
  const [intPart, decPart] = absValue.toFixed(2).split('.');
  const isZero = intPart === '0' && decPart === '00';
  const isNegative = value < 0 && !isZero;

  // Add thousands separator
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = isNegative ? `-${withCommas}` : withCommas;

  return `${formatted}.${decPart}`;
}

/**
 * Format cents as yuan with thousands separator and 2 decimal places
 * @param c - amount in cents
 * @returns formatted string like "1,000.00"
 */
export function fmtYuan(c: number): string {
  const yuan = centsToYuan(c);
  return formatSigned(yuan);
}

/**
 * Format cents as 万元 (ten thousand yuan) with thousands separator and 2 decimal places
 * @param c - amount in cents
 * @returns formatted string like "1,000.00万元"
 */
export function fmtWan(c: number): string {
  // 1万元 = 10,000 yuan = 1,000,000 cents
  const wan = c / 1000000;
  return `${formatSigned(wan)}万元`;
}

/**
 * Format cents according to the requested display unit.
 * @param c - amount in cents
 * @param unit - '元' formats with fmtYuan, '万元' formats with fmtWan
 * @returns formatted string
 */
export function fmtByUnit(c: number, unit: '元' | '万元'): string {
  return unit === '万元' ? fmtWan(c) : fmtYuan(c);
}
