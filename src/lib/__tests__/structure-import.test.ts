import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportStructure } from '../structure';
import type { KeyPair } from '../types';

const { generateKeyPair } = vi.hoisted(() => ({ generateKeyPair: vi.fn() }));
vi.mock('../crypto', () => ({ generateKeyPair }));

beforeEach(() => {
  vi.resetModules();
  let sequence = 0;
  generateKeyPair.mockReset().mockImplementation(async () => ({ privateKey: `private-${++sequence}`, publicKey: `public-${sequence}` }));
});

async function fixture() {
  const store = await import('../store');
  await store.addPeer();
  await store.addPeer();
  store.updateNetwork({ topology: 'hybrid', gatewayId: '1' });
  store.updatePeer('2', { fullTunnel: true, gatewayId: '1', mtu: 1420 });
  return { store, json: exportStructure(store.getState().network, store.getState().peers) };
}

describe('atomic structure import', () => {
  it('replaces the structure, generates fresh keys, and emits once', async () => {
    const { store, json } = await fixture();
    const oldKeys = store.getState().peers.map((peer) => peer.keys);
    store.updatePeer('1', { name: 'edited' });
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    await store.importStructure(json);
    unsubscribe();
    expect(exportStructure(store.getState().network, store.getState().peers)).toBe(json);
    expect(store.getState().peers.map((peer) => peer.keys)).not.toEqual(oldKeys);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe DNS before generating keys or replacing state', async () => {
    const { store, json } = await fixture();
    const original = store.getState();
    const calls = generateKeyPair.mock.calls.length;
    const data = JSON.parse(json);
    data.peers[0].dns = '1.1.1.1;command';
    await expect(store.importStructure(JSON.stringify(data))).rejects.toThrow('DNS do nó');
    expect(generateKeyPair).toHaveBeenCalledTimes(calls);
    expect(store.getState()).toBe(original);
  });

  it.each([1279, 65536, 1420.5, '1420', 'bad'])('rejects invalid MTU %j before generating keys or replacing state', async (mtu) => {
    const { store, json } = await fixture();
    const original = store.getState();
    const calls = generateKeyPair.mock.calls.length;
    const data = JSON.parse(json);
    data.peers[0].mtu = mtu;
    await expect(store.importStructure(JSON.stringify(data))).rejects.toThrow('MTU');
    expect(generateKeyPair).toHaveBeenCalledTimes(calls);
    expect(store.getState()).toBe(original);
  });

  it('preserves the current editor on parsing or key-generation failure', async () => {
    const { store, json } = await fixture();
    const original = store.getState();
    await expect(store.importStructure('{}')).rejects.toThrow();
    expect(store.getState()).toBe(original);
    generateKeyPair.mockRejectedValueOnce(new Error('crypto failed'));
    await expect(store.importStructure(json)).rejects.toThrow('crypto failed');
    expect(store.getState()).toBe(original);
  });

  it('never overwrites edits made during asynchronous import', async () => {
    const { store, json } = await fixture();
    let resolve!: (keys: KeyPair) => void;
    generateKeyPair.mockImplementationOnce(() => new Promise<KeyPair>((done) => { resolve = done; }));
    const importing = store.importStructure(json);
    store.updatePeer('1', { name: 'keep-my-edit' });
    resolve({ privateKey: 'new-private', publicKey: 'new-public' });
    await expect(importing).rejects.toThrow('editada durante a importação');
    expect(store.getState().peers[0].name).toBe('keep-my-edit');
  });

  it.each(['addPeer', 'regenerateAllKeys'] as const)('prevents pending %s from modifying the imported structure', async (operation) => {
    const { store, json } = await fixture();
    let resolve!: (keys: KeyPair) => void;
    generateKeyPair.mockImplementationOnce(() => new Promise<KeyPair>((done) => { resolve = done; }));
    const pending = store[operation]();
    await store.importStructure(json);
    const imported = store.getState();
    resolve({ privateKey: 'late-private', publicKey: 'late-public' });
    await expect(pending).rejects.toThrow('estrutura mudou');
    expect(store.getState()).toBe(imported);
  });

  it.each(['network', 'peer'])('never reuses a dangling %s gateway reference when adding a node', async (source) => {
    const { json } = await fixture();
    const data = JSON.parse(json);
    data.network.topology = 'mesh';
    data.network.gatewayId = source === 'network' ? '1' : '';
    data.peers = [{ ...data.peers[1], id: 'client', name: 'client', gatewayId: source === 'peer' ? '1' : '' }];
    vi.resetModules();
    const store = await import('../store');
    const { validateRouting } = await import('../routing');
    await store.importStructure(JSON.stringify(data));
    await store.addPeer();
    expect(store.getState().peers.map((peer) => peer.id)).toEqual(['client', '2']);
    expect(validateRouting(store.getState().peers, store.getState().network)).toHaveLength(1);
  });

  it('keeps auto-generated names unique case-insensitively across arbitrary imported IDs', async () => {
    const { json } = await fixture();
    const data = JSON.parse(json);
    data.network = { ...data.network, topology: 'mesh', gatewayId: '' };
    data.peers = [{ ...data.peers[0], id: 'server', name: 'PEER1' }];
    vi.resetModules();
    const store = await import('../store');
    await store.importStructure(JSON.stringify(data));
    await store.addPeer();
    expect(store.getState().peers.map((peer) => peer.name)).toEqual(['PEER1', 'peer2']);
    expect(() => exportStructure(store.getState().network, store.getState().peers)).not.toThrow();
  });

  it('allocates a name after key generation so intervening edits cannot claim it', async () => {
    const { store } = await fixture();
    let resolve!: (keys: KeyPair) => void;
    generateKeyPair.mockImplementationOnce(() => new Promise<KeyPair>((done) => { resolve = done; }));
    const adding = store.addPeer();
    store.updatePeer('1', { name: 'PEER3' });
    resolve({ privateKey: 'new-private', publicKey: 'new-public' });
    await adding;
    expect(store.getState().peers.at(-1)?.name).toBe('peer4');
  });

  it('does not add a node beyond the imported address capacity', async () => {
    const { store, json } = await fixture();
    const data = JSON.parse(json);
    data.peers = Array.from({ length: 254 }, (_, index) => ({
      ...data.peers[0], id: String(index + 1), name: `node${index + 1}`, wgOctet: index + 1,
    }));
    await store.importStructure(JSON.stringify(data));
    const original = store.getState();
    await expect(store.addPeer()).rejects.toThrow('máximo de 254');
    expect(store.getState()).toBe(original);
  });

  it('avoids ID collisions when adding after import into a fresh editor', async () => {
    const { json } = await fixture();
    vi.resetModules();
    const freshStore = await import('../store');
    await freshStore.importStructure(json);
    await freshStore.addPeer();
    expect(freshStore.getState().peers.map((peer) => peer.id)).toEqual(['1', '2', '3']);
  });
});
