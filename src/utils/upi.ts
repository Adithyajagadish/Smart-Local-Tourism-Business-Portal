import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { PaymentMethod } from '../types';

export interface UpiPaymentUriParams {
  upiId: string;
  payeeName: string;
  amountInr: number;
  transactionNote?: string;
  transactionRef?: string;
  omitAmount?: boolean;
}

/**
 * Normalizes a host mobile number into a readable format and extracts digits for UPI suggestion.
 */
export function extractPhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) {
    return digits.slice(-10);
  }
  return digits;
}

export function suggestUpiIdFromPhone(phone: string, app: 'phonepe' | 'gpay' | 'both'): string {
  const digits = extractPhoneDigits(phone);
  if (digits.length < 10) return '';
  return app === 'gpay' ? `${digits}@okaxis` : `${digits}@ybl`;
}

export function isValidUpiId(upiId: string): boolean {
  const cleaned = upiId.trim();
  return /^[^\s@]+@[^\s@]+$/.test(cleaned) && cleaned.length >= 5 && cleaned.length <= 80;
}

export function isValidPhoneInput(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function sanitizeUpiText(value: string, fallback: string, maxLen: number): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

/**
 * Builds an NPCI-compliant P2P UPI payment URI (`upi://pay?...`) as well as app-specific
 * deep links for PhonePe (`phonepe://pay?...`) and Google Pay (`tez://upi/pay?...`).
 * Uses RFC 3986 `%20` encoding (never `+`), preserves literal `@` in `pa`, sanitizes text
 * fields, and omits merchant-only `tr` so personal VPAs do not fail signature checks.
 */
export function buildUpiLinks(params: UpiPaymentUriParams): {
  genericUri: string;
  phonePeUri: string;
  gPayUri: string;
} {
  const pa = params.upiId.trim().replace(/\s+/g, '');
  const pn = sanitizeUpiText(params.payeeName || '', 'Tourx Host', 40);
  const tn = sanitizeUpiText(params.transactionNote || '', 'Tourx Booking', 40);

  const parts: string[] = [
    `pa=${pa}`,
    `pn=${encodeURIComponent(pn)}`,
  ];

  if (!params.omitAmount && Number.isFinite(params.amountInr) && params.amountInr > 0) {
    const rounded = Math.round(params.amountInr * 100) / 100;
    const am = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
    parts.push(`am=${am}`);
  }

  parts.push('cu=INR');
  parts.push(`tn=${encodeURIComponent(tn)}`);

  const qs = parts.join('&');
  return {
    genericUri: `upi://pay?${qs}`,
    phonePeUri: `phonepe://pay?${qs}`,
    gPayUri: `tez://upi/pay?${qs}`,
  };
}

export function getAppDeepLink(
  method: PaymentMethod,
  params: UpiPaymentUriParams,
): string {
  const links = buildUpiLinks(params);
  return method === 'phonepe' ? links.phonePeUri : links.gPayUri;
}

export async function generateUpiQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    width: 280,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

export interface UploadedQrResult {
  dataUrl: string;
  decodedUri: string;
  decodedUpiId: string;
  decodedPayeeName: string;
  decodedPhone: string;
}

export async function processUploadedQrImage(file: File): Promise<UploadedQrResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (PNG, JPG, or WEBP) of your payment QR code.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the uploaded QR image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid QR image file.'));
      img.onload = () => {
        // 1. Decode QR at higher resolution (up to 1200px) so phone screenshots scan accurately
        const scanMax = 1200;
        let scanW = img.width;
        let scanH = img.height;
        if (scanW > scanMax || scanH > scanMax) {
          const ratio = Math.min(scanMax / scanW, scanMax / scanH);
          scanW = Math.round(scanW * ratio);
          scanH = Math.round(scanH * ratio);
        }

        const scanCanvas = document.createElement('canvas');
        scanCanvas.width = scanW;
        scanCanvas.height = scanH;
        const scanCtx = scanCanvas.getContext('2d');
        let decodedUri = '';
        let decodedUpiId = '';
        let decodedPayeeName = '';
        let decodedPhone = '';

        if (scanCtx) {
          scanCtx.fillStyle = '#FFFFFF';
          scanCtx.fillRect(0, 0, scanW, scanH);
          scanCtx.drawImage(img, 0, 0, scanW, scanH);
          const imageData = scanCtx.getImageData(0, 0, scanW, scanH);
          const code = jsQR(imageData.data, scanW, scanH, {
            inversionAttempts: 'attemptBoth',
          });

          if (code?.data) {
            decodedUri = code.data.trim();
            if (/^upi:\/\/pay/i.test(decodedUri)) {
              const queryIndex = decodedUri.indexOf('?');
              if (queryIndex !== -1) {
                const params = new URLSearchParams(decodedUri.slice(queryIndex + 1));
                const pa = (params.get('pa') || '').trim();
                const pn = (params.get('pn') || '').trim();
                if (isValidUpiId(pa)) {
                  decodedUpiId = pa;
                  const digitsBeforeAt = pa.split('@')[0]?.replace(/\D/g, '') || '';
                  if (digitsBeforeAt.length === 10) {
                    decodedPhone = digitsBeforeAt;
                  }
                }
                if (pn) {
                  decodedPayeeName = pn;
                }
              }
            }
          }
        }

        // 2. Save crisp compact image (max 640px) suitable for database storage & camera scanning
        const outMax = 640;
        let outW = img.width;
        let outH = img.height;
        if (outW > outMax || outH > outMax) {
          const ratio = Math.min(outMax / outW, outMax / outH);
          outW = Math.round(outW * ratio);
          outH = Math.round(outH * ratio);
        }

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(0, 0, outW, outH);
        outCtx.drawImage(img, 0, 0, outW, outH);

        let dataUrl = outCanvas.toDataURL('image/png');
        if (dataUrl.length > 240000) {
          dataUrl = outCanvas.toDataURL('image/jpeg', 0.88);
        }
        if (dataUrl.length > 240000) {
          dataUrl = outCanvas.toDataURL('image/jpeg', 0.72);
        }

        resolve({
          dataUrl,
          decodedUri,
          decodedUpiId,
          decodedPayeeName,
          decodedPhone,
        });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
