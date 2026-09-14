import type { NetworkConfig, Peer } from './types';

export interface RoutingIssue {
  peerId: string;
  message: string;
}

export interface PeerRoute {
  peer: Peer;
  allowedIPs: string[];
}

export function getGatewayCandidates(
  self: Peer,
  peers: Peer[],
  network: NetworkConfig,
): Peer[] {
  return peers.filter((peer) =>
    peer.id !== self.id &&
    (network.topology === 'mesh' || self.role === 'hub' || peer.role === 'hub'),
  );
}

function requiresGateway(self: Peer, network: NetworkConfig): boolean {
  return self.fullTunnel || (network.topology === 'hub-spoke' && self.role === 'spoke');
}

function gatewayId(self: Peer, network: NetworkConfig): string {
  return self.gatewayId || network.gatewayId;
}

export function validateRouting(peers: Peer[], network: NetworkConfig): RoutingIssue[] {
  const issues: RoutingIssue[] = [];

  for (const self of peers) {
    const candidates = getGatewayCandidates(self, peers, network);
    if (!requiresGateway(self, network)) {
      if (network.topology === 'hybrid' && self.role === 'spoke' && candidates.length === 0) {
        issues.push({ peerId: self.id, message: 'Adicione um servidor para conectar este cliente.' });
      }
      continue;
    }

    const targetId = gatewayId(self, network);
    if (!targetId) {
      issues.push({ peerId: self.id, message: `Selecione um gateway${self.fullTunnel ? ' para Full Tunnel' : ' para a sub-rede WireGuard'}.` });
    } else if (!candidates.some((peer) => peer.id === targetId)) {
      issues.push({ peerId: self.id, message: 'O gateway selecionado precisa existir, ser outro nó e ter conexão direta nesta topologia.' });
    } else if (self.fullTunnel) {
      // A gateway may itself use an upstream full tunnel, but the chain must not loop.
      const visited = new Set([self.id]);
      let next = peers.find((peer) => peer.id === targetId);
      while (next) {
        if (visited.has(next.id)) {
          issues.push({ peerId: self.id, message: 'Os gateways de saída selecionados formam um ciclo de roteamento.' });
          break;
        }
        visited.add(next.id);
        if (!next.fullTunnel) break;
        const upstreamId = gatewayId(next, network);
        next = peers.find((peer) => peer.id === upstreamId);
      }
    }
  }

  return issues;
}

/** Plan direct peers and route ownership together so all config consumers agree. */
export function planPeerRoutes(
  self: Peer,
  peers: Peer[],
  network: NetworkConfig,
): PeerRoute[] {
  const issues = validateRouting(peers, network);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => {
      const name = peers.find((peer) => peer.id === issue.peerId)?.name || issue.peerId;
      return `${name}: ${issue.message}`;
    }).join('\n'));
  }

  const targetId = gatewayId(self, network);
  return getGatewayCandidates(self, peers, network).map((peer) => {
    let allowedIPs = [`${network.subnet}.${peer.wgOctet}/32`, `fd10:100::${peer.wgOctet}/128`];
    if (peer.id === targetId) {
      if (self.fullTunnel) {
        allowedIPs = ['0.0.0.0/0', '::/0'];
      } else if (network.topology === 'hub-spoke' && self.role === 'spoke') {
        allowedIPs = [`${network.subnet}.0/24`, 'fd10:100::/64'];
      }
    }
    return { peer, allowedIPs };
  });
}
