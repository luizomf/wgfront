import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyPair } from '../types';
import { EXAMPLE_STRUCTURE_JSON } from '../example-structure';
import { exportStructure } from '../structure';
import { generateAllConfigs } from '../config-generator';
import { pairId, validatePairKeys } from '../psk';

const { generateKeyPair, generatePresharedKey } = vi.hoisted(() => ({
  generateKeyPair: vi.fn(), generatePresharedKey: vi.fn(),
}));
vi.mock('../crypto', () => ({ generateKeyPair, generatePresharedKey }));

beforeEach(() => {
  vi.resetModules();
  let x = 0, psk = 0;
  generateKeyPair.mockReset().mockImplementation(async () => ({ privateKey: `private-${++x}`, publicKey: `public-${x}` }));
  generatePresharedKey.mockReset().mockImplementation(() => btoa(String.fromCharCode(++psk) + '\0'.repeat(31)));
});

async function fixture() {
  const store = await import('../store');
  await store.importStructure(EXAMPLE_STRUCTURE_JSON);
  store.updateNetwork({ usePsk: true });
  return store;
}

function delayKey() {
  let resolve!: (key: KeyPair) => void;
  generateKeyPair.mockImplementationOnce(() => new Promise<KeyPair>((done) => { resolve = done; }));
  return () => resolve({ privateKey: 'delayed-private', publicKey: 'delayed-public' });
}

function failPsk() {
  generatePresharedKey.mockImplementationOnce(() => { throw new Error('entropy unavailable'); });
}

function expectRotated(before: ReturnType<Awaited<ReturnType<typeof fixture>>['getState']>, after: typeof before) {
  for (const peer of after.peers) expect(peer.keys).not.toEqual(before.peers.find((p) => p.id === peer.id)?.keys);
  for (const [id, key] of after.pairKeys) expect(key).not.toBe(before.pairKeys.get(id));
  validatePairKeys(after.peers, after.network, after.pairKeys);
}

describe('atomic PSK editor state', () => {
  it('starts off, consumes no PSK entropy until enabled, discards on disable and refreshes on re-enable', async () => {
    const store = await import('../store');
    expect(store.getState().network.usePsk).toBe(false);
    await store.importStructure(EXAMPLE_STRUCTURE_JSON);
    await store.regenerateAllKeys();
    expect(generatePresharedKey).not.toHaveBeenCalled();
    const { peers, network } = store.getState();
    const baseline = generateAllConfigs(peers, network);
    store.updateNetwork({ usePsk: true });
    const enabled = store.getState();
    expect(enabled.pairKeys.size).toBe(12);
    store.updateNetwork({ usePsk: false });
    expect(store.getState().pairKeys.size).toBe(0);
    expect(generateAllConfigs(store.getState().peers, store.getState().network, store.getState().pairKeys)).toEqual(baseline);
    store.updateNetwork({ usePsk: true });
    for (const [id, key] of store.getState().pairKeys) expect(key).not.toBe(enabled.pairKeys.get(id));
  });

  it('keeps all secrets through ordinary edits and gateway/route changes', async () => {
    const store = await fixture();
    const before = store.getState();
    generatePresharedKey.mockClear();
    store.updateNetwork({ dns: '9.9.9.9', port: 12345, keepalive: 0, gatewayId: 'example-alt', subnet: '10.43.0' });
    store.updatePeer('example-laptop', { name: 'new-name', label: 'new label', dns: '', mtu: 1420,
      gatewayId: 'example-services', fullTunnel: false, natGateway: true, natInterface: 'ens3', publicEndpointIp: '192.0.2.1' });
    expect(store.getState().pairKeys).toEqual(before.pairKeys);
    expect(store.getState().peers.map((p) => p.keys)).toEqual(before.peers.map((p) => p.keys));
    expect(generatePresharedKey).not.toHaveBeenCalled();
  });

  it('reconciles topology, role, addition and removal with only missing edges generated', async () => {
    const store = await fixture();
    const initial = store.getState().pairKeys;
    generatePresharedKey.mockClear();
    store.updateNetwork({ topology: 'mesh' });
    expect(store.getState().pairKeys.size).toBe(15);
    expect(generatePresharedKey).toHaveBeenCalledTimes(3);
    for (const [id, key] of initial) expect(store.getState().pairKeys.get(id)).toBe(key);
    store.updateNetwork({ topology: 'hub-spoke' });
    expect(store.getState().pairKeys).toEqual(initial);
    store.updatePeer('example-laptop', { role: 'hub' });
    expect(store.getState().pairKeys.size).toBe(14);
    store.updatePeer('example-laptop', { role: 'spoke' });
    expect(store.getState().pairKeys).toEqual(initial);
    await store.addPeer();
    const added = store.getState().peers.at(-1)!;
    expect(store.getState().pairKeys.size).toBe(15);
    store.removePeer(added.id);
    expect(store.getState().pairKeys).toEqual(initial);
    store.removePeer('example-services');
    expect(store.getState().pairKeys.size).toBe(7);
    for (const [id, key] of store.getState().pairKeys) expect(initial.get(id)).toBe(key);
  });

  it('can enable/disable empty or singleton states without entropy', async () => {
    const store = await import('../store');
    store.updateNetwork({ usePsk: true });
    await store.addPeer();
    store.updateNetwork({ usePsk: false });
    store.updateNetwork({ usePsk: true });
    store.removePeer(store.getState().peers[0].id);
    expect(store.getState().pairKeys.size).toBe(0);
    expect(generatePresharedKey).not.toHaveBeenCalled();
  });

  it.each(['enable', 'topology', 'role', 'add'] as const)('publishes nothing on %s entropy failure, including failure after partial generation', async (operation) => {
    const store = await fixture();
    if (operation === 'enable') store.updateNetwork({ usePsk: false });
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    generatePresharedKey.mockReturnValueOnce(btoa('x'.repeat(32)));
    failPsk();
    if (operation === 'add') await expect(store.addPeer()).rejects.toThrow('entropy');
    else expect(() => {
      if (operation === 'enable') store.updateNetwork({ usePsk: true });
      if (operation === 'topology') store.updateNetwork({ topology: 'mesh' });
      if (operation === 'role') store.updatePeer('example-laptop', { role: 'hub' });
    }).toThrow('entropy');
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['regenerateAllKeys', 'importStructure'] as const)('%s rotates X25519 and PSKs in exactly one publication', async (operation) => {
    const store = await fixture();
    const before = store.getState();
    const json = exportStructure(before.network, before.peers);
    const listener = vi.fn();
    store.subscribe(listener);
    await store[operation](json);
    expect(listener).toHaveBeenCalledTimes(1);
    expectRotated(before, store.getState());
    expect(exportStructure(store.getState().network, store.getState().peers)).toBe(json);
  });

  it.each(['regenerateAllKeys', 'importStructure', 'addPeer'] as const)('%s preserves whole prior state on X25519 or PSK failure', async (operation) => {
    const store = await fixture();
    const before = store.getState();
    const json = exportStructure(before.network, before.peers);
    generateKeyPair.mockRejectedValueOnce(new Error('X25519 unavailable'));
    await expect(store[operation](json)).rejects.toThrow('X25519');
    expect(store.getState()).toBe(before);
    generatePresharedKey.mockReturnValueOnce(btoa('x'.repeat(32)));
    failPsk();
    await expect(store[operation](json)).rejects.toThrow('entropy');
    expect(store.getState()).toBe(before);
  });

  it('regenerates against latest graph and metadata, including concurrently added nodes', async () => {
    const store = await fixture();
    const before = store.getState();
    const release = delayKey();
    const pending = store.regenerateAllKeys();
    store.updatePeer('example-laptop', { mtu: 1420, name: 'edited', dns: '', role: 'hub' });
    store.updateNetwork({ topology: 'mesh', keepalive: 10 });
    store.removePeer('example-phone');
    await store.addPeer();
    const added = store.getState().peers.at(-1)!;
    const edited = store.getState();
    release();
    await pending;
    expectRotated(before, store.getState());
    expect(store.getState().peers.at(-1)!.keys).not.toEqual(added.keys);
    expect(store.getState().pairKeys.size).toBe(15);
    expect(exportStructure(store.getState().network, store.getState().peers)).toBe(exportStructure(edited.network, edited.peers));
  });

  it('regeneration failure retains concurrent metadata and all currently active keys', async () => {
    const store = await fixture();
    const release = delayKey();
    const pending = store.regenerateAllKeys();
    store.updatePeer('example-laptop', { name: 'keep-this', mtu: 1420 });
    const edited = store.getState();
    failPsk();
    release();
    await expect(pending).rejects.toThrow('entropy');
    expect(store.getState()).toBe(edited);
  });

  it('a pending add uses current topology/enablement and preserves concurrent metadata', async () => {
    const store = await fixture();
    const release = delayKey();
    const pending = store.addPeer();
    store.updateNetwork({ topology: 'mesh' });
    store.updatePeer('example-laptop', { name: 'keep-this' });
    release();
    await pending;
    const state = store.getState();
    expect(state.pairKeys.size).toBe(21);
    expect(state.peers.find((p) => p.id === 'example-laptop')?.name).toBe('keep-this');
    validatePairKeys(state.peers, state.network, state.pairKeys);
  });

  it.each(['metadata', 'disable', 'regenerate'] as const)('aborts stale imports after concurrent %s without PSK generation', async (edit) => {
    const store = await fixture();
    const json = exportStructure(store.getState().network, store.getState().peers);
    const release = delayKey();
    const pending = store.importStructure(json);
    if (edit === 'metadata') store.updatePeer('example-laptop', { mtu: 1420 });
    if (edit === 'disable') store.updateNetwork({ usePsk: false });
    if (edit === 'regenerate') await store.regenerateAllKeys();
    const edited = store.getState();
    generatePresharedKey.mockClear();
    release();
    await expect(pending).rejects.toThrow('editada durante a importação');
    expect(store.getState()).toBe(edited);
    expect(generatePresharedKey).not.toHaveBeenCalled();
  });

  it.each(['addPeer', 'regenerateAllKeys'] as const)('blocks stale %s after a fresh enabled import', async (operation) => {
    const store = await fixture();
    const json = exportStructure(store.getState().network, store.getState().peers);
    const release = delayKey();
    const pending = store[operation]();
    await store.importStructure(json);
    const imported = store.getState();
    release();
    await expect(pending).rejects.toThrow('estrutura mudou');
    expect(store.getState()).toBe(imported);
  });

  it('drops all pair material when importing a legacy disabled structure', async () => {
    const store = await fixture();
    const data = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    data.version = 3;
    delete data.network.usePsk;
    await store.importStructure(JSON.stringify(data));
    expect(store.getState().network.usePsk).toBe(false);
    expect(store.getState().pairKeys.size).toBe(0);
    expect(store.getState().pairKeys.has(pairId('example-exit', 'example-alt'))).toBe(false);
  });
});
