#!/usr/bin/env bash
set -euo pipefail

PUBLISH=0
OUT=""
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --dry-run) PUBLISH=0 ;;
    *) OUT="$arg" ;;
  esac
done
test -n "$OUT" || { echo "usage: native/android/publish.sh <dir with Open-Historia-Native-Android-<abi>.apk> [--publish]   (a dry run unless --publish)" >&2; exit 2; }

REPO="Open-Historia/open-historia"
TAG="native-experimental"
ABIS=(arm64-v8a x86_64)
NOTE='**Android** (Android 7 or later): `Open-Historia-Native-Android-arm64-v8a.apk` for nearly every phone and tablet, or `Open-Historia-Native-Android-x86_64.apk` for x86_64 devices and emulators. Allow your browser or file manager to install apps, then open the file. It installs beside the official app as *Open Historia Native*, with its own saves, scenarios and settings. It does not update itself yet: to update, install the newer file over it, and your games stay.'
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '%s\n' "$*"; }
run() {
  if [ "$PUBLISH" = 1 ]; then "$@"; else say "would run: $*"; fi
}

APKS=()
for abi in "${ABIS[@]}"; do
  apk="$OUT/Open-Historia-Native-Android-$abi.apk"
  test -s "$apk" || { echo "$apk is missing" >&2; exit 1; }
  APKS+=("$apk")
done

if ! gh release view "$TAG" --repo "$REPO" --json body --jq .body > "$WORK/body.md" 2>/dev/null; then
  echo "the $TAG release does not exist yet; publish the Windows app first, which writes its notes" >&2
  exit 1
fi

for apk in "${APKS[@]}"; do
  say "uploading $(basename "$apk") $(wc -c < "$apk" | tr -d ' ') bytes to $TAG"
done
run gh release upload "$TAG" "${APKS[@]}" --repo "$REPO" --clobber

if [ "$PUBLISH" = 1 ]; then
  gh release view "$TAG" --repo "$REPO" --json assets > "$WORK/assets.json"
  for apk in "${APKS[@]}"; do
    name="$(basename "$apk")"
    want="$(wc -c < "$apk" | tr -d ' ')"
    have="$(node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).assets.find((x)=>x.name===process.argv[2]);console.log(a?a.size:0)' "$WORK/assets.json" "$name")"
    test "$have" = "$want" || { echo "$name on $TAG is $have bytes, not $want" >&2; exit 1; }
  done
else
  say "would check: each APK on $TAG has its size"
fi

if grep -q '^\*\*Android\*\*' "$WORK/body.md"; then
  say "the release notes already say how to install the Android app"
else
  awk -v note="$NOTE" 'BEGIN { done = 0 } !done && /^Feedback:/ { print note; print ""; done = 1 } { print } END { if (!done) { print ""; print note } }' "$WORK/body.md" > "$WORK/notes.md"
  say "adding the Android paragraph to the release notes"
  run gh release edit "$TAG" --repo "$REPO" --notes-file "$WORK/notes.md"
fi

if [ "$PUBLISH" = 1 ]; then
  gh release view "$TAG" --repo "$REPO" --json tagName,isPrerelease,assets --jq '{tag: .tagName, prerelease: .isPrerelease, assets: [.assets[] | {name, size}]}'
else
  say "dry run: nothing was uploaded. Run again with --publish to publish."
fi
