export const MTU_HELP = 'Vazio: automático (wg-quick). Inteiro de 1280 a 65535 para IPv4/IPv6.';

/** Keep malformed edits invalid; never confuse them with the automatic setting. */
export function parseMtuInput(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return null;
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

/** Shared by live config validation and the strict structure format. */
export function validateMtu(value: unknown): asserts value is number | null {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1280 || value > 65535) {
    throw new Error(`MTU inválido. ${MTU_HELP}`);
  }
}
