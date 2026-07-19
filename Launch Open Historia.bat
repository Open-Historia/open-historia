@echo off
REM Open Historia — Windows launcher © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE).

setlocal EnableExtensions EnableDelayedExpansion
title Open Historia - Launcher

REM ============================================================
REM  Open Historia - one-click setup and launch
REM  ----------------------------------------------------------
REM   1. Verifies Node.js is installed
REM   2. Downloads the world map data (GitHub Release assets) if missing
REM   3. Installs npm dependencies
REM   4. Builds the client
REM   5. Starts the server and opens your browser
REM
REM  Just double-click this file. Keep the window open while
REM  playing; close it (or press Ctrl+C) to stop the game.
REM ============================================================

REM Work from the folder this script lives in (the project root)
cd /d "%~dp0"

echo.
echo ===================================================
echo             OPEN HISTORIA  -  LAUNCHER
echo ===================================================
echo.

REM ---- 1. Check Node.js -------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this computer.
    echo Open Historia needs Node.js to run.
    echo.
    where winget >nul 2>&1
    if not errorlevel 1 (
        set /p "INSTALLNODE=Install Node.js LTS now via winget? [Y/N] "
        if /i "!INSTALLNODE!"=="Y" (
            winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            echo.
            echo Node.js installation finished.
            echo Please CLOSE this window and run this launcher again
            echo so the updated PATH takes effect.
            echo.
            pause
            exit /b 0
        )
    )
    echo Download and install Node.js ^(LTS^) from: https://nodejs.org/
    echo Then run this launcher again.
    echo.
    pause
    exit /b 1
)

set "NODEVER="
for /f "delims=" %%V in ('node --version 2^>nul') do set "NODEVER=%%V"
REM "where" finding node does NOT guarantee it runs here: launched "as
REM administrator", the window gets the ADMIN account's environment, and a
REM Node.js installed only for the normal user account isn't on that PATH.
REM The old script parsed the resulting EMPTY output as version 0 and told
REM players their brand-new Node was "too old". Say what actually happened.
if not defined NODEVER (
    echo [ERROR] Node.js was found but could not be started from this window.
    echo Node.js installations found on this computer:
    where node
    echo.
    echo This usually means the launcher was run AS ADMINISTRATOR while Node.js
    echo is installed only for your user account. Run the launcher normally by
    echo double-clicking it - it does NOT need administrator rights. If it still
    echo fails, reinstall Node.js LTS from https://nodejs.org/ with the default
    echo settings and run the launcher again in a NEW window.
    echo.
    pause
    exit /b 1
)
REM The client build runs on Vite 7, which hard-refuses anything below Node
REM 20.19 / 22.12 partway through setup with its own cryptic message. Enforce
REM Vite's real floor HERE with a clear message instead: pass on 20.19+, 22.12+,
REM or any 23+. Parse major.minor out of "vXX.YY.Z".
for /f "tokens=1,2 delims=." %%M in ("!NODEVER!") do (
    set "NODEMAJOR=%%M"
    set "NODEMINOR=%%N"
)
set "NODEMAJOR=!NODEMAJOR:v=!"
set /a NODEMAJORNUM=NODEMAJOR 2>nul
set /a NODEMINORNUM=NODEMINOR 2>nul
set "NODEOK="
if !NODEMAJORNUM! GEQ 23 set "NODEOK=1"
if !NODEMAJORNUM! EQU 22 if !NODEMINORNUM! GEQ 12 set "NODEOK=1"
if !NODEMAJORNUM! EQU 20 if !NODEMINORNUM! GEQ 19 set "NODEOK=1"
if not defined NODEOK (
    echo [ERROR] Node.js !NODEVER! is too old - Open Historia needs Node 22.12 or
    echo newer ^(20.19+ also works^). Install the current LTS from: https://nodejs.org/
    echo.
    echo Node.js installations found on this computer:
    where node
    echo.
    echo If you just installed a newer Node.js and an OLD version is listed first
    echo above, close this window and run the launcher again - windows that were
    echo already open keep the old PATH. If that doesn't help, uninstall the old
    echo Node.js ^(or move the new one higher in PATH^) and retry.
    echo.
    pause
    exit /b 1
)
set "NODEPATH="
for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODEPATH set "NODEPATH=%%P"
echo [OK] Node.js !NODEVER! detected ^(!NODEPATH!^).
echo.

REM ---- 2. Ensure world map data ----------------------------
REM  The big map binaries (pmtiles, geojson, city seeds) are hosted as assets on
REM  a GitHub Release - free, unmetered bandwidth - instead of Git LFS, whose
REM  small free bandwidth quota a few installs used to exhaust. A fresh git/ZIP
REM  install no longer ships them, so this downloads any that are missing on
REM  first run. (Node is guaranteed present by step 1.) See scripts\map-assets.json.
echo Checking world map data...
if exist "scripts\fetch-map-assets.mjs" node "scripts\fetch-map-assets.mjs" --ensure
echo.

REM ---- 3. Install dependencies -----------------------------
REM Always run npm install: it's a fast no-op when nothing changed, but it also
REM installs any NEW dependency a code update added. Gating this on "node_modules
REM missing" skipped those, so a newly-required package (e.g. jszip) never got
REM installed and the production build failed to resolve it.
echo Installing / updating dependencies ^(fast if already up to date^)...
call npm install
if errorlevel 1 goto :fail
echo.

REM ---- 4. Build the client ---------------------------------
REM Give Node extra heap so the production build doesn't run out of memory
REM on machines that are low on free RAM.
set "NODE_OPTIONS=--max-old-space-size=4096"
REM Rebuild when the build is missing OR stale (an update made any source file
REM newer than the last build). Previously this only built when dist was missing,
REM so after every update players had to delete the dist folder by hand.
set "OH_NEEDS_BUILD="
if not exist "dist\index.html" set "OH_NEEDS_BUILD=1"
if not defined OH_NEEDS_BUILD (
    powershell -NoProfile -Command "$b=(Get-Item 'dist/index.html').LastWriteTimeUtc; if (Get-ChildItem -Recurse -File -Path src,public,server,index.html,vite.config.ts,package.json -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -gt $b } | Select-Object -First 1) { exit 1 }; exit 0"
    if errorlevel 1 set "OH_NEEDS_BUILD=1"
)
if defined OH_NEEDS_BUILD (
    echo Building the app...
    call npm run build
    if errorlevel 1 goto :fail
) else (
    echo [OK] Build already up to date.
)
echo.

REM ---- 5. Launch -------------------------------------------
echo ===================================================
echo   Starting server at http://localhost:3000
echo   Your browser will open automatically.
echo   Keep this window open while playing.
echo   Press Ctrl+C or close this window to stop.
echo ===================================================
echo.

REM Open the browser a few seconds after the server boots
start "" /min cmd /c "ping -n 5 127.0.0.1 >nul & start http://localhost:3000"

node server\server.js

echo.
echo Server stopped.
pause
exit /b 0


:fail
echo.
echo [ERROR] Setup failed - see the messages above for details.
echo.
pause
exit /b 1
