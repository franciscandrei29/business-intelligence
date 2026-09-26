#!/bin/bash
BACKUP_DIR="/root/backups/kimono-bi-standalone"
DATE=$(date +%Y%m%d-%H%M%S)
DB="kimono_bi_standalone"

mkdir -p "$BACKUP_DIR"

# Dump + gzip
PGPASSWORD='KimonoBi2026Standalone!' pg_dump -U kimonobi_app -h 127.0.0.1 "$DB" | gzip > "$BACKUP_DIR/$DB-$DATE.sql.gz"

# Retention 7 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "[$(date)] Backup finalizat: $DB-$DATE.sql.gz"
