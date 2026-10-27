#!/usr/bin/env bash
set -euo pipefail

# Checks what the unit tests can't, against a running mini: a file sent
# through the real HTTP server lands intact in its --software.image-dir
# folder, and /images keeps the entry added for it.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACTON_BIN="${ACTON:-acton}"
ACTON_BUILD_ARGS="${ACTON_BUILD_ARGS:-}"
CURL_BIN="${CURL:-curl}"
PORT="${PORT:-$((18080 + RANDOM % 1000))}"
BIN_FILE="$ROOT_DIR/minisys/out/bin/mini"
WORK_DIR="$(mktemp -d)"
IMAGE_DIR="$WORK_DIR/images"
NAME="test-image.bin"
PID=""
STATUS=""
BODY=""

cleanup() {
    if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null || true
        wait "$PID" 2>/dev/null || true
    fi
    rm -rf "$WORK_DIR"
}

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

wait_for_http() {
    local url="http://127.0.0.1:${PORT}/image-file"
    for _ in $(seq 1 100); do
        if "$CURL_BIN" --connect-timeout 1 --max-time 2 -fsS "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.1
    done
    fail "mini did not start listening on port ${PORT}"
}

start_mini() {
    # A relative folder, so mini resolves it against its working directory
    (
        cd "$WORK_DIR"
        exec "$BIN_FILE" --http.port "$PORT" --software.image-dir images
    ) >/dev/null 2>&1 &
    PID=$!
    wait_for_http
}

# Send a file as one PUT with -T and keep the reply in STATUS and BODY. curl
# would wait a second for a "100 Continue" before a large body; Expect: turns
# that off.
upload() {
    local path="$1" file="$2"
    STATUS="$("$CURL_BIN" -sS --connect-timeout 1 --max-time 30 -o "$WORK_DIR/reply" -w '%{http_code}' -H 'Expect:' -T "$file" "http://127.0.0.1:${PORT}${path}")"
    BODY="$(cat "$WORK_DIR/reply")"
}

# Send a RESTCONF request under /restconf/data, the way the web UI does
restconf() {
    local method="$1" path="$2" data="${3:-}"
    local args=(-sS --connect-timeout 1 --max-time 10 -o "$WORK_DIR/reply" -w '%{http_code}' -X "$method" -H 'Accept: application/yang-data+json')
    if [[ -n "$data" ]]; then
        args+=(-H 'Content-Type: application/yang-data+json' --data-binary "$data")
    fi
    STATUS="$("$CURL_BIN" "${args[@]}" "http://127.0.0.1:${PORT}/restconf/data${path}")"
    BODY="$(cat "$WORK_DIR/reply")"
}

expect() {
    [[ "$STATUS" == "$1" && "$BODY" == *"$2"* ]] || fail "expected $1 with '$2', got $STATUS: $BODY"
}

trap cleanup EXIT

cd "$ROOT_DIR"
if command -v "$ACTON_BIN" >/dev/null 2>&1; then
    "$ACTON_BIN" build $ACTON_BUILD_ARGS minisys/src/mini.act
elif [[ ! -x "$BIN_FILE" ]]; then
    fail "acton not found on PATH and ${BIN_FILE} is missing; set ACTON=/path/to/acton"
fi

# Binary data whose start looks like the end of HTTP headers
mkdir "$IMAGE_DIR"
{ printf '\r\n\r\n\0\377'; head -c $((3 * 1024 * 1024 - 6)) /dev/urandom; } > "$WORK_DIR/source.bin"

start_mini
upload "/image-file/$NAME" "$WORK_DIR/source.bin"
expect 200 ""
cmp "$WORK_DIR/source.bin" "$IMAGE_DIR/$NAME" || fail "the uploaded file differs from the source"

# The web UI then adds the file's image list entry
ENTRY="{\"name\":\"$NAME\",\"os\":\"IOS XE\",\"version\":\"17.18.03a\",\"model\":[\"C8000V\"]}"
restconf PATCH "" "{\"stratoweave-images:images\":{\"image\":[$ENTRY]}}"
expect 204 ""
restconf GET "/stratoweave-images:images"
expect 200 "$ENTRY"
restconf DELETE "/stratoweave-images:images/image=$NAME"
expect 204 ""
restconf GET "/stratoweave-images:images"
[[ "$BODY" != *"$NAME"* ]] || fail "the image list entry is still there after DELETE: $BODY"

echo "Image upload test passed on port ${PORT}"
