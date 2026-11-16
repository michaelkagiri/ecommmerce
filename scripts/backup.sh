#!/bin/sh
# Nightly backup. Cron: 0 2 * * * cd /opt/pos && ./scripts/backup.sh
set -e
mkdir -p backups
FILE="backups/pos-$(date +%F).archive.gz"
docker compose exec -T mongo mongodump --db pos --archive --gzip > "$FILE"
find backups -name 'pos-*.archive.gz' -mtime +14 -delete
# Copy OFF the server (a backup on the same disk is not a backup). Examples:
# rclone copy "$FILE" remote:pos-backups/
# scp "$FILE" user@other-host:/backups/pos/
echo "Backup written: $FILE"
