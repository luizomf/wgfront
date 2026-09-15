import type { NetworkConfig, Peer } from './types';
import { generatePresharedKey } from './crypto';
import { getGatewayCandidates } from './routing';

/** Operational secrets only: never attach to serialized network or peer settings. */
export type PairKeys = ReadonlyMap<string, string>;

export function pairId(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

function validate(key: unknown): asserts key is string {
  // 32 bytes, standard padded base64, including canonical zero padding bits.
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(key) ||
      key === 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') {
    throw new Error('PSK ausente ou inválida. Regere as chaves antes de exportar.');
  }
}

export function getPairKey(keys: PairKeys, a: string, b: string): string {
  const key = keys.get(pairId(a, b));
  validate(key);
  return key;
}

/** Build the complete next graph without mutating existing secrets, even on failure. */
export function reconcilePairKeys(
  peers: Peer[], network: NetworkConfig, previous: PairKeys = new Map(),
): PairKeys {
  const next = new Map<string, string>();
  if (!network.usePsk) return next;
  for (const self of peers) {
    for (const other of getGatewayCandidates(self, peers, network)) {
      const id = pairId(self.id, other.id);
      if (next.has(id)) continue;
      const key = previous.has(id) ? previous.get(id) : generatePresharedKey();
      validate(key);
      next.set(id, key);
    }
  }
  return next;
}

export function validatePairKeys(peers: Peer[], network: NetworkConfig, keys: PairKeys): void {
  if (!network.usePsk) return;
  for (const self of peers) {
    for (const other of getGatewayCandidates(self, peers, network)) getPairKey(keys, self.id, other.id);
  }
}
