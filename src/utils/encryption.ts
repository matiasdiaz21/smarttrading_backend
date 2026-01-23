import crypto from 'crypto';
import { config } from '../config';

const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(config.encryption.key, 'salt', 32);
const ivLength = 16;

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

export function decrypt(encryptedText: string | null | undefined): string {
  // Si el texto está vacío, nulo o indefinido, retornar cadena vacía
  if (!encryptedText || encryptedText.trim() === '') {
    return '';
  }

  // Verificar que tenga el formato correcto (iv:encrypted)
  const parts = encryptedText.split(':');
  if (parts.length !== 2) {
    // Si no tiene el formato correcto, asumir que no está encriptado (datos antiguos)
    return encryptedText;
  }

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    // Validar que el IV tenga la longitud correcta
    if (iv.length !== ivLength) {
      return encryptedText; // Retornar el texto original si el IV es inválido
    }
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Si falla la desencriptación, retornar el texto original
    // Esto puede pasar con datos antiguos que no estaban encriptados
    console.warn('Error al desencriptar:', error);
    return encryptedText;
  }
}

