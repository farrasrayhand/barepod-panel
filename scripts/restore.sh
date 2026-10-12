#!/usr/bin/env bash
# BarePod Panel — put back a backup made by scripts/uninstall.sh.
#
#   scripts/restore.sh                          # use the newest backup in /var/backups/barepod
#   scripts/restore.sh --from <file.tar.gz>     # use a specific one
#   scripts/restore.sh --yes                    # actually restore (dry run without it)
#   scripts/restore.sh --yes --force            # replace a panel database that is already there
#
# Restores the panel database (accounts, records, their settings, audit log), the self-signed certificate,
# and — if the backup is a "full" one — /etc/barepod and the systemd unit files. It does not invent
# anything: what is inside the backup is printed from its manifest before anything is written.
#
# It stops the panel while it works. It will not overwrite an existing panel database without --force, and
# when forced it moves the current one aside first rather than deleting it.
#
# After restoring, the binary has to be there: run scripts/install.sh (which will notice the backup and say
# the same thing) or `barepod service install`, then sign in with the accounts that were in the backup.

set -euo pipefail

UNITS_DIR="${BAREPOD_UNITS_DIR:-/etc/systemd/system}"
DATA_DIR="${BAREPOD_DATA_DIR:-/var/lib/barepod}"
CONF_DIR="${BAREPOD_CONF_DIR:-/etc/barepod}"
BACKUP_DIR="${BAREPOD_BACKUP_DIR:-/var/backups/barepod}"

FROM=""
ASSUME_YES=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --from=*) FROM="${arg#--from=}" ;;
    --from) shift; FROM="${1:-}" ;;
    --yes) ASSUME_YES=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) [ -f "$arg" ] && FROM="$arg" || { echo "unknown option: $arg (try --help)" >&2; exit 2; } ;;
  esac
done

say()  { printf '  %s\n' "$*"; }
section() { printf '\n%s\n' "$*"; }
act()  { printf '  [run]  %s\n' "$*"; if [ "$ASSUME_YES" -eq 1 ]; then eval "$*" >/dev/null 2>&1 || printf '  [warn] that step did not complete cleanly: %s\n' "$*"; fi; }

[ "$(id -u)" -eq 0 ] || { echo "run this as root (it writes systemd units and the panel's data directory)." >&2; exit 1; }

if [ -z "$FROM" ]; then
  FROM="$(ls -1t "$BACKUP_DIR"/barepod-backup-*.tar.gz 2>/dev/null | head -n1 || true)"
  [ -n "$FROM" ] || { echo "no backup found in $BACKUP_DIR — pass one with --from <file.tar.gz>" >&2; exit 1; }
fi
[ -f "$FROM" ] || { echo "no such backup: $FROM" >&2; exit 1; }

section "Backup to restore"
say "file: $FROM"
say "size: $(du -h "$FROM" | cut -f1)"
manifest="$(tar -xzOf "$FROM" barepod/MANIFEST.txt 2>/dev/null || true)"
if [ -n "$manifest" ]; then
  printf '%s\n' "$manifest" | sed 's/^/  | /'
else
  say "no manifest inside — this was not made by scripts/uninstall.sh; continuing because you asked,"
  say "but only files whose names this script knows will be put back"
fi

section "Plan"
say "panel database:   -> $DATA_DIR/barepod.db$([ -f "$DATA_DIR/barepod.db" ] && echo "  (exists; $([ "$FORCE" -eq 1 ] && echo 'will be moved aside' || echo 'NOT overwritten without --force'))" || echo '')"
say "certificate:      -> $DATA_DIR/panel-selfsigned.{crt,key}"
say "unit files:       -> $UNITS_DIR (only if the backup is a full one)"
[ -f "$DATA_DIR/barepod.db" ] && [ "$FORCE" -eq 0 ] && [ "$ASSUME_YES" -eq 1 ] && { echo; echo "refusing: a panel database is already there. Use --force to replace it (it will be moved aside)." >&2; exit 1; }

if [ "$ASSUME_YES" -eq 0 ]; then
  section "Dry run. Nothing was written. Re-run with --yes to restore."
  exit 0
fi

section "Restoring"
work="$(mktemp -d)"
tar -xzf "$FROM" -C "$work"
src="$work/barepod"
[ -d "$src" ] || { echo "this archive does not contain a barepod/ directory" >&2; exit 1; }

act "systemctl stop barepod.service"
act "install -d -m 0700 '$DATA_DIR'"
if [ -f "$DATA_DIR/barepod.db" ] && [ "$FORCE" -eq 1 ]; then
  moved="$DATA_DIR/barepod.db.replaced-$(date +%Y%m%d-%H%M%S)"
  act "mv '$DATA_DIR/barepod.db' '$moved'"
  say "the database that was there is now $moved"
fi
[ -f "$src/barepod.db" ] && act "cp -a '$src/barepod.db' '$DATA_DIR/barepod.db'" && act "chmod 0600 '$DATA_DIR/barepod.db'"
for cert in "$src"/panel-selfsigned.*; do
  [ -f "$cert" ] || continue
  act "cp -a '$cert' '$DATA_DIR/'"
done
if [ -d "$src/etc/barepod" ]; then
  act "install -d -m 0700 '$CONF_DIR'"
  act "cp -a '$src/etc/barepod/.' '$CONF_DIR/'"
fi
if [ -d "$src/units" ]; then
  for unit in "$src/units"/*.service; do
    [ -f "$unit" ] || continue
    act "cp -a '$unit' '$UNITS_DIR/'"
    dir="${unit%.service}.service.d"
    [ -d "$dir" ] && act "cp -a '$dir/.' '$UNITS_DIR/${unit##*/}.d/'"
  done
  act "systemctl daemon-reload"
fi
rm -rf "$work"

section "Restored"
say "Accounts, records and settings are back in $DATA_DIR/barepod.db — sign in with the accounts that were"
say "in the backup, not with a newly created one."
say "If the binary is not installed yet: scripts/install.sh, then 'barepod service install'."
