import type { Peer, NetworkConfig } from './types';
import { generateKeyPair } from './crypto';

export interface AppState {
  network: NetworkConfig;
  peers: Peer[];
}

type Listener = (state: AppState) => void;

const DEFAULT_NETWORK: NetworkConfig = {
  subnet: '10.100.0',
  port: 51820,
  keepalive: 25,
  topology: 'mesh',
};

let state: AppState = {
  network: { ...DEFAULT_NETWORK },
  peers: [],
};

const listeners = new Set<Listener>();
let idCounter = 0;

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

export function updateNetwork(partial: Partial<NetworkConfig>): void {
  state = {
    ...state,
    network: { ...state.network, ...partial },
  };
  emit();
}

export async function addPeer(): Promise<void> {
  const id = String(++idCounter);
  const keys = await generateKeyPair();
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
    natGateway: false,
    natInterface: 'eth0',
  };

  state = { ...state, peers: [...state.peers, peer] };
  emit();
}

export function updatePeer(id: string, partial: Partial<Peer>): void {
  state = {
    ...state,
    peers: state.peers.map((p) =>
      p.id === id ? { ...p, ...partial } : p,
    ),
  };
  emit();
}

export function removePeer(id: string): void {
  state = {
    ...state,
    peers: state.peers.filter((p) => p.id !== id),
  };
  emit();
}

export async function regenerateAllKeys(): Promise<void> {
  const newPeers = await Promise.all(
    state.peers.map(async (p) => ({
      ...p,
      keys: await generateKeyPair(),
    })),
  );
  state = { ...state, peers: newPeers };
  emit();
}
