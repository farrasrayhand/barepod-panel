#!/usr/bin/env bash
#
# BarePod Panel — installer / environment check
# Phase 1: frontend prototype (Go backend daemon not implemented yet)
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

log "Environment OK: linux/${ARCH}$([ "$IS_LXC" -eq 1 ] && echo ' (LXC)')"
log "Note: the Go backend daemon is not implemented yet (Phase 2)."
log "      To try the UI now:  cd frontend && npm install && npm run dev"
