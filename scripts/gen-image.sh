#!/bin/bash
# gen-image.sh <output_path> <size> <prompt>
# Generates an image via z-ai CLI with up to 3 attempts (1 initial + 2 retries).
OUT="$1"; SIZE="$2"; PROMPT="$3"
if [ -z "$OUT" ] || [ -z "$SIZE" ] || [ -z "$PROMPT" ]; then
  echo "FAIL[$OUT]: missing args"
  exit 1
fi
for attempt in 1 2 3; do
  # Skip if already generated and non-empty (idempotent re-runs)
  if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT" 2>/dev/null || echo 0)" -gt 10000 ]; then
    echo "OK[$OUT]: exists from previous run"
    exit 0
  fi
  echo ">>> $OUT attempt $attempt"
  z-ai image -p "$PROMPT" -o "$OUT" -s "$SIZE" >/dev/null 2>&1
  if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT" 2>/dev/null || echo 0)" -gt 10000 ]; then
    echo "OK[$OUT]: $(stat -c%s "$OUT") bytes (attempt $attempt)"
    exit 0
  fi
  sleep $((attempt * 3))
done
echo "FAIL[$OUT]: all 3 attempts failed"
exit 2
