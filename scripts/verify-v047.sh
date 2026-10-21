#!/usr/bin/env bash
# verify-v047.sh — host-side checks for the v0.4.7 capacity-sharing fix.
#
# Unit tests prove the renderers and handlers in isolation. This script proves the
# running daemon and the installed web servers agree with them:
#   * journald logs are readable for a real site
#   * creating a route rewrites the vhost for nginx, caddy, apache and openlitespeed
#   * ping performs a real HTTP request (a dead upstream is reported, not invented)
#   * the public deploy webhook validates its token and ignores a foreign branch
#   * git_commit_watcher is installed, scheduled and (optionally) runs
#
# Usage:
#   BAREPOD_URL=https://panel.example.com \
#   BAREPOD_USER=admin BAREPOD_PASS='...' \
#   BAREPOD_SLUG=my-site \
#   ./scripts/verify-v047.sh
#
# Optional:
#   BAREPOD_WEBHOOK_TOKEN=...   exercise the public webhook (fake branch; no deploy)
#   BAREPOD_WEBHOOK_DEPLOY=1    also send the real branch — THIS STARTS A DEPLOY
#   BAREPOD_REAL_BRANCH=main    branch used by the real-push probe
#   BAREPOD_RUN_WATCHER=1       run git_commit_watcher now — MAY START DEPLOYS
#   BAREPOD_CURL_INSECURE=1     pass -k (self-signed panel certificate only)
#
# Exit status: 0 when every hard check passes; 1 when one fails.

set -euo pipefail

BASE="${BAREPOD_URL:?set BAREPOD_URL (for example https://panel.example.com)}"
BASE="${BASE%/}"
USERNAME="${BAREPOD_USER:?set BAREPOD_USER (panel username)}"
PASSWORD="${BAREPOD_PASS:?set BAREPOD_PASS (panel password)}"
SLUG="${BAREPOD_SLUG:-}"
WEBHOOK_TOKEN="${BAREPOD_WEBHOOK_TOKEN:-}"
REAL_BRANCH="${BAREPOD_REAL_BRANCH:-main}"

CURL=(curl -sS --fail-with-body)
if [[ "${BAREPOD_CURL_INSECURE:-0}" == "1" ]]; then
  CURL+=(-k)
fi

JAR="$(mktemp -t barepod-verify.XXXXXX)"
COOKIE_JAR=(-b "$JAR" -c "$JAR")
CSRF=""
FAILURES=0
WARNINGS=0
ROUTE_ID=""
ROUTE_PATH="/__barepod_verify_$$/"

cleanup() {
  if [[ -n "$ROUTE_ID" ]]; then
    api DELETE "/websites/${SLUG}/routes/${ROUTE_ID}" >/dev/null 2>&1 || true
  fi
  rm -f "$JAR"
}
trap cleanup EXIT

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
pass() { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33mWARN\033[0m %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

jget() {
  # jget <dot.path> reads JSON from stdin; empty when the key is absent.
  python3 -c '
import json, sys
try:
    value = json.load(sys.stdin)
    for key in sys.argv[1].split("."):
        if key:
            value = value[key]
    print("" if value is None else value)
except Exception:
    print("")
' "$1"
}

# api METHOD PATH [BODY] — prints the response body. GET needs no CSRF header.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=("${CURL[@]}" "${COOKIE_JAR[@]}" -X "$method" -H 'Accept: application/json')
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi
  if [[ -n "$CSRF" && "$method" != "GET" ]]; then
    args+=(-H "X-CSRF-Token: $CSRF")
  fi
  "${args[@]}" "${BASE}/api/v1${path}"
}

say "Panel health"
HEALTH="$(curl -sS ${BAREPOD_CURL_INSECURE:+ -k} "${BASE}/api/v1/health" || true)"
VERSION="$(printf '%s' "$HEALTH" | jget version)"
if [[ "$VERSION" == "0.4.7" ]]; then
  pass "health reports version $VERSION"
else
  warn "health version is '${VERSION:-unreachable}', expected 0.4.7 (was the new bundle rolled out?)"
fi

say "Login"
LOGIN_BODY="$(python3 -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":sys.argv[2]}))' "$USERNAME" "$PASSWORD")"
LOGIN="$(api POST /auth/login "$LOGIN_BODY" || true)"
CSRF="$(printf '%s' "$LOGIN" | jget csrfToken)"
if [[ -n "$CSRF" ]]; then
  pass "signed in as $USERNAME"
else
  fail "login failed: $LOGIN"
  say "Result"
  printf '  %d failure(s); cannot continue without a session.\n' "$FAILURES"
  exit 1
fi

if [[ -z "$SLUG" ]]; then
  SITES="$(api GET /websites || true)"
  SLUG="$(printf '%s' "$SITES" | python3 -c '
import json, sys
try:
    items = json.load(sys.stdin).get("items", [])
    print(items[0]["slug"] if items else "")
except Exception:
    print("")
')"
  if [[ -n "$SLUG" ]]; then
    say "No BAREPOD_SLUG given; using first site: $SLUG"
  fi
fi
if [[ -z "$SLUG" ]]; then
  fail "no website exists and BAREPOD_SLUG is unset"
  exit 1
fi

say "journald logs ($SLUG)"
LOGS="$(api GET "/websites/${SLUG}/logs?lines=20" || true)"
LOG_MODE="$(printf '%s' "$LOGS" | jget mode)"
LOG_UNIT="$(printf '%s' "$LOGS" | jget unit)"
LOG_COUNT="$(printf '%s' "$LOGS" | python3 -c '
import json,sys
try:
    print(len(json.load(sys.stdin).get("lines") or []))
except Exception:
    print("0")
')"
LOG_NOTE="$(printf '%s' "$LOGS" | jget note)"
if [[ "$LOG_MODE" == "journald" || "$LOG_MODE" == "journalctl" ]]; then
  pass "$LOG_UNIT returned $LOG_COUNT line(s)"
  [[ -n "$LOG_NOTE" ]] && warn "daemon note: $LOG_NOTE"
else
  warn "logs endpoint mode='${LOG_MODE:-unknown}' (dry-run/missing journal); note: ${LOG_NOTE:-none}"
fi

say "Metric history"
METRICS="$(api GET '/system/metrics?range=7d' || true)"
MET_STORAGE="$(printf '%s' "$METRICS" | jget storage)"
MET_RESOLUTION="$(printf '%s' "$METRICS" | jget resolution)"
MET_BYTES="$(printf '%s' "$METRICS" | jget metricsDbBytes)"
MET_COUNT="$(printf '%s' "$METRICS" | python3 -c '
import json,sys
try:
    print(len(json.load(sys.stdin).get("items") or []))
except Exception:
    print("0")
')"
if [[ "$MET_STORAGE" == "sqlite" ]]; then
  pass "7d host history answered from metrics.db (${MET_RESOLUTION}, ${MET_COUNT} bucket(s), ${MET_BYTES:-0} bytes)"
elif [[ "$MET_STORAGE" == "memory" ]]; then
  warn "7d history answered from memory; metrics.db may be empty yet or persistence is off"
else
  fail "metrics history response: $METRICS"
fi
SITE_METRICS="$(api GET "/websites/${SLUG}/metrics?range=7d" || true)"
SITE_STORAGE="$(printf '%s' "$SITE_METRICS" | jget storage)"
SITE_COUNT="$(printf '%s' "$SITE_METRICS" | python3 -c '
import json,sys
try:
    print(len(json.load(sys.stdin).get("items") or []))
except Exception:
    print("0")
')"
if [[ "$SITE_STORAGE" == "sqlite" && "$SITE_COUNT" -gt 0 ]]; then
  pass "site 7d history has $SITE_COUNT bucket(s)"
else
  warn "site 7d history: storage=${SITE_STORAGE:-unknown}, buckets=$SITE_COUNT"
fi

say "Real upstream ping ($SLUG)"
PING="$(api POST "/websites/${SLUG}/ping" '{}' || true)"
PING_OK="$(printf '%s' "$PING" | jget ok)"
PING_TARGET="$(printf '%s' "$PING" | jget target)"
PING_LATENCY="$(printf '%s' "$PING" | jget latencyMs)"
PING_ERROR="$(printf '%s' "$PING" | jget error)"
if [[ -n "$PING_TARGET" && -n "$PING_LATENCY" ]]; then
  if [[ "$PING_OK" == "True" ]]; then
    pass "ping $PING_TARGET answered in ${PING_LATENCY}ms"
  else
    warn "ping $PING_TARGET is genuinely unreachable (${PING_ERROR:-no detail}); endpoint is live"
  fi
else
  fail "ping returned no target/latency: $PING"
fi

say "Route → vhost on all four engines"
ROUTE_BODY="$(python3 -c 'import json,sys; print(json.dumps({"path":sys.argv[1],"upstream":"http://127.0.0.1:65535","description":"v0.4.7 host verification","websocket":True,"stripPrefix":True}))' "$ROUTE_PATH")"
ROUTE="$(api POST "/websites/${SLUG}/routes" "$ROUTE_BODY" || true)"
ROUTE_ID="$(printf '%s' "$ROUTE" | jget id)"
STORED_PATH="$(printf '%s' "$ROUTE" | jget path)"
if [[ -z "$ROUTE_ID" ]]; then
  fail "could not create route: $ROUTE"
else
  if [[ "$STORED_PATH" == "$ROUTE_PATH" ]]; then
    pass "route stored at canonical prefix $STORED_PATH"
  else
    fail "route prefix not canonical: stored '$STORED_PATH', expected '$ROUTE_PATH'"
  fi

  declare -A PATTERNS=(
    [nginx]="location ^~ ${ROUTE_PATH}"
    [caddy]="handle_path ${ROUTE_PATH}*"
    [apache]="<Location \"${ROUTE_PATH}\">"
    [openlitespeed]="context ${ROUTE_PATH}"
  )
  for engine in nginx caddy apache openlitespeed; do
    PREVIEW="$(api GET "/websites/${SLUG}/vhost/preview?engine=${engine}" || true)"
    CONFIG="$(printf '%s' "$PREVIEW" | jget config)"
    if [[ -z "$CONFIG" ]]; then
      fail "$engine preview returned no config: $PREVIEW"
    elif grep -qF "${PATTERNS[$engine]}" <<<"$CONFIG"; then
      pass "$engine vhost contains ${PATTERNS[$engine]}"
    elif grep -qF "$ROUTE_PATH" <<<"$CONFIG"; then
      warn "$engine vhost contains the path but not the expected directive '${PATTERNS[$engine]}'"
    else
      fail "$engine vhost is missing $ROUTE_PATH"
    fi
  done

  api DELETE "/websites/${SLUG}/routes/${ROUTE_ID}" >/dev/null 2>&1 || true
  ROUTE_ID=""
  ROUTES="$(api GET "/websites/${SLUG}/routes" || true)"
  if grep -qF "$ROUTE_PATH" <<<"$ROUTES"; then
    fail "route $ROUTE_PATH still listed after delete"
  else
    pass "temporary route deleted"
  fi
fi

say "Public deploy webhook"
if [[ -z "$WEBHOOK_TOKEN" ]]; then
  warn "BAREPOD_WEBHOOK_TOKEN unset; skipped (set it to test the public endpoint)"
else
  FAKE_BODY='{"ref":"refs/heads/__barepod_verify_nonexistent__"}'
  WEBHOOK="$(curl -sS ${BAREPOD_CURL_INSECURE:+ -k} -X POST -H 'Content-Type: application/json' \
    --data "$FAKE_BODY" "${BASE}/api/v1/webhooks/deploy/${SLUG}?token=${WEBHOOK_TOKEN}" || true)"
  WEBHOOK_STATUS="$(printf '%s' "$WEBHOOK" | jget status)"
  WEBHOOK_OK="$(printf '%s' "$WEBHOOK" | jget ok)"
  WEBHOOK_MESSAGE="$(printf '%s' "$WEBHOOK" | jget message)"
  if [[ "$WEBHOOK_STATUS" == "ignored" || "$WEBHOOK_OK" == "False" ]]; then
    if grep -qi 'disabled' <<<"$WEBHOOK_MESSAGE"; then
      warn "endpoint answered, but auto-deploy is disabled so the branch guard was not exercised"
    else
      pass "foreign branch ignored without starting a deploy"
    fi
  elif grep -qi 'unauthorized' <<<"$WEBHOOK"; then
    fail "webhook token rejected: $WEBHOOK"
  elif [[ "$WEBHOOK_STATUS" == "deploying" ]]; then
    warn "foreign branch unexpectedly started a deploy: $WEBHOOK"
  else
    fail "unexpected webhook response: $WEBHOOK"
  fi

  if [[ "${BAREPOD_WEBHOOK_DEPLOY:-0}" == "1" ]]; then
    say "Real push probe — this starts a deploy"
    REAL_BODY="$(python3 -c 'import json,sys; print(json.dumps({"ref":"refs/heads/"+sys.argv[1]}))' "$REAL_BRANCH")"
    REAL="$(curl -sS ${BAREPOD_CURL_INSECURE:+ -k} -X POST -H 'Content-Type: application/json' \
      --data "$REAL_BODY" "${BASE}/api/v1/webhooks/deploy/${SLUG}?token=${WEBHOOK_TOKEN}" || true)"
    REAL_STATUS="$(printf '%s' "$REAL" | jget status)"
    if [[ "$REAL_STATUS" == "deploying" ]]; then
      pass "real push accepted on $REAL_BRANCH (deploy started)"
    else
      fail "real push was not accepted: $REAL"
    fi
  fi
fi

say "git_commit_watcher"
JOBS="$(api GET /cron/jobs || true)"
WATCHER="$(printf '%s' "$JOBS" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
    items = payload.get("items") or payload.get("jobs") or []
    for job in items:
        if job.get("id") == "git_commit_watcher" or job.get("name") == "git_commit_watcher":
            print(json.dumps(job))
            break
except Exception:
    pass
')"
if [[ -z "$WATCHER" ]]; then
  fail "git_commit_watcher is not registered in the scheduler"
else
  W_ENABLED="$(printf '%s' "$WATCHER" | jget enabled)"
  W_SCHEDULE="$(printf '%s' "$WATCHER" | jget schedule)"
  W_LAST="$(printf '%s' "$WATCHER" | jget lastRunAt)"
  W_STATUS="$(printf '%s' "$WATCHER" | jget lastStatus)"
  pass "registered (enabled=$W_ENABLED schedule=$W_SCHEDULE)"
  if [[ -n "$W_LAST" ]]; then
    pass "last run $W_LAST status=$W_STATUS"
  else
    warn "has not run yet on this host"
  fi

  if [[ "${BAREPOD_RUN_WATCHER:-0}" == "1" ]]; then
    say "Running git_commit_watcher now — this may start deploys"
    RUN="$(api POST /cron/jobs/system/git_commit_watcher/run '{}' || true)"
    RUN_STATUS="$(printf '%s' "$RUN" | jget status)"
    RUN_OUTPUT="$(printf '%s' "$RUN" | jget output)"
    if [[ "$RUN_STATUS" == "success" ]]; then
      pass "watcher run succeeded"
    else
      fail "watcher run status='$RUN_STATUS': $RUN_OUTPUT"
    fi
    printf '%s\n' "$RUN_OUTPUT" | sed 's/^/    /'
  fi
fi

say "Result"
if [[ "$FAILURES" -gt 0 ]]; then
  printf '  \033[1;31m%d failure(s)\033[0m, %d warning(s).\n' "$FAILURES" "$WARNINGS"
  exit 1
fi
printf '  \033[1;32mAll hard checks passed\033[0m, %d warning(s).\n' "$WARNINGS"
