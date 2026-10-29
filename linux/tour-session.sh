#!/usr/bin/env bash
set -u
out="$3"
mkdir -p "$out"
here="$(cd "$(dirname "$0")" && pwd)"
pids=()
openbox --sm-disable > "$out/openbox.log" 2>&1 &
pids+=($!)
sleep 1
dunst > "$out/dunst.log" 2>&1 &
pids+=($!)
dbus-monitor --session "type='method_call',interface='org.freedesktop.Notifications'" > "$out/dbus-notifications.log" 2>&1 &
pids+=($!)
sleep 1
echo "session: DISPLAY=$DISPLAY DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
xdpyinfo 2>/dev/null | grep -E "dimensions|resolution" || true
dbus-send --session --print-reply --dest=org.freedesktop.Notifications /org/freedesktop/Notifications org.freedesktop.Notifications.GetServerInformation 2>&1 | sed 's/^/session: /'
node "$here/../macos/tour.mjs" "$@" --dbus-log "$out/dbus-notifications.log"
code=$?
sleep 1
for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
wait 2>/dev/null || true
exit $code
