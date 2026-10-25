#!/usr/bin/env bash
# Finds out which calls of YOUR panel can list a reseller's lines.
# Prints only statuses, counts and FIELD NAMES — never usernames, passwords or other customer data.
# Usage: bash scripts/probe-panel.sh
set -u
command -v python3 >/dev/null || { echo "python3 missing: apt install -y python3"; exit 1; }

read -r -p "Reseller API URL (e.g. http://panel.com/resellerapi): " RAPI
read -r -s -p "API key of a REAL reseller (one that has lines): " KEY; echo
read -r -p "ID of a line THIS reseller owns (Enter = skip): " OWN
read -r -p "ID of a line of ANOTHER reseller (Enter = skip): " OTHER
read -r -p "Panel base URL for api.php / player_api (e.g. http://panel.com:80, Enter = skip): " BASE
RAPI="${RAPI%/}"; BASE="${BASE%/}"

summ() { # prints a safe summary of a JSON answer read from stdin
python3 -c '
import sys, json
raw = sys.stdin.read()
try:
    j = json.loads(raw)
except Exception:
    print("   not JSON (" + str(len(raw)) + " bytes)" + (": " + raw[:80].replace("\n"," ") if len(raw) < 200 and "pass" not in raw.lower() else ""))
    sys.exit()
def rows(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ("data", "lines", "users", "items", "aaData", "rows", "result"):
            if k in x and isinstance(x[k], (list, dict)):
                v = x[k]
                return v if isinstance(v, list) else list(v.values()) if v and all(isinstance(i, dict) for i in v.values()) else [v]
    return []
r = rows(j)
top = list(j.keys())[:12] if isinstance(j, dict) else "list"
extra = ""
if isinstance(j, dict):
    for k in ("status", "result", "recordsTotal", "recordsFiltered", "total", "error", "message"):
        if k in j and not isinstance(j[k], (list, dict)): extra += " %s=%s" % (k, str(j[k])[:40])
print("   top keys:", top, "|", "records:", len(r), extra)
first = r[0] if r and isinstance(r[0], dict) else None
if first:
    print("   fields:", sorted(first.keys())[:40])
    for k in ("member_id", "owner_id", "reseller_id", "created_by"):
        if k in first: print("   owner field %s present" % k)
'
}

call() { echo "== $1"; curl -s -m 30 "$2" | summ; }

echo; echo "### Reseller API"
call "user_info"                 "$RAPI/?api_key=$KEY&action=user_info"
call "get_lines"                 "$RAPI/?api_key=$KEY&action=get_lines"
call "get_lines start/limit"     "$RAPI/?api_key=$KEY&action=get_lines&start=0&limit=10"
call "get_lines start/length"    "$RAPI/?api_key=$KEY&action=get_lines&draw=1&start=0&length=10"
call "get_lines page/per_page"   "$RAPI/?api_key=$KEY&action=get_lines&page=1&per_page=10"
call "get_lines show_all"        "$RAPI/?api_key=$KEY&action=get_lines&show_all=1"
call "lines"                     "$RAPI/?api_key=$KEY&action=lines"
call "get_users"                 "$RAPI/?api_key=$KEY&action=get_users"
call "get_mags"                  "$RAPI/?api_key=$KEY&action=get_mags"
echo "== get_lines via POST"; curl -s -m 30 -X POST --data "api_key=$KEY&action=get_lines&start=0&limit=10" "$RAPI/" | summ
[ -n "$OWN" ]   && call "get_line own ($OWN)"     "$RAPI/?api_key=$KEY&action=get_line&id=$OWN"
[ -n "$OTHER" ] && call "get_line OTHER ($OTHER)" "$RAPI/?api_key=$KEY&action=get_line&id=$OTHER"

if [ -n "$BASE" ]; then
  echo; echo "### api.php (works only if this server IP is whitelisted on the panel)"
  call "api.php reg_user list"  "$BASE/api.php?action=reg_user&sub=list"
  call "api.php user list"      "$BASE/api.php?action=user&sub=list"
  call "api.php user info (dummy)" "$BASE/api.php?action=user&sub=info&username=orbitprobe&password=orbitprobe"
fi
echo; echo "Done. Send this whole output (it contains no customer data)."
