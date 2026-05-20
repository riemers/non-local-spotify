#!/bin/sh
set -e

if [ "${ENABLE_CRON}" = "true" ]; then
  echo "Starting daily sync scheduler (crontab: 06:00, TZ=${TZ:-UTC})"
  supercronic /app/crontab &
fi

exec "$@"
