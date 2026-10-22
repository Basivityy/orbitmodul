#!/usr/bin/env bash
# OrbitModul update: pulls the latest code from GitHub, rebuilds and checks the site.
# If the site does not answer after the update, it goes back to the previous version automatically.
# Usage (on the server):  cd /root/xui-billing && bash scripts/update.sh
set -u
cd "$(dirname "$0")/.."

check() {
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ || true)
    case "$code" in 200|301|302|303|307|308) echo "$code"; return 0 ;; esac
    sleep 3
  done
  echo "${code:-000}"
  return 1
}

deploy() {
  docker compose up -d --build || return 1
  # nginx is recreated so it always reaches the new app container
  docker compose up -d --force-recreate nginx || return 1
}

prev=$(git rev-parse HEAD)
echo "→ current version: $(cat VERSION 2>/dev/null)"
git fetch -q origin main || { echo "✗ could not reach GitHub"; exit 1; }
git reset -q --hard origin/main
echo "→ new version:     $(cat VERSION 2>/dev/null)"

if deploy && code=$(check); then
  echo "✓ update OK — site answers ($code)"
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

echo "✗ the site does not answer after the update — going back to the previous version"
docker compose logs --tail=40 app nginx > /root/orbit-update-error.log 2>&1 || true
git reset -q --hard "$prev"
deploy
if code=$(check); then
  echo "✓ previous version restored ($code). Error log: /root/orbit-update-error.log"
else
  echo "✗ site still not answering ($code). Error log: /root/orbit-update-error.log"
fi
exit 1
