import { describe, expect, it } from 'vitest';
import {
  cidrsOverlap,
  parseCidr,
  parseExtraAllowedIpsInput,
  validateExtraAllowedIps,
} from '../allowed-ips';

describe('CIDR parsing', () => {
  it.each([
    '192.168.0.105/32',
    '192.168.1.0/24',
    '0.0.0.0/0',
    '2001:db8::/32',
    '2001:db8::1/128',
    'fe80::/10',
    '::/0',
  ])('accepts the network %s', (value) => {
    expect(() => parseCidr(value)).not.toThrow();
  });

  it.each([
    '',
    '192.168.0.105',
    '192.168.0.256/32',
    '192.168.0.5/33',
    '192.168.0.5/24',
    '192.168.01.5/32',
    '2001:db8::1',
    '2001:db8::1/64',
    '2001:db8::/129',
    '2001:db8:::/32',
    '2001:db8::g/128',
    '1:2:3:4:5:6:7:8:9/128',
    '::ffff:192.168.0.1/128',
    ' 10.0.0.0/8',
  ])('rejects %j', (value) => {
    expect(() => parseCidr(value)).toThrow();
  });
});

describe('CIDR overlap', () => {
  it.each([
    ['192.168.0.105/32', '192.168.0.105/32', true],
    ['192.168.0.0/24', '192.168.0.105/32', true],
    ['192.168.0.105/32', '192.168.0.0/24', true],
    ['192.168.0.0/24', '192.168.1.0/24', false],
    ['10.0.0.0/8', '192.168.0.0/16', false],
    ['2001:db8::/32', '2001:db8:1::/48', true],
    ['2001:db8::/48', '2001:db8:1::/48', false],
    ['192.168.0.0/24', '2001:db8::/32', false],
  ])('%s and %s overlap: %s', (a, b, expected) => {
    expect(cidrsOverlap(parseCidr(a), parseCidr(b))).toBe(expected);
  });
});

describe('extra AllowedIPs input', () => {
  it('splits on commas, spaces, and new lines and drops empty entries', () => {
    expect(parseExtraAllowedIpsInput(' 192.168.0.105/32,\n2001:db8::/32  10.9.0.0/16,, ')).toEqual([
      '192.168.0.105/32', '2001:db8::/32', '10.9.0.0/16',
    ]);
  });

  it('keeps malformed entries so validation can report them', () => {
    expect(parseExtraAllowedIpsInput('192.168.0.105, nope')).toEqual(['192.168.0.105', 'nope']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseExtraAllowedIpsInput('  \n ')).toEqual([]);
  });
});

describe('extra AllowedIPs validation', () => {
  const subnet = '10.100.0';

  it('accepts an empty list and distinct networks', () => {
    expect(() => validateExtraAllowedIps([], subnet)).not.toThrow();
    expect(() => validateExtraAllowedIps(['192.168.0.105/32', '2001:db8::/32'], subnet)).not.toThrow();
  });

  it.each([
    [null, /lista/],
    ['192.168.0.105/32', /lista/],
    [[1], /inválid/],
    [['192.168.0.105'], /192\.168\.0\.105/],
    [['192.168.0.105/32', '192.168.0.105/32'], /repetid|sobrep/],
    [['192.168.0.0/24', '192.168.0.105/32'], /sobrep/],
    [['10.100.0.5/32'], /sub-rede WireGuard/],
    [['10.0.0.0/8'], /sub-rede WireGuard/],
    [['fd10:100::5/128'], /sub-rede WireGuard/],
    [['0.0.0.0/0'], /sub-rede WireGuard/],
  ])('rejects %j', (value, message) => {
    expect(() => validateExtraAllowedIps(value, subnet)).toThrow(message);
  });

  it('names the network to use when host bits are set', () => {
    expect(() => parseCidr('192.168.0.5/24')).toThrow('192.168.0.0/24');
    expect(() => parseCidr('2001:db8::1/64')).toThrow('2001:db8::/64');
  });

  it('skips the WireGuard subnet check while the subnet is invalid', () => {
    expect(() => validateExtraAllowedIps(['10.100.0.5/32'], '10.100')).not.toThrow();
  });

  it('caps the list size', () => {
    const many = Array.from({ length: 65 }, (_, i) => `172.16.${i}.0/24`);
    expect(() => validateExtraAllowedIps(many, subnet)).toThrow(/64/);
  });
});
