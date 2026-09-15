import type { Peer, NetworkConfig } from './types';
import { generateKeyPair } from './crypto';
import { parseStructure } from './structure';
import { DEFAULT_DNS } from './dns';
import { reconcilePairKeys, type PairKeys } from './psk';

export interface AppState {
  network: NetworkConfig;
  peers: Peer[];
  pairKeys: PairKeys;
}

type Listener = (state: AppState) => void;

const DEFAULT_NETWORK: NetworkConfig = {
  usePsk: false,
  dns: DEFAULT_DNS,
  subnet: '10.100.0',
  port: 51820,
  keepalive: 25,
  topology: 'mesh',
  gatewayId: '',
};

let state: AppState = {
  network: { ...DEFAULT_NETWORK },
  peers: [],
  pairKeys: new Map(),
};

const listeners = new Set<Listener>();
let idCounter = 0;
let replacementVersion = 0;

function emit(): void {
  for (const fn of listeners) {
    fn(state);
  }
}

export function getState(): AppState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reconcile all secrets before a single observable publication. */
function commit(next: Omit<AppState, 'pairKeys'>, previous: PairKeys = state.pairKeys, replace = false): void {
  const pairKeys = reconcilePairKeys(next.peers, next.network, previous);
  if (replace) replacementVersion++;
  state = { ...next, pairKeys };
  emit();
}

export function updateNetwork(partial: Partial<NetworkConfig>): void {
  commit({ ...state, network: { ...state.network, ...partial } });
}

export async function addPeer(): Promise<void> {
  const version = replacementVersion;
  const keys = await generateKeyPair();
  if (version !== replacementVersion) throw new Error('A estrutura mudou durante a geração das chaves.');
  if (state.peers.length >= 254) throw new Error('A rede já tem o máximo de 254 nós.');
  const reservedIds = new Set([
    state.network.gatewayId,
    ...state.peers.flatMap((peer) => [peer.id, peer.gatewayId]),
  ]);
  const usedNames = new Set(state.peers.map((peer) => peer.name.toLowerCase()));
  let id: string;
  do { id = String(++idCounter); }
  while (reservedIds.has(id) || usedNames.has(`peer${id}`));
  const usedOctets = new Set(state.peers.map((p) => p.wgOctet));
  let octet = 1;
  while (usedOctets.has(octet) && octet <= 254) octet++;

  const peer: Peer = {
    id,
    name: `peer${id}`,
    label: `Peer ${id}`,
    lanIp: '',
    publicEndpointIp: '',
    wgOctet: octet,
    keys,
    role: state.peers.length === 0 ? 'hub' : 'spoke',
    fullTunnel: false,
    dns: null,
    mtu: null,
    gatewayId: '',
    natGateway: false,
    natInterface: 'eth0',
  };

  commit({ ...state, peers: [...state.peers, peer] });
}

export function updatePeer(id: string, partial: Partial<Peer>): void {
  commit({
    ...state,
    peers: state.peers.map((p) =>
      p.id === id ? { ...p, ...partial } : p,
    ),
  });
}

export function removePeer(id: string): void {
  commit({ ...state, peers: state.peers.filter((p) => p.id !== id) });
}

export async function regenerateAllKeys(): Promise<void> {
  const version = replacementVersion;
  const keysById = new Map<string, Peer['keys']>();
  // Include nodes added while awaiting crypto, without overwriting newer metadata.
  do {
    const missing = state.peers.filter((peer) => !keysById.has(peer.id));
    const pairs = await Promise.all(missing.map(async (peer) => ({ id: peer.id, keys: await generateKeyPair() })));
    if (version !== replacementVersion) throw new Error('A estrutura mudou durante a geração das chaves.');
    for (const { id, keys } of pairs) keysById.set(id, keys);
  } while (state.peers.some((peer) => !keysById.has(peer.id)));
  commit({
    ...state,
    peers: state.peers.map((peer) => ({ ...peer, keys: keysById.get(peer.id)! })),
  }, new Map(), true);
}

export async function importStructure(json: string): Promise<void> {
  const structure = parseStructure(json);
  const previous = state;
  const peers = await Promise.all(structure.peers.map(async (peer) => ({
    ...peer, keys: await generateKeyPair(),
  })));
  if (state !== previous) throw new Error('A rede foi editada durante a importação. Tente importar novamente.');
  commit({ network: structure.network, peers }, new Map(), true);
}
