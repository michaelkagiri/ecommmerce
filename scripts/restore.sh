#!/bin/sh
# Usage: ./scripts/restore.sh backups/pos-2026-11-09.archive.gz   (replaces current data!)
# Practise this on a spare machine before you need it.
set -e
docker compose exec -T mongo mongorestore --archive --gzip --drop < "$1"
