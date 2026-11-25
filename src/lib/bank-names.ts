const IFSC_BANK_MAP: Record<string, string> = {
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Mahindra Bank',
  HDFC: 'HDFC Bank',
  SIBL: 'South Indian Bank',
  ICIC: 'ICICI Bank',
  SBIN: 'State Bank of India',
  FDRL: 'Federal Bank',
  CNRB: 'Canara Bank',
  BARB: 'Bank of Baroda',
  YESB: 'Yes Bank',
  IDFB: 'IDFC First Bank',
  PUNB: 'Punjab National Bank',
  UBIN: 'Union Bank of India',
  INDB: 'IndusInd Bank',
  IOBA: 'Indian Overseas Bank',
  IDIB: 'Indian Bank',
  CBIN: 'Central Bank of India',
  BKID: 'Bank of India',
  MAHB: 'Bank of Maharashtra',
  KARB: 'Karnataka Bank',
  KVBL: 'Karur Vysya Bank',
  TMBL: 'Tamilnad Mercantile Bank',
  CSBK: 'CSB Bank',
  DLXB: 'Dhanlaxmi Bank',
  ESAF: 'ESAF Small Finance Bank',
};

/**
 * Derive human-readable Indian bank name from an IFSC code's 4-letter prefix.
 * Falls back to the uppercase 4-char IFSC prefix if unmapped.
 */
export function getBankNameFromIfsc(ifscCode: string | null | undefined): string {
  const prefix = (ifscCode || '').trim().toUpperCase().slice(0, 4);
  if (!prefix) return '—';
  return IFSC_BANK_MAP[prefix] || prefix;
}
