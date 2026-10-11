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

say "Done"
if [[ "$failures" -gt 0 ]]; then
  echo "   $failures engine(s) did not answer; the panel will report them honestly rather than pretend."
  exit 1
fi
echo "   Every engine installed here answers, and the panel's /db-engines will say so."
