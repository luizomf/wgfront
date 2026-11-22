export const MAX_EXTRA_ALLOWED_IPS = 64;

export const EXTRA_ALLOWED_IPS_HELP =
  'Opcional. Redes IPv4/IPv6 extras roteadas para este nó (ex.: seu IP de LAN, 192.168.0.10/32), separadas por vírgula.';

export interface Cidr {
  text: string;
  version: 4 | 6;
  network: bigint;
  prefix: number;
}

const BITS = { 4: 32, 6: 128 } as const;

function parseIpv4(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null;
    result = (result << 8n) | BigInt(part);
  }
  return result;
}

function parseIpv6(value: string): bigint | null {
  if (!/^[0-9a-fA-F:]+$/.test(value)) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const groups = (half: string) => (half === '' ? [] : half.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let result = 0n;
  for (const group of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    result = (result << 16n) | BigInt(`0x${group}`);
  }
  return result;
}

/** Parse a network in CIDR form; host bits must be zero, so the text means one network. */
export function parseCidr(value: string): Cidr {
  const fail = (): never => {
    throw new Error(`Rota inválida: "${value}". Use uma rede IPv4/IPv6 em CIDR, como 192.168.0.10/32.`);
  };
  const match = /^([^/\s]+)\/(0|[1-9]\d{0,2})$/.exec(value);
  if (!match) fail();
  const [, address, prefixText] = match!;
  const version = address.includes(':') ? 6 : 4;
  const parsed = version === 4 ? parseIpv4(address) : parseIpv6(address);
  const prefix = Number(prefixText);
  if (parsed === null || prefix > BITS[version]) fail();
  const hostBits = BigInt(BITS[version] - prefix);
  if (parsed! & ((1n << hostBits) - 1n)) fail();
  return { text: value, version, network: parsed!, prefix };
}

export function cidrsOverlap(a: Cidr, b: Cidr): boolean {
  if (a.version !== b.version) return false;
  const shift = BigInt(BITS[a.version] - Math.min(a.prefix, b.prefix));
  return a.network >> shift === b.network >> shift;
}

/** Split the editor text; malformed entries are kept so validation can name them. */
export function parseExtraAllowedIpsInput(raw: string): string[] {
  return raw.split(/[\s,]+/).filter((entry) => entry !== '');
}

function wireGuardSubnets(subnet: string): Cidr[] {
  return [parseCidr(`${subnet}.0/24`), parseCidr('fd10:100::/64')];
}

/** Shared by live routing validation and the strict structure format. */
export function validateExtraAllowedIps(value: unknown, subnet: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error('Rotas extras: use uma lista de redes.');
  if (value.length > MAX_EXTRA_ALLOWED_IPS) {
    throw new Error(`Rotas extras: no máximo ${MAX_EXTRA_ALLOWED_IPS} redes por nó.`);
  }
  const reserved = wireGuardSubnets(subnet);
  const seen: Cidr[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error('Rotas extras: entrada inválida.');
    const cidr = parseCidr(entry);
    if (reserved.some((net) => cidrsOverlap(net, cidr))) {
      throw new Error(`Rota extra ${entry} conflita com a sub-rede WireGuard.`);
    }
    const clash = seen.find((other) => cidrsOverlap(other, cidr));
    if (clash) throw new Error(`Rota extra ${entry} sobrepõe ${clash.text} neste nó.`);
    seen.push(cidr);
  }
}
