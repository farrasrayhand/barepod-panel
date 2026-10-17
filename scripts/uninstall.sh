#!/usr/bin/env bash
# BarePod Panel — full uninstall, with a backup you choose the size of.
#
# Safe to read and safe to run twice, because "uninstall" should never mean "lost something you did not ask
# to lose". Dry run by default: without --yes it prints exactly what it would remove and changes nothing.
#
#   scripts/uninstall.sh                                # show the plan, change nothing
#   scripts/uninstall.sh --yes                          # remove the panel; back up db; keep data dir
#   scripts/uninstall.sh --yes --backup=full            # back up db + certificate + config + unit files
#   scripts/uninstall.sh --yes --backup=none            # no backup at all
#   scripts/uninstall.sh --yes --backup-dir=/mnt/usb   # write it somewhere else (never inside a path
#                                                       # this script deletes, and it is read back first)
#   scripts/uninstall.sh --yes --purge-data             # delete /var/lib/barepod as well
#   scripts/uninstall.sh --yes --purge-data --remove-tenants
#   scripts/uninstall.sh --yes --purge-data --remove-tenants --remove-tenant-data
#   scripts/uninstall.sh --yes --remove-packages        # and apt-purge the engines
#
# The backup lands in /var/backups/barepod as barepod-backup-<host>-<timestamp>.tar.gz together with a
# manifest, and scripts/restore.sh (or the installer, which detects it and says so) can put it back.
#
# What a backup does NOT contain, said here rather than discovered later: the contents of your databases.
# Their credentials are encrypted inside the panel database this backup holds, so it can put the panel back
# exactly as it was — records, accounts, settings, audit log — but not dump data it cannot authenticate for.
# Use the panel's own Export button for each database before uninstalling; for site files, copy them.
#
# It does NOT remove: engine packages unless --remove-packages is given, journald history, or anything
# under a tenant's home unless --remove-tenant-data is given. The last lines of output say so.

set -euo pipefail

UNITS_DIR="${BAREPOD_UNITS_DIR:-/etc/systemd/system}"
INSTALL_DIR="${BAREPOD_INSTALL_DIR:-/usr/local/bin}"
DATA_DIR="${BAREPOD_DATA_DIR:-/var/lib/barepod}"
CONF_DIR="${BAREPOD_CONF_DIR:-/etc/barepod}"
BACKUP_DIR="${BAREPOD_BACKUP_DIR:-/var/backups/barepod}"
SITES_ROOT="${BAREPOD_SITES_ROOT:-/home}"

ASSUME_YES=0
BACKUP="db"          # db | full | none
PURGE_DATA=0
REMOVE_TENANTS=0
REMOVE_TENANT_DATA=0
REMOVE_CONTAINERS=1
REMOVE_VOLUMES=0
REMOVE_PACKAGES=0
KEEP_ENGINE_CONFIG=0

for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    --backup=db|--backup=full|--backup=none) BACKUP="${arg#--backup=}" ;;
    --backup-dir=*) BACKUP_DIR="${arg#--backup-dir=}" ;;
    --purge-data) PURGE_DATA=1 ;;
    --remove-tenants) REMOVE_TENANTS=1 ;;
    --remove-tenant-data) REMOVE_TENANTS=1; REMOVE_TENANT_DATA=1 ;;
    --keep-containers) REMOVE_CONTAINERS=0 ;;
    --remove-volumes) REMOVE_VOLUMES=1 ;;
    --remove-packages) REMOVE_PACKAGES=1 ;;
    --keep-engine-config) KEEP_ENGINE_CONFIG=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '  %s\n' "$*"; }
section() { printf '\n%s\n' "$*"; }
act()  { printf '  [run]  %s\n' "$*"; if [ "$ASSUME_YES" -eq 1 ]; then eval "$*" >/dev/null 2>&1 || printf '  [warn] that step did not complete cleanly: %s\n' "$*"; fi; }
cmd()  { command -v "$1" >/dev/null 2>&1; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "BarePod uninstall requires root privileges. Please run with sudo (e.g. sudo bash scripts/uninstall.sh --yes)." >&2
  exit 1
fi

# A backup written inside a directory this script deletes is not a backup, and the operator's reason for
# choosing a path may be exactly the reason it matters — so this refuses rather than quietly relocating it.
resolve() { readlink -f "$1" 2>/dev/null || printf '%s' "$1"; }
if [ "$BACKUP" != "none" ]; then
  for doomed in "$DATA_DIR" "$CONF_DIR" "$UNITS_DIR"; do
    case "$(resolve "$BACKUP_DIR")/" in
      "$(resolve "$doomed")"/*)
        echo "refusing: the backup directory ($BACKUP_DIR) is inside $doomed, which this uninstall deletes." >&2
        echo "use --backup-dir=<path outside it> (the default, /var/backups/barepod, is on the root filesystem" >&2
        echo "and is never touched here), or pass --backup=none on purpose." >&2
        exit 1 ;;
    esac
  done
fi

# --- what is here, gathered before anything is touched, so the plan is a fact and not a guess ---
mapfile -t SITE_UNITS < <(ls -1 "$UNITS_DIR" 2>/dev/null | grep -E '^barepod-app@.*\.service$' | grep -v '^barepod-app@\.service$' || true)
declare -A TENANTS=()
for unit in "${SITE_UNITS[@]:-}"; do
  [ -n "${unit:-}" ] || continue
  user="$(grep -hoP '^User=\K\S+' "$UNITS_DIR/$unit" "$UNITS_DIR/${unit}.d/"*.conf 2>/dev/null | head -n1 || true)"
  [ -n "$user" ] || continue
  TENANTS["$user"]=1
done
mapfile -t CONTAINERS < <(cmd docker && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '^barepod-(mongo|dbgate)' || true)

section "BarePod uninstall — plan"
say "panel unit:        $UNITS_DIR/barepod.service$([ -f "$UNITS_DIR/barepod.service" ] && echo ' (present)' || echo ' (absent)')"
say "site units:        ${#SITE_UNITS[@]} (${SITE_UNITS[*]:-none})"
say "tenant accounts:   ${#TENANTS[@]} (${!TENANTS[*]:-none})"
say "binary:            $INSTALL_DIR/barepod"
say "data:              $DATA_DIR$([ "$PURGE_DATA" -eq 1 ] && echo '  -> will be DELETED' || echo '  -> kept')"
say "backup:            $BACKUP$([ "$BACKUP" = "none" ] && echo '  (nothing saved anywhere)' || echo "  -> $BACKUP_DIR/barepod-backup-<host>-<date>.tar.gz")"
say "config:            $CONF_DIR"
say "lockout (nftables): table inet barepod$(cmd nft && nft list table inet barepod >/dev/null 2>&1 && echo ' (present)' || echo ' (absent)')"
say "containers:        ${#CONTAINERS[@]} (${CONTAINERS[*]:-none})$([ "$REMOVE_VOLUMES" -eq 1 ] && echo '  -> with volumes' || echo '  -> volumes kept')"
say "tenant data:       $SITES_ROOT/<tenant>$([ "$REMOVE_TENANT_DATA" -eq 1 ] && echo '  -> DELETED' || echo '  -> kept')"
say "engine packages:   $([ "$REMOVE_PACKAGES" -eq 1 ] && echo 'apt purge (engines, php, docker, golang)' || echo 'kept')"

if [ "$ASSUME_YES" -eq 0 ]; then
  section "Dry run. Nothing above was changed. Re-run with --yes to carry it out."
  exit 0
fi

# --- 1. stop the panel and the sites, and release anyone the lockout banned ---
section "Stopping services"
for unit in "${SITE_UNITS[@]:-}"; do
  [ -n "${unit:-}" ] || continue
  act "systemctl disable --now '$unit'"
done
act "systemctl disable --now barepod.service"
act "systemctl reset-failed barepod.service"
mapfile -t TUNNEL_UNITS < <(ls -1 "$UNITS_DIR" 2>/dev/null | grep -E '^barepod-tunnel@.*\.service$' | grep -v '^barepod-tunnel@\.service$' || true)
for t_unit in "${TUNNEL_UNITS[@]:-}"; do
  [ -n "${t_unit:-}" ] || continue
  act "systemctl disable --now '$t_unit'"
done
if cmd nft; then
  act "nft delete table inet barepod"
  say "(the lockout's bans lived here; deleting the table releases every blocked address)"
fi

# --- 2. the backup, taken with the panel stopped (see the note in the copy step) ---
if [ "$BACKUP" != "none" ]; then
  section "Backing up"
  stamp="$(date +%Y%m%d-%H%M%S)"
  host="$(hostname -s 2>/dev/null || echo host)"
  archive="$BACKUP_DIR/barepod-backup-$host-$stamp.tar.gz"
  work="$(mktemp -d)"
  act "install -d -m 0700 '$BACKUP_DIR'"
  mkdir -p "$work/barepod"
  if [ -f "$DATA_DIR/barepod.db" ]; then
    # sqlite3's own copy is consistent even if something is still writing; a plain cp of a WAL database can
    # lose the commits sitting in barepod.db-wal. The service is already stopped above, and this is the
    # belt to that pair of braces.
    if cmd sqlite3 && sqlite3 "$DATA_DIR/barepod.db" "VACUUM INTO '$work/barepod/barepod.db'" 2>/dev/null; then
      say "panel database copied with sqlite3 VACUUM INTO (consistent, includes the write-ahead log)"
    else
      act "cp -a '$DATA_DIR/barepod.db' '$work/barepod/'"
      for sidecar in "$DATA_DIR"/barepod.db-wal "$DATA_DIR"/barepod.db-shm; do
        [ -f "$sidecar" ] && act "cp -a '$sidecar' '$work/barepod/'"
      done
    fi
  fi
  # The certificate is what stops a reinstall from showing a brand-new warning to the same operator.
  cp -a "$DATA_DIR"/panel-selfsigned.* "$work/barepod/" 2>/dev/null || true
  if [ "$BACKUP" = "full" ]; then
    mkdir -p "$work/etc" "$work/units"
    cp -a "$CONF_DIR" "$work/etc/barepod" 2>/dev/null || true
    cp -a "$UNITS_DIR/barepod.service" "$work/units/" 2>/dev/null || true
    mkdir -p "$work/units/barepod.service.d"
    cp -a "$UNITS_DIR/barepod.service.d/." "$work/units/barepod.service.d/" 2>/dev/null || true
    for unit in "${SITE_UNITS[@]:-}"; do
      [ -n "${unit:-}" ] || continue
      cp -a "$UNITS_DIR/$unit" "$work/units/" 2>/dev/null || true
      mkdir -p "$work/units/${unit}.d" && cp -a "$UNITS_DIR/${unit}.d/." "$work/units/${unit}.d/" 2>/dev/null || true
    done
  fi
  {
    echo "barepod-backup 1"
    echo "host: $(hostname 2>/dev/null || echo unknown)"
    echo "date: $(date -Is)"
    echo "level: $BACKUP"
    echo "sites: ${SITE_UNITS[*]:-none}"
    echo "tenants: ${!TENANTS[*]:-none}"
    echo ""
    echo "Contains: the panel database (accounts, records, their settings and the audit log)$([ "$BACKUP" = "full" ] && echo ', the self-signed certificate, /etc/barepod and the systemd unit files')"
    echo "Does not contain: the contents of your databases or your site files. Their credentials are"
    echo "encrypted inside the panel database, so a dump cannot be authenticated for from here — use the"
    echo "panel's Export for each database, and copy site files, before uninstalling."
  } > "$work/barepod/MANIFEST.txt"
  act "tar -czf '$archive' -C '$work' barepod"
  rm -rf "$work"
  if [ -s "$archive" ] && tar -tzf "$archive" >/dev/null 2>&1; then
    say "backup written and read back: $archive ($(du -h "$archive" | cut -f1))"
    say "nothing is deleted below until this line appears — that is the point of the order"
  else
    say "the archive could not be written or read back: $archive"
    echo "refusing to continue: a failed backup followed by a delete is the worst possible order." >&2
    exit 1
  fi
  say "put it back later with: $(dirname "$0")/restore.sh --from '$archive'"
fi

# --- 3. the panel's own units and files ---
section "Removing the panel"
act "rm -f '$UNITS_DIR/barepod.service' '$UNITS_DIR/barepod.service.barepod-backup'"
act "rm -rf '$UNITS_DIR/barepod.service.d'"
act "rm -f '$UNITS_DIR/barepod-app@.service'"
act "rm -f '$UNITS_DIR/barepod-tunnel@.service'"
for t_unit in "${TUNNEL_UNITS[@]:-}"; do
  [ -n "${t_unit:-}" ] || continue
  act "rm -f '$UNITS_DIR/$t_unit'"
done
for unit in "${SITE_UNITS[@]:-}"; do
  [ -n "${unit:-}" ] || continue
  act "rm -f '$UNITS_DIR/$unit'"
  act "rm -rf '$UNITS_DIR/${unit}.d'"
done
act "systemctl daemon-reload"
act "rm -f '$INSTALL_DIR/barepod' '$INSTALL_DIR/pgweb'"
act "rm -rf '$CONF_DIR'"
act "rm -rf '$DATA_DIR/dbtools'"

# --- 4. give the engines back the way the installer found them ---
if [ "$KEEP_ENGINE_CONFIG" -eq 0 ]; then
  section "Restoring engine configuration the panel changed"
  # Redis: the panel's ACL file and the bind it set are both ours; leaving aclfile pointing at a file we
  # deleted would stop redis from starting, so the directive goes with it.
  if [ -f /etc/redis/redis.conf ]; then
    act "cp -a /etc/redis/redis.conf /etc/redis/redis.conf.barepod-uninstall.bak"
    act "sed -i -E 's|^[[:space:]]*aclfile[[:space:]]+.*|# aclfile (removed by the BarePod uninstall)|; s|^[[:space:]]*bind[[:space:]]+.*|bind 127.0.0.1 -::1|' /etc/redis/redis.conf"
    act "systemctl reload-or-restart redis-server"
  fi
  act "rm -f /etc/redis/users.acl"
  # PostgreSQL: our drop-in goes; pg_hba lines we added are restored from the backups the daemon kept.
  for pg in /etc/postgresql/*/main; do
    [ -d "$pg" ] || continue
    act "rm -f '$pg/conf.d/99-barepod.conf'"
    [ -f "$pg/pg_hba.conf.barepod-backup" ] && act "cp -a '$pg/pg_hba.conf.barepod-backup' '$pg/pg_hba.conf'"
    act "systemctl reload-or-restart postgresql"
  done
  # MariaDB: our tuning drop-in goes, and bind-address goes back to loopback (public exposure is over).
  act "rm -f /etc/mysql/mariadb.conf.d/99-barepod.cnf"
  if [ -f /etc/mysql/mariadb.conf.d/50-server.cnf ]; then
    act "cp -a /etc/mysql/mariadb.conf.d/50-server.cnf /etc/mysql/mariadb.conf.d/50-server.cnf.barepod-uninstall.bak"
    act "sed -i -E 's|^[[:space:]]*bind-address[[:space:]]*=.*|bind-address            = 127.0.0.1|' /etc/mysql/mariadb.conf.d/50-server.cnf"
    act "systemctl reload-or-restart mariadb"
  fi
  act "rm -f /etc/apt/sources.list.d/mongodb-org-*.list"
fi

# --- 5. the containers the panel ran ---
if [ "$REMOVE_CONTAINERS" -eq 1 ] && cmd docker; then
  section "Removing panel containers"
  for name in "${CONTAINERS[@]:-}"; do
    [ -n "${name:-}" ] || continue
    act "docker rm -f '$name'"
  done
  if [ "$REMOVE_VOLUMES" -eq 1 ]; then
    say "removing volumes too — this is the step that deletes containerised database data"
    for volume in $(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E '^barepod' || true); do
      act "docker volume rm '$volume'"
    done
  fi
fi

# --- 6. tenant accounts, only when asked, and never their files unless asked twice ---
if [ "$REMOVE_TENANTS" -eq 1 ]; then
  section "Removing tenant accounts"
  for user in "${!TENANTS[@]}"; do
    [ "$user" = "root" ] && { say "skipping root"; continue; }
    id "$user" >/dev/null 2>&1 || { say "$user does not exist any more"; continue; }
    if [ "$REMOVE_TENANT_DATA" -eq 1 ]; then
      act "userdel -r '$user'"
    else
      act "userdel '$user'"
      say "$user removed; their files stay in $SITES_ROOT/$user"
    fi
  done
fi

# --- 7. data, only with an explicit flag ---
if [ "$PURGE_DATA" -eq 1 ]; then
  section "Deleting panel data"
  act "rm -rf '$DATA_DIR'"
  say "deleted $DATA_DIR (panel database, web bundle, self-signed certificate, tool logs)"
else
  section "Keeping panel data"
  say "$DATA_DIR was left in place. Delete it yourself to finish the job:"
  say "  rm -rf '$DATA_DIR'"
fi

# --- 8. packages, only with an explicit flag ---
if [ "$REMOVE_PACKAGES" -eq 1 ] && cmd apt-get; then
  section "Purging packages"
  say "this removes the engines themselves, including their data directories under /var/lib"
  act "apt-get purge -y postgresql* mariadb-server* mariadb-client* redis-server php-cli php-fpm php-mysql php-gd php-curl php-mbstring php-xml php-zip golang-go docker.io"
  act "apt-get autoremove -y"
fi

section "Done"
say "Removed: the panel unit, its drop-ins, every site unit, the binary, /etc/barepod, the lockout table,"
say "and (when asked) the data directory, containers, tenant accounts and packages."
say "Left alone on purpose: journald history (journalctl --vacuum-time=1s clears it), site files you did not"
say "ask to delete, and the engines themselves unless --remove-packages was used."
if [ "$BACKUP" != "none" ]; then
  say "Backup: $(ls -1t "$BACKUP_DIR"/barepod-backup-*.tar.gz 2>/dev/null | head -n1 || echo "$BACKUP_DIR")"
  say "It lives outside everything this script deleted, so it survives. If the host itself is being rebuilt,"
  say "copy the file somewhere else first — scripts/restore.sh --from <file> takes it from any path, and"
  say "scripts/install.sh notices a backup left in $BACKUP_DIR."
fi
