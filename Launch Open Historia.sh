#!/usr/bin/env bash
# Open Historia — Linux/Termux launcher © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE).

# ============================================================
#  Open Historia - one-click setup and launch (Linux / macOS)
#  ----------------------------------------------------------
#   1. Verifies Node.js is installed
#   2. Downloads the world map data (Git LFS assets) if missing
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

# Download helper: curl preferred, wget as fallback.
fetch() { # fetch <url> <outfile>
    if command -v curl >/dev/null 2>&1; then
        curl -L -f --retry 3 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$2" "$1"
    else
        echo "  [ERROR] Neither curl nor wget was found."
        return 1
    fi
}

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

echo "[OK] Node.js $(node --version 2>/dev/null) detected."
echo ""

# ---- 2. Ensure world map data (Git LFS assets) -----------
#  The big map files ship as tiny Git LFS pointer stubs in a
#  ZIP download. Pull the real binaries from GitHub's media CDN.
#  Real files are several MB; LFS pointer stubs are ~150 B.
ASSET_BASE="https://media.githubusercontent.com/media/Open-Historia/open-historia/main"

ensure_asset() { # ensure_asset <local path == repo path>
    local target="$1" size=0
    [ -f "$target" ] && size=$(wc -c < "$target" | tr -d '[:space:]')
    if [ "${size:-0}" -ge 100000 ]; then
        echo "  [OK] $(basename "$target") already present."
        return 0
    fi
    echo "  Downloading $(basename "$target") ..."
    mkdir -p "$(dirname "$target")"
    if fetch "$ASSET_BASE/$target" "$target.download"; then
        mv -f "$target.download" "$target"
        echo "  [OK] $(basename "$target") downloaded."
    else
        rm -f "$target.download"
        echo "  [WARN] Could not download $(basename "$target") - the map may not display."
    fi
}

echo "Checking world map data..."
ensure_asset "public/assets/cities.pmtiles"
ensure_asset "public/assets/countries.pmtiles"
ensure_asset "public/assets/regions.pmtiles"
# Map-editor seeds + the built-in Modern Day world map (also LFS)
ensure_asset "public/assets/regions-seed.geojson"
ensure_asset "public/assets/cities-seed.json"
ensure_asset "server/data/scenarios/default/regions.geojson"
echo ""

# ---- 3. Install dependencies -----------------------------
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies (first run - this can take a few minutes)..."
    npm install || { echo ""; echo "[ERROR] Setup failed - see the messages above for details."; exit 1; }
else
    echo "[OK] Dependencies already installed."
    echo "     (Delete the \"node_modules\" folder to force a clean reinstall.)"
fi
echo ""

# ---- 4. Build the client ---------------------------------
# Give Node extra heap so the production build doesn't run out of memory
# on machines that are low on free RAM.
export NODE_OPTIONS="--max-old-space-size=4096"
if [ ! -f "dist/index.html" ]; then
    echo "Building the app..."
    npm run build || { echo ""; echo "[ERROR] Setup failed - see the messages above for details."; exit 1; }
else
    echo "[OK] Build already present."
    echo "     (Delete the \"dist\" folder to force a rebuild.)"
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
