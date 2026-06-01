#!/bin/bash
# StreamRelay FFmpeg Relay Script
# Usage: ./ffmpeg-relay.sh <source_url> <output_dir> <channel_slug> [transcode]

set -euo pipefail

SOURCE_URL="${1:?Source URL required}"
OUTPUT_DIR="${2:?Output directory required}"
CHANNEL_SLUG="${3:?Channel slug required}"
TRANSCODE="${4:-false}"

HLS_DIR="${OUTPUT_DIR}/${CHANNEL_SLUG}"
mkdir -p "$HLS_DIR"

LOG_FILE="/var/log/streamrelay/${CHANNEL_SLUG}.log"
mkdir -p "$(dirname "$LOG_FILE")"

COMMON_OPTS=(
  -hide_banner
  -loglevel warning
  -reconnect 1
  -reconnect_streamed 1
  -reconnect_delay_max 5
  -timeout 10000000
  -i "$SOURCE_URL"
)

if [ "$TRANSCODE" = "true" ]; then
  CODEC_OPTS=(-c:v libx264 -preset veryfast -b:v 2000k -c:a aac -b:a 128k)
else
  CODEC_OPTS=(-c copy)
fi

HLS_OPTS=(
  -f hls
  -hls_time 4
  -hls_list_size 6
  -hls_flags delete_segments+append_list+omit_endlist
  -hls_segment_filename "${HLS_DIR}/seg_%03d.ts"
  "${HLS_DIR}/index.m3u8"
)

echo "[$(date -Iseconds)] Starting relay: ${CHANNEL_SLUG}" >> "$LOG_FILE"

exec ffmpeg "${COMMON_OPTS[@]}" "${CODEC_OPTS[@]}" "${HLS_OPTS[@]}" \
  >> "$LOG_FILE" 2>&1
