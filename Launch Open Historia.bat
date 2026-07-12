@echo off
REM Open Historia — Windows launcher © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE).

setlocal EnableExtensions EnableDelayedExpansion
title Open Historia - Launcher

REM ============================================================
REM  Open Historia - one-click setup and launch
REM  ----------------------------------------------------------
REM   1. Verifies Node.js is installed
REM   2. Downloads the world map data (Git LFS assets) if missing
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

for /f "delims=" %%V in ('node --version 2^>nul') do set "NODEVER=%%V"
echo [OK] Node.js !NODEVER! detected.
echo.

REM ---- 2. Ensure world map data (Git LFS assets) -----------
REM  The big map files ship as tiny Git LFS pointer stubs in a
REM  ZIP download. Pull the real binaries from GitHub's media CDN.
echo Checking world map data...
call :ensure_asset "public\assets\cities.pmtiles"    "public/assets/cities.pmtiles"
call :ensure_asset "public\assets\countries.pmtiles" "public/assets/countries.pmtiles"
call :ensure_asset "public\assets\regions.pmtiles"   "public/assets/regions.pmtiles"
REM  Map-editor seeds + the built-in Modern Day world map (also LFS)
call :ensure_asset "public\assets\regions-seed.geojson" "public/assets/regions-seed.geojson"
call :ensure_asset "public\assets\cities-seed.json"     "public/assets/cities-seed.json"
call :ensure_asset "server\data\scenarios\default\regions.geojson" "server/data/scenarios/default/regions.geojson"
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
if not exist "dist\index.html" (
    echo Building the app...
    call npm run build
    if errorlevel 1 goto :fail
) else (
    echo [OK] Build already present.
    echo      ^(Delete the "dist" folder to force a rebuild.^)
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


REM ============================================================
REM  Subroutine: make sure one Git LFS asset is the real file.
REM  Real files are several MB; LFS pointer stubs are ~150 B.
REM  Usage:  call :ensure_asset "local\path" "repo/path"
REM ============================================================
:ensure_asset
set "TARGET=%~1"
set "URL=https://media.githubusercontent.com/media/Open-Historia/open-historia/main/%~2"
set "FSIZE=0"
if exist "%TARGET%" for %%A in ("%TARGET%") do set "FSIZE=%%~zA"

if !FSIZE! GEQ 100000 (
    echo   [OK] %~nx1 already present.
    goto :eof
)

echo   Downloading %~nx1 ...
curl -L -f --retry 3 --create-dirs -o "%TARGET%.download" "%URL%"
if errorlevel 1 (
    echo   [WARN] Could not download %~nx1 - the map may not display.
    if exist "%TARGET%.download" del /q "%TARGET%.download"
    goto :eof
)
move /y "%TARGET%.download" "%TARGET%" >nul
echo   [OK] %~nx1 downloaded.
goto :eof


:fail
echo.
echo [ERROR] Setup failed - see the messages above for details.
echo.
pause
exit /b 1
