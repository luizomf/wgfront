import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateRouting } from '../routing';
import { DEFAULT_DNS } from '../dns';

vi.mock('../crypto', () => ({
  generateKeyPair: vi.fn(async () => ({ privateKey: 'test-private', publicKey: 'test-public' })),
}));

beforeEach(() => vi.resetModules());

describe('routing selections in the editor', () => {
  it('starts without an implicit gateway and uses hub/spoke roles for new nodes', async () => {
    const store = await import('../store');
    await store.addPeer();
    await store.addPeer();
    const { peers, network } = store.getState();
    expect(network.gatewayId).toBe('');
    expect(network.dns).toBe(DEFAULT_DNS);
    expect(peers.map((peer) => peer.dns)).toEqual([null, null]);
    expect(peers.map((peer) => peer.gatewayId)).toEqual(['', '']);
    expect(peers.map((peer) => peer.role)).toEqual(['hub', 'spoke']);
  });

  it('keeps keys and routing untouched when DNS changes and preserves DNS through key regeneration', async () => {
    const store = await import('../store');
    await store.addPeer();
    const before = store.getState().peers[0];
    store.updateNetwork({ dns: '9.9.9.9' });
    store.updatePeer(before.id, { dns: '10.100.0.8' });
    expect(store.getState().peers[0]).toEqual({ ...before, dns: '10.100.0.8' });
    expect(store.getState().peers[0].keys).toBe(before.keys);
    await store.regenerateAllKeys();
    expect(store.getState().network.dns).toBe('9.9.9.9');
    expect(store.getState().peers[0].dns).toBe('10.100.0.8');
  });

  it('keeps a removed per-node gateway invalid rather than using the network fallback', async () => {
    const store = await import('../store');
    await store.addPeer();
    await store.addPeer();
    await store.addPeer();
    const [defaultGateway, overrideGateway, client] = store.getState().peers;
    store.updateNetwork({ topology: 'hybrid', gatewayId: defaultGateway.id });
    store.updatePeer(overrideGateway.id, { role: 'hub' });
    store.updatePeer(client.id, { fullTunnel: true, gatewayId: overrideGateway.id });
    expect(validateRouting(store.getState().peers, store.getState().network)).toEqual([]);

    store.removePeer(overrideGateway.id);
    const { peers, network } = store.getState();
    expect(peers.find((p) => p.id === client.id)?.gatewayId).toBe(overrideGateway.id);
    expect(validateRouting(peers, network).map((issue) => issue.peerId)).toEqual([client.id]);
  });

  it('preserves explicit routing through key regeneration and topology changes', async () => {
    const store = await import('../store');
    await store.addPeer();
    await store.addPeer();
    const [gateway, client] = store.getState().peers;
    store.updateNetwork({ topology: 'hybrid', gatewayId: gateway.id });
    store.updatePeer(client.id, { gatewayId: gateway.id, fullTunnel: true });
    await store.regenerateAllKeys();
    store.updateNetwork({ topology: 'hub-spoke' });
    expect(store.getState().network.gatewayId).toBe(gateway.id);
    expect(store.getState().peers[1].gatewayId).toBe(gateway.id);
    expect(validateRouting(store.getState().peers, store.getState().network)).toEqual([]);
  });
});
