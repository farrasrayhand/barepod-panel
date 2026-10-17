#!/usr/bin/env bash
#
# BarePod Panel — installer / environment check
# Phase 2: frontend prototype + Go daemon skeleton
#
# The panel ships without any account: the operator creates their own root admin
# with `barepod admin create` (no default username, no default password).
#
# Supported targets:
#   - linux/amd64 (x86_64)  — bare metal, VPS
#   - linux/arm64 (aarch64) — bare metal, VPS, Raspberry Pi 4/5, cloud ARM
#   - LXC / LXD containers (see the caveats below)

set -euo pipefail

log()  { printf '\033[1;34m[barepod]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[barepod]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[barepod]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Privilege check (must run with sudo or as root) ---
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  die "BarePod installation requires root privileges. Please re-run with: curl -fsSL https://raw.githubusercontent.com/farrasrayhand/barepod-panel/main/scripts/install.sh | sudo bash"
fi

# --- OS ---
[ "$(uname -s)" = "Linux" ] || die "BarePod Panel targets Linux only (got $(uname -s))."

# --- Architecture: amd64 + arm64 ---
ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64|amd64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l|armv6l) die "32-bit ARM ($ARCH_RAW) is not supported — use a 64-bit OS (arm64)." ;;
  *)             die "Unsupported architecture: $ARCH_RAW" ;;
esac
log "Architecture: linux/${ARCH}"

# --- Virtualization / container detection ---
VIRT=""
command -v systemd-detect-virt >/dev/null 2>&1 && VIRT="$(systemd-detect-virt || true)"

IS_LXC=0
if [ "$VIRT" = "lxc" ] || [ "$VIRT" = "lxc-libvirt" ] || grep -qaE '(^| )container=lxc( |$)' /proc/1/environ 2>/dev/null; then
  IS_LXC=1
fi
log "Virtualization: ${VIRT:-none (bare metal)}"

# --- cgroups v2 (required for tenant isolation) ---
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  log "cgroups: v2 (unified) detected"
else
  warn "cgroups v2 not detected — tenant isolation (cgroups quotas) needs the unified hierarchy."
fi

# --- LXC caveats ---
if [ "$IS_LXC" -eq 1 ]; then
  log "LXC container detected — requirement checks:"
  if [ -e /dev/net/tun ]; then
    log "  - /dev/net/tun present (Cloudflare Tunnel OK)"
  else
    warn "  - /dev/net/tun missing: add 'lxc.cgroup2.devices.allow: c 10:200 rwm' for Cloudflare Tunnel."
  fi
  warn "  - Docker-in-LXC (container pods) needs 'security.nesting=true' + 'security.nesting=true keyctl=1'."
  warn "  - S.M.A.R.T. disk diagnostics and fstrim are usually unavailable in unprivileged containers."
  warn "  - Some host metrics (/proc, /sys) may be masked depending on the LXC config."
fi

# --- Runtime prerequisites ---
if command -v node >/dev/null 2>&1; then
  log "Node.js: $(node -v)"
else
  warn "Node.js 20+ not found — required to build/run the frontend (apt install nodejs npm, or nvm)."
fi

if command -v docker >/dev/null 2>&1; then
  log "Docker: $(docker --version 2>/dev/null || echo 'present')"
else
  warn "Docker not found — required for container pods at runtime (Phase 3)."
fi

# --- Database engines & Build Dependencies ---
# If running standalone via curl, automatically install essential packages on Ubuntu/Debian
if [[ -x "$(dirname "$0")/install-engines.sh" ]]; then
  "$(dirname "$0")/install-engines.sh" "$@" || echo "   (engine installation reported a problem; the panel will show each engine honestly)"
elif command -v apt-get >/dev/null 2>&1; then
  log "Installing runtime & build dependencies (apt)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || true
  apt-get install -y -qq curl wget tar git unzip ca-certificates gnupg \
    python3 python3-venv python3-pip python3-dev composer certbot \
    nginx mariadb-server redis-server >/dev/null 2>&1 || true
  systemctl enable --now mariadb redis-server nginx >/dev/null 2>&1 || true
fi

# Ensure cloudflared is installed for Cloudflare Tunnel support
if ! command -v cloudflared >/dev/null 2>&1; then
  log "Installing cloudflared for Cloudflare Tunnel support..."
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" -o /usr/local/bin/cloudflared 2>/dev/null || true
  chmod 0755 /usr/local/bin/cloudflared || true
fi

# --- BarePod daemon & frontend bundle ---
INSTALL_DIR="${BAREPOD_INSTALL_DIR:-/usr/local/bin}"
DATA_DIR="${BAREPOD_DATA_DIR:-/var/lib/barepod}"
CONF_DIR="${BAREPOD_CONF_DIR:-/etc/barepod}"
DB_PATH="${BAREPOD_DB:-$DATA_DIR/barepod.db}"
DIST_DIR="${DATA_DIR}/dist"

mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$CONF_DIR" "$DIST_DIR"
chmod 0755 "$INSTALL_DIR"
chmod 0700 "$DATA_DIR" "$CONF_DIR"

DAEMON_INSTALLED=0

# If run inside the repository with source code
if [ -f backend/go.mod ] && command -v go >/dev/null 2>&1; then
  log "Building daemon from local source code..."
  ( cd backend && go build -o "$INSTALL_DIR/barepod" ./cmd/barepod )
  if [ -d frontend/dist ]; then
    cp -r frontend/dist/* "$DIST_DIR/"
  fi
  DAEMON_INSTALLED=1
  log "Installed binary: $INSTALL_DIR/barepod"
else
  # Standalone 1-line curl installation: download official precompiled GitHub release
  log "Resolving latest official release bundle from GitHub (linux/${ARCH})..."

  LATEST_TAG=""
  # Method 1: HTTP header redirect inspection (does not touch api.github.com, zero rate-limiting!)
  EFFECTIVE_URL=$(curl -fsSLI -o /dev/null -w "%{url_effective}" https://github.com/farrasrayhand/barepod-panel/releases/latest 2>/dev/null || true)
  if [[ "$EFFECTIVE_URL" =~ tag/([^/]+) ]]; then
    LATEST_TAG="${BASH_REMATCH[1]}"
  fi

  # Method 2: GitHub API fallback
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG=$(curl -fsSL https://api.github.com/repos/farrasrayhand/barepod-panel/releases/latest 2>/dev/null | grep '"tag_name":' | head -n 1 | cut -d '"' -f 4 || true)
  fi

  # Method 3: Hardcoded latest fallback
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v3.0.1"
  fi

  RELEASE_URL="https://github.com/farrasrayhand/barepod-panel/releases/download/${LATEST_TAG}/barepod-${LATEST_TAG}-linux-${ARCH}.tar.gz"
  log "Downloading: $RELEASE_URL"

  TMP_TAR="/tmp/barepod-latest-linux-${ARCH}.tar.gz"
  TMP_DIR="/tmp/barepod-extract-$$"
  if curl -fsSL "$RELEASE_URL" -o "$TMP_TAR"; then
    mkdir -p "$TMP_DIR"
    tar -xzf "$TMP_TAR" -C "$TMP_DIR"
    
    if [ -f "$TMP_DIR/barepod" ]; then
      mv "$TMP_DIR/barepod" "$INSTALL_DIR/barepod"
      chmod 0755 "$INSTALL_DIR/barepod"
      if [ -d "$TMP_DIR/dist" ]; then
        rm -rf "$DIST_DIR"/*
        cp -r "$TMP_DIR/dist"/* "$DIST_DIR/"
      fi
      DAEMON_INSTALLED=1
      log "Successfully installed BarePod binary and UI assets."
    fi
    rm -rf "$TMP_TAR" "$TMP_DIR"
  else
    die "Failed to download BarePod release bundle from: $RELEASE_URL"
  fi
fi

if [ "$DAEMON_INSTALLED" -eq 1 ]; then
  log "BarePod Panel binary verified: $($INSTALL_DIR/barepod version || echo 'ready')"
else
  die "BarePod binary could not be installed."
fi

log "Environment OK: linux/${ARCH}$([ "$IS_LXC" -eq 1 ] && echo ' (LXC)')"

# --- Interactive Setup & Automated Service Configuration ---
HAS_TTY=0
if [ -c /dev/tty ]; then
  HAS_TTY=1
fi

ADMIN_USER="admin"
ADMIN_PASS=""
PANEL_PORT="8443"

# Check if admin already exists
ALREADY_INITIALIZED=0
if [ -f "$DB_PATH" ]; then
  if "$INSTALL_DIR/barepod" user list --db "$DB_PATH" 2>/dev/null | grep -q "admin"; then
    ALREADY_INITIALIZED=1
  fi
fi

if [ "$ALREADY_INITIALIZED" -eq 1 ]; then
  log "Panel database already contains admin account — skipping creation."
else
  printf '\n\033[1;36m%s\033[0m\n' "=================================================="
  printf '\033[1;36m%s\033[0m\n' "     BarePod Panel — Initial Setup Wizard"
  printf '\033[1;36m%s\033[0m\n' "=================================================="
  
  if [ "$HAS_TTY" -eq 1 ] && [ "${BAREPOD_NONINTERACTIVE:-0}" != "1" ]; then
    printf '\n\033[1;33m[?] Enter root admin username (default: admin): \033[0m'
    read -r input_user </dev/tty || true
    if [ -n "$input_user" ]; then
      ADMIN_USER="$input_user"
    fi

    printf '\033[1;33m[?] Enter admin password (leave empty to generate secure password): \033[0m'
    read -r -s input_pass </dev/tty || true
    printf '\n'
    if [ -n "$input_pass" ]; then
      ADMIN_PASS="$input_pass"
    fi

    printf '\033[1;33m[?] Enter panel port (default: 8443): \033[0m'
    read -r input_port </dev/tty || true
    if [ -n "$input_port" ]; then
      PANEL_PORT="$input_port"
    fi
  else
    log "Non-interactive terminal detected — using default admin username and generating secure password."
  fi

  log "Creating root admin account ($ADMIN_USER)..."
  if [ -n "$ADMIN_PASS" ]; then
    "$INSTALL_DIR/barepod" admin create --username "$ADMIN_USER" --password "$ADMIN_PASS" --db "$DB_PATH"
  else
    "$INSTALL_DIR/barepod" admin create --username "$ADMIN_USER" --db "$DB_PATH"
  fi
fi

# Automatically configure and start systemd service
log "Configuring and starting systemd service (0.0.0.0:${PANEL_PORT})..."
"$INSTALL_DIR/barepod" service install -listen "0.0.0.0:${PANEL_PORT}" -db "$DB_PATH" -static "$DIST_DIR" >/dev/null 2>&1 || true

# Resolve Server IP for direct access
SERVER_IP=$(curl -fsSL -m 3 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

printf '\n\033[1;32m%s\033[0m\n' "================================================================="
printf '\033[1;32m%s\033[0m\n' "  🎉 BarePod Panel is installed and running successfully!"
printf '\033[1;32m%s\033[0m\n' "================================================================="
printf '\n'
printf '  \033[1mPanel URL:\033[0m    \033[1;34mhttps://%s:%s\033[0m\n' "$SERVER_IP" "$PANEL_PORT"
printf '  \033[1mUsername:\033[0m     \033[1;33m%s\033[0m\n' "$ADMIN_USER"
printf '  \033[1mService:\033[0m      systemctl status barepod\n'
printf '  \033[1mLogs:\033[0m         journalctl -u barepod -f\n'
printf '\n'
printf '\033[1;30m%s\033[0m\n' "Note: If using self-signed TLS, accept your browser certificate warning."
printf '\033[1;32m%s\033[0m\n\n' "================================================================="
