import type { KeyPair } from './types';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits'],
  );

  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateBytes = new Uint8Array(pkcs8).slice(16, 48);

  const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicBytes = new Uint8Array(rawPublic);

  return {
    privateKey: toBase64(privateBytes),
    publicKey: toBase64(publicBytes),
  };
}

export function isX25519Supported(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.subtle.generateKey === 'function'
  );
}
