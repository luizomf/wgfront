import type { Peer, NetworkConfig, GeneratedConfig, Topology } from './types';

function peerWgIp(subnet: string, octet: number): string {
  return `${subnet}.${octet}`;
}

function peerWgIp6(octet: number): string {
  return `fd10:100::${octet}`;
}

function peerEndpoint(peer: Peer): string {
  return peer.publicEndpointIp || peer.lanIp;
}

interface PeerBlockOptions {
  useFullTunnel: boolean;
  useSubnetRoute: boolean;
}

function buildPeerBlock(
  peer: Peer,
  network: NetworkConfig,
  options: PeerBlockOptions,
): string {
  const wgIp = peerWgIp(network.subnet, peer.wgOctet);
  const endpoint = peerEndpoint(peer);
  const lines: string[] = [];

  const wgIp6 = peerWgIp6(peer.wgOctet);

  lines.push(`# ${peer.label} - ${endpoint}:${network.port} -> ${wgIp}/32`);
  lines.push('[Peer]');
  lines.push(`PublicKey = ${peer.keys.publicKey}`);

  if (options.useFullTunnel) {
    lines.push('AllowedIPs = 0.0.0.0/0, ::/0');
  } else if (options.useSubnetRoute) {
    lines.push(`AllowedIPs = ${network.subnet}.0/24, fd10:100::/64`);
  } else {
    lines.push(`AllowedIPs = ${wgIp}/32, ${wgIp6}/128`);
  }

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
  const selfWgIp6 = peerWgIp6(self.wgOctet);
  lines.push(`Address = ${selfWgIp}/24, ${selfWgIp6}/64`);

  if (self.fullTunnel) {
    lines.push('DNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001');
  }

  lines.push('');

  const visiblePeers = peersForNode(self, allPeers, network.topology);

  const isSpoke = network.topology === 'hub-spoke' && self.role === 'spoke';

  // Full tunnel: only the first peer gets 0.0.0.0/0 (avoids routing conflicts)
  let fullTunnelAssigned = false;
  for (const peer of visiblePeers) {
    const useFullTunnel = self.fullTunnel && !fullTunnelAssigned;
    if (useFullTunnel) fullTunnelAssigned = true;

    // Spokes route the entire WG subnet through hubs
    const useSubnetRoute = isSpoke && peer.role === 'hub' && !useFullTunnel;

    lines.push(buildPeerBlock(peer, network, { useFullTunnel, useSubnetRoute }));
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
    const wgIp6 = peerWgIp6(peer.wgOctet);
    lines.push(`  wg ip  : ${wgIp}/24, ${wgIp6}/64`);
    lines.push('');
  }

  return lines.join('\n');
}
