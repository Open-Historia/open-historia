#!/usr/bin/env bash
# Open Historia — Linux/Termux launcher © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE).

# ============================================================
#  Open Historia - one-click setup and launch (Linux / macOS)
#  ----------------------------------------------------------
#   1. Verifies Node.js is installed
#   2. Downloads the world map data (GitHub Release assets) if missing
#   3. Installs npm dependencies
#   4. Builds the client
#   5. Starts the server and opens your browser
#
#  Run from a terminal:   ./"Launch Open Historia.sh"
#  macOS: double-click "Launch Open Historia.command" instead.
#  Keep the terminal open while playing; press Ctrl+C to stop.
# ============================================================

# Work from the folder this script lives in (the project root)
cd "$(dirname "$0")" || exit 1

echo ""
echo "==================================================="
echo "            OPEN HISTORIA  -  LAUNCHER"
echo "==================================================="
echo ""

# ---- 1. Check Node.js -------------------------------------
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js was not found on this computer."
    echo "Open Historia needs Node.js to run."
    echo ""
    case "$(uname -s)" in
        Darwin)
            if command -v brew >/dev/null 2>&1; then
                read -r -p "Install Node.js now via Homebrew? [y/N] " answer
                if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
                    brew install node
                fi
            else
                echo "Install it with Homebrew (https://brew.sh):  brew install node"
            fi
            ;;
        *)
            PKG_CMD=""
            # Termux (Android) has its own package manager and no sudo.
            if [ -n "$TERMUX_VERSION" ] || { [ -n "$PREFIX" ] && [ "${PREFIX#*com.termux}" != "$PREFIX" ]; }; then
                PKG_CMD="pkg install -y nodejs"
            elif command -v apt-get >/dev/null 2>&1; then PKG_CMD="sudo apt-get install -y nodejs npm"
            elif command -v dnf >/dev/null 2>&1; then PKG_CMD="sudo dnf install -y nodejs npm"
            elif command -v pacman >/dev/null 2>&1; then PKG_CMD="sudo pacman -S --noconfirm nodejs npm"
            elif command -v zypper >/dev/null 2>&1; then PKG_CMD="sudo zypper install -y nodejs npm"
            fi
            if [ -n "$PKG_CMD" ]; then
                read -r -p "Install Node.js now with \"$PKG_CMD\"? [y/N] " answer
                if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
                    $PKG_CMD
                fi
            fi
            ;;
    esac
    if ! command -v node >/dev/null 2>&1; then
        echo ""
        echo "Download and install Node.js (LTS) from: https://nodejs.org/"
        echo "Then run this launcher again."
        echo ""
        exit 1
    fi
fi

NODEVER="$(node --version 2>/dev/null)"
# A node that resolves but produces no version output never ran (broken
# install, wrong binary for this system). Parsing the empty string as
# version 0 used to mislabel this "too old" — say what actually happened.
if [ -z "$NODEVER" ]; then
    echo "[ERROR] Node.js was found at $(command -v node) but could not be run."
    echo "Reinstall Node.js LTS from https://nodejs.org/ then run this launcher"
    echo "again in a NEW terminal."
    echo ""
    exit 1
fi
# The client build runs on Vite 7, which hard-refuses anything below Node
# 20.19 / 22.12 partway through setup with its own cryptic message. Enforce
# Vite's real floor HERE with a clear message instead: pass on 20.19+, 22.12+,
# or any 23+. Parse major.minor out of "vXX.YY.Z".
NODEMAJOR="$(printf '%s' "$NODEVER" | sed -E 's/^v?([0-9]+).*/\1/')"
NODEMINOR="$(printf '%s' "$NODEVER" | sed -E 's/^v?[0-9]+\.([0-9]+).*/\1/')"
case "$NODEMAJOR" in ''|*[!0-9]*) NODEMAJOR=0 ;; esac
case "$NODEMINOR" in ''|*[!0-9]*) NODEMINOR=0 ;; esac
NODEOK=""
if [ "$NODEMAJOR" -ge 23 ]; then NODEOK=1
elif [ "$NODEMAJOR" -eq 22 ] && [ "$NODEMINOR" -ge 12 ]; then NODEOK=1
elif [ "$NODEMAJOR" -eq 20 ] && [ "$NODEMINOR" -ge 19 ]; then NODEOK=1
fi
if [ -z "$NODEOK" ]; then
    echo "[ERROR] Node.js $NODEVER (at $(command -v node)) is too old - Open Historia"
    echo "needs Node 22.12 or newer (20.19+ also works). Install the current LTS from:"
    echo "  https://nodejs.org/"
    echo ""
    echo "If you just installed a newer Node.js, open a NEW terminal (already-open ones"
    echo "keep the old PATH), and check 'which -a node' for an older install shadowing"
    echo "the new one."
    echo ""
    exit 1
fi
echo "[OK] Node.js $NODEVER detected ($(command -v node))."
echo ""

# ---- 2. Ensure world map data ----------------------------
#  The big map binaries (pmtiles, geojson, city seeds) are hosted as assets on a
#  GitHub Release - free, unmetered bandwidth - instead of Git LFS, whose small
#  free bandwidth quota a few installs used to exhaust. A fresh git/ZIP install no
#  longer ships these files, so this downloads any that are missing on first run.
#  (Node is guaranteed present by step 1.) See scripts/map-assets.json.
echo "Checking world map data..."
if [ -f "scripts/fetch-map-assets.mjs" ]; then
    node "scripts/fetch-map-assets.mjs" --ensure || true
fi
echo ""

# ---- 3. Install dependencies -----------------------------
# Always run npm install: it's a fast no-op when nothing changed, but it also
# installs any NEW dependency a code update added. Gating this on "node_modules
# missing" skipped those, so a newly-required package (e.g. jszip) never got
# installed and the production build failed to resolve it.
echo "Installing / updating dependencies (fast if already up to date)..."
npm install || { echo ""; echo "[ERROR] Setup failed - see the messages above for details."; exit 1; }
echo ""

# ---- 4. Build the client ---------------------------------
# Give Node extra heap so the production build doesn't run out of memory
# on machines that are low on free RAM.
export NODE_OPTIONS="--max-old-space-size=4096"
# Rebuild when the build is missing OR stale — i.e. an update changed any source
# file since the last build. Previously this only built when dist was missing, so
# after every update players had to delete dist by hand for changes to apply.
if [ ! -f "dist/index.html" ]; then
    echo "Building the app..."
    npm run build || { echo ""; echo "[ERROR] Setup failed - see the messages above for details."; exit 1; }
elif [ -n "$(find src public server index.html vite.config.ts package.json -newer "dist/index.html" 2>/dev/null | head -n 1)" ]; then
    echo "An update changed the app - rebuilding to apply it..."
    npm run build || { echo ""; echo "[ERROR] Setup failed - see the messages above for details."; exit 1; }
else
    echo "[OK] Build already up to date."
fi
echo ""

# ---- 5. Launch -------------------------------------------
echo "==================================================="
echo "  Starting server at http://localhost:3000"
echo "  Your browser will open automatically."
echo "  Keep this terminal open while playing."
echo "  Press Ctrl+C to stop."
echo "==================================================="
echo ""

# Open the browser a few seconds after the server boots
case "$(uname -s)" in
    Darwin) OPEN_CMD="open" ;;
    *) command -v xdg-open >/dev/null 2>&1 && OPEN_CMD="xdg-open" || OPEN_CMD="" ;;
esac
if [ -n "$OPEN_CMD" ]; then
    ( sleep 4; "$OPEN_CMD" "http://localhost:3000" >/dev/null 2>&1 ) &
fi

node server/server.js

echo ""
echo "Server stopped."
exit 0
