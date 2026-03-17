export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export type Topology = 'mesh' | 'hub-spoke';
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
  natGateway: boolean;
  natInterface: string;
}

export interface NetworkConfig {
  subnet: string;
  port: number;
  keepalive: number;
  topology: Topology;
}

export interface GeneratedConfig {
  peerId: string;
  peerName: string;
  filename: string;
  content: string;
}
