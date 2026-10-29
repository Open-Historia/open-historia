#!/usr/bin/env bash
set -u
out="${1:?usage: first-open.sh <out dir> [zip url]}"
url="${2:-https://github.com/Open-Historia/open-historia/releases/download/native-experimental/Open-Historia-Native-macOS.zip}"
mkdir -p "$out"
work="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/oh-first-open.XXXXXX")" && pwd -P)"
dl="$work/Downloads"
mkdir -p "$dl"
report="$out/first-open.txt"
: > "$report"
say() { printf '%s\n' "$*" | tee -a "$report"; }
show() { say "\$ $*"; "$@" > "$work/cmd.txt" 2>&1; local code=$?; sed 's/^/  /' "$work/cmd.txt" | tee -a "$report"; say "  (exit $code)"; return $code; }
problems=0
need() { if [ "$1" = 0 ]; then say "ok   $2"; else say "FAIL $2"; problems=$((problems + 1)); fi; }

say "== Gatekeeper on this runner"
show sw_vers
show spctl --status

say "== Download the published zip"
show curl -fsSL --retry 3 -o "$dl/Open-Historia-Native-macOS.zip" "$url"
need $? "the release zip downloads"
show xattr -l "$dl/Open-Historia-Native-macOS.zip"
stamp="$(printf '%x' "$(date +%s)")"
show xattr -w com.apple.quarantine "0083;$stamp;Safari;" "$dl/Open-Historia-Native-macOS.zip"
show xattr -p com.apple.quarantine "$dl/Open-Historia-Native-macOS.zip"

say "== Unpack it as Finder would (ditto keeps the quarantine on what it unpacks)"
show ditto -x -k "$dl/Open-Historia-Native-macOS.zip" "$dl"
app="$dl/Open Historia Native.app"
test -d "$app"
need $? "the app comes out of the zip"
show xattr -p com.apple.quarantine "$app"
xattr -p com.apple.quarantine "$app" >/dev/null 2>&1
need $? "the unpacked app carries the quarantine flag, as a browser download would"
show xattr -p com.apple.quarantine "$app/Contents/MacOS/Open Historia"
show codesign --display --verbose=2 "$app"
show codesign --verify --deep --strict --verbose=2 "$app"

say "== Gatekeeper's verdict"
show spctl --assess --type execute --verbose=4 "$app"
assessed=$?
if [ "$assessed" != 0 ]; then need 0 "spctl rejects the un-notarised app (expected)"; else need 1 "spctl rejects the un-notarised app (it accepted it)"; fi
if command -v syspolicy_check >/dev/null 2>&1; then show syspolicy_check distribution "$app"; fi

running() { pgrep -f "$app/Contents/MacOS/Open Historia" >/dev/null 2>&1; }
stop_ours() { pkill -f "$app/Contents/" >/dev/null 2>&1; sleep 2; pkill -9 -f "$app/Contents/" >/dev/null 2>&1; for pid in "${openers[@]}"; do kill "$pid" >/dev/null 2>&1; done; true; }
openers=()
launch() {
  say "\$ open -n --env OH_STANDIN_MODEL=1 --env OH_DISCORD_PRESENCE=0 \"$app\"  (in the background: open waits while Gatekeeper asks)"
  open -n --env OH_STANDIN_MODEL=1 --env OH_DISCORD_PRESENCE=0 "$app" > "$work/open-$#-${#openers[@]}.txt" 2>&1 &
  openers+=($!)
}

say "== Double-click while quarantined"
since="$(date '+%Y-%m-%d %H:%M:%S')"
launch
sleep 20
if running; then say "the game is running while still quarantined"; quarantined_ran=1; else say "the game did not start while quarantined"; quarantined_ran=0; fi
held="$(pgrep -fl "AppTranslocation/.*/Open Historia Native.app/Contents/MacOS/Open Historia" 2>/dev/null)"
if [ -n "$held" ]; then say "Gatekeeper translocated the app and holds its process behind the prompt: $held"; fi
if kill -0 "${openers[0]}" 2>/dev/null; then say "open is still waiting after 20 s (a Gatekeeper prompt is up)"; else say "open returned: $(cat "$work"/open-*.txt 2>/dev/null | tr '\n' ' ')"; fi
screencapture -x "$out/first-open-1-quarantined.png" 2>/dev/null || true
show pgrep -fl "CoreServicesUIAgent|Open Historia"
log show --start "$since" --style compact --predicate 'process == "syspolicyd" OR subsystem == "com.apple.syspolicy" OR process == "CoreServicesUIAgent"' 2>/dev/null | grep -iE "open historia|openhistoria|notari|gatekeeper|quarantine|deny|reject" | tail -25 | sed 's/^/  log: /' | tee -a "$report"
stop_ours
pkill -f "AppTranslocation/.*/Open Historia Native.app/Contents/" >/dev/null 2>&1 || true
killall -9 CoreServicesUIAgent >/dev/null 2>&1 || true
sleep 2
if [ "$assessed" != 0 ]; then
  if [ "$quarantined_ran" = 0 ]; then need 0 "Gatekeeper holds the quarantined app back"; else say "note: the runner let the quarantined app start (Gatekeeper is relaxed on this image)"; fi
fi

say "== The documented step (the command-line Open Anyway)"
show xattr -dr com.apple.quarantine "$app"
xattr -p com.apple.quarantine "$app" >/dev/null 2>&1
test $? != 0
need $? "the quarantine flag is gone"
show spctl --assess --type execute --verbose=4 "$app"

say "== Double-click after the step"
launch
ok=1
for i in $(seq 1 45); do if running; then ok=0; break; fi; sleep 1; done
need $ok "the game starts after xattr -dr com.apple.quarantine"
sleep 25
running
need $? "the game is still running 25 s later"
screencapture -x "$out/first-open-2-after-xattr.png" 2>/dev/null || true
show pgrep -fl "$app/Contents/"
stop_ours

say "== first open summary: $problems problem(s)"
rm -rf "$work"
exit $problems
