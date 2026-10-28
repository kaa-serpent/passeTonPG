#!/usr/bin/env bash
set -euo pipefail
cd /opt/passetonpg
set -a
source /var/lib/passetonpg/current.env
set +a
docker compose -f deploy/compose.prod.yaml exec -T app node scripts/backup.mjs
# Retain 14 days of this application's backups only; keep independent off-VM copies.
find /var/lib/passetonpg/data/backups -maxdepth 1 -type f -name 'passetonpg-*.sqlite' -mtime +14 -delete
