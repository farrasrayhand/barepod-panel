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

# --- Database engines ---
# Without this step every engine says "not installed": the panel can only offer
# what the host has. Skip it with --no-engines.
if [[ -x "$(dirname "$0")/install-engines.sh" ]]; then
  "$(dirname "$0")/install-engines.sh" "$@" || echo "   (engine installation reported a problem; the panel will show each engine honestly)"
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
  log "Downloading latest official release bundle from GitHub (linux/${ARCH})..."
  RELEASE_URL=$(curl -fsSL https://api.github.com/repos/farrasrayhand/barepod-panel/releases/latest | grep "browser_download_url.*linux-${ARCH}.tar.gz" | cut -d '"' -f 4 || true)
  
  if [ -n "$RELEASE_URL" ]; then
    TMP_TAR="/tmp/barepod-latest-linux-${ARCH}.tar.gz"
    TMP_DIR="/tmp/barepod-extract-$$"
    curl -fsSL "$RELEASE_URL" -o "$TMP_TAR"
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
    warn "Could not fetch precompiled release bundle from GitHub."
  fi
fi

if [ "$DAEMON_INSTALLED" -eq 1 ]; then
  log "BarePod Panel binary verified: $($INSTALL_DIR/barepod version || echo 'ready')"
else
  warn "Binary could not be downloaded or built automatically."
fi

log "Environment OK: linux/${ARCH}$([ "$IS_LXC" -eq 1 ] && echo ' (LXC)')"
log "Next steps:"
log "  1. Create your root admin account:"
log "     barepod admin create --username <you> --db $DB_PATH"
log "     (creates your root admin; the password is generated and shown once)"
log ""
log "  2. Install and start as a background systemd service:"
log "     barepod service install -listen 0.0.0.0:8443 -db $DB_PATH -static $DIST_DIR"
log ""
log "  3. Open your browser at: https://<server-ip>:8443"
log "There is no default account and no default password by design."
