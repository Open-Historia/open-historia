#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PUBLISH=0
OUT=""
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --dry-run) PUBLISH=0 ;;
    *) OUT="$arg" ;;
  esac
done
test -n "$OUT" || { echo "usage: native/publish-release.sh <package out dir> [--publish]   (a dry run unless --publish)" >&2; exit 2; }

REPO="Open-Historia/open-historia"
TAG="native-experimental"
CHUNK_TAG="native-experimental-chunks"
TITLE="Open Historia Native — super experimental"
CHUNK_TITLE="Open Historia Native — update pieces"
EXE="$OUT/Open-Historia-Native-Setup.exe"
FEED="$OUT/native-latest.json"
CHECK="$HERE/check-release.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '%s\n' "$*"; }
run() {
  if [ "$PUBLISH" = 1 ]; then "$@"; else say "would run: $*"; fi
}
assets() {
  if gh release view "$1" --repo "$REPO" --json assets > "$2" 2>/dev/null; then return 0; fi
  echo '{"assets":[]}' > "$2"
  return 1
}

node "$CHECK" local "$OUT"

if ! assets "$CHUNK_TAG" "$WORK/chunks-before.json"; then
  CHUNK_NOTES="$WORK/chunk-notes.md"
  printf '%s\n' \
    'The pieces Open Historia Native updates itself from. An installed copy downloads only the pieces that changed since its own version, checks each one, and puts the new files in place when the game closes.' \
    '' \
    'Nothing here is meant to be downloaded by hand: to install the game, use `Open-Historia-Native-Setup.exe` from the `native-experimental` release.' \
    > "$CHUNK_NOTES"
  run gh release create "$CHUNK_TAG" --repo "$REPO" --prerelease --latest=false --target main --title "$CHUNK_TITLE" --notes-file "$CHUNK_NOTES"
fi

node "$CHECK" plan "$OUT" "$WORK/chunks-before.json" "$WORK/upload.txt"
COUNT="$(grep -c . "$WORK/upload.txt" || true)"
if [ "$COUNT" -gt 0 ]; then
  say "uploading $COUNT chunk file(s) to $CHUNK_TAG (pieces first, the file list last):"
  BATCH=()
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    say "  $(basename "$file") $(wc -c < "$file" | tr -d ' ') bytes"
    BATCH+=("$file")
    if [ "${#BATCH[@]}" -ge 20 ]; then
      run gh release upload "$CHUNK_TAG" "${BATCH[@]}" --repo "$REPO" --clobber
      BATCH=()
    fi
  done < "$WORK/upload.txt"
  if [ "${#BATCH[@]}" -gt 0 ]; then run gh release upload "$CHUNK_TAG" "${BATCH[@]}" --repo "$REPO" --clobber; fi
fi

if [ "$PUBLISH" = 1 ]; then
  assets "$CHUNK_TAG" "$WORK/chunks-after.json"
  node "$CHECK" remote-chunks "$OUT" "$WORK/chunks-after.json"
else
  say "would check: every chunk file the feed names is on $CHUNK_TAG with its size (else stop before the feed)"
fi

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  NOTES="$WORK/notes.md"
  printf '%s\n' \
    '**Super experimental.** This is Open Historia Native, a native rewrite of the game. It is not the official release and not the beta: expect missing pieces, rough edges and crashes.' \
    '' \
    'Windows only: `Open-Historia-Native-Setup.exe`. It installs beside the official app as *Open Historia Native*, with its own Start Menu entry and its own saves, scenarios and settings.' \
    '' \
    'It updates itself from this page. `native-latest.json` is its update feed; the official app and the beta never read it.' \
    '' \
    'Feedback: [open an issue](https://github.com/Open-Historia/open-historia/issues).' \
    > "$NOTES"
  run gh release create "$TAG" --repo "$REPO" --prerelease --latest=false --target main --title "$TITLE" --notes-file "$NOTES"
fi

say "uploading the installer $(basename "$EXE") $(wc -c < "$EXE" | tr -d ' ') bytes to $TAG"
run gh release upload "$TAG" "$EXE" --repo "$REPO" --clobber
if [ "$PUBLISH" = 1 ]; then
  assets "$TAG" "$WORK/main-after.json"
  node "$CHECK" remote-installer "$OUT" "$WORK/main-after.json"
else
  say "would check: the installer on $TAG has the size the feed names (else stop before the feed)"
fi

say "uploading the feed $(basename "$FEED") last"
run gh release upload "$TAG" "$FEED" --repo "$REPO" --clobber

if [ "$PUBLISH" = 1 ]; then
  MANIFEST_NAME="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).chunks.manifest.name)' "$FEED")"
  for attempt in 1 2 3 4 5 6; do
    if curl -fsSL "https://github.com/$REPO/releases/download/$TAG/native-latest.json?t=$(date +%s)" -o "$WORK/live.json" \
      && curl -fsSL "https://github.com/$REPO/releases/download/$CHUNK_TAG/$MANIFEST_NAME" -o "$WORK/live-manifest.json" \
      && node "$CHECK" live "$OUT" "$WORK/live.json" "$WORK/live-manifest.json"; then
      break
    fi
    [ "$attempt" -lt 6 ] || { echo "the live feed does not match what was published" >&2; exit 1; }
    sleep 10
  done
  gh release view "$TAG" --repo "$REPO" --json tagName,isPrerelease,assets --jq '{tag: .tagName, prerelease: .isPrerelease, assets: [.assets[] | {name, size}]}'
else
  say "would check: the live feed and its file list download and match what was published"
  say "dry run: nothing was uploaded. Run again with --publish to publish."
fi
