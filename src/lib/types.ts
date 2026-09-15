export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export type Topology = 'mesh' | 'hub-spoke' | 'hybrid';
export type PeerRole = 'hub' | 'spoke';

export interface Peer {
  id: string;
  name: string;
  label: string;
  lanIp: string;
  publicEndpointIp: string;
  wgOctet: number;
  keys: KeyPair;
  role: PeerRole;
  fullTunnel: boolean;
  dns: string | null;
  /** null is automatic; NaN preserves malformed live edits and must never be serialized. */
  mtu: number | null;
  gatewayId: string;
  natGateway: boolean;
  natInterface: string;
}

export interface NetworkConfig {
  dns: string;
  subnet: string;
  port: number;
  keepalive: number;
  topology: Topology;
  gatewayId: string;
}

export interface GeneratedConfig {
  peerId: string;
  peerName: string;
  filename: string;
  content: string;
}
