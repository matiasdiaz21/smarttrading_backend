import crypto from 'crypto';

export function verifyHMAC(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    // Si la firma está vacía, no es válida
    if (!signature || !secret) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    // Si las longitudes no coinciden, no es válida
    if (signature.length !== expectedSignature.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Error verifying HMAC:', error);
    return false;
  }
}

export function generateHMAC(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

