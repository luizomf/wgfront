import { describe, expect, it } from 'vitest';
import { exportStructure, MAX_STRUCTURE_BYTES, parseStructure } from '../structure';
import type { NetworkConfig, Peer } from '../types';

const network: NetworkConfig = { subnet: '10.100.0', port: 51820, keepalive: 25, topology: 'hybrid', gatewayId: '8' };
const peers: Peer[] = [
  { id: '8', name: 'exit', label: 'Exit server', lanIp: '', publicEndpointIp: 'vpn.example.com', wgOctet: 8, role: 'hub', fullTunnel: false, gatewayId: '', natGateway: true, natInterface: 'eth0', keys: { privateKey: 'PRIVATE_SECRET', publicKey: 'PUBLIC_SECRET' } },
  { id: '108', name: 'client', label: 'Client', lanIp: '192.168.0.108', publicEndpointIp: '', wgOctet: 108, role: 'spoke', fullTunnel: true, gatewayId: '8', natGateway: false, natInterface: '', keys: { privateKey: 'PRIVATE_CLIENT', publicKey: 'PUBLIC_CLIENT' } },
];

function document(): any {
  return JSON.parse(exportStructure(network, peers));
}

describe('structure format', () => {
  it('round-trips all network and peer settings, without any key material', () => {
    const json = exportStructure(network, peers);
    expect(json).not.toMatch(/keys|privateKey|publicKey|PRIVATE_|PUBLIC_/);
    expect(parseStructure(json)).toEqual({ version: 1, network, peers: peers.map(({ keys, ...peer }) => peer) });
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
    (d: any) => { d.version = 2; },
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
