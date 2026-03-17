import { describe, it, expect } from 'vitest';
import {
  generateConfig,
  generateAllConfigs,
  generateKeySummary,
} from '../config-generator';
import type { Peer, NetworkConfig } from '../types';

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
  subnet: '10.100.0',
  port: 51820,
  keepalive: 25,
  topology: 'mesh',
};

describe('generateConfig', () => {
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
  const hubSpokeNetwork: NetworkConfig = { ...network, topology: 'hub-spoke' };

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
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: true });
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

  it('only assigns 0.0.0.0/0 to first peer to avoid routing conflicts', () => {
    const self = makePeer({ id: '1', wgOctet: 1, fullTunnel: true });
    const peer2 = makePeer({ id: '2', wgOctet: 2 });
    const peer3 = makePeer({ id: '3', wgOctet: 3 });

    const config = generateConfig(self, [self, peer2, peer3], network);

    const matches = config.match(/AllowedIPs = 0\.0\.0\.0\/0/g);
    expect(matches).toHaveLength(1);
    expect(config).toContain('AllowedIPs = 10.100.0.3/32, fd10:100::3/128');
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
