import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePresharedKey } from '../crypto';
import { getPairKey, pairId, reconcilePairKeys, validatePairKeys } from '../psk';
import { generateAllConfigs, generateConfig } from '../config-generator';
import { EXAMPLE_STRUCTURE_JSON } from '../example-structure';
import { exportStructure, parseStructure } from '../structure';
import { DEFAULT_DNS } from '../dns';

function fixture() {
  const { network, peers } = parseStructure(EXAMPLE_STRUCTURE_JSON);
  return { network: { ...network, usePsk: true }, peers: peers.map((peer) => ({
    ...peer, keys: { privateKey: `private-${peer.id}`, publicKey: `public-${peer.id}` },
  })) };
}
afterEach(() => vi.restoreAllMocks());

describe('automatic pair secrets', () => {
  it('uses CSPRNG for exactly 32 bytes with canonical standard base64 and independent calls', () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const keys = Array.from({ length: 100 }, generatePresharedKey);
    expect(new Set(keys).size).toBe(100);
    expect(random).toHaveBeenCalledTimes(100);
    for (const [bytes] of random.mock.calls) expect(bytes).toBeInstanceOf(Uint8Array);
    for (const key of keys) {
      expect(atob(key)).toHaveLength(32);
      expect(btoa(atob(key))).toBe(key);
      expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    }
  });

  it('has no entropy fallback and rejects all-zero generated material', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable'); });
    expect(generatePresharedKey).toThrow('unavailable');
    vi.mocked(crypto.getRandomValues).mockImplementation((bytes) => bytes);
    expect(generatePresharedKey).toThrow('PSK segura');
  });

  it('encodes unordered pair IDs without separator collisions', () => {
    expect(pairId('b', 'a')).toBe(pairId('a', 'b'));
    expect(pairId('a-b', 'c')).not.toBe(pairId('a', 'b-c'));
    expect(pairId('a", "b', 'c')).not.toBe(pairId('a', 'b", "c'));
  });

  it.each([['hybrid', 12], ['hub-spoke', 12], ['mesh', 15]] as const)(
    '%s emits %i unique pairs symmetrically and only adds PSK lines', (topology, count) => {
      const { peers, network } = fixture();
      network.topology = topology;
      const keys = reconcilePairKeys(peers, network);
      expect(keys.size).toBe(count);
      expect(new Set(keys.values()).size).toBe(count);
      const baseline = generateAllConfigs(peers, { ...network, usePsk: false });
      const configs = generateAllConfigs(peers, network, keys);
      const emitted: string[] = [];
      configs.forEach((config, index) => {
        expect(config.content).toBe(generateConfig(peers[index], peers, network, keys));
        expect(config.content.replace(/^PresharedKey = .+\n/gm, '')).toBe(baseline[index].content);
        for (const block of config.content.split('[Peer]\n').slice(1)) {
          const publicKey = block.match(/^PublicKey = (.+)$/m)![1];
          const other = peers.find((peer) => peer.keys.publicKey === publicKey)!;
          const key = block.match(/^PresharedKey = (.+)$/m)![1];
          expect(key).toBe(getPairKey(keys, config.peerId, other.id));
          emitted.push(key);
        }
      });
      expect(emitted).toHaveLength(count * 2);
      for (const key of keys.values()) expect(emitted.filter((value) => value === key)).toHaveLength(2);
    },
  );

  it('retains 12 hybrid edges when mesh adds three, and drops edges when returning', () => {
    const { peers, network } = fixture();
    const hybrid = reconcilePairKeys(peers, network);
    const random = vi.spyOn(crypto, 'getRandomValues');
    const mesh = reconcilePairKeys(peers, { ...network, topology: 'mesh' }, hybrid);
    expect(random).toHaveBeenCalledTimes(3);
    for (const [id, key] of hybrid) expect(mesh.get(id)).toBe(key);
    expect(reconcilePairKeys(peers, network, mesh)).toEqual(hybrid);
    expect(random).toHaveBeenCalledTimes(3);
  });

  it('does not allocate entropy for disabled, empty, singleton, or disconnected graphs', () => {
    const { peers, network } = fixture();
    const random = vi.spyOn(crypto, 'getRandomValues');
    const disabled = { ...network, usePsk: false };
    expect(reconcilePairKeys(peers, disabled)).toEqual(new Map());
    expect(reconcilePairKeys([], network)).toEqual(new Map());
    expect(reconcilePairKeys(peers.slice(0, 1), network)).toEqual(new Map());
    expect(reconcilePairKeys(peers.filter((p) => p.role === 'spoke'), network)).toEqual(new Map());
    expect(generateAllConfigs(peers, disabled).every((c) => !c.content.includes('PresharedKey'))).toBe(true);
    expect(generateAllConfigs(peers.slice(0, 1), network)).toHaveLength(1);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'secret', 'A'.repeat(43) + '=', 'A'.repeat(42) + 'B=',
    'A'.repeat(42) + '_=', 'A'.repeat(43), 'A'.repeat(44), 'A'.repeat(43) + '=\n', 42])(
    'fails closed for missing, zero, noncanonical or malformed material (%#)', (key) => {
      const { peers, network } = fixture();
      const keys = new Map(reconcilePairKeys(peers, network));
      const id = pairId(peers[0].id, peers[1].id);
      if (key === undefined) keys.delete(id);
      else keys.set(id, key as string);
      expect(() => generateAllConfigs(peers, network, keys)).toThrow('PSK');
      expect(() => generateConfig(peers[0], peers, network, keys)).toThrow('PSK');
      expect(() => validatePairKeys(peers, network, keys)).toThrow('PSK');
      expect(() => generateAllConfigs(peers, { ...network, usePsk: false }, keys)).not.toThrow();
    },
  );

  it('never repairs malformed retained keys silently', () => {
    const { peers, network } = fixture();
    const previous = new Map([[pairId(peers[0].id, peers[1].id), 'bad']]);
    expect(() => reconcilePairKeys(peers, network, previous)).toThrow('PSK');
    expect([...previous.values()]).toEqual(['bad']);
  });
});

describe('key-free v4 structure', () => {
  it.each([true, false])('round-trips only the enablement choice %s, even with future secret fields', (usePsk) => {
    const { peers, network } = fixture();
    network.usePsk = usePsk;
    const pairKeys = reconcilePairKeys(peers, network);
    const extended = { ...network, pairKeys, presharedKey: 'SECRET' };
    const json = exportStructure(extended, peers.map((peer) => ({ ...peer, presharedKey: 'SECRET', pairKeys })));
    expect(json).not.toMatch(/SECRET|private-|public-|pairKeys|presharedKey|"keys"/);
    for (const key of pairKeys.values()) expect(json).not.toContain(key);
    const parsed = parseStructure(json);
    expect(parsed.version).toBe(4);
    expect(parsed.network).toEqual(network);
    expect(JSON.parse(EXAMPLE_STRUCTURE_JSON).network.usePsk).toBe(false);
  });

  it.each([1, 2, 3])('migrates strict v%i with PSK off and historical DNS/MTU intact', (version) => {
    const data = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    data.version = version;
    delete data.network.usePsk;
    data.network.dns = '9.9.9.9';
    data.peers[0].mtu = 1420;
    data.peers[0].dns = '';
    if (version === 1) delete data.network.dns;
    for (const peer of data.peers) {
      if (version < 3) delete peer.mtu;
      if (version === 1) delete peer.dns;
    }
    const parsed = parseStructure(JSON.stringify(data));
    expect(parsed.network.usePsk).toBe(false);
    expect(parsed.network.dns).toBe(version === 1 ? DEFAULT_DNS : '9.9.9.9');
    expect(parsed.peers[0].mtu).toBe(version === 3 ? 1420 : null);
    expect(parsed.peers[0].dns).toBe(version === 1 ? null : '');
    data.network.usePsk = false;
    expect(() => parseStructure(JSON.stringify(data))).toThrow('Estrutura inválida');
  });

  it.each([undefined, null, 0, 1, 'true', {}, []])('requires a strict v4 boolean (%#)', (usePsk) => {
    const data = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    data.network.usePsk = usePsk;
    expect(() => parseStructure(JSON.stringify(data))).toThrow('Estrutura inválida');
  });
});
