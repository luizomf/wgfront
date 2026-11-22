import { describe, expect, it } from 'vitest';
import { getGatewayCandidates, planPeerRoutes, validateRouting } from '../routing';
import type { NetworkConfig, Peer, Topology } from '../types';
import { DEFAULT_DNS } from '../dns';

function peer(id: string, overrides: Partial<Peer> = {}): Peer {
  return {
    id, name: id, label: id, lanIp: '', publicEndpointIp: '', wgOctet: Number(id),
    keys: { privateKey: 'test-private', publicKey: `test-public-${id}` },
    role: 'hub', gatewayId: '', fullTunnel: false, dns: null, mtu: null, extraAllowedIPs: [], natGateway: false, natInterface: 'eth0',
    ...overrides,
  };
}

const network: NetworkConfig = {
  usePsk: false,
  dns: DEFAULT_DNS,
  topology: 'hybrid', subnet: '10.100.0', port: 51820, keepalive: 25, gatewayId: '8',
};
const hub = peer('8');
const client = peer('108', { role: 'spoke', fullTunnel: true });
const otherClient = peer('109', { role: 'spoke' });

describe('routing validation', () => {
  it('accepts an empty editor', () => {
    expect(validateRouting([], network)).toEqual([]);
  });

  it.each(['mesh', 'hub-spoke', 'hybrid'] as Topology[])('accepts an explicit full tunnel gateway in %s', (topology) => {
    expect(validateRouting([hub, client], { ...network, topology })).toEqual([]);
  });

  it.each(['', 'missing', '108', '109'])('rejects missing, stale, self, and non-direct gateways (%s)', (gatewayId) => {
    const config = { ...network, gatewayId };
    expect(validateRouting([hub, client, otherClient], config).map((issue) => issue.peerId)).toEqual(['108']);
    expect(() => planPeerRoutes(client, [hub, client, otherClient], config)).toThrow();
  });

  it('does not replace an invalid explicit override with a valid default', () => {
    const invalid = { ...client, gatewayId: 'removed' };
    expect(validateRouting([hub, invalid], network)).toHaveLength(1);
  });

  it('invalidates a gateway after changing its role to client', () => {
    expect(validateRouting([{ ...hub, role: 'spoke' }, client], network).some((issue) => issue.peerId === client.id)).toBe(true);
  });

  it('requires an explicit relay even when hub-spoke has only one hub', () => {
    const spoke = { ...client, fullTunnel: false };
    expect(validateRouting([hub, spoke], { ...network, topology: 'hub-spoke', gatewayId: '' })).toHaveLength(1);
  });

  it('does not require a gateway for split mesh or hybrid', () => {
    const spoke = { ...client, fullTunnel: false, gatewayId: 'stale-but-unused' };
    for (const topology of ['mesh', 'hybrid'] as Topology[]) {
      expect(validateRouting([hub, spoke], { ...network, topology, gatewayId: '' })).toEqual([]);
    }
  });

  it('requires at least one server for hybrid clients', () => {
    expect(validateRouting([otherClient], network)).toEqual([
      { peerId: otherClient.id, message: 'Adicione um servidor para conectar este cliente.' },
    ]);
  });

  it('rejects circular internet exit chains', () => {
    const a = peer('1', { fullTunnel: true, gatewayId: '2' });
    const b = peer('2', { fullTunnel: true, gatewayId: '3' });
    const c = peer('3', { fullTunnel: true, gatewayId: '1' });
    const issues = validateRouting([a, b, c], { ...network, topology: 'mesh' });
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.message.includes('ciclo de roteamento'))).toBe(true);
  });

  it('accepts acyclic upstream exits with an explicit terminal gateway', () => {
    const a = peer('1', { fullTunnel: true, gatewayId: '2' });
    const b = peer('2', { fullTunnel: true, gatewayId: '8' });
    expect(validateRouting([a, b, hub], { ...network, topology: 'mesh' })).toEqual([]);
  });
});

describe('gateway candidates', () => {
  const peers = [hub, client, otherClient];
  it('excludes self and other clients in hybrid and hub-spoke', () => {
    for (const topology of ['hybrid', 'hub-spoke'] as Topology[]) {
      expect(getGatewayCandidates(client, peers, { ...network, topology })).toEqual([hub]);
      expect(getGatewayCandidates(hub, peers, { ...network, topology })).toEqual([client, otherClient]);
    }
  });

  it('ignores roles in mesh but still excludes self', () => {
    expect(getGatewayCandidates(client, peers, { ...network, topology: 'mesh' })).toEqual([hub, otherClient]);
  });
});

describe('extra AllowedIPs', () => {
  const nas = peer('105', { role: 'spoke', fullTunnel: true, extraAllowedIPs: ['192.168.0.105/32'] });
  const routesTo = (self: Peer, peers: Peer[], config: NetworkConfig, target: Peer) =>
    planPeerRoutes(self, peers, config).find((route) => route.peer.id === target.id)?.allowedIPs;

  it('appends a peer\'s extras to its block on the hub, between its WireGuard addresses', () => {
    expect(routesTo(hub, [hub, nas], network, nas)).toEqual([
      '10.100.0.105/32', '192.168.0.105/32', 'fd10:100::105/128',
    ]);
  });

  it('keeps an empty list byte-identical to the default routes', () => {
    expect(routesTo(hub, [hub, client], network, client)).toEqual(['10.100.0.108/32', 'fd10:100::108/128']);
  });

  it('does not change a full-tunnel gateway route', () => {
    const exit = { ...hub, extraAllowedIPs: ['203.0.113.0/24'] };
    expect(routesTo(client, [exit, client], network, exit)).toEqual(['0.0.0.0/0', '::/0']);
  });

  it('keeps the hub-spoke subnet default and adds the hub\'s extras', () => {
    const relay = { ...hub, extraAllowedIPs: ['192.168.50.0/24'] };
    const spoke = { ...otherClient, gatewayId: '8' };
    const config = { ...network, topology: 'hub-spoke' as Topology };
    expect(routesTo(spoke, [relay, spoke], config, relay)).toEqual([
      '10.100.0.0/24', '192.168.50.0/24', 'fd10:100::/64',
    ]);
  });

  it('adds extras on every direct peer in mesh', () => {
    const a = peer('1', { extraAllowedIPs: ['192.168.10.0/24'] });
    const b = peer('2');
    const c = peer('3');
    const config = { ...network, topology: 'mesh' as Topology, gatewayId: '' };
    expect(routesTo(b, [a, b, c], config, a)).toContain('192.168.10.0/24');
    expect(routesTo(c, [a, b, c], config, a)).toContain('192.168.10.0/24');
  });

  it('reports an invalid extra on its own node and blocks generation', () => {
    const broken = { ...nas, extraAllowedIPs: ['192.168.0.105'] };
    const issues = validateRouting([hub, broken], network);
    expect(issues.map((issue) => issue.peerId)).toEqual(['105']);
    expect(issues[0].message).toMatch(/192\.168\.0\.105/);
    expect(() => planPeerRoutes(hub, [hub, broken], network)).toThrow();
  });

  it('rejects extras of different peers that overlap in the same generated config', () => {
    const other = peer('106', { role: 'spoke', fullTunnel: true, extraAllowedIPs: ['192.168.0.0/24'] });
    const issues = validateRouting([hub, nas, other], network);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/sobrep/);
    expect(() => planPeerRoutes(hub, [hub, nas, other], network)).toThrow();
  });

  it('allows the same extra on peers that never share a generated config', () => {
    const exit = { ...hub, extraAllowedIPs: ['192.168.0.0/24'] };
    const backup = peer('9', { extraAllowedIPs: ['192.168.0.0/24'] });
    expect(validateRouting([exit, backup, client], network)).toEqual([]);
  });
});
