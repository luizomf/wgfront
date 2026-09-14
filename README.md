# WireGuard Config Generator

Generate WireGuard configuration files entirely in your browser.
No server. No tracking. Just math.

**Live:** [wireguard.otaviomiranda.com.br](https://wireguard.otaviomiranda.com.br)

## Features

- **X25519 key generation** via Web Crypto API (no external dependencies)
- **Mesh topology** — full mesh, every node talks to every node
- **Hub-spoke topology** — spokes connect to all hubs, with one explicitly selected hub routing the WG subnet
- **Hybrid topology** — servers mesh with each other; clients connect to every server, never directly to each other
- **Explicit gateway selection** — network default with per-node overrides; no first-peer or NAT-checkbox fallback
- **Full tunnel** — route internet traffic through the selected gateway with `AllowedIPs = 0.0.0.0/0, ::/0`, keeping direct peers on host routes
- **Routing validation** — invalid gateway selections and circular internet exits block config preview and export
- **Structure import/export** — versioned JSON containing nodes and routing settings, never keys; import generates fresh keys for rotation
- **Dual-stack IPv6** — ULA addresses (`fd10:100::X`) alongside IPv4
- **Live config preview** with syntax highlighting
- **Download all** as `.zip` or copy individual configs
- **100% client-side** — nothing leaves your browser

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Astro (static output) |
| UI | Vanilla TypeScript |
| Crypto | Web Crypto API (X25519) |
| ZIP | fflate |
| Tests | Vitest |
| Font | JetBrains Mono (self-hosted) |

## Getting Started

```bash
npm install
npm run dev      # dev server
npm test         # run unit tests
npm run check    # Astro / TypeScript checks
npm run build    # static build → dist/
```

Requires Node.js >= 22.12.0.

Browser regression tests (isolated test browser, not your personal profile):

```bash
npx playwright install chromium  # one-time browser setup
npm run test:e2e                 # builds and tests the static site on 127.0.0.1:4322
# Or use an already-installed Google Chrome:
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

The browser suite serves the production build (no dev-server hot reload) and
covers hybrid peers, ZIP contents, gateway overrides/removal, role/topology
changes, stale export protection, structure round-trips, and mobile layout.

## Browser Support

X25519 key generation requires:

- Chrome 113+
- Firefox 130+
- Safari 17.4+

## How It Works

1. Add nodes and fill in their details (name, IPs, WG octet)
2. Choose topology: **mesh**, **hub-spoke**, or **hybrid**; assign hub/spoke or server/client roles
3. Select a default gateway (or a per-node override) for hub-spoke subnet routing or **full tunnel**
4. Keys are generated client-side via `crypto.subtle.generateKey({ name: 'X25519' })`
5. Download configs and deploy to your machines with `wg-quick`

## Save a Structure for Key Rotation

Use **Export Structure** to save `wireguard-structure.json`. It contains node
names, addresses, roles, gateway choices, and network settings, but **no private
or public keys**. You can save unfinished gateway selections as a draft even
when config export is blocked.

Later, use **Import Structure** (available even in an empty editor). It validates
the file, asks before replacing existing nodes, and generates fresh keys for
every imported node. Then download the new configs and update the matching
public keys on all affected machines. Exporting the JSON does not rotate keys.

The [version 1 format reference](docs/structure-format.md) includes an example and
field constraints for tools or infrastructure agents. This is a network blueprint,
not an executable deployment plan. Share carefully: it still contains hostnames,
IP addresses, and topology. It is not a backup of your current cryptographic keys.

## Hybrid Example

For three VPSs (`kvm2`, `kvm4`, `kvm8`) and several local or roaming devices:

1. Select **hybrid**.
2. Mark the three VPSs as **servers** and the devices as **clients**.
3. Set each server's public endpoint; leave client endpoints empty when they roam or are behind NAT.
4. Select `kvm8` as the network's default gateway.
5. Enable **Full Tunnel** on the clients, not on `kvm8` itself.
6. If `kvm8` runs Linux with iptables/ip6tables, enable **NAT Gateway** there and set its actual outbound interface. Otherwise configure forwarding and internet egress outside the generated config.

Each client gets direct `/32` (IPv4) and `/128` (IPv6) routes to `kvm2` and `kvm4`, and default routes through `kvm8`. Each server gets host routes to all other nodes. Clients have no direct WireGuard peers for each other. Adding a server connects it to every node without manually editing peer lists.

### Connections versus routing

| Mode | Direct peers | Split-tunnel routes | Full-tunnel routes |
|------|--------------|---------------------|--------------------|
| Mesh | Every other node | Host routes only | Default routes on selected gateway; host routes on others |
| Hub-spoke | Hubs: everyone; spokes: hubs only | Spokes: WG subnet on selected hub, host routes on other hubs; hubs: host routes only | Default routes on selected gateway; host routes on others |
| Hybrid | Servers: everyone; clients: servers only | Host routes only; no client-to-client WG relay | Default routes on selected gateway; host routes on other servers |

A gateway is required for **full tunnel in every mode**, and for **split-tunnel spokes in hub-spoke**. A per-node selection overrides the network default. It must point to another directly connected node. Removing that node or changing roles never silently picks a replacement: fix the selection before exporting. Selections are ignored when the current node/mode does not need a gateway.

Only one peer owns each default or WG subnet prefix in a config. More-specific host routes keep traffic to other servers direct. Multiple hubs do **not** imply automatic failover or load balancing.

The **NAT Gateway** checkbox generates Linux firewall hooks; it does not choose any node's route. Gateways need IPv4/IPv6 forwarding and appropriate firewall rules. Internet egress also needs NAT or upstream routing appropriate to the assigned addresses. Hub-spoke relays without NAT still need forwarding/firewall configuration, managed separately. The generator does not inspect or configure remote hosts.

LAN destinations such as `192.168.0.x` normally keep using the existing local LAN route; the generator does not advertise that LAN subnet. Using another client's **WireGuard IP** is different: hybrid full-tunnel clients send it through their gateway, while hybrid split-tunnel clients have no route ownership for that destination. No automatic LAN/roaming endpoint discovery is performed.

## Project Structure

```
src/
  components/       Astro components (Header, PeerList, ConfigPreview, etc.)
  layouts/          Base HTML layout
  lib/              Pure TypeScript logic
    crypto.ts         X25519 key generation
    config-generator  Config string builder
    routing.ts        Direct peer selection, route ownership, and gateway validation
    store.ts          Observable state (pub/sub)
    validators.ts     Input validation
    zip.ts            ZIP download via fflate
  styles/           Global CSS (CRT cyberpunk theme)
  pages/            Single page (index.astro)
```

## License

MIT

## Author

**Otavio Miranda** — [otaviomiranda.com.br](https://www.otaviomiranda.com.br)
