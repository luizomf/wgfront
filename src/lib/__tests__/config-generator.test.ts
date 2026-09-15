import { describe, it, expect } from 'vitest';
import {
  generateConfig,
  generateAllConfigs,
  generateKeySummary,
} from '../config-generator';
import type { Peer, NetworkConfig } from '../types';
import { DEFAULT_DNS } from '../dns';

function makePeer(overrides: Partial<Peer> = {}): Peer {
  return {
    id: '1',
    name: 'peer1',
    label: 'Test Peer 1',
    lanIp: '192.168.0.10',
    publicEndpointIp: '',
    wgOctet: 1,
    role: 'hub',
    fullTunnel: false,
    dns: null,
    gatewayId: '',
    natGateway: false,
    natInterface: 'eth0',
    keys: {
      privateKey: 'cFBBbVdGcGxWZWN0b3JUZXN0S2V5UHJpdmF0ZTEyMw==',
      publicKey: 'cFBCbFZlY3RvclRlc3RLZXlQdWJsaWMxMjM0NTY3OA==',
    },
    ...overrides,
  };
}

const network: NetworkConfig = {
  dns: DEFAULT_DNS,
  subnet: '10.100.0',
  port: 51820,
  keepalive: 25,
  topology: 'mesh',
  gatewayId: '',
};

describe('generateConfig', () => {
  it('changes only the DNS line when the inherited default changes', () => {
    const self = makePeer({ fullTunnel: true, gatewayId: '2' });
    const peers = [self, makePeer({ id: '2', wgOctet: 2 })];
    const before = generateConfig(self, peers, network);
    const after = generateConfig(self, peers, { ...network, dns: '9.9.9.9 2620:fe::fe' });
    expect(after).toBe(before.replace(`DNS = ${DEFAULT_DNS}`, 'DNS = 9.9.9.9, 2620:fe::fe'));
  });

  it('allows custom DNS in split tunnel without adding any routes', () => {
    const self = makePeer();
    const custom = { ...self, dns: '10.100.0.8' };
    const before = generateConfig(self, [self], network);
    const after = generateConfig(custom, [custom], network);
    expect(after).toContain('DNS = 10.100.0.8');
    expect(after.replace('DNS = 10.100.0.8\n', '')).toBe(before);
  });

  it('omits DNS on an explicit empty override without changing full-tunnel routes', () => {
    const self = makePeer({ fullTunnel: true, gatewayId: '2' });
    const gateway = makePeer({ id: '2', wgOctet: 2 });
    const custom = { ...self, dns: '' };
    const before = generateConfig(self, [self, gateway], network);
    const after = generateConfig(custom, [custom, gateway], network);
    expect(after).toBe(before.replace(`DNS = ${DEFAULT_DNS}\n`, ''));
    expect(after).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
  });

  it('blocks all config exports for invalid effective DNS, including split-tunnel overrides', () => {
    const self = makePeer({ dns: '1.1.1.1\nPostUp = command' });
    expect(() => generateConfig(self, [self], network)).toThrow('DNS inválido');
    expect(() => generateAllConfigs([self], network)).toThrow('DNS inválido');
    const full = makePeer({ fullTunnel: true, gatewayId: '2' });
    expect(() => generateAllConfigs([full, makePeer({ id: '2', wgOctet: 2 })], { ...network, dns: 'invalid' })).toThrow('DNS inválido');
  });

  it('produces [Interface] section for self', () => {
    const self = makePeer();
    const config = generateConfig(self, [self], network);

    expect(config).toContain('[Interface]');
    expect(config).toContain(`PrivateKey = ${self.keys.privateKey}`);
    expect(config).toContain('ListenPort = 51820');
    expect(config).toContain('Address = 10.100.0.1/24, fd10:100::1/64');
  });

  it('does not include self as a peer', () => {
    const self = makePeer();
    const config = generateConfig(self, [self], network);

    expect(config).not.toContain('[Peer]');
  });

  it('includes other peers with correct fields', () => {
    const self = makePeer({ id: '1', wgOctet: 1 });
    const other = makePeer({
      id: '2',
      name: 'peer2',
      label: 'KVM 2',
      lanIp: '192.168.0.20',
      publicEndpointIp: '76.13.71.178',
      wgOctet: 2,
      keys: {
        privateKey: 'b3RoZXJQcml2YXRlS2V5Rm9yVGVzdGluZ1B1cnBvc2U=',
        publicKey: 'b3RoZXJQdWJsaWNLZXlGb3JUZXN0aW5nUHVycG9zZXM=',
      },
    });

    const config = generateConfig(self, [self, other], network);

    expect(config).toContain('[Peer]');
    expect(config).toContain(`PublicKey = ${other.keys.publicKey}`);
    expect(config).toContain('AllowedIPs = 10.100.0.2/32, fd10:100::2/128');
    expect(config).toContain('Endpoint = 76.13.71.178:51820');
    expect(config).toContain('PersistentKeepalive = 25');
  });

  it('omits Endpoint when publicEndpointIp is empty', () => {
    const self = makePeer({ id: '1', wgOctet: 1 });
    const other = makePeer({
      id: '2',
      wgOctet: 2,
      publicEndpointIp: '',
    });

    const config = generateConfig(self, [self, other], network);

    expect(config).not.toContain('Endpoint =');
  });

  it('uses lanIp in comment when publicEndpointIp is empty', () => {
    const self = makePeer({ id: '1', wgOctet: 1 });
    const other = makePeer({
      id: '2',
      wgOctet: 2,
      lanIp: '192.168.0.20',
      publicEndpointIp: '',
      label: 'Local Peer',
    });

    const config = generateConfig(self, [self, other], network);

    expect(config).toContain('# Local Peer - 192.168.0.20:51820');
  });
});

describe('generateAllConfigs', () => {
  it('returns one config per peer', () => {
    const peers = [
      makePeer({ id: '1', name: 'node1', wgOctet: 1 }),
      makePeer({ id: '2', name: 'node2', wgOctet: 2 }),
    ];

    const configs = generateAllConfigs(peers, network);

    expect(configs).toHaveLength(2);
    expect(configs[0].filename).toBe('node1.conf');
    expect(configs[1].filename).toBe('node2.conf');
  });
});

describe('hub-spoke topology', () => {
  const hubSpokeNetwork: NetworkConfig = { ...network, topology: 'hub-spoke', gatewayId: '1' };

  it('hub sees all other peers', () => {
    const hub = makePeer({ id: '1', role: 'hub', wgOctet: 1 });
    const spoke1 = makePeer({ id: '2', role: 'spoke', wgOctet: 2 });
    const spoke2 = makePeer({ id: '3', role: 'spoke', wgOctet: 3 });

    const config = generateConfig(hub, [hub, spoke1, spoke2], hubSpokeNetwork);

    expect(config).toContain('AllowedIPs = 10.100.0.2/32, fd10:100::2/128');
    expect(config).toContain('AllowedIPs = 10.100.0.3/32, fd10:100::3/128');
  });

  it('spoke routes entire subnet through hub', () => {
    const hub = makePeer({ id: '1', role: 'hub', wgOctet: 1 });
    const spoke1 = makePeer({ id: '2', role: 'spoke', wgOctet: 2 });
    const spoke2 = makePeer({ id: '3', role: 'spoke', wgOctet: 3 });

    const config = generateConfig(spoke1, [hub, spoke1, spoke2], hubSpokeNetwork);

    expect(config).toContain('AllowedIPs = 10.100.0.0/24, fd10:100::/64');
    expect(config).not.toContain('10.100.0.3/32');
  });

  it('hub keeps /32 per spoke', () => {
    const hub = makePeer({ id: '1', role: 'hub', wgOctet: 1 });
    const spoke1 = makePeer({ id: '2', role: 'spoke', wgOctet: 2 });

    const config = generateConfig(hub, [hub, spoke1], hubSpokeNetwork);

    expect(config).toContain('AllowedIPs = 10.100.0.2/32, fd10:100::2/128');
    expect(config).not.toContain('10.100.0.0/24');
  });

  it('mesh topology ignores roles', () => {
    const hub = makePeer({ id: '1', role: 'hub', wgOctet: 1 });
    const spoke1 = makePeer({ id: '2', role: 'spoke', wgOctet: 2 });
    const spoke2 = makePeer({ id: '3', role: 'spoke', wgOctet: 3 });

    const config = generateConfig(spoke1, [hub, spoke1, spoke2], network);

    expect(config).toContain('AllowedIPs = 10.100.0.1/32, fd10:100::1/128');
    expect(config).toContain('AllowedIPs = 10.100.0.3/32, fd10:100::3/128');
  });
});

describe('full tunnel', () => {
  it('adds DNS and 0.0.0.0/0 when fullTunnel is true', () => {
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: true, gatewayId: '2' });
    const hub = makePeer({ id: '2', wgOctet: 2, publicEndpointIp: '1.2.3.4' });

    const config = generateConfig(self, [self, hub], network);

    expect(config).toContain('DNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001');
    expect(config).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(config).not.toContain('AllowedIPs = 10.100.0.2/32');
  });

  it('does not add DNS or 0.0.0.0/0 when fullTunnel is false', () => {
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: false });
    const hub = makePeer({ id: '2', wgOctet: 2 });

    const config = generateConfig(self, [self, hub], network);

    expect(config).not.toContain('DNS');
    expect(config).toContain('AllowedIPs = 10.100.0.2/32, fd10:100::2/128');
  });

  it('only assigns 0.0.0.0/0 to the explicit gateway', () => {
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: true, gatewayId: '2' });
    const peer2 = makePeer({ id: '2', wgOctet: 2 });
    const peer3 = makePeer({ id: '3', wgOctet: 3 });

    const config = generateConfig(self, [self, peer2, peer3], network);

    const matches = config.match(/AllowedIPs = 0\.0\.0\.0\/0/g);
    expect(matches).toHaveLength(1);
    expect(config).toContain('AllowedIPs = 10.100.0.3/32, fd10:100::3/128');
  });

  it('routes full tunnel through the selected NAT gateway instead of first peer', () => {
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: true, gatewayId: '3' });
    const peer2 = makePeer({ id: '2', wgOctet: 2 });
    const natPeer = makePeer({ id: '3', wgOctet: 3, natGateway: true, publicEndpointIp: '1.2.3.4' });

    const config = generateConfig(self, [self, peer2, natPeer], network);

    // peer2 should keep /32 (not the full tunnel target)
    expect(config).toContain('AllowedIPs = 10.100.0.2/32, fd10:100::2/128');
    // natPeer should get 0.0.0.0/0
    expect(config).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(config).not.toContain('AllowedIPs = 10.100.0.3/32');
  });

  it.each([false, true])('rejects an unselected gateway even when NAT is %s', (natGateway) => {
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: true });
    const peer2 = makePeer({ id: '2', wgOctet: 2, natGateway });

    expect(() => generateConfig(self, [self, peer2], network)).toThrow('Selecione um gateway');
  });
});

describe('NAT gateway', () => {
  it('adds PostUp/PostDown rules when natGateway is true', () => {
    const self = makePeer({ id: '1', wgOctet: 1, natGateway: true, natInterface: 'ens3' });
    const other = makePeer({ id: '2', wgOctet: 2 });

    const config = generateConfig(self, [self, other], network);

    expect(config).toContain('PostUp = sysctl -w net.ipv4.ip_forward=1');
    expect(config).toContain('PostUp = sysctl -w net.ipv6.conf.all.forwarding=1');
    expect(config).toContain('PostUp = iptables -t nat -A POSTROUTING -o ens3 -j MASQUERADE');
    expect(config).toContain('PostUp = ip6tables -t nat -A POSTROUTING -o ens3 -j MASQUERADE');
    expect(config).toContain('PostDown = iptables -t nat -D POSTROUTING -o ens3 -j MASQUERADE');
    expect(config).toContain('PostDown = sysctl -w net.ipv4.ip_forward=0');
  });

  it('does not add NAT rules when natGateway is false', () => {
    const self = makePeer({ id: '1', wgOctet: 1, natGateway: false });
    const other = makePeer({ id: '2', wgOctet: 2 });

    const config = generateConfig(self, [self, other], network);

    expect(config).not.toContain('PostUp');
    expect(config).not.toContain('PostDown');
  });

  it('defaults to eth0 when natInterface is empty', () => {
    const self = makePeer({ id: '1', wgOctet: 1, natGateway: true, natInterface: '' });
    const other = makePeer({ id: '2', wgOctet: 2 });

    const config = generateConfig(self, [self, other], network);

    expect(config).toContain('PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE');
  });
});

describe('hybrid and multi-hub routing', () => {
  const hybrid: NetworkConfig = { ...network, topology: 'hybrid', gatewayId: 'kvm8' };
  const servers = [2, 4, 8].map((octet) => makePeer({
    id: `kvm${octet}`, name: `kvm${octet}`, label: `kvm${octet}`,
    wgOctet: octet, role: 'hub', natGateway: octet === 8,
    publicEndpointIp: `203.0.113.${octet}`,
    keys: { privateKey: 'test-private', publicKey: `server-${octet}` },
  }));
  const clients = [108, 109, 114, 137].map((octet) => makePeer({
    id: `client${octet}`, name: `client${octet}`, label: `client${octet}`,
    wgOctet: octet, role: 'spoke', fullTunnel: true,
    keys: { privateKey: 'test-private', publicKey: `client-${octet}` },
  }));
  const peers = [...servers, ...clients];

  function peerBlocks(config: string): Map<string, string> {
    return new Map(config.split('[Peer]\n').slice(1).map((block) => [
      block.match(/^PublicKey = (.+)$/m)![1],
      block.match(/^AllowedIPs = (.+)$/m)![1],
    ]));
  }

  it('reproduces three servers and four roaming/LAN clients in both directions', () => {
    const configs = generateAllConfigs(peers, hybrid);
    for (const client of clients) {
      const config = configs.find((c) => c.peerId === client.id)!.content;
      expect(peerBlocks(config)).toEqual(new Map([
        ['server-2', '10.100.0.2/32, fd10:100::2/128'],
        ['server-4', '10.100.0.4/32, fd10:100::4/128'],
        ['server-8', '0.0.0.0/0, ::/0'],
      ]));
      expect(config).not.toContain('10.100.0.0/24');
      expect(config).not.toContain('192.168.0.0/24');
      expect(config.match(/^Endpoint = /gm)).toHaveLength(3);
    }
    for (const server of servers) {
      const config = configs.find((c) => c.peerId === server.id)!.content;
      const blocks = peerBlocks(config);
      expect(blocks.size).toBe(6);
      for (const other of peers.filter((peer) => peer.id !== server.id)) {
        expect(blocks.get(other.keys.publicKey)).toBe(`10.100.0.${other.wgOctet}/32, fd10:100::${other.wgOctet}/128`);
      }
      expect(config.match(/^Endpoint = /gm)).toHaveLength(2);
    }
  });

  it('keeps split hybrid clients on direct host routes only', () => {
    const splitPeers = peers.map((peer) => ({ ...peer, fullTunnel: false }));
    const config = generateConfig(splitPeers[3], splitPeers, { ...hybrid, gatewayId: '' });
    expect(peerBlocks(config)).toEqual(new Map([
      ['server-2', '10.100.0.2/32, fd10:100::2/128'],
      ['server-4', '10.100.0.4/32, fd10:100::4/128'],
      ['server-8', '10.100.0.8/32, fd10:100::8/128'],
    ]));
    expect(config).not.toContain('DNS =');
  });

  it('assigns the WG subnet to exactly one selected hub in split hub-spoke', () => {
    const splitPeers = peers.map((peer) => ({ ...peer, fullTunnel: false }));
    const config = generateConfig(splitPeers[3], splitPeers, { ...hybrid, topology: 'hub-spoke' });
    expect(peerBlocks(config)).toEqual(new Map([
      ['server-2', '10.100.0.2/32, fd10:100::2/128'],
      ['server-4', '10.100.0.4/32, fd10:100::4/128'],
      ['server-8', '10.100.0.0/24, fd10:100::/64'],
    ]));
  });

  it('does not let other hubs steal client traffic from a full tunnel gateway', () => {
    const config = generateConfig(clients[0], peers, { ...hybrid, topology: 'hub-spoke' });
    expect(peerBlocks(config).get('server-8')).toBe('0.0.0.0/0, ::/0');
    expect(config).not.toContain('10.100.0.0/24');
    expect(config).not.toContain('fd10:100::/64');
  });

  it('lets a peer override the network gateway without requiring generated NAT', () => {
    const overridden = peers.map((peer) => peer.id === clients[0].id ? { ...peer, gatewayId: 'kvm4' } : peer);
    const configs = generateAllConfigs(overridden, hybrid);
    expect(peerBlocks(configs[3].content).get('server-4')).toBe('0.0.0.0/0, ::/0');
    expect(peerBlocks(configs[3].content).get('server-8')).toBe('10.100.0.8/32, fd10:100::8/128');
    expect(peerBlocks(configs[4].content).get('server-8')).toBe('0.0.0.0/0, ::/0');
  });

  it('does not change route ownership when peers are reordered', () => {
    expect(peerBlocks(generateConfig(clients[0], [...peers].reverse(), hybrid)))
      .toEqual(peerBlocks(generateConfig(clients[0], peers, hybrid)));
  });

  it('refuses to export any configs when the chosen gateway was removed', () => {
    expect(() => generateAllConfigs(peers.filter((p) => p.id !== 'kvm8'), hybrid))
      .toThrow('O gateway selecionado precisa existir');
  });
});

describe('generateKeySummary', () => {
  it('lists all peers with keys and IPs', () => {
    const peer = makePeer();
    const summary = generateKeySummary([peer], network);

    expect(summary).toContain('peer1');
    expect(summary).toContain(`private: ${peer.keys.privateKey}`);
    expect(summary).toContain(`public : ${peer.keys.publicKey}`);
    expect(summary).toContain('wg ip  : 10.100.0.1/24, fd10:100::1/64');
  });
});
