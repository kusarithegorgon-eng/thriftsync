const OFF_PLATFORM_LINK = /(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|ph|co)\b/i;
const EXTERNAL_PHONE = /(?:\+?63[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}|09\d{9})/;
const OFF_ESCROW_PAYMENT = /\b(?:gcash|maya|paymaya|paypal|bank transfer|wire transfer|off[- ]platform|outside (?:the )?(?:app|platform)|pay (?:me|directly)|direct payment|cash (?:settlement|payment|transfer)|send (?:the )?money (?:to|via))\b/i;

export function getMessageSafetyError(message: string): string | null {
  if (OFF_PLATFORM_LINK.test(message)) {
    return 'External links are blocked. Keep all payments and conversations inside ThriftSync.';
  }
  if (EXTERNAL_PHONE.test(message)) {
    return 'External phone numbers are blocked. Keep all conversations inside ThriftSync.';
  }
  if (OFF_ESCROW_PAYMENT.test(message)) {
    return 'Off-platform payments are blocked. Keep all payments inside ThriftSync to stay protected by Escrow.';
  }
  return null;
}
