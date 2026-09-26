#!/bin/bash
cd /root/business-intelligence-kimono-nu-seo
set -a && . ./.env && set +a

REPORT=""
ERRORS=0

# 1. PM2 Status
ONLINE=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(sum(1 for p in d if p.get('pm2_env',{}).get('status')=='online'))" 2>/dev/null)
TOTAL=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d))" 2>/dev/null)
REPORT+="PM2: ${ONLINE}/${TOTAL} online\n"

# 2. Last sync
LAST_SYNC=$(grep -oP "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}" /root/logs/kimono-bi-standalone/cron-sync.log 2>/dev/null | tail -1)
REPORT+="Ultimul sync: ${LAST_SYNC}\n"

# 3. Errors in last 12h
ERR_COUNT=$(find /root/logs/kimono-bi-standalone/ -name "error-*.log" -mmin -720 -exec grep -c "Error" {} + 2>/dev/null | awk -F: '{s+=$2}END{print s+0}')
REPORT+="Erori 12h: ${ERR_COUNT}\n"

# 4. DB size
DB_SIZE=$(psql -U postgres -h 127.0.0.1 -t -c "SELECT pg_size_pretty(pg_database_size('kimono_bi_standalone'));" 2>/dev/null | xargs)
REPORT+="DB size: ${DB_SIZE}\n"

# 5. Disk space
DISK=$(df -h / | tail -1 | awk '{print $4 " free (" $5 " used)"}')
REPORT+="Disk: ${DISK}\n"

# 6. Memory
MEM=$(free -h | grep Mem | awk '{print $3 "/" $2 " used"}')
REPORT+="Memory: ${MEM}\n"

SUBJECT="Kimono BI Morning Check - $(date '+%Y-%m-%d')"
if [ "${ERR_COUNT}" -gt 10 ] 2>/dev/null; then
  SUBJECT="ALERTA Kimono BI: ${ERR_COUNT} erori detectate"
  ERRORS=$((ERRORS+1))
fi

echo -e "Subject: ${SUBJECT}\nFrom: Kimono BI <noreply@kimonogroup.ro>\nTo: franciscandrei@gmail.com\nContent-Type: text/plain; charset=utf-8\n\n${REPORT}" | sendmail -t

echo "[morning-check] $(date -Iseconds) done. Errors: ${ERRORS}"
