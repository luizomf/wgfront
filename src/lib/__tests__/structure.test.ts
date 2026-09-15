import { describe, expect, it } from 'vitest';
import { exportStructure, MAX_STRUCTURE_BYTES, parseStructure } from '../structure';
import type { NetworkConfig, Peer } from '../types';
import { DEFAULT_DNS } from '../dns';

const network: NetworkConfig = { usePsk: false, dns: DEFAULT_DNS, subnet: '10.100.0', port: 51820, keepalive: 25, topology: 'hybrid', gatewayId: '8' };
const peers: Peer[] = [
  { id: '8', name: 'exit', label: 'Exit server', lanIp: '', publicEndpointIp: 'vpn.example.com', wgOctet: 8, role: 'hub', fullTunnel: false, dns: null, mtu: null, gatewayId: '', natGateway: true, natInterface: 'eth0', keys: { privateKey: 'PRIVATE_SECRET', publicKey: 'PUBLIC_SECRET' } },
  { id: '108', name: 'client', label: 'Client', lanIp: '192.168.0.108', publicEndpointIp: '', wgOctet: 108, role: 'spoke', fullTunnel: true, dns: null, mtu: null, gatewayId: '8', natGateway: false, natInterface: '', keys: { privateKey: 'PRIVATE_CLIENT', publicKey: 'PUBLIC_CLIENT' } },
];

function document(): any {
  return JSON.parse(exportStructure(network, peers));
}

describe('structure format', () => {
  it('round-trips all network and peer settings, without any key material', () => {
    const json = exportStructure(network, peers);
    expect(json).not.toMatch(/keys|privateKey|publicKey|PRIVATE_|PUBLIC_/);
    expect(parseStructure(json)).toEqual({ version: 4, network, peers: peers.map(({ keys, ...peer }) => peer) });
  });

  it('migrates version 1 with the exact original full-tunnel DNS defaults', () => {
    const legacy = document();
    legacy.version = 1;
    delete legacy.network.usePsk;
    delete legacy.network.dns;
    legacy.peers.forEach((peer: any) => { delete peer.dns; delete peer.mtu; });
    const parsed = parseStructure(JSON.stringify(legacy));
    expect(parsed).toEqual(parseStructure(exportStructure(network, peers)));
    expect(parsed.network.dns).toBe(DEFAULT_DNS);
    expect(parsed.peers.every((peer) => peer.dns === null)).toBe(true);
  });

  it('preserves all three DNS meanings and an empty network default in version 3', () => {
    for (const dns of [null, '', '9.9.9.9, 2620:fe::fe']) {
      const customized = peers.map((peer) => ({ ...peer, dns }));
      const parsed = parseStructure(exportStructure({ ...network, dns: '' }, customized));
      expect(parsed.network.dns).toBe('');
      expect(parsed.peers.every((peer) => peer.dns === dns)).toBe(true);
    }
  });

  it('does not silently ignore DNS fields in a version 1 document', () => {
    const legacy = document();
    legacy.version = 1;
    expect(() => parseStructure(JSON.stringify(legacy))).toThrow('Estrutura inválida');
  });

  it('does not accidentally serialize future secret fields', () => {
    const extended = peers.map((peer) => ({ ...peer, futureSecret: 'DO_NOT_EXPORT' }));
    expect(exportStructure({ ...network, futureSecret: 'DO_NOT_EXPORT' } as NetworkConfig, extended)).not.toContain('DO_NOT_EXPORT');
  });

  it('allows an unfinished routing selection to be saved as a draft', () => {
    expect(parseStructure(exportStructure({ ...network, gatewayId: '' }, peers.map((p) => ({ ...p, gatewayId: 'removed' }))))).toBeDefined();
  });

  it.each(['mesh', 'hub-spoke', 'hybrid'] as const)('preserves %s', (topology) => {
    expect(parseStructure(exportStructure({ ...network, topology }, peers)).network.topology).toBe(topology);
  });

  it.each(['not json', 'null', '[]', '{}'])('rejects invalid JSON documents: %s', (json) => {
    expect(() => parseStructure(json)).toThrow('Estrutura inválida');
  });

  it.each([
    (d: any) => { d.version = 5; },
    (d: any) => { delete d.network.dns; },
    (d: any) => { delete d.peers[0].dns; },
    (d: any) => { d.network.dns = null; },
    (d: any) => { d.network.dns = 'dns.example.com'; },
    (d: any) => { d.peers[0].dns = ['1.1.1.1']; },
    (d: any) => { d.peers[0].dns = '1.1.1.1\nPostUp = command'; },
    (d: any) => { d.peers[0].dns = '2001:::1'; },
    (d: any) => { d.network.topology = ['hybrid']; },
    (d: any) => { d.network.port = '51820'; },
    (d: any) => { d.network.keepalive = -1; },
    (d: any) => { d.network.subnet = '10.100.256'; },
    (d: any) => { d.peers[0].keys = { privateKey: 'secret' }; },
    (d: any) => { d.peers[0].PostUp = 'arbitrary command'; },
    (d: any) => { d.peers[0].name = '../file'; },
    (d: any) => { d.peers[0].label = 'comment\nPostUp = command'; },
    (d: any) => { d.peers[0].natInterface = 'eth0;id'; },
    (d: any) => { d.peers[0].fullTunnel = 'false'; },
    (d: any) => { d.peers[0].wgOctet = 255; },
    (d: any) => { d.peers[0].publicEndpointIp = '256.1.2.3'; },
    (d: any) => { d.peers[0].publicEndpointIp = '1.2.3.4:51820'; },
    (d: any) => { d.peers[0].id = '\" onclick=\"'; },
    (d: any) => { d.peers[1].id = d.peers[0].id; },
    (d: any) => { d.peers[1].wgOctet = d.peers[0].wgOctet; },
    (d: any) => { d.peers[1].name = d.peers[0].name.toUpperCase(); },
    (d: any) => { delete d.peers[0].gatewayId; },
    (d: any) => { d.peers = Array(255).fill(d.peers[0]); },
  ])('rejects unsupported, malformed, duplicate, or unsafe fields (%#)', (mutate) => {
    const data = document();
    mutate(data);
    expect(() => parseStructure(JSON.stringify(data))).toThrow('Estrutura inválida');
  });

  it('rejects oversized input before JSON parsing', () => {
    expect(() => parseStructure(' '.repeat(MAX_STRUCTURE_BYTES + 1))).toThrow('1 MB');
  });
});
