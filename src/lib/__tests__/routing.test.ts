import { describe, expect, it } from 'vitest';
import { getGatewayCandidates, planPeerRoutes, validateRouting } from '../routing';
import type { NetworkConfig, Peer, Topology } from '../types';
import { DEFAULT_DNS } from '../dns';

function peer(id: string, overrides: Partial<Peer> = {}): Peer {
  return {
    id, name: id, label: id, lanIp: '', publicEndpointIp: '', wgOctet: Number(id),
    keys: { privateKey: 'test-private', publicKey: `test-public-${id}` },
    role: 'hub', gatewayId: '', fullTunnel: false, dns: null, mtu: null, natGateway: false, natInterface: 'eth0',
    ...overrides,
  };
}

const network: NetworkConfig = {
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
