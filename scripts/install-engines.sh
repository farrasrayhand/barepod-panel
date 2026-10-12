#!/usr/bin/env bash
#
# BarePod Panel — database engines
#
# The panel can only offer what the host actually has, so an installation that
# stops at the panel leaves every engine saying "not installed". This step
# installs the servers (and their clients, which come with them) and waits until
# each one really answers, because "installed" and "ready" are not the same thing.
#
# Idempotent: an engine that is already present and running is left alone.
# Skip the whole step with --no-engines (or BAREPOD_ENGINES=0).
set -euo pipefail

SKIP_ENGINES="${BAREPOD_ENGINES:-1}"
WANT=(postgresql mariadb redis)
# MongoDB is not in the Ubuntu/Debian archives; it needs its own repository, so it
# is offered separately instead of pulling a third-party source in by surprise.
WANT_MONGO="${BAREPOD_MONGO:-0}"

for arg in "$@"; do
  case "$arg" in
    --no-engines) SKIP_ENGINES=0 ;;
    --with-mongodb) WANT_MONGO=1 ;;
    --help)
      echo "usage: install-engines.sh [--no-engines] [--with-mongodb]"
      exit 0
      ;;
  esac
done

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(uname -s)" != "Linux" ]]; then
  note "not Linux: the panel runs its engines only on a Linux host, nothing to do"
  exit 0
fi
if [[ "$SKIP_ENGINES" != "1" ]]; then
  note "engine installation skipped (--no-engines)"
  exit 0
fi
if ! have apt-get; then
  note "this script installs engines with apt (Debian/Ubuntu); on another distribution install the servers yourself"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
say "Installing database engines"
apt-get update -qq
# postgresql + mariadb-server + redis-server, each pulling its own client tools.
# A server that is already installed is simply kept.
apt-get install -y -qq postgresql mariadb-server redis-server python3-venv >/dev/null
note "packages in place: PostgreSQL, MariaDB, Redis"

if [[ "$WANT_MONGO" == "1" ]]; then
  say "Installing MongoDB (third-party repository)"
  if have mongosh; then
    note "already installed"
  else
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
      | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME")/mongodb-org/7.0 multiverse" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list
    apt-get update -qq
    apt-get install -y -qq mongodb-org >/dev/null
    note "installed from repo.mongodb.org (a third-party source, added on request)"
  fi
fi

# Enable and start, then wait for each one to answer: an engine is only "ready"
# when it responds, not when its package is unpacked.
say "Starting the engines and waiting for them"
systemctl enable --now postgresql >/dev/null 2>&1 || true
systemctl enable --now mariadb >/dev/null 2>&1 || systemctl enable --now mysql >/dev/null 2>&1 || true
systemctl enable --now redis-server >/dev/null 2>&1 || true
[[ "$WANT_MONGO" == "1" ]] && { systemctl enable --now mongod >/dev/null 2>&1 || true; }

wait_for() {
  local name="$1" probe="$2" tries=30
  for _ in $(seq "$tries"); do
    if eval "$probe" >/dev/null 2>&1; then
      note "$name: ready"
      return 0
    fi
    sleep 1
  done
  note "$name: did NOT answer after ${tries}s — check 'systemctl status' for it"
  return 1
}

failures=0
wait_for "PostgreSQL" "pg_isready -q" || failures=$((failures + 1))
wait_for "MariaDB" "mariadb-admin ping --silent" || failures=$((failures + 1))
wait_for "Redis" "redis-cli ping" || failures=$((failures + 1))
if [[ "$WANT_MONGO" == "1" ]]; then
  wait_for "MongoDB" "mongosh --quiet --eval 'db.runCommand({ping:1}).ok'" || failures=$((failures + 1))
fi

# The panel's own account list: the daemon talks to PostgreSQL and MariaDB over
# their unix sockets as root, which peer/socket authentication accepts without a
# password. A PostgreSQL role for root is what makes that work on a fresh install.
say "Letting the daemon administer PostgreSQL over its socket"
if su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='root'\"" 2>/dev/null | grep -q 1; then
  note "role 'root' already exists"
else
  su postgres -c "psql -qc \"CREATE ROLE root SUPERUSER LOGIN\"" >/dev/null 2>&1 \
    && note "created the 'root' role (socket auth, no password)" \
    || note "could not create the 'root' role — create it yourself: su postgres -c \"psql -c 'CREATE ROLE root SUPERUSER LOGIN'\""
fi

# A manager that runs as a container (DbGate) reaches PostgreSQL over the mounted
# unix socket, where it cannot be the OS user `postgres`: peer authentication refuses
# a requested database user that is not the connecting OS user, so its credential
# would be unusable. The `postgres` line stays peer (that is how the panel administers
# it), a `root` line stays peer (the legacy account above), and every other socket
# login is asked for the database password — which is what makes a manager work.
say "Allowing password logins over the PostgreSQL socket (managers run in a container)"
HBA="$(su postgres -c "psql -tAc 'SHOW hba_file'" 2>/dev/null)"
if [[ -n "$HBA" && -f "$HBA" ]]; then
  cp -n "$HBA" "$HBA.barepod.bak" 2>/dev/null || true
  if grep -qE '^local[[:space:]]+all[[:space:]]+all[[:space:]]+peer' "$HBA"; then
    sed -i -E 's#^(local[[:space:]]+all[[:space:]]+all[[:space:]]+)peer#\1scram-sha-256#' "$HBA"
    grep -qE '^local[[:space:]]+all[[:space:]]+root[[:space:]]+peer' "$HBA" || \
      sed -i -E '0,/^(local[[:space:]]+all[[:space:]]+postgres[[:space:]]+peer)/s//&\nlocal   all             root                                    peer/' "$HBA"
    systemctl reload postgresql >/dev/null 2>&1 || systemctl restart postgresql >/dev/null 2>&1 || true
    note "socket logins other than postgres/root now use a password (backup: $HBA.barepod.bak)"
  else
    note "the PostgreSQL socket rules already allow passwords"
  fi
else
  note "could not find pg_hba.conf — a manager may not reach PostgreSQL over the socket"
fi

# ---------------------------------------------------------------- attributing a refusal
# A lockout can only ban an address it can name, and PostgreSQL does not name it unless
# log_connections is on. Measured on a stock install: a refused password writes
# "FATAL:  password authentication failed for user ..." with no address anywhere, and there is
# no "connection received" line at all — so the watchdog has nothing to pair a pid with and
# skips every refusal, leaving PostgreSQL unprotectable however the panel is configured.
PG_CONF="$(ls /etc/postgresql/*/main/postgresql.conf 2>/dev/null | head -n1)"
if [[ -n "$PG_CONF" ]]; then
  if grep -qE '^[[:space:]]*#?[[:space:]]*log_connections' "$PG_CONF"; then
    sed -i 's/^[[:space:]]*#\?[[:space:]]*log_connections.*/log_connections = on/' "$PG_CONF"
  else
    printf '\n# Added by BarePod: without this a refused login names no address, and the\n# brute-force lockout cannot ban one.\nlog_connections = on\n' >> "$PG_CONF"
  fi
  # A reload is enough for this setting and does not interrupt anything.
  systemctl reload postgresql >/dev/null 2>&1 || true
  note "PostgreSQL now logs its connections, so a refused login can be attributed"
else
  note "no postgresql.conf found — a refused login may name no address, and nothing can ban it"
fi

# The same idea for MariaDB, for the opposite reason: some installs log to the journal, and a
# log the watchdog cannot read is an engine with no lockout. Pointing it at a file is what
# makes it watchable.
MY_CONF=/etc/mysql/mariadb.conf.d/50-server.cnf
if [[ -f "$MY_CONF" ]]; then
  install -d -o mysql -g adm -m 2750 /var/log/mysql 2>/dev/null || mkdir -p /var/log/mysql
  if ! grep -qE '^[[:space:]]*log_error' "$MY_CONF"; then
    printf '\n# Added by BarePod: the brute-force lockout reads this file.\nlog_error = /var/log/mysql/error.log\n' >> "$MY_CONF"
  fi
  note "MariaDB will log to /var/log/mysql/error.log (on its next restart)"
fi

# ---------------------------------------------------------------- an authenticated cache
# A passwordless Redis is not "just a cache": every process on the host can reach loopback —
# including a tenant's own application — and Redis's default user would then let any of them read
# every other tenant's keys, bypassing the prefix scoping the panel hands out. It is also the
# classic remote-takeover path (write authorized_keys or a cron file through CONFIG SET dir +
# SAVE) the moment anything can route to it.
#
# The order below is the whole point: the panel needs an identity of its own *before* the default
# user can be closed, or the panel loses the ability to create the per-cache users it manages.
# The identity is handed over through a systemd drop-in, which is inert until the panel's unit
# exists, so this can run before or after the panel is installed.
if have redis-cli; then
  REDIS_ADMIN_FILE=/etc/barepod/redis-admin.url
  if [[ -f "$REDIS_ADMIN_FILE" ]] && redis-cli -u "$(cat "$REDIS_ADMIN_FILE")" --no-auth-warning ping >/dev/null 2>&1; then
    note "Redis already has an admin identity for the panel"
  elif redis-cli -h 127.0.0.1 ping >/dev/null 2>&1; then
    REDIS_ADMIN_PASS="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 28)"
    REDIS_URL="redis://barepod_admin:${REDIS_ADMIN_PASS}@127.0.0.1:6379"
    if redis-cli -h 127.0.0.1 --no-auth-warning ACL SETUSER barepod_admin reset on ">${REDIS_ADMIN_PASS}" '~*' '+@all' >/dev/null 2>&1; then
      mkdir -p /etc/barepod && chmod 0700 /etc/barepod
      printf '%s\n' "$REDIS_URL" > "$REDIS_ADMIN_FILE"
      chmod 0600 "$REDIS_ADMIN_FILE"
      # The users live in an ACL file, not in redis.conf: runtime ACL users are lost on a restart
      # (measured — a restart while changing `bind` wiped every cache user), and Redis refuses to
      # start if `user` lines are in redis.conf while an aclfile is configured.
      install -d -m 0750 -o redis -g redis /etc/redis 2>/dev/null || mkdir -p /etc/redis
      {
        printf 'user barepod_admin on #%s ~* +@all\n' "$(printf '%s' "$REDIS_ADMIN_PASS" | sha256sum | cut -c1-64)"
        printf 'user default off\n'
      } > /etc/redis/users.acl
      chown redis:redis /etc/redis/users.acl 2>/dev/null || true
      chmod 0640 /etc/redis/users.acl
      if ! grep -qE '^[[:space:]]*aclfile' /etc/redis/redis.conf 2>/dev/null; then
        printf '\n# Added by BarePod: ACL users live here, because ones created at runtime are lost on\n# a restart. Do not also put `user` lines in this file — Redis refuses to start then.\naclfile /etc/redis/users.acl\n' >> /etc/redis/redis.conf
      fi
      # A container manager has to be able to reach the cache, and the one address a container has
      # to the host is the docker bridge gateway — so the cache listens there too, and the panel's
      # firewall keeps every other interface out. `bind` is a startup directive: this needs a
      # restart, which the note below says.
      REDIS_GATEWAY="$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
      if [[ -n "$REDIS_GATEWAY" ]] && ! grep -qE "^[[:space:]]*bind .*${REDIS_GATEWAY}" /etc/redis/redis.conf 2>/dev/null; then
        sed -i "s|^[[:space:]]*bind .*|bind 127.0.0.1 -::1 ${REDIS_GATEWAY}|" /etc/redis/redis.conf
        note "Redis will also listen on the container gateway ${REDIS_GATEWAY}, so a container manager can reach it (takes effect on its next restart)"
      fi
      systemctl restart redis-server >/dev/null 2>&1 || true
      if redis-cli -u "$REDIS_URL" --no-auth-warning ACL WHOAMI 2>/dev/null | grep -q barepod_admin; then
        note "Redis no longer accepts unauthenticated connections (default off, users in /etc/redis/users.acl, panel identity in $REDIS_ADMIN_FILE)"
      else
        note "Redis did not accept the panel's identity — check: systemctl status redis-server"
      fi
      install -d -m 0755 /etc/systemd/system/barepod.service.d
      printf '[Service]\nEnvironment=BAREPOD_REDIS_URL=%s\n' "$REDIS_URL" \
        > /etc/systemd/system/barepod.service.d/redis-admin.conf
      note "run: systemctl daemon-reload && systemctl restart barepod   (to hand the panel its identity)"
    else
      note "the Redis admin identity could not be created"
    fi
  else
    note "Redis did not answer without credentials and no admin identity is stored — left untouched rather than half-configured"
  fi

  # These are enforced on every run, not only when the identity is created: a host that already has
  # an identity would otherwise keep a Redis without an ACL file (so its users die on the next
  # restart) and reachable only on loopback (so no container manager could open it).
  if [[ -f /etc/redis/redis.conf ]]; then
    if ! grep -qE '^[[:space:]]*aclfile' /etc/redis/redis.conf; then
      install -d -m 0750 -o redis -g redis /etc/redis 2>/dev/null || mkdir -p /etc/redis
      [[ -f /etc/redis/users.acl ]] || printf 'user default off\n' > /etc/redis/users.acl
      chown redis:redis /etc/redis/users.acl 2>/dev/null || true
      chmod 0640 /etc/redis/users.acl
      printf '\n# Added by BarePod: ACL users live here, because ones created at runtime are lost on\n# a restart. Do not also put `user` lines in this file — Redis refuses to start then.\naclfile /etc/redis/users.acl\n' >> /etc/redis/redis.conf
      note "Redis ACL users moved to /etc/redis/users.acl (a restart is needed to apply it)"
    fi
    REDIS_GATEWAY="$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
    if [[ -n "$REDIS_GATEWAY" ]] && ! grep -qE "^[[:space:]]*bind .*${REDIS_GATEWAY}" /etc/redis/redis.conf 2>/dev/null; then
      sed -i "s|^[[:space:]]*bind .*|bind 127.0.0.1 -::1 ${REDIS_GATEWAY}|" /etc/redis/redis.conf
      note "Redis will also listen on the container gateway ${REDIS_GATEWAY}, so a container manager can reach it (takes effect on its next restart)"
    fi
  fi
fi

# ---------------------------------------------------------------- tuning
# Every engine installs with defaults meant for a machine doing nothing else: PostgreSQL gets 128MB
# of shared buffers, MariaDB a 128MB buffer pool, Redis no memory policy at all. On a panel host
# that is what turns a busy afternoon into swapping. The sizes below come from the RAM measured
# here, and they are written as drop-in files so the distribution's own configuration is never
# rewritten — a BarePod file can be deleted to go back to stock.
say "Sizing the engines to this machine"
RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)
RAM_MB=${RAM_MB:-2048}
# work_mem is per sort or hash, so it multiplies by concurrent queries: sizing it as a fraction of
# RAM alone is the classic way to run a machine out of memory (200 connections × 128MB is 25GB).
# It is sized against the connection limit instead.
PG_MAX_CONNS=200
PG_WORK_MEM=$((RAM_MB / (PG_MAX_CONNS * 4)))
[[ "$PG_WORK_MEM" -lt 4 ]] && PG_WORK_MEM=4

PG_CONF_D="$(ls -d /etc/postgresql/*/main/conf.d 2>/dev/null | head -1)"
if [[ -n "$PG_CONF_D" ]]; then
  cat > "$PG_CONF_D/99-barepod.conf" <<CONF
# Written by BarePod, sized to this machine (${RAM_MB} MB of RAM). Delete this file to return to
# PostgreSQL's own defaults.
shared_buffers = $((RAM_MB / 4))MB
effective_cache_size = $((RAM_MB * 3 / 4))MB
work_mem = ${PG_WORK_MEM}MB
maintenance_work_mem = $((RAM_MB / 16))MB
max_connections = ${PG_MAX_CONNS}
CONF
  note "PostgreSQL: shared_buffers $((RAM_MB / 4))MB, work_mem ${PG_WORK_MEM}MB, ${PG_MAX_CONNS} connections"
fi

MARIA_CONF_D=/etc/mysql/mariadb.conf.d
if [[ -d "$MARIA_CONF_D" ]]; then
  cat > "$MARIA_CONF_D/99-barepod.cnf" <<CONF
# Written by BarePod, sized to this machine (${RAM_MB} MB of RAM). Delete this file to return to
# MariaDB's own defaults.
[mysqld]
innodb_buffer_pool_size = $((RAM_MB / 2))M
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2
max_connections = ${PG_MAX_CONNS}
CONF
  note "MariaDB: innodb_buffer_pool_size $((RAM_MB / 2))MB, ${PG_MAX_CONNS} connections"
fi

if [[ -f /etc/redis/redis.conf ]]; then
  # A cache should evict rather than refuse writes when it fills, which is what Redis's default
  # (noeviction) does. A memory limit is deliberately NOT set: this host may hold cache data an
  # application treats as durable, and choosing a ceiling for it is the operator's call, not an
  # installer's.
  if ! grep -qE '^[[:space:]]*maxmemory-policy' /etc/redis/redis.conf; then
    printf '\n# Added by BarePod: a cache that fills should evict its coldest keys, not start\n# refusing writes. No maxmemory is set here on purpose — pick a ceiling you are happy with.\nmaxmemory-policy allkeys-lru\n' >> /etc/redis/redis.conf
    note "Redis: maxmemory-policy allkeys-lru (no memory limit set — that is your call)"
  fi
fi

# ---------------------------------------------------------------- brute-force lockout
# A database port that is opened to the outside (per-database "public" exposure) needs a
# lockout before it is opened, not after: fail2ban watches the engines' own logs and bans
# the address that keeps failing. The numbers are deliberate panel defaults, not
# fail2ban's, and they live in the jail files so an operator can change them in one place
# (and the panel can rewrite them later).
# ---------------------------------------------------------------- the panel's own lockout
# fail2ban used to be installed here, and is deliberately no longer: measured on this host, version
# 1.0.2 against Python 3.12 prints "Server ready" and exits 255 with nothing in its own log — and a
# jail that is written but whose daemon is dead protects nothing. The panel runs its own watchdog
# instead: the same table the panel already uses, bans persisted in its database, re-applied at every
# start, and it reads the engines' own logs. Nothing needs installing for that.
say "Brute-force lockout: the panel's own watchdog (no fail2ban)"
note "fail2ban is not installed and no jails are written — the daemon's watchdog covers the engines"

# ---------------------------------------------------------------- optional managers
# pgweb is one Go binary with no runtime of its own, and the panel starts it only
# when someone opens it and stops it when it goes idle — so having it installed
# costs nothing while it is not being used. It is fetched from its own release page
# at a pinned version; if the download fails the rest of the install still stands.
PGWEB_VERSION="0.16.2"
if have pgweb; then
  note "pgweb already installed"
else
  ARCH=$(uname -m); case "$ARCH" in x86_64) PGWEB_ARCH="amd64";; aarch64|arm64) PGWEB_ARCH="arm64";; *) PGWEB_ARCH="";; esac
  if [[ -n "$PGWEB_ARCH" ]]; then
    URL="https://github.com/sosedoff/pgweb/releases/download/v${PGWEB_VERSION}/pgweb_linux_${PGWEB_ARCH}.zip"
    if curl -fsSL "$URL" -o /tmp/pgweb.zip 2>/dev/null && unzip -o -q /tmp/pgweb.zip -d /tmp/pgweb-extract 2>/dev/null; then
      # The binary inside the release zip is named pgweb_linux_<arch>, not pgweb.
      PGWEB_BIN="$(find /tmp/pgweb-extract -maxdepth 1 -type f -name 'pgweb*' | head -n1)"
      if [[ -n "$PGWEB_BIN" ]] && install -m 0755 "$PGWEB_BIN" /usr/local/bin/pgweb; then
        note "installed pgweb ${PGWEB_VERSION} (starts on demand, stops when idle)"
      else
        note "pgweb could not be installed — the panel will say it is unavailable"
      fi
      rm -rf /tmp/pgweb.zip /tmp/pgweb-extract
    else
      note "pgweb could not be downloaded — the panel will say it is unavailable"
      rm -f /tmp/pgweb.zip
    fi
  else
    note "no pgweb build for $ARCH — the panel will say it is unavailable"
  fi
fi

# ------------------------------------------------------------ optional PHP manager
# phpMyAdmin is a PHP application and the panel runs it with PHP's own small server
# (php -S) — one process, no Apache or PHP-FPM — so only the CLI and a few
# extensions are needed. The panel reports it as unavailable until then.
# ------------------------------------------------------------ PHP: the manager, and the runtime
# phpMyAdmin is a PHP application that the panel runs with PHP's own small server (php -S) — one
# process, no Apache or PHP-FPM — so the CLI and a few extensions are what it needs. A *website*
# with runtime `php` is a different thing: the panel runs one php-fpm master per site with a pool of
# its own, so `php-fpm` must exist at the path it builds. Measured: it did not (this installer was
# CLI-only), and the panel looked for `php-fpm83` where Debian and Ubuntu provide `php-fpm8.3`.
say "Installing PHP for the phpMyAdmin manager and for PHP websites"
if have php; then
  note "php already installed ($(php -r 'echo PHP_VERSION;' 2>/dev/null))"
else
  apt-get install -y -qq php-cli php-mysql php-mbstring php-zip php-gd php-curl php-xml >/dev/null 2>&1 \
    && note "installed php-cli + extensions" \
    || note "php could not be installed — phpMyAdmin will be unavailable"
fi

# php-fpm is what serves a PHP website; without it such a site has a unit that cannot start.
if ls /usr/sbin/php-fpm* >/dev/null 2>&1 || command -v php-fpm >/dev/null 2>&1; then
  note "php-fpm already installed ($(ls /usr/sbin/php-fpm* 2>/dev/null | head -1))"
else
  apt-get install -y -qq php-fpm >/dev/null 2>&1 \
    && note "installed php-fpm ($(ls /usr/sbin/php-fpm* 2>/dev/null | head -1)) — PHP websites can be served" \
    || note "php-fpm could not be installed — a website with runtime php will not start"
fi
# The distribution's own php-fpm service is deliberately left alone: each site gets its own master
# and pool, so a system-wide one would only hold a socket nothing talks to.

# Keep in step with the daemon's -dbtools-dir (default: beside the panel database).
DBTOOLS_DIR="${BAREPOD_DBTOOLS_DIR:-/var/lib/barepod/dbtools}"
PMA_VERSION="5.2.1"
PMA_DIR="$DBTOOLS_DIR/phpmyadmin"
mkdir -p "$DBTOOLS_DIR"
if [[ -f "$PMA_DIR/index.php" ]]; then
  note "phpMyAdmin already installed"
elif have php; then
  URL="https://files.phpmyadmin.net/phpMyAdmin/${PMA_VERSION}/phpMyAdmin-${PMA_VERSION}-english.tar.gz"
  if curl -fsSL "$URL" -o /tmp/pma.tgz 2>/dev/null && tar -xzf /tmp/pma.tgz -C "$DBTOOLS_DIR" 2>/dev/null; then
    mv "$DBTOOLS_DIR/phpMyAdmin-${PMA_VERSION}-english" "$PMA_DIR" 2>/dev/null || true
    if [[ -f "$PMA_DIR/index.php" ]]; then
      note "installed phpMyAdmin ${PMA_VERSION} (starts on demand, stops when idle)"
    else
      note "phpMyAdmin could not be unpacked — the panel will say it is unavailable"
    fi
  else
    note "phpMyAdmin could not be downloaded — the panel will say it is unavailable"
  fi
  rm -f /tmp/pma.tgz
else
  note "phpMyAdmin needs php — skipped"
fi

say "Done"
if [[ "$failures" -gt 0 ]]; then
  echo "   $failures engine(s) did not answer; the panel will report them honestly rather than pretend."
  exit 1
fi
echo "   Every engine installed here answers, and the panel's /db-engines will say so."
