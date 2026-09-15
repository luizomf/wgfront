import type { NetworkConfig, Peer } from './types';
import { isValidIp } from './validators';

export const DEFAULT_DNS = '1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001';

function isIPv4(value: string): boolean {
  return isValidIp(value) && value.split('.').every((part) => String(Number(part)) === part);
}

function isIPv6(value: string): boolean {
  if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  try {
    // URL parsing validates the IPv6 literal locally; it makes no network request.
    new URL(`http://[${value}]/`);
    return true;
  } catch { return false; }
}

export function parseDnsServers(value: string): string[] {
  const invalid = () => new Error('DNS inválido. Use endereços IPv4 ou IPv6 separados por vírgulas ou espaços, sem portas ou domínios.');
  if (typeof value !== 'string' || value.length > 1024) throw invalid();
  if (!value.trim()) return [];
  const servers = value.trim().split(/[,\s]+/).filter(Boolean);
  if (servers.length === 0 || servers.some((server) => !isIPv4(server) && !isIPv6(server))) throw invalid();
  return servers;
}

export function getDnsServers(
  self: Pick<Peer, 'dns' | 'fullTunnel'>,
  network: Pick<NetworkConfig, 'dns'>,
): string[] {
  const value = self.dns === null ? (self.fullTunnel ? network.dns : '') : self.dns;
  return parseDnsServers(value);
}
