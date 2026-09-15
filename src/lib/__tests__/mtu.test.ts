import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseMtuInput, validateMtu } from '../mtu';
import { generateAllConfigs, generateConfig } from '../config-generator';
import { EXAMPLE_STRUCTURE_JSON } from '../example-structure';
import { exportStructure, parseStructure } from '../structure';
import { validateRouting } from '../routing';
import { DEFAULT_DNS } from '../dns';

function fixture() {
  const { network, peers } = parseStructure(EXAMPLE_STRUCTURE_JSON);
  return { network, peers: peers.map((peer) => ({
    ...peer, keys: { privateKey: `private-${peer.id}`, publicKey: `public-${peer.id}` },
  })) };
}

const invalidValues = [1279, 65536, 0, -1420, 1420.5, NaN, Infinity, -Infinity, '1420', '', undefined, true, [], {}];

describe('MTU validation', () => {
  it.each(['', '   '])('uses automatic for blank input %j', (raw) => {
    expect(parseMtuInput(raw)).toBeNull();
  });

  it.each(['1280', '1420', '65535', ' 1420 '])('accepts complete decimal integers: %j', (raw) => {
    const value = parseMtuInput(raw);
    expect(value).toBe(Number(raw));
    expect(() => validateMtu(value)).not.toThrow();
  });

  it.each(['1420px', '1420.5', '1420.0', '1e3', '0x580', '+1420', '-1420', 'NaN', 'Infinity', '1 420', 'abc', '1\n420'])('never truncates or silently clears malformed input %j', (raw) => {
    expect(parseMtuInput(raw)).toBeNaN();
    expect(() => validateMtu(parseMtuInput(raw))).toThrow('MTU inválido');
  });

  it.each(invalidValues.map((value) => [value]))('rejects invalid values at every config and export entry point: %j', (value) => {
    expect(() => validateMtu(value)).toThrow('MTU inválido');
    const { network, peers } = fixture();
    // Deliberately cross the type boundary to exercise runtime callers too.
    peers[1].mtu = value as number;
    expect(validateRouting(peers, network)).toEqual([
      expect.objectContaining({ peerId: peers[1].id, message: expect.stringContaining('MTU inválido') }),
    ]);
    expect(() => generateConfig(peers[0], peers, network)).toThrow('MTU inválido');
    expect(() => generateAllConfigs(peers, network)).toThrow('MTU inválido');
    expect(() => exportStructure(network, peers)).toThrow('MTU inválido');
  });
});

describe('MTU configs and persistence', () => {
  it('preserves default config bytes from the pre-MTU ff4e9b2 generator', () => {
    const { network, peers } = fixture();
    // Captured from ff4e9b2 with this fixture's synthetic keys, before MTU existed.
    const baseline = {
      mesh: '0fd1a602a8c41dc5e386438cbb44ed5161b5357433a8d67726baf5d1a3008ba4',
      'hub-spoke': '05d98928d1cbe997eeaf67d41fe9941391bc49c7577065402bc4a252d963ee4d',
      hybrid: '41eb8171c0285dc129a9ffffe1c7a573c47c3a8fe04375dbcd4ea0fc8fd34582',
    };
    for (const topology of ['mesh', 'hub-spoke', 'hybrid'] as const) {
      const configs = generateAllConfigs(peers, { ...network, topology });
      expect(createHash('sha256').update(JSON.stringify(configs)).digest('hex')).toBe(baseline[topology]);
    }
  });

  it.each(['mesh', 'hub-spoke', 'hybrid'] as const)('only adds one Interface line to the customized node in %s; clearing restores exact bytes', (topology) => {
    const { network, peers } = fixture();
    network.topology = topology;
    expect(peers.every((peer) => peer.mtu === null)).toBe(true);
    const before = generateAllConfigs(peers, network);
    expect(before.every((config) => !config.content.includes('MTU ='))).toBe(true);
    // Exercise both a NAT exit and a full-tunnel client, preserving DNS, hooks, keys, and routes.
    for (const index of [0, 3]) {
      for (const mtu of [1280, 1420, 65535]) {
        peers[index].mtu = mtu;
        const after = generateAllConfigs(peers, network);
        for (const [i, config] of after.entries()) {
          if (i === index) {
            expect(config.content.match(/^MTU = .+$/gm)).toEqual([`MTU = ${mtu}`]);
            expect(config.content.split('[Peer]')[0]).toContain(`MTU = ${mtu}\n`);
            expect(config.content.replace(`MTU = ${mtu}\n`, '')).toBe(before[i].content);
          } else expect(config).toEqual(before[i]);
        }
      }
      peers[index].mtu = null;
      expect(generateAllConfigs(peers, network)).toEqual(before);
    }
  });

  it('retains independent null and boundary overrides in key-free v3', () => {
    const { network, peers } = fixture();
    peers[0].mtu = 1280;
    peers[1].mtu = 65535;
    const json = exportStructure(network, peers);
    expect(json).not.toMatch(/private-|public-|"keys"/);
    expect(parseStructure(json)).toEqual({ version: 3, network, peers: peers.map(({ keys, ...peer }) => peer) });
  });

  it.each([1, 2])('migrates v%s to automatic without changing historical DNS or other fields', (version) => {
    const data = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    data.version = version;
    data.network.dns = '9.9.9.9';
    data.peers[0].dns = '';
    data.peers[3].dns = '10.42.0.3';
    if (version === 1) delete data.network.dns;
    for (const peer of data.peers) {
      delete peer.mtu;
      if (version === 1) delete peer.dns;
    }
    const result = parseStructure(JSON.stringify(data));
    expect(result.version).toBe(3);
    expect(result.network).toEqual({ ...data.network, dns: version === 1 ? DEFAULT_DNS : '9.9.9.9' });
    expect(result.peers).toEqual(data.peers.map((peer: object) => ({
      ...peer, mtu: null, ...(version === 1 ? { dns: null } : {}),
    })));
    const peers = result.peers.map((peer) => ({ ...peer, keys: { privateKey: 'private', publicKey: 'public' } }));
    expect(parseStructure(exportStructure(result.network, peers))).toEqual(result);
  });

  it.each([1, 2])('rejects MTU fields in strict legacy v%s', (version) => {
    const data = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    data.version = version;
    if (version === 1) {
      delete data.network.dns;
      data.peers.forEach((peer: { dns?: unknown }) => { delete peer.dns; });
    }
    expect(() => parseStructure(JSON.stringify(data))).toThrow('Estrutura inválida');
  });

  it.each(invalidValues.filter((value) => typeof value !== 'number' || Number.isFinite(value)).map((value) => [value]))('rejects invalid or missing v3 MTU: %j', (value) => {
    const data = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    data.peers[0].mtu = value;
    expect(() => parseStructure(JSON.stringify(data))).toThrow('Estrutura inválida');
  });

  it('rejects JSON numeric overflow rather than treating it as automatic', () => {
    expect(() => parseStructure(EXAMPLE_STRUCTURE_JSON.replace('"mtu":null', '"mtu":1e999'))).toThrow('MTU');
  });
});
