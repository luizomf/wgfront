import type { Peer, NetworkConfig, GeneratedConfig, Topology } from './types';

function peerWgIp(subnet: string, octet: number): string {
  return `${subnet}.${octet}`;
}

function peerEndpoint(peer: Peer): string {
  return peer.publicEndpointIp || peer.lanIp;
}

function buildPeerBlock(
  peer: Peer,
  network: NetworkConfig,
): string {
  const wgIp = peerWgIp(network.subnet, peer.wgOctet);
  const endpoint = peerEndpoint(peer);
  const lines: string[] = [];

  lines.push(`# ${peer.label} - ${endpoint}:${network.port} -> ${wgIp}/32`);
  lines.push('[Peer]');
  lines.push(`PublicKey = ${peer.keys.publicKey}`);
  lines.push(`AllowedIPs = ${wgIp}/32`);

  if (peer.publicEndpointIp) {
    lines.push(`Endpoint = ${peer.publicEndpointIp}:${network.port}`);
  }

  lines.push(`PersistentKeepalive = ${network.keepalive}`);
  lines.push('');

  return lines.join('\n');
}

function peersForNode(
  self: Peer,
  allPeers: Peer[],
  topology: Topology,
): Peer[] {
  return allPeers.filter((peer) => {
    if (peer.id === self.id) return false;
    if (topology === 'mesh') return true;
    // hub-spoke: hubs see everyone, spokes see only hubs
    if (self.role === 'hub') return true;
    return peer.role === 'hub';
  });
}

export function generateConfig(
  self: Peer,
  allPeers: Peer[],
  network: NetworkConfig,
): string {
  const selfWgIp = peerWgIp(network.subnet, self.wgOctet);
  const lines: string[] = [];

  lines.push('[Interface]');
  lines.push(`PrivateKey = ${self.keys.privateKey}`);
  lines.push(`ListenPort = ${network.port}`);
  lines.push(`Address = ${selfWgIp}/24`);
  lines.push('');

  const visiblePeers = peersForNode(self, allPeers, network.topology);
  for (const peer of visiblePeers) {
    lines.push(buildPeerBlock(peer, network));
  }

  return lines.join('\n');
}

export function generateAllConfigs(
  peers: Peer[],
  network: NetworkConfig,
): GeneratedConfig[] {
  return peers.map((self) => ({
    peerId: self.id,
    peerName: self.name,
    filename: `${self.name}.conf`,
    content: generateConfig(self, peers, network),
  }));
}

export function generateKeySummary(
  peers: Peer[],
  network: NetworkConfig,
): string {
  const lines: string[] = [];

  for (const peer of peers) {
    const wgIp = peerWgIp(network.subnet, peer.wgOctet);
    lines.push(peer.name);
    lines.push(`  private: ${peer.keys.privateKey}`);
    lines.push(`  public : ${peer.keys.publicKey}`);
    lines.push(`  wg ip  : ${wgIp}/24`);
    lines.push('');
  }

  return lines.join('\n');
}
