const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

export function isValidIp(ip: string): boolean {
  if (!IP_REGEX.test(ip)) return false;
  return ip.split('.').every((octet) => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isValidOctet(octet: number): boolean {
  return Number.isInteger(octet) && octet >= 1 && octet <= 254;
}

export function isValidSubnet(subnet: string): boolean {
  const parts = subnet.split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => {
    const n = parseInt(part, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === part;
  });
}

export function isOctetUnique(octet: number, peerIds: number[]): boolean {
  return peerIds.filter((id) => id === octet).length <= 1;
}
