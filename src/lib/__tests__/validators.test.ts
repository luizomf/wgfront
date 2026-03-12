import { describe, it, expect } from 'vitest';
import {
  isValidIp,
  isValidPort,
  isValidOctet,
  isValidSubnet,
  isOctetUnique,
} from '../validators';

describe('isValidIp', () => {
  it('accepts valid IPs', () => {
    expect(isValidIp('192.168.0.1')).toBe(true);
    expect(isValidIp('10.0.0.0')).toBe(true);
    expect(isValidIp('255.255.255.255')).toBe(true);
  });

  it('rejects invalid IPs', () => {
    expect(isValidIp('256.0.0.1')).toBe(false);
    expect(isValidIp('abc')).toBe(false);
    expect(isValidIp('10.0.0')).toBe(false);
    expect(isValidIp('')).toBe(false);
  });
});

describe('isValidPort', () => {
  it('accepts valid ports', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(51820)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it('rejects invalid ports', () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(1.5)).toBe(false);
  });
});

describe('isValidOctet', () => {
  it('accepts 1-254', () => {
    expect(isValidOctet(1)).toBe(true);
    expect(isValidOctet(254)).toBe(true);
  });

  it('rejects 0, 255, and non-integers', () => {
    expect(isValidOctet(0)).toBe(false);
    expect(isValidOctet(255)).toBe(false);
    expect(isValidOctet(1.5)).toBe(false);
  });
});

describe('isValidSubnet', () => {
  it('accepts valid 3-part subnets', () => {
    expect(isValidSubnet('10.100.0')).toBe(true);
    expect(isValidSubnet('192.168.1')).toBe(true);
  });

  it('rejects invalid subnets', () => {
    expect(isValidSubnet('10.100.0.0')).toBe(false);
    expect(isValidSubnet('10.100')).toBe(false);
    expect(isValidSubnet('abc.def.ghi')).toBe(false);
    expect(isValidSubnet('10.100.256')).toBe(false);
  });
});

describe('isOctetUnique', () => {
  it('returns true when octet appears once', () => {
    expect(isOctetUnique(1, [1, 2, 3])).toBe(true);
  });

  it('returns false when octet appears multiple times', () => {
    expect(isOctetUnique(1, [1, 1, 3])).toBe(false);
  });
});
