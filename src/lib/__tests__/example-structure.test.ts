import { describe, expect, it } from 'vitest';
import { EXAMPLE_STRUCTURE_JSON } from '../example-structure';
import { exportStructure, parseStructure } from '../structure';
import { generateAllConfigs } from '../config-generator';
import { validateRouting } from '../routing';
import { getState, importStructure, updatePeer } from '../store';
import type { Topology } from '../types';

function examplePeers() {
  return parseStructure(EXAMPLE_STRUCTURE_JSON).peers.map((peer) => ({
    ...peer, keys: { privateKey: `private-${peer.id}`, publicKey: `public-${peer.id}` },
  }));
}

describe('fictitious example structure', () => {
  it('contains no keys and covers servers, NAT, LAN, roaming, full/split tunnels, and gateway overrides', () => {
    const example = parseStructure(EXAMPLE_STRUCTURE_JSON);
    expect(EXAMPLE_STRUCTURE_JSON).not.toMatch(/"keys"|"privateKey"|"publicKey"/);
    expect(example.peers).toHaveLength(6);
    expect(example.peers.filter((peer) => peer.role === 'hub')).toHaveLength(3);
    expect(example.peers.filter((peer) => peer.role === 'spoke')).toHaveLength(3);
    expect(example.peers.filter((peer) => peer.natGateway)).toHaveLength(2);
    expect(example.peers.some((peer) => peer.lanIp && !peer.publicEndpointIp)).toBe(true);
    expect(example.peers.some((peer) => peer.fullTunnel && peer.gatewayId)).toBe(true);
    expect(example.peers.some((peer) => peer.fullTunnel && !peer.gatewayId)).toBe(true);
    expect(example.peers.some((peer) => peer.role === 'spoke' && !peer.fullTunnel)).toBe(true);
    for (const peer of example.peers.filter((peer) => peer.publicEndpointIp)) {
      expect(peer.publicEndpointIp).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/);
    }
  });

  it.each(['hybrid', 'hub-spoke', 'mesh'] as Topology[])('has valid explicit routing when switched to %s', (topology) => {
    const network = { ...parseStructure(EXAMPLE_STRUCTURE_JSON).network, topology };
    const peers = examplePeers();
    expect(validateRouting(peers, network)).toEqual([]);
    expect(generateAllConfigs(peers, network)).toHaveLength(6);
  });

  it('demonstrates distinct internet exits and a host-route-only client', () => {
    const { network } = parseStructure(EXAMPLE_STRUCTURE_JSON);
    const configs = generateAllConfigs(examplePeers(), network);
    const routes = (name: string) => configs.find((config) => config.peerName === name)!.content
      .split('[Peer]\n').slice(1).map((block) => block.match(/^AllowedIPs = (.+)$/m)![1]);
    expect(routes('laptop')).toEqual(['0.0.0.0/0, ::/0', '10.42.0.2/32, fd10:100::2/128', '10.42.0.3/32, fd10:100::3/128']);
    expect(routes('phone')).toEqual(['10.42.0.1/32, fd10:100::1/128', '0.0.0.0/0, ::/0', '10.42.0.3/32, fd10:100::3/128']);
    expect(routes('workstation')).toEqual(['10.42.0.1/32, fd10:100::1/128', '10.42.0.2/32, fd10:100::2/128', '10.42.0.3/32, fd10:100::3/128']);
  });

  it('uses the real import path, creates fresh keys every time, and never mutates the template', async () => {
    await importStructure(EXAMPLE_STRUCTURE_JSON);
    const first = getState().peers.map((peer) => peer.keys);
    updatePeer('example-exit', { name: 'edited-by-user' });
    await importStructure(EXAMPLE_STRUCTURE_JSON);
    const { network, peers } = getState();
    expect(peers.map((peer) => peer.keys)).not.toEqual(first);
    expect(new Set(peers.map((peer) => peer.keys.publicKey)).size).toBe(6);
    expect(JSON.parse(exportStructure(network, peers))).toEqual(JSON.parse(EXAMPLE_STRUCTURE_JSON));
  });
});
