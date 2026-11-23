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
