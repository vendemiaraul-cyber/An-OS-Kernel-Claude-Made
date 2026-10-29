#!/usr/bin/env bash
# ConMon Lab · Android server
# Real Android (Redroid, Android 12, 64-bit) in Docker on an ARM64 Ubuntu
# server, streamed to any browser with ws-scrcpy, behind HTTPS and a password.
#
# Run on a fresh Ubuntu 22.04/24.04 ARM64 VM (Oracle Cloud Ampere A1 or
# AWS t4g.small or bigger):
#   curl -fsSL https://raw.githubusercontent.com/vendemiaraul-cyber/An-OS-Kernel-Claude-Made/main/android-server/setup.sh | sudo bash
# Optional: PASSWORD=yourpass DOMAIN=android.example.com before "bash".
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
[ "$(uname -m)" = aarch64 ] || echo "Warning: this is $(uname -m); the image used here is for ARM64 servers."

DIR=/opt/conmon-android
USER_NAME=${USER_NAME:-conmon}
PASSWORD=${PASSWORD:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)}
IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN=${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}     # sslip.io names point at your IP, so HTTPS works without buying a domain

echo "== 1/5 Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl "linux-modules-extra-$(uname -r)" || apt-get install -yq ca-certificates curl
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "== 2/5 Android's binder driver"
modprobe binder_linux devices="binder,hwbinder,vndbinder" || {
  echo "This kernel has no binder_linux module. Install linux-modules-extra for it, reboot and run again."; exit 1; }
echo 'binder_linux' > /etc/modules-load.d/redroid.conf
echo 'options binder_linux devices="binder,hwbinder,vndbinder"' > /etc/modprobe.d/redroid.conf

echo "== 3/5 Firewall (ports 80 and 443)"
if command -v iptables >/dev/null && iptables -S INPUT | grep -q REJECT; then   # Oracle's Ubuntu images block them
  for p in 80 443; do iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport $p -j ACCEPT; done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

echo "== 4/5 Files in $DIR"
mkdir -p "$DIR/ws-scrcpy" "$DIR/data"
cat > "$DIR/ws-scrcpy/Dockerfile" <<'DOCKER'
FROM node:16-bullseye
RUN apt-get update && apt-get install -y --no-install-recommends adb git python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/NetrisTV/ws-scrcpy.git /src \
 && cd /src && npm install && npm run dist \
 && cd dist && npm install --omit=dev
WORKDIR /src/dist
# Keep adb attached to the Android container, then serve the web UI on :8000.
CMD sh -c 'while :; do adb connect android:5555 >/dev/null 2>&1; sleep 10; done & exec node index.js'
DOCKER
HASH=$(docker run --rm caddy:2 caddy hash-password --plaintext "$PASSWORD")
cat > "$DIR/Caddyfile" <<CADDY
$DOMAIN {
  basic_auth {
    $USER_NAME $HASH
  }
  reverse_proxy ws-scrcpy:8000
}
CADDY
cat > "$DIR/docker-compose.yml" <<'COMPOSE'
services:
  android:                       # real Android 12, no ports open to the internet
    image: redroid/redroid:12.0.0_64only-latest
    privileged: true
    restart: unless-stopped
    volumes: ["./data:/data"]
    command: ["androidboot.redroid_width=720", "androidboot.redroid_height=1280", "androidboot.redroid_dpi=320", "androidboot.redroid_gpu_mode=guest"]
  ws-scrcpy:                     # streams the screen and sends taps and keys
    build: ./ws-scrcpy
    restart: unless-stopped
    depends_on: [android]
  caddy:                         # HTTPS certificate + password
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy:/data"]
    depends_on: [ws-scrcpy]
volumes:
  caddy: {}
COMPOSE

echo "== 5/5 Starting (the first build takes 5-10 minutes)"
cd "$DIR"
docker compose up -d --build

cat <<DONE

Android is starting (about a minute after this).
  Address:  https://$DOMAIN
  User:     $USER_NAME
  Password: $PASSWORD
In ConMon Lab: Kernel Lab -> Android (your server) -> paste the address.
On the page, tap "redroid"/android:5555 and choose a player (MSE or Broadway).
Also open ports 80 and 443 in your cloud's firewall (Oracle: VCN -> Security List -> Ingress rules).
Stop:   cd $DIR && docker compose down      Reset Android: delete $DIR/data
DONE
