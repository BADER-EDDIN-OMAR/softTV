#!/bin/sh
# Run from the checkout on the deployment server. A short write outage ensures consistency.
set -eu
cd "$(dirname "$0")/.."
umask 077
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd)"
backup_name="softtv-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
docker compose stop app
restart_app() { docker compose start app >/dev/null; }
cleanup() { rm -f "$backup_dir/$backup_name.partial"; restart_app; }
trap cleanup EXIT
# The app volume includes the database, WAL files, attachments and generated admin password.
docker compose run --rm --no-deps -T --entrypoint tar app -czf - -C /app/data . > "$backup_dir/$backup_name.partial"
mv "$backup_dir/$backup_name.partial" "$backup_dir/$backup_name"
printf 'Backup created: %s/%s\n' "$backup_dir" "$backup_name"
