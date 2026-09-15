import { describe, expect, it } from 'vitest';
import { DEFAULT_DNS, getDnsServers, parseDnsServers } from '../dns';

const network = { dns: DEFAULT_DNS };

describe('DNS servers', () => {
  it('keeps the existing default byte-for-byte', () => {
    expect(DEFAULT_DNS).toBe('1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001');
    expect(getDnsServers({ dns: null, fullTunnel: true }, network).join(', ')).toBe(DEFAULT_DNS);
    expect(getDnsServers({ dns: null, fullTunnel: false }, network)).toEqual([]);
  });

  it('parses comma- and space-separated literal IPv4 and IPv6 without changing their order', () => {
    expect(parseDnsServers(' 9.9.9.9,  2620:fe::fe  ::ffff:192.0.2.1, ')).toEqual([
      '9.9.9.9', '2620:fe::fe', '::ffff:192.0.2.1',
    ]);
  });

  it.each([false, true])('uses an explicit override regardless of full tunnel (%s)', (fullTunnel) => {
    expect(getDnsServers({ dns: '10.100.0.8', fullTunnel }, network)).toEqual(['10.100.0.8']);
    expect(getDnsServers({ dns: '', fullTunnel }, network)).toEqual([]);
  });

  it('allows an empty network default and ignores an unused invalid default', () => {
    expect(getDnsServers({ dns: null, fullTunnel: true }, { dns: '  ' })).toEqual([]);
    expect(getDnsServers({ dns: null, fullTunnel: false }, { dns: 'invalid' })).toEqual([]);
    expect(getDnsServers({ dns: '9.9.9.9', fullTunnel: true }, { dns: 'invalid' })).toEqual(['9.9.9.9']);
  });

  it.each([
    '256.1.1.1', '1.1.1', '01.1.1.1', '0x7f000001', '1.1.1.1:53', '1.1.1.1/32',
    'dns.example.com', 'https://dns.example.com/dns-query', '[::1]', 'fe80::1%eth0',
    '2001:::1', '2001:gg::1', '::ffff:256.1.1.1', ',',
    '1.1.1.1\nPostUp = command', '1.1.1.1;command', '1.1.1.1\x00', '1'.repeat(1025),
  ])('rejects invalid, ambiguous, or injectable DNS: %s', (value) => {
    expect(() => parseDnsServers(value)).toThrow('DNS inválido');
  });
});
