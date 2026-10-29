#!/bin/sh
# Starts ConMon Lab on this computer at http://localhost:8080 (needs python3).
cd "$(dirname "$0")/site" || exit 1
URL=http://localhost:8080/kernel/
echo "ConMon Lab is running at $URL - press Ctrl+C to stop."
( sleep 1; (xdg-open "$URL" || open "$URL") >/dev/null 2>&1 ) &
exec python3 -m http.server 8080 --bind 127.0.0.1
