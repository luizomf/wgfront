# WireGuard — Manual Prático de Referência

> Baseado nos deep research reports (Claude, Gemini, GPT).
> Foco: comandos, configs, troubleshooting. Menos teoria, mais terminal.

---

## 1. Instalação

```bash
# Fedora / RHEL
sudo dnf install wireguard-tools

# Ubuntu / Debian
sudo apt install wireguard

# macOS
brew install wireguard-tools
# ou instalar o app WireGuard da App Store

# Verificar se o módulo do kernel está disponível (Linux)
sudo modprobe wireguard
lsmod | grep wireguard
```

---

## 2. Geração de Chaves

```bash
# Gerar par de chaves (privada + pública)
wg genkey | tee privatekey | wg pubkey > publickey

# Gerar preshared key (proteção pós-quântica, uma por par de peers)
wg genpsk > presharedkey

# Permissões corretas (IMPORTANTE)
chmod 600 privatekey presharedkey
```

**Regra de ouro:** gere a chave privada no dispositivo que vai usá-la. Nunca transfira chaves privadas pela rede.

---

## 3. Configs Completas por Cenário

### 3.1 Hub-and-Spoke (VPS como hub central)

**VPS (Hub) — `/etc/wireguard/wg0.conf`**

```ini
[Interface]
PrivateKey = <VPS_PRIVATE_KEY>
Address = 10.0.0.1/24
ListenPort = 51820

# Habilita forwarding e NAT (IPv4 + IPv6) ao subir a interface
PostUp   = sysctl -w net.ipv4.ip_forward=1; sysctl -w net.ipv6.conf.all.forwarding=1
PostUp   = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT
PostUp   = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostUp   = ip6tables -A FORWARD -i %i -j ACCEPT; ip6tables -A FORWARD -o %i -j ACCEPT
PostUp   = ip6tables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
PostDown = ip6tables -D FORWARD -i %i -j ACCEPT; ip6tables -D FORWARD -o %i -j ACCEPT
PostDown = ip6tables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# Cliente 1 — Notebook
[Peer]
PublicKey = <NOTEBOOK_PUBLIC_KEY>
PresharedKey = <PSK_VPS_NOTEBOOK>
AllowedIPs = 10.0.0.2/32

# Cliente 2 — Celular
[Peer]
PublicKey = <CELULAR_PUBLIC_KEY>
PresharedKey = <PSK_VPS_CELULAR>
AllowedIPs = 10.0.0.3/32

# Cliente 3 — Servidor doméstico (Boa Esperança)
[Peer]
PublicKey = <SERVIDOR_PUBLIC_KEY>
PresharedKey = <PSK_VPS_SERVIDOR>
AllowedIPs = 10.0.0.4/32, 192.168.1.0/24  # túnel + LAN da casa
```

**Cliente (Notebook) — `/etc/wireguard/wg0.conf`**

```ini
[Interface]
PrivateKey = <NOTEBOOK_PRIVATE_KEY>
Address = 10.0.0.2/32
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = <VPS_PUBLIC_KEY>
PresharedKey = <PSK_VPS_NOTEBOOK>
Endpoint = <IP_PUBLICO_VPS>:51820
AllowedIPs = 0.0.0.0/0, ::/0           # full tunnel (todo tráfego pela VPN)
# AllowedIPs = 10.0.0.0/24             # split tunnel (só rede interna)
PersistentKeepalive = 25
```

> **Nota sobre `eth0`:** na VPS Hostinger, a interface pública pode ser `ens3`, `enp1s0`, etc.
> Descubra com: `ip route show default | awk '{print $5}'`

### 3.2 Site-to-Site (LAN da casa ↔ VPS)

**Servidor doméstico (gateway WireGuard da LAN)**

```ini
[Interface]
PrivateKey = <SERVIDOR_PRIVATE_KEY>
Address = 10.0.0.4/32

# Habilita forwarding para a LAN
PostUp  = sysctl -w net.ipv4.ip_forward=1
PostUp  = iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT
PostUp  = iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT

[Peer]
PublicKey = <VPS_PUBLIC_KEY>
PresharedKey = <PSK_VPS_SERVIDOR>
Endpoint = <IP_PUBLICO_VPS>:51820
AllowedIPs = 10.0.0.0/24               # sub-rede do túnel
PersistentKeepalive = 25
```

**Na VPS**, o peer do servidor doméstico inclui a LAN:

```ini
[Peer]
PublicKey = <SERVIDOR_PUBLIC_KEY>
AllowedIPs = 10.0.0.4/32, 192.168.1.0/24
```

**Nos dispositivos da LAN** (que NÃO rodam WireGuard), adicione rota estática apontando para o gateway WireGuard:

```bash
# Em cada máquina da LAN, ou no roteador:
sudo ip route add 10.0.0.0/24 via 192.168.1.X  # X = IP local do servidor WG
```

### 3.3 Exposição de Serviço Local (Reverse Tunnel + Nginx)

Cenário: Home Assistant rodando em `192.168.1.100:8123` na LAN, acessível via domínio público.

**Na VPS — nginx reverse proxy (`/etc/nginx/conf.d/homeassistant.conf`)**

```nginx
server {
    listen 443 ssl http2;
    server_name ha.seudominio.com;

    ssl_certificate     /etc/letsencrypt/live/ha.seudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ha.seudominio.com/privkey.pem;

    location / {
        proxy_pass http://10.0.0.4:8123;  # IP do servidor doméstico no túnel WG
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (necessário para Home Assistant)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
# Gerar certificado SSL
sudo certbot --nginx -d ha.seudominio.com
```

### 3.4 Dual-Stack IPv6

```ini
[Interface]
PrivateKey = <PRIVATE_KEY>
Address = 10.0.0.2/32, fd00:wg::2/128     # IPv4 + IPv6 ULA
DNS = 1.1.1.1, 2606:4700:4700::1111

[Peer]
PublicKey = <VPS_PUBLIC_KEY>
Endpoint = <IP_PUBLICO_VPS>:51820
AllowedIPs = 0.0.0.0/0, ::/0              # full tunnel dual-stack
PersistentKeepalive = 25
```

**Na VPS, habilite forwarding + FORWARD + masquerade IPv6 (adicionar no PostUp):**

```bash
sysctl -w net.ipv6.conf.all.forwarding=1
ip6tables -A FORWARD -i wg0 -j ACCEPT
ip6tables -A FORWARD -o wg0 -j ACCEPT
ip6tables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
```

> **Atenção:** sem as regras de FORWARD no ip6tables, o masquerade sozinho não basta — o kernel dropa o tráfego v6 antes de chegar no NAT.

---

## 4. Comandos Operacionais

### Gerenciamento da Interface

```bash
# Subir / derrubar
sudo wg-quick up wg0
sudo wg-quick down wg0

# Habilitar no boot (systemd)
sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0

# Recarregar config SEM derrubar (adicionar/remover peers on-the-fly)
sudo wg syncconf wg0 <(sudo wg-quick strip wg0)
```

### Monitoramento

```bash
# Status completo (handshake, transferência, endpoint real)
sudo wg show
sudo wg show wg0

# Formato parseable (bom para scripts/prometheus)
sudo wg show all dump

# Monitorar em tempo real
watch -n 2 'sudo wg show wg0'

# Ver interface e IPs atribuídos
ip addr show wg0

# Ver rotas instaladas pelo wg-quick
ip route show table all | grep wg0
ip rule show
```

### Debug de Rede

```bash
# Testar conectividade básica pelo túnel
ping -c 4 10.0.0.1

# Verificar se o UDP chega na VPS (rodar na VPS)
sudo tcpdump -i eth0 udp port 51820 -n

# Testar MTU (achar o valor máximo sem fragmentação)
ping -c 4 -M do -s 1392 10.0.0.1    # começa com 1392, vai subindo
# Se funcionar com 1392: MTU = 1392 + 28 (header IP+ICMP) = 1420 ✓
# Se falhar, reduza até passar

# Verificar se ip_forward está ativo
cat /proc/sys/net/ipv4/ip_forward     # deve retornar 1

# Listar regras iptables relevantes
sudo iptables -L FORWARD -n -v
sudo iptables -t nat -L POSTROUTING -n -v

# Com nftables
sudo nft list ruleset

# Verificar portas abertas
sudo ss -ulnp | grep 51820

# Testar DNS pelo túnel
dig @1.1.1.1 google.com
nslookup google.com 1.1.1.1

# Verificar seu IP público (confirmar se está saindo pela VPN)
curl -4 ifconfig.me
curl -6 ifconfig.me
```

### Kernel Debug (usar com moderação)

```bash
# Ativar debug do módulo wireguard no kernel
echo "module wireguard +p" | sudo tee /sys/kernel/debug/dynamic_debug/control

# Acompanhar logs
sudo dmesg -wT | grep wireguard

# DESATIVAR quando terminar (gera MUITO output)
echo "module wireguard -p" | sudo tee /sys/kernel/debug/dynamic_debug/control
```

---

## 5. Firewall — Exemplos Práticos

### iptables (VPS como exit node)

```bash
# Habilitar forwarding
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.d/99-wireguard.conf

# NAT (masquerade) — necessário para exit node
IFACE=$(ip route show default | awk '{print $5}')
sudo iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE

# Permitir forward de/para wg0
sudo iptables -A FORWARD -i wg0 -j ACCEPT
sudo iptables -A FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT

# Firewall restritivo na VPS (só WireGuard + SSH + HTTP/S)
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
sudo iptables -A INPUT -p udp --dport 51820 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo iptables -A INPUT -j DROP
```

### nftables (alternativa moderna)

```bash
sudo nft add table inet wireguard
sudo nft add chain inet wireguard forward '{ type filter hook forward priority 0; policy drop; }'
sudo nft add rule inet wireguard forward iifname "wg0" accept
sudo nft add rule inet wireguard forward oifname "wg0" ct state related,established accept

# NAT
sudo nft add table ip nat
sudo nft add chain ip nat postrouting '{ type nat hook postrouting priority 100; }'
sudo nft add rule ip nat postrouting oifname "eth0" masquerade
```

### Persistir regras

```bash
# iptables — Fedora/RHEL
sudo dnf install iptables-services
sudo iptables-save | sudo tee /etc/sysconfig/iptables

# iptables — Debian/Ubuntu
sudo apt install iptables-persistent
sudo netfilter-persistent save

# nftables — salvar config
sudo nft list ruleset | sudo tee /etc/nftables.conf
sudo systemctl enable nftables
```

---

## 6. Troubleshooting — Árvore de Decisão

```
Problema: túnel não funciona
│
├─ wg show → sem handshake?
│  ├─ Verificar: chaves públicas estão corretas e cruzadas?
│  ├─ Verificar: endpoint (IP:porta) está correto?
│  ├─ Verificar: firewall da VPS permite UDP/51820 inbound?
│  │  └─ sudo ufw allow 51820/udp  OU  iptables -A INPUT -p udp --dport 51820 -j ACCEPT
│  ├─ Verificar: ISP bloqueia UDP? (raro, mas acontece)
│  │  └─ Testar com: nc -u -z <IP_VPS> 51820
│  └─ tcpdump na VPS: sudo tcpdump -i eth0 udp port 51820 -c 10
│
├─ Handshake OK, mas sem tráfego?
│  ├─ ping pelo túnel falha? → problema de roteamento
│  ├─ Verificar AllowedIPs — destino está incluído?
│  ├─ ip route show → rota para destino aponta para wg0?
│  ├─ ip_forward habilitado no hub? → cat /proc/sys/net/ipv4/ip_forward
│  └─ Regras FORWARD no iptables permitem tráfego?
│
├─ Funciona numa direção só?
│  ├─ Falta MASQUERADE/SNAT no servidor
│  ├─ Firewall assimétrico (permite ida, bloqueia volta)
│  └─ Rota de retorno — o destino sabe voltar? (ip route)
│
├─ Funciona mas cai intermitentemente?
│  ├─ PersistentKeepalive configurado? (25 é o padrão razoável)
│  ├─ CGNAT do ISP com timeout agressivo → testar com 15
│  └─ Conflito de IP na rede interna?
│
└─ Sites carregam parcialmente / SSH trava?
   ├─ Problema de MTU! Padrão do WG: 1420
   ├─ Com PPPoE (comum em fibra BR): testar 1380 ou 1280
   ├─ Testar: ping -M do -s 1372 10.0.0.1  (reduzir até funcionar)
   └─ Ajustar no [Interface]: MTU = 1380
```

---

## 7. MTU — Referência Rápida

| Link físico              | MTU recomendado para wg0 |
|--------------------------|--------------------------|
| Ethernet padrão (1500)   | 1420                     |
| PPPoE (1492)             | 1412                     |
| PPPoE + overhead (1480)  | 1380                     |
| 4G/LTE (variável)       | 1280 (safe minimum)      |
| IPv6 sobre IPv4          | 1400                     |

**Fórmula:** `MTU_wg0 = MTU_link - 60` (IPv4) ou `MTU_link - 80` (IPv6)

---

## 8. Split Tunnel vs Full Tunnel

```ini
# FULL TUNNEL — todo tráfego passa pela VPN
AllowedIPs = 0.0.0.0/0, ::/0

# SPLIT TUNNEL — só rede interna e IPs específicos
AllowedIPs = 10.0.0.0/24, 192.168.1.0/24

# SPLIT TUNNEL — excluir um range (truque com AllowedIPs Calculator)
# Ex: tudo pela VPN EXCETO a LAN local 192.168.1.0/24
# Use: https://www.procustodibus.com/blog/2021/03/wireguard-allowedips-calculator/
```

### Roteamento por processo (policy routing avançado)

```bash
# Desabilita rotas automáticas do wg-quick
# No [Interface]: Table = off

# Marcar tráfego de um usuário específico
sudo iptables -t mangle -A OUTPUT -m owner --uid-owner 1001 -j MARK --set-mark 200

# Criar tabela de roteamento customizada
echo "200 vpn" | sudo tee -a /etc/iproute2/rt_tables
sudo ip rule add fwmark 200 table vpn
sudo ip route add default dev wg0 table vpn
```

---

## 9. Segurança / Hardening

```bash
# Permissões dos arquivos de config (CRÍTICO)
sudo chmod 600 /etc/wireguard/wg0.conf
sudo chown root:root /etc/wireguard/wg0.conf

# SSH hardening na VPS
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Verificar vazamento de DNS (deve mostrar o DNS da VPN, não o do ISP)
curl -s https://am.i.mullvad.net/json | python3 -m json.tool
# ou
resolvectl status wg0

# Kill-switch simples (bloqueia tráfego se a VPN cair)
# Adicionar ao PostUp da config do cliente:
PostUp  = iptables -I OUTPUT ! -o wg0 -m mark ! --mark $(wg show wg0 fwmark) -m addrtype ! --dst-type LOCAL -j REJECT
PostDown = iptables -D OUTPUT ! -o wg0 -m mark ! --mark $(wg show wg0 fwmark) -m addrtype ! --dst-type LOCAL -j REJECT
```

---

## 10. Adição Dinâmica de Peers (sem restart)

```bash
# Gerar chaves do novo peer
wg genkey | tee /tmp/new_peer_priv | wg pubkey > /tmp/new_peer_pub
wg genpsk > /tmp/new_psk

# Adicionar peer no servidor (on-the-fly)
sudo wg set wg0 peer $(cat /tmp/new_peer_pub) \
    preshared-key /tmp/new_psk \
    allowed-ips 10.0.0.5/32

# Salvar a config em disco (senão perde no reboot)
sudo wg-quick strip wg0 | sudo tee /etc/wireguard/wg0.conf.new
# Revisar e mover: sudo mv /etc/wireguard/wg0.conf.new /etc/wireguard/wg0.conf

# Alternativa: editar o .conf e recarregar sem derrubar
sudo wg syncconf wg0 <(sudo wg-quick strip wg0)

# Remover peer
sudo wg set wg0 peer <PUBLIC_KEY_DO_PEER> remove
```

---

## 11. Automação e QR Code (mobile)

```bash
# Instalar qrencode
sudo dnf install qrencode   # Fedora
sudo apt install qrencode   # Debian/Ubuntu

# Gerar QR code da config de um cliente (para escanear no celular)
qrencode -t ansiutf8 < /etc/wireguard/client-phone.conf

# Ou salvar como PNG
qrencode -t png -o /tmp/wg-phone.png < /etc/wireguard/client-phone.conf
```

---

## 12. Script Rápido — Setup Inicial do Servidor

```bash
#!/usr/bin/env bash
set -euo pipefail

WG_IFACE="wg0"
WG_PORT="51820"
WG_NET="10.0.0"
SERVER_IP="${WG_NET}.1/24"
PUB_IFACE=$(ip route show default | awk '{print $5}')

echo "==> Gerando chaves do servidor..."
mkdir -p /etc/wireguard
wg genkey | tee /etc/wireguard/server_private | wg pubkey > /etc/wireguard/server_public
chmod 600 /etc/wireguard/server_private

PRIV=$(cat /etc/wireguard/server_private)

cat > /etc/wireguard/${WG_IFACE}.conf << EOF
[Interface]
PrivateKey = ${PRIV}
Address = ${SERVER_IP}
ListenPort = ${WG_PORT}
PostUp   = sysctl -w net.ipv4.ip_forward=1; sysctl -w net.ipv6.conf.all.forwarding=1; iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_IFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${PUB_IFACE} -j MASQUERADE; ip6tables -A FORWARD -i ${WG_IFACE} -j ACCEPT; ip6tables -A FORWARD -o ${WG_IFACE} -j ACCEPT; ip6tables -t nat -A POSTROUTING -o ${PUB_IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_IFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o ${PUB_IFACE} -j MASQUERADE; ip6tables -D FORWARD -i ${WG_IFACE} -j ACCEPT; ip6tables -D FORWARD -o ${WG_IFACE} -j ACCEPT; ip6tables -t nat -D POSTROUTING -o ${PUB_IFACE} -j MASQUERADE
EOF

chmod 600 /etc/wireguard/${WG_IFACE}.conf

echo "==> Habilitando WireGuard..."
systemctl enable --now wg-quick@${WG_IFACE}

echo "==> Abrindo firewall..."
if command -v ufw &>/dev/null; then
    ufw allow ${WG_PORT}/udp
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port=${WG_PORT}/udp
    firewall-cmd --reload
fi

echo ""
echo "==> Servidor WireGuard configurado!"
echo "    Interface: ${WG_IFACE}"
echo "    Porta:     ${WG_PORT}"
echo "    IP túnel:  ${SERVER_IP}"
echo "    Pub key:   $(cat /etc/wireguard/server_public)"
echo ""
echo "Adicione peers com:"
echo "  wg set ${WG_IFACE} peer <PUBKEY> allowed-ips ${WG_NET}.2/32"
```

---

## 13. Referência Rápida — wg-quick vs wg

| Ação                        | `wg-quick`                          | `wg` (low-level)                     |
|-----------------------------|-------------------------------------|--------------------------------------|
| Subir interface             | `wg-quick up wg0`                   | `ip link add wg0 type wireguard`     |
| Derrubar                    | `wg-quick down wg0`                | `ip link del wg0`                    |
| Configurar                  | Lê `/etc/wireguard/wg0.conf`       | `wg setconf wg0 /path/to/conf`      |
| Adicionar peer              | Editar .conf + `wg syncconf`        | `wg set wg0 peer <KEY> ...`         |
| Ver status                  | —                                   | `wg show wg0`                        |
| Atribuir IP                 | `Address = ...` no .conf            | `ip addr add 10.0.0.1/24 dev wg0`   |
| Rotas automáticas           | Sim (baseado em AllowedIPs)         | Não (manual com `ip route`)          |
| DNS                         | `DNS = ...` no .conf                | Manual (resolvectl/resolv.conf)      |
| PostUp/PostDown hooks       | Sim                                 | Não                                  |

**`wg-quick`** é o wrapper que a maioria usa. **`wg`** é para quando você quer controle total (ex: network namespaces, scripts customizados).

---

## 14. Checklist — Novo Peer

- [ ] Gerar chave privada **no dispositivo destino**
- [ ] Derivar chave pública
- [ ] Gerar PSK para o par
- [ ] Adicionar `[Peer]` no servidor com `PublicKey` + `AllowedIPs` + `PresharedKey`
- [ ] Criar config do cliente com `Endpoint` do servidor
- [ ] Definir `PersistentKeepalive = 25` se atrás de NAT/CGNAT
- [ ] Testar: `wg-quick up wg0` → `ping 10.0.0.1` → `wg show`
- [ ] Verificar handshake recente (< 3 min)
- [ ] Testar MTU se houver problemas de carregamento parcial
- [ ] Persistir: `systemctl enable wg-quick@wg0`
