@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Pax Historia - Launcher

REM ============================================================
REM  Pax Historia - one-click setup and launch
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
echo             PAX HISTORIA  -  LAUNCHER
echo ===================================================
echo.

REM ---- 1. Check Node.js -------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this computer.
    echo Pax Historia needs Node.js to run.
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
REM  The .pmtiles files ship as tiny Git LFS pointer stubs in a
REM  ZIP download. Pull the real binaries from GitHub's media CDN.
echo Checking world map data...
call :ensure_asset cities
call :ensure_asset countries
call :ensure_asset regions
echo.

REM ---- 3. Install dependencies -----------------------------
if not exist "node_modules" (
    echo Installing dependencies ^(first run - this can take a few minutes^)...
    call npm install
    if errorlevel 1 goto :fail
) else (
    echo [OK] Dependencies already installed.
    echo      ^(Delete the "node_modules" folder to force a clean reinstall.^)
)
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
REM  Subroutine: make sure one PMTiles asset is the real file.
REM  Real archives are several MB; LFS pointer stubs are ~150 B.
REM  Usage:  call :ensure_asset <name-without-extension>
REM ============================================================
:ensure_asset
set "ASSET=%~1"
set "TARGET=public\assets\%ASSET%.pmtiles"
set "URL=https://media.githubusercontent.com/media/Tommi-K/pax-historia/main/public/assets/%ASSET%.pmtiles"
set "FSIZE=0"
if exist "%TARGET%" for %%A in ("%TARGET%") do set "FSIZE=%%~zA"

if !FSIZE! GEQ 100000 (
    echo   [OK] %ASSET%.pmtiles already present.
    goto :eof
)

echo   Downloading %ASSET%.pmtiles ...
curl -L -f --retry 3 -o "%TARGET%.download" "%URL%"
if errorlevel 1 (
    echo   [WARN] Could not download %ASSET%.pmtiles - the map may not display.
    if exist "%TARGET%.download" del /q "%TARGET%.download"
    goto :eof
)
move /y "%TARGET%.download" "%TARGET%" >nul
echo   [OK] %ASSET%.pmtiles downloaded.
goto :eof


:fail
echo.
echo [ERROR] Setup failed - see the messages above for details.
echo.
pause
exit /b 1
