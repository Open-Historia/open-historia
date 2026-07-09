#!/usr/bin/env bash
# Open Historia — Linux/Termux updater © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE).

# ============================================================
#  Open Historia - one-click updater (Linux / macOS)
#  ----------------------------------------------------------
#  Replaces this install's files with the latest ones from
#  GitHub, without touching your saved games or settings.
#
#   - Git installs (folder has .git):  git pull + LFS
#   - ZIP installs:                    downloads the latest
#     code and copies it over this folder (needs rsync)
#
#  What is protected:
#   * server/data/games        (your save games)
#   * server/data/*.json       (your library state)
#   * existing scenario files  (new ones are added, yours
#                               are never overwritten)
#   * public/assets/*.pmtiles  (real map data is never
#                               replaced by LFS pointer stubs)
#
#  After updating, run "Launch Open Historia.sh" as usual -
#  it reinstalls dependencies and rebuilds automatically.
#
#  Run from a terminal:   ./"Update Open Historia.sh"
#  macOS: double-click "Update Open Historia.command" instead.
# ============================================================

# Which repository to update from. The beta channel lives on the beta
# branch of the organisation repository - updating keeps tracking it.
REPO_OWNER="Open-Historia"
REPO_NAME="open-historia"
REPO_BRANCH="beta"

fail_copy() {
    echo ""
    echo "[ERROR] Copying the update failed - see messages above."
    echo "Your existing install was not fully modified; re-run to retry."
    exit 1
}

# The whole update runs inside main() so bash parses this entire file
# before any of it executes - the update overwriting this very script
# mid-run can then never corrupt the running process.
main() {
    # Work from the folder this script lives in (the project root)
    cd "$(dirname "$0")" || exit 1

    echo ""
    echo "==================================================="
    echo "            OPEN HISTORIA  -  UPDATER"
    echo "   source: $REPO_OWNER/$REPO_NAME ($REPO_BRANCH)"
    echo "==================================================="
    echo ""

    # ---- Git installs: a proper pull is the cleanest update ----
    if [ -d ".git" ]; then
        if ! command -v git >/dev/null 2>&1; then
            echo "[ERROR] This is a git install but git is not on PATH."
            echo "Install Git (https://git-scm.com/) and run this again."
            exit 1
        fi
        echo "This is a git install - updating with git pull..."
        if ! git pull --ff-only; then
            echo ""
            echo "[WARN] git pull could not fast-forward (local changes?)."
            echo "Commit/stash your changes, or resolve manually, then retry."
            exit 1
        fi
        git lfs pull 2>/dev/null
        finish
    fi

    # ---- ZIP installs: download the latest code and overlay ----
    if command -v curl >/dev/null 2>&1; then
        DOWNLOAD="curl -L -f --retry 3 -o"
    elif command -v wget >/dev/null 2>&1; then
        DOWNLOAD="wget -O"
    else
        echo "[ERROR] Neither curl nor wget was found - install one and re-run."
        exit 1
    fi
    if ! command -v rsync >/dev/null 2>&1; then
        echo "[ERROR] rsync was not found. It ships with macOS; on Linux install it"
        echo "        with your package manager (e.g. sudo apt-get install rsync;"
        echo "        on Termux: pkg install rsync)."
        exit 1
    fi

    WORKDIR="${TMPDIR:-/tmp}/open-historia-update"
    ZIPFILE="$WORKDIR/latest.zip"
    rm -rf "$WORKDIR"
    mkdir -p "$WORKDIR"

    echo "Downloading the latest version..."
    if ! $DOWNLOAD "$ZIPFILE" "https://codeload.github.com/$REPO_OWNER/$REPO_NAME/zip/refs/heads/$REPO_BRANCH"; then
        echo "[ERROR] Download failed - check your internet connection."
        exit 1
    fi

    echo "Extracting..."
    if command -v unzip >/dev/null 2>&1; then
        unzip -q "$ZIPFILE" -d "$WORKDIR"
    else
        tar -xf "$ZIPFILE" -C "$WORKDIR"
    fi
    if [ $? -ne 0 ]; then
        echo "[ERROR] Could not extract the update."
        exit 1
    fi

    SRC="$WORKDIR/$REPO_NAME-$REPO_BRANCH"
    if [ ! -f "$SRC/package.json" ]; then
        echo "[ERROR] The downloaded update looks incomplete."
        exit 1
    fi

    echo "Updating files (saves and map data are preserved)..."

    # Big map files ship as tiny LFS pointer stubs inside GitHub ZIPs. They must
    # never overwrite (or trigger deletion of) the real local data. rsync never
    # deletes excluded files, so these are safe under --delete too.
    KEEP=(--exclude='*.pmtiles' --exclude='regions-seed.geojson' --exclude='cities-seed.json')

    # 1) Repo-owned code directories are MIRRORED: new files added, changed files
    #    updated, and files the update removed are deleted locally too.
    for d in src scripts public; do
        if [ -d "$SRC/$d" ]; then
            rsync -a --delete "${KEEP[@]}" "$SRC/$d/" "./$d/" || fail_copy
        fi
    done

    #    server code is mirrored as well, but server/data (saves, scenarios,
    #    library state) is fully protected from both copying and deletion.
    if [ -d "$SRC/server" ]; then
        rsync -a --delete --exclude='/data/' "${KEEP[@]}" "$SRC/server/" "./server/" || fail_copy
    fi

    # 2) Root-level files (package.json, launcher, README, configs...) are
    #    copied without purging - the root also holds node_modules, dist etc.
    rsync -a --exclude='*/' "${KEEP[@]}" "$SRC/" "./" || fail_copy

    # 3) Scenario content: ADD new files only - never overwrite the player's
    #    existing scenario data.
    if [ -d "$SRC/server/data/scenarios" ]; then
        mkdir -p "./server/data/scenarios"
        rsync -a --ignore-existing "$SRC/server/data/scenarios/" "./server/data/scenarios/" || fail_copy
    fi

    # 3b) ...except the built-in "default" scenario, which is shipped app content
    #     (prompts, world, colors, cover image, template state), not player data
    #     - so its files are always refreshed, otherwise shipped updates to it
    #     never reach an existing install. Its large map geometry (regions.geojson)
    #     is LFS-backed and arrives as a pointer stub in a codeload zip, so it is
    #     excluded here and handled by the LFS resolver in 3c. Saved games
    #     (server/data/games) are untouched regardless.
    if [ -d "$SRC/server/data/scenarios/default" ]; then
        rsync -a --exclude='*.geojson' --exclude='*.pmtiles' \
            "$SRC/server/data/scenarios/default/" "./server/data/scenarios/default/" || fail_copy
    fi

    # 3c) Resolve Git-LFS pointer stubs (map geodata, pmtiles) to real content.
    #     A codeload zip only carries pointers, so none of the LFS files skipped
    #     above (or KEEP-excluded from the copies) would otherwise ever update on
    #     a ZIP install. This downloads any that actually changed from GitHub's
    #     media host and checksum-verifies them. Best-effort: it needs Node (which
    #     running the game already requires) and never fails the update - a missing
    #     Node or a failed download just leaves the existing files in place.
    if command -v node >/dev/null 2>&1 && [ -f "scripts/resolve-lfs.mjs" ]; then
        node "scripts/resolve-lfs.mjs" "$SRC" "$REPO_OWNER" "$REPO_NAME" "$REPO_BRANCH" || true
    fi

    rm -rf "$WORKDIR"

    # Force a rebuild on next launch so the update actually takes effect.
    rm -rf "dist"

    finish
}

finish() {
    # ZIP extraction can lose the executable bit - restore it.
    chmod +x "Launch Open Historia.sh" "Update Open Historia.sh" \
             "Launch Open Historia.command" "Update Open Historia.command" 2>/dev/null
    # Refresh the vendored Fantasy Map Generator from its repo (the map editor's
    # world generator). Best-effort - needs Node + deps, which the launcher keeps
    # installed; a failure here never blocks the update.
    if command -v node >/dev/null 2>&1 && [ -f "scripts/fetch-fmg.mjs" ]; then
        echo "Refreshing the Fantasy Map Generator (map editor world generator)..."
        node "scripts/fetch-fmg.mjs" || true
    fi
    echo ""
    echo "==================================================="
    echo "  Update complete."
    echo "  Run \"Launch Open Historia.sh\" to play - it will"
    echo "  reinstall dependencies and rebuild automatically."
    echo "==================================================="
    echo ""
    exit 0
}

main "$@"
