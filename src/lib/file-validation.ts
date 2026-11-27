export type MagicByteValidationResult = {
  valid: boolean;
  detectedMime?: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
  error?: string;
};

/**
 * Inspect file header magic bytes to confirm actual content matches
 * an allowed document/receipt format (PDF, PNG, JPEG, WEBP) and prevent
 * renamed HTML/SVG/executable uploads spoofing MIME headers.
 */
export function validateDocumentMagicBytes(
  buffer: Uint8Array,
  declaredMime: string
): MagicByteValidationResult {
  if (!buffer || buffer.length < 4) {
    return {
      valid: false,
      error: 'Uploaded file is empty or too small to be a valid document.',
    };
  }

  let detectedMime: MagicByteValidationResult['detectedMime'];

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    detectedMime = 'application/pdf';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  else if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    detectedMime = 'image/png';
  }
  // JPEG: FF D8 FF
  else if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    detectedMime = 'image/jpeg';
  }
  // WEBP: RIFF....WEBP
  else if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    detectedMime = 'image/webp';
  }

  if (!detectedMime) {
    return {
      valid: false,
      error: 'Unsupported or corrupted file signature. Only authentic PDF, JPG, PNG, or WEBP files are accepted.',
    };
  }

  const normalizedDeclared = (declaredMime || '').trim().toLowerCase();
  if (normalizedDeclared) {
    const canonicalDeclared =
      normalizedDeclared === 'image/jpg' ? 'image/jpeg' : normalizedDeclared;
    if (canonicalDeclared !== detectedMime) {
      return {
        valid: false,
        error: 'File contents do not match the declared file type.',
      };
    }
  }

  return { valid: true, detectedMime };
}
