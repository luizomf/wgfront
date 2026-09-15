import type { NetworkConfig, Peer } from './types';
import { isValidIp, isValidOctet, isValidPort, isValidSubnet } from './validators';
import { DEFAULT_DNS, parseDnsServers } from './dns';

export const MAX_STRUCTURE_BYTES = 1_000_000;

export interface NetworkStructure {
  version: 2;
  network: NetworkConfig;
  peers: Omit<Peer, 'keys'>[];
}

function invalid(detail: string): never {
  throw new Error(`Estrutura inválida: ${detail}.`);
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('objeto esperado');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(result, key))) {
    invalid('campos ausentes ou desconhecidos; o arquivo não deve conter chaves WireGuard');
  }
  return result;
}

function text(value: unknown, field: string, max = 255): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid(field);
  return value;
}

function validateDns(value: unknown, field: string): void {
  const result = text(value, field, 1024);
  try { parseDnsServers(result); } catch { invalid(field); }
}

function id(value: unknown, allowEmpty = false): string {
  const result = text(value, 'identificador', 64);
  if (!(allowEmpty && result === '') && !/^[a-zA-Z0-9_-]+$/.test(result)) invalid('identificador');
  return result;
}

function endpoint(value: unknown): string {
  const result = text(value, 'endpoint');
  const hostname = result.length <= 253 && !/^[\d.]+$/.test(result) &&
    result.split('.').every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
  if (result && !isValidIp(result) && !hostname) invalid('endpoint (use IPv4 ou hostname, sem porta)');
  return result;
}

/** Explicit allowlists keep keys and future secret fields out of saved structures. */
export function exportStructure(network: NetworkConfig, peers: Peer[]): string {
  const structure: NetworkStructure = {
    version: 2,
    network: {
      dns: network.dns,
      subnet: network.subnet, port: network.port, keepalive: network.keepalive,
      topology: network.topology, gatewayId: network.gatewayId,
    },
    peers: peers.map((peer) => ({
      id: peer.id, name: peer.name, label: peer.label, lanIp: peer.lanIp,
      publicEndpointIp: peer.publicEndpointIp, wgOctet: peer.wgOctet,
      role: peer.role, fullTunnel: peer.fullTunnel, gatewayId: peer.gatewayId, dns: peer.dns,
      natGateway: peer.natGateway, natInterface: peer.natInterface,
    })),
  };
  const json = JSON.stringify(structure, null, 2) + '\n';
  parseStructure(json);
  return json;
}

/** Parse data only; never import executable hooks or cryptographic key material. */
export function parseStructure(json: string): NetworkStructure {
  if (new TextEncoder().encode(json).byteLength > MAX_STRUCTURE_BYTES) invalid('arquivo maior que 1 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { invalid('JSON não reconhecido'); }
  const root = object(parsed, ['version', 'network', 'peers']);
  if (root.version !== 1 && root.version !== 2) invalid('versão não suportada');
  const legacy = root.version === 1;
  const network = object(root.network, ['subnet', 'port', 'keepalive', 'topology', 'gatewayId', ...(legacy ? [] : ['dns'])]);
  if (legacy) network.dns = DEFAULT_DNS;
  validateDns(network.dns, 'DNS da rede');
  if (!isValidSubnet(text(network.subnet, 'sub-rede'))) invalid('sub-rede');
  if (typeof network.port !== 'number' || !isValidPort(network.port)) invalid('porta');
  if (typeof network.keepalive !== 'number' || !Number.isInteger(network.keepalive) || network.keepalive < 0 || network.keepalive > 600) invalid('keepalive');
  if (typeof network.topology !== 'string' || !['mesh', 'hub-spoke', 'hybrid'].includes(network.topology)) invalid('topologia');
  id(network.gatewayId, true);
  if (!Array.isArray(root.peers) || root.peers.length > 254) invalid('máximo de 254 nós');
  const ids = new Set<string>();
  const octets = new Set<number>();
  const names = new Set<string>();
  const peers = root.peers.map((value) => {
    const peer = object(value, ['id', 'name', 'label', 'lanIp', 'publicEndpointIp', 'wgOctet', 'role', 'fullTunnel', 'gatewayId', 'natGateway', 'natInterface', ...(legacy ? [] : ['dns'])]);
    if (legacy) peer.dns = null;
    if (peer.dns !== null) validateDns(peer.dns, 'DNS do nó');
    const peerId = id(peer.id);
    const name = text(peer.name, 'nome', 64);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) invalid('nome do nó');
    text(peer.label, 'rótulo', 128);
    const lanIp = text(peer.lanIp, 'IP local');
    if (lanIp && !isValidIp(lanIp)) invalid('IP local');
    endpoint(peer.publicEndpointIp);
    if (typeof peer.wgOctet !== 'number' || !isValidOctet(peer.wgOctet)) invalid('octeto WireGuard');
    if (ids.has(peerId) || octets.has(peer.wgOctet) || names.has(name.toLowerCase())) invalid('identificador, nome ou octeto duplicado');
    ids.add(peerId); octets.add(peer.wgOctet); names.add(name.toLowerCase());
    if (peer.role !== 'hub' && peer.role !== 'spoke') invalid('papel do nó');
    if (typeof peer.fullTunnel !== 'boolean' || typeof peer.natGateway !== 'boolean') invalid('opção de túnel ou NAT');
    id(peer.gatewayId, true);
    const natInterface = text(peer.natInterface, 'interface NAT', 15);
    if (natInterface && !/^[a-zA-Z0-9_.:-]+$/.test(natInterface)) invalid('interface NAT');
    return peer as unknown as Omit<Peer, 'keys'>;
  });
  // Unresolved gateways are valid drafts; routing validation still blocks config exports.
  return { version: 2, network: network as unknown as NetworkConfig, peers };
}
