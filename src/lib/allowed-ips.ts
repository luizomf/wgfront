import { isValidSubnet } from './validators';

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

function formatAddress(version: 4 | 6, value: bigint): string {
  if (version === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join('.');
  }
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt(112 - i * 16)) & 0xffffn));
  let best = { start: -1, length: 1 };
  for (let start = 0; start < 8;) {
    let end = start;
    while (end < 8 && groups[end] === 0) end++;
    if (end - start > best.length) best = { start, length: end - start };
    start = end === start ? start + 1 : end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (best.start < 0) return hex.join(':');
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.length).join(':')}`;
}

// Validation runs on every keystroke for every config; keep parsed networks, bounded.
const parsed = new Map<string, Cidr>();
const MAX_CACHED = 10_000;

/** Parse a network in CIDR form; host bits must be zero, so the text means one network. */
export function parseCidr(value: string): Cidr {
  const cached = parsed.get(value);
  if (cached) return cached;
  const fail = (): never => {
    throw new Error(`Rota inválida: "${value}". Use uma rede IPv4/IPv6 em CIDR, como 192.168.0.10/32.`);
  };
  const match = /^([^/\s]+)\/(0|[1-9]\d{0,2})$/.exec(value);
  if (!match) fail();
  const [, address, prefixText] = match!;
  const version = address.includes(':') ? 6 : 4;
  const bits = version === 4 ? parseIpv4(address) : parseIpv6(address);
  const prefix = Number(prefixText);
  if (bits === null || prefix > BITS[version]) fail();
  const hostMask = (1n << BigInt(BITS[version] - prefix)) - 1n;
  if (bits! & hostMask) {
    const network = formatAddress(version, bits! & ~hostMask);
    throw new Error(`Rota ${value} tem bits de host; use ${network}/${prefix}.`);
  }
  const cidr: Cidr = { text: value, version, network: bits!, prefix };
  if (parsed.size >= MAX_CACHED) parsed.clear();
  parsed.set(value, cidr);
  return cidr;
}

/** First and last address covered by the network, comparable within one IP version. */
export function cidrRange(cidr: Cidr): [bigint, bigint] {
  const size = 1n << BigInt(BITS[cidr.version] - cidr.prefix);
  return [cidr.network, cidr.network + size - 1n];
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
  // A subnet still being typed is reported by the network settings, not here.
  const reserved = isValidSubnet(subnet) ? wireGuardSubnets(subnet) : [];
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
