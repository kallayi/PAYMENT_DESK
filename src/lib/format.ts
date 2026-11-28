// ==========================================
// Formatting Helpers for INDFURN PayFlow
// ==========================================

const inrFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a number into Indian Rupee representation (e.g., ₹50,000.00)
 */
export function formatINR(val: number | string | null | undefined): string {
  const num = typeof val === 'string' ? parseFloat(val) : (val ?? 0);
  return `₹${inrFormatter.format(isNaN(num) ? 0 : num)}`;
}

/**
 * Format a number into Indian Rupee representation without ₹ symbol (e.g., 50,000.00)
 */
export function formatINRPlain(val: number | string | null | undefined): string {
  const num = typeof val === 'string' ? parseFloat(val) : (val ?? 0);
  return inrFormatter.format(isNaN(num) ? 0 : num);
}

/**
 * Strict 2-decimal place safe rounding to prevent floating-point drift
 */
export function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Neutralize spreadsheet formula injection trigger characters (=, +, -, @, \t, \r)
 * on free-text CSV / Excel cells without modifying numeric cells or validated bank codes.
 */
export function sanitizeSpreadsheetText(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/^[=+\-@\t\r]/.test(str) || /^[=+\-@]/.test(str.trim())) {
    return `'${str}`;
  }
  return str;
}

/**
 * Calculate Net Payable: Amount - TDS
 */
export function calculateNetPayable(amount: number, tds: number = 0): number {
  return round2(Math.max(0, (Number(amount) || 0) - (Number(tds) || 0)));
}

/**
 * Format ISO date string (YYYY-MM-DD) to human-readable date (e.g., "19 Nov 2026")
 */
export function formatHumanDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const month = months[monthIndex] || parts[1];
  return `${parts[2]} ${month} ${parts[0]}`;
}

/**
 * Format ISO date string (YYYY-MM-DD) to short date (e.g., "19 Nov")
 */
export function formatShortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const month = months[monthIndex] || parts[1];
  return `${parts[2]} ${month}`;
}

/**
 * Format ISO date string (YYYY-MM-DD) to Indian DD-MM-YYYY format for print sheets
 */
export function formatDDMMYYYY(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/**
 * Format ISO timestamp to readable date-time (e.g., "19 Nov 2026, 02:15 PM")
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

/**
 * Format a PaymentMode enum value into a clean UI label.
 */
export function formatPaymentMode(
  mode: string | null | undefined,
  compact: boolean = false
): string {
  if (mode === 'CHEQUE') return 'Cheque';
  if (mode === 'IMPS') return 'IMPS';
  return compact ? 'NEFT/RTGS' : 'NEFT / RTGS';
}

/**
 * Strip non-numeric characters (allowing a single decimal point and up to 2 decimal places)
 * for clean numeric state from an Indian-comma formatted amount string.
 */
export function sanitizeIndianAmountInput(raw: string): string {
  if (!raw) return '';
  const stripped = raw.replace(/[^0-9.]/g, '');
  if (!stripped) return '';

  const firstDotIdx = stripped.indexOf('.');
  let intPart = firstDotIdx >= 0 ? stripped.slice(0, firstDotIdx) : stripped;
  const hasDot = firstDotIdx >= 0;
  const decPart = hasDot
    ? stripped.slice(firstDotIdx + 1).replace(/\./g, '').slice(0, 2)
    : '';

  if (hasDot && intPart === '') {
    intPart = '0';
  } else if (intPart.length > 1) {
    intPart = intPart.replace(/^0+/, '') || '0';
  }

  return hasDot ? `${intPart}.${decPart}` : intPart;
}

/**
 * Group integer digits using Indian numbering system (en-IN: 50,000 / 5,00,000 / 12,50,000).
 */
function groupIndianIntegerDigits(digits: string): string {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
}

/**
 * Format a clean numeric string (or raw string) with live Indian comma grouping
 * while preserving trailing decimal points and typed fractional digits (up to 2).
 */
export function formatIndianAmountInput(rawOrClean: string | number | null | undefined): string {
  if (rawOrClean === null || rawOrClean === undefined) return '';
  const clean = sanitizeIndianAmountInput(String(rawOrClean));
  if (!clean) return '';

  const dotIdx = clean.indexOf('.');
  if (dotIdx === -1) {
    return groupIndianIntegerDigits(clean);
  }
  const intPart = clean.slice(0, dotIdx);
  const decPart = clean.slice(dotIdx + 1);
  return `${groupIndianIntegerDigits(intPart)}.${decPart}`;
}

/**
 * Compute current date string (YYYY-MM-DD) strictly in IST (Asia/Kolkata, UTC+05:30).
 */
export function getTodayISTDateString(): string {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(Date.now() + istOffsetMs);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert an ISO timestamp or YYYY-MM-DD string to an IST YYYY-MM-DD date string.
 */
export function toISTDateIso(val: string | null | undefined): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(parsed.getTime() + istOffsetMs);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const INR_ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const INR_TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function convertTwoDigitsToWords(n: number): string {
  if (n <= 0) return '';
  if (n < 20) return INR_ONES[n];
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  return unit > 0 ? `${INR_TENS[ten]} ${INR_ONES[unit]}` : INR_TENS[ten];
}

function convertIndianIntegerToWords(num: number): string {
  if (num <= 0) return '';
  const parts: string[] = [];

  const crore = Math.floor(num / 10000000);
  if (crore > 0) {
    parts.push(`${convertIndianIntegerToWords(crore)} Crore`);
  }

  const lakh = Math.floor((num % 10000000) / 100000);
  if (lakh > 0) {
    parts.push(`${convertTwoDigitsToWords(lakh)} Lakh`);
  }

  const thousand = Math.floor((num % 100000) / 1000);
  if (thousand > 0) {
    parts.push(`${convertTwoDigitsToWords(thousand)} Thousand`);
  }

  const hundred = Math.floor((num % 1000) / 100);
  if (hundred > 0) {
    parts.push(`${INR_ONES[hundred]} Hundred`);
  }

  const rest = num % 100;
  if (rest > 0) {
    parts.push(convertTwoDigitsToWords(rest));
  }

  return parts.join(' ');
}

/**
 * Convert a numeric/string INR amount into Indian numbering words
 * (Crore / Lakh / Thousand / Hundred + Paise).
 */
export function formatINRInWords(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') {
    return 'Rupees Zero Only';
  }
  const normalized =
    typeof amount === 'string' ? parseFloat(amount.replace(/,/g, '').trim()) : amount;
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 'Rupees Zero Only';
  }

  const totalPaise = Math.round(normalized * 100);
  if (totalPaise <= 0) {
    return 'Rupees Zero Only';
  }

  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  if (rupees === 0 && paise > 0) {
    return `Rupees ${convertTwoDigitsToWords(paise)} Paise Only`;
  }

  const rupeeWords = convertIndianIntegerToWords(rupees);
  if (paise > 0) {
    return `Rupees ${rupeeWords} and ${convertTwoDigitsToWords(paise)} Paise Only`;
  }
  return `Rupees ${rupeeWords} Only`;
}

/**
 * Compute current date & month parts strictly in IST (Asia/Kolkata, UTC+05:30).
 */
export function getCurrentISTInfo(): {
  yearMonth: string;
  monthLabel: string;
  day: number;
  daysInMonth: number;
  monthStartIso: string;
  nextMonthStartIso: string;
} {
  const nowUtcMs = Date.now();
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(nowUtcMs + istOffsetMs);
  const year = istDate.getUTCFullYear();
  const monthIndex = istDate.getUTCMonth();
  const month = String(monthIndex + 1).padStart(2, '0');
  const day = istDate.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const monthsFull = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthLabel = `${monthsFull[monthIndex]} ${year}`;

  const monthStartIstUtcMs = Date.UTC(year, monthIndex, 1, 0, 0, 0) - istOffsetMs;
  const nextMonthStartIstUtcMs = Date.UTC(year, monthIndex + 1, 1, 0, 0, 0) - istOffsetMs;

  return {
    yearMonth: `${year}-${month}`,
    monthLabel,
    day,
    daysInMonth,
    monthStartIso: new Date(monthStartIstUtcMs).toISOString(),
    nextMonthStartIso: new Date(nextMonthStartIstUtcMs).toISOString(),
  };
}
