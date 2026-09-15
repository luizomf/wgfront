import type { Peer, NetworkConfig, GeneratedConfig } from './types';
import { planPeerRoutes } from './routing';
import { getDnsServers } from './dns';

function peerWgIp(subnet: string, octet: number): string {
  return `${subnet}.${octet}`;
}

function peerWgIp6(octet: number): string {
  return `fd10:100::${octet}`;
}

function peerEndpoint(peer: Peer): string {
  return peer.publicEndpointIp || peer.lanIp;
}

function buildPeerBlock(
  peer: Peer,
  network: NetworkConfig,
  allowedIPs: string[],
): string {
  const wgIp = peerWgIp(network.subnet, peer.wgOctet);
  const endpoint = peerEndpoint(peer);
  const lines: string[] = [];

  lines.push(`# ${peer.label} - ${endpoint}:${network.port} -> ${wgIp}/32`);
  lines.push('[Peer]');
  lines.push(`PublicKey = ${peer.keys.publicKey}`);

  lines.push(`AllowedIPs = ${allowedIPs.join(', ')}`);

  if (peer.publicEndpointIp) {
    lines.push(`Endpoint = ${peer.publicEndpointIp}:${network.port}`);
  }

  lines.push(`PersistentKeepalive = ${network.keepalive}`);
  lines.push('');

  return lines.join('\n');
}

export function generateConfig(
  self: Peer,
  allPeers: Peer[],
  network: NetworkConfig,
): string {
  const routes = planPeerRoutes(self, allPeers, network);
  const selfWgIp = peerWgIp(network.subnet, self.wgOctet);
  const lines: string[] = [];

  lines.push('[Interface]');
  lines.push(`PrivateKey = ${self.keys.privateKey}`);
  lines.push(`ListenPort = ${network.port}`);
  const selfWgIp6 = peerWgIp6(self.wgOctet);
  lines.push(`Address = ${selfWgIp}/24, ${selfWgIp6}/64`);

  const dns = getDnsServers(self, network);
  if (dns.length > 0) lines.push(`DNS = ${dns.join(', ')}`);

  if (self.natGateway) {
    const iface = self.natInterface || 'eth0';
    lines.push('');
    lines.push('# Habilita o encaminhamento de pacotes');
    lines.push('PostUp = sysctl -w net.ipv4.ip_forward=1');
    lines.push('PostUp = sysctl -w net.ipv6.conf.all.forwarding=1');
    lines.push('');
    lines.push('# Regras de firewall para NAT masquerading');
    lines.push(`PostUp = iptables -A FORWARD -i %i -j ACCEPT`);
    lines.push(`PostUp = iptables -A FORWARD -o %i -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    lines.push(`PostUp = iptables -t nat -A POSTROUTING -o ${iface} -j MASQUERADE`);
    lines.push(`PostUp = ip6tables -A FORWARD -i %i -j ACCEPT`);
    lines.push(`PostUp = ip6tables -A FORWARD -o %i -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    lines.push(`PostUp = ip6tables -t nat -A POSTROUTING -o ${iface} -j MASQUERADE`);
    lines.push('');
    lines.push('# Limpeza (quando o WireGuard desliga)');
    lines.push(`PostDown = iptables -D FORWARD -i %i -j ACCEPT`);
    lines.push(`PostDown = iptables -D FORWARD -o %i -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    lines.push(`PostDown = iptables -t nat -D POSTROUTING -o ${iface} -j MASQUERADE`);
    lines.push(`PostDown = ip6tables -D FORWARD -i %i -j ACCEPT`);
    lines.push(`PostDown = ip6tables -D FORWARD -o %i -m state --state RELATED,ESTABLISHED -j ACCEPT`);
    lines.push(`PostDown = ip6tables -t nat -D POSTROUTING -o ${iface} -j MASQUERADE`);
    lines.push('PostDown = sysctl -w net.ipv4.ip_forward=0');
    lines.push('PostDown = sysctl -w net.ipv6.conf.all.forwarding=0');
  }

  lines.push('');

  for (const { peer, allowedIPs } of routes) {
    lines.push(buildPeerBlock(peer, network, allowedIPs));
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
