@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Pax Historia - Updater

REM ============================================================
REM  Pax Historia - one-click updater
REM  ----------------------------------------------------------
REM  Replaces this install's files with the latest ones from
REM  GitHub, without touching your saved games or settings.
REM
REM   - Git installs (folder has .git):  git pull + LFS
REM   - ZIP installs:                    downloads the latest
REM     code and copies it over this folder
REM
REM  What is protected:
REM   * server\data\games        (your save games)
REM   * server\data\*.json       (your library state)
REM   * existing scenario files  (new ones are added, yours
REM                               are never overwritten)
REM   * public\assets\*.pmtiles  (real map data is never
REM                               replaced by LFS pointer stubs)
REM
REM  After updating, run "Launch Pax Historia.bat" as usual -
REM  it reinstalls dependencies and rebuilds automatically.
REM ============================================================

REM Which repository to update from. Active development lives in the Beta
REM repository - updating mirrors it no matter where this copy came from,
REM so every install converges on the same codebase.
set "REPO_OWNER=Arkniem"
set "REPO_NAME=Open-Historia-Beta"
set "REPO_BRANCH=main"

REM Work from the folder this script lives in (the project root)
cd /d "%~dp0"

echo.
echo ===================================================
echo             PAX HISTORIA  -  UPDATER
echo    source: %REPO_OWNER%/%REPO_NAME% (%REPO_BRANCH%)
echo ===================================================
echo.

REM ---- Git installs: a proper pull is the cleanest update ----
if exist ".git" (
    where git >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] This is a git install but git is not on PATH.
        echo Install Git from https://git-scm.com/ and run this again.
        pause & exit /b 1
    )
    echo This is a git install - updating with git pull...
    git pull --ff-only
    if errorlevel 1 (
        echo.
        echo [WARN] git pull could not fast-forward ^(local changes?^).
        echo Commit/stash your changes, or resolve manually, then retry.
        pause & exit /b 1
    )
    git lfs pull 2>nul
    goto :finish
)

REM ---- ZIP installs: download the latest code and overlay ----
where curl >nul 2>&1
if errorlevel 1 (
    echo [ERROR] curl was not found. It ships with Windows 10/11 -
    echo         update Windows, or install Git and re-run.
    pause & exit /b 1
)
where tar >nul 2>&1
if errorlevel 1 (
    echo [ERROR] tar was not found. It ships with Windows 10/11.
    pause & exit /b 1
)

set "WORKDIR=%TEMP%\pax-historia-update"
set "ZIPFILE=%WORKDIR%\latest.zip"
if exist "%WORKDIR%" rmdir /s /q "%WORKDIR%"
mkdir "%WORKDIR%"

echo Downloading the latest version...
curl -L -f --retry 3 -o "%ZIPFILE%" "https://codeload.github.com/%REPO_OWNER%/%REPO_NAME%/zip/refs/heads/%REPO_BRANCH%"
if errorlevel 1 (
    echo [ERROR] Download failed - check your internet connection.
    pause & exit /b 1
)

echo Extracting...
tar -xf "%ZIPFILE%" -C "%WORKDIR%"
if errorlevel 1 (
    echo [ERROR] Could not extract the update.
    pause & exit /b 1
)

set "SRC=%WORKDIR%\%REPO_NAME%-%REPO_BRANCH%"
if not exist "%SRC%\package.json" (
    echo [ERROR] The downloaded update looks incomplete.
    pause & exit /b 1
)

echo Updating files ^(saves and map data are preserved^)...

REM Big map files ship as tiny LFS pointer stubs inside GitHub ZIPs. They must
REM never overwrite (or trigger deletion of) the real local data. Robocopy
REM never purges excluded files/dirs, so these are safe under /MIR too.
set "KEEP_FILES=*.pmtiles regions-seed.geojson cities-seed.json"

REM 1) Repo-owned code directories are MIRRORED: new files added, changed files
REM    updated, and files the update removed are deleted locally too.
for %%D in (src scripts public) do (
    if exist "%SRC%\%%D" (
        robocopy "%SRC%\%%D" "%CD%\%%D" /MIR /NFL /NDL /NJH /NJS /NP /XF %KEEP_FILES% >nul
        if errorlevel 8 goto :copyfail
    )
)

REM    server code is mirrored as well, but server\data (saves, scenarios,
REM    library state) is fully protected from both copying and deletion.
if exist "%SRC%\server" (
    robocopy "%SRC%\server" "%CD%\server" /MIR /NFL /NDL /NJH /NJS /NP ^
        /XD "%SRC%\server\data" "%CD%\server\data" /XF %KEEP_FILES% >nul
    if errorlevel 8 goto :copyfail
)

REM 2) Root-level files (package.json, launcher, README, configs...) are
REM    copied without purging - the root also holds node_modules, dist etc.
robocopy "%SRC%" "%CD%" /LEV:1 /NFL /NDL /NJH /NJS /NP /XF %KEEP_FILES% >nul
if errorlevel 8 goto :copyfail

REM 3) Scenario content: ADD new files only - never overwrite the player's
REM    existing scenario data (robocopy /XC /XN /XO copies only new files).
if exist "%SRC%\server\data\scenarios" (
    robocopy "%SRC%\server\data\scenarios" "%CD%\server\data\scenarios" /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto :copyfail
)

rmdir /s /q "%WORKDIR%" 2>nul

REM Force a rebuild on next launch so the update actually takes effect.
if exist "dist" rmdir /s /q "dist"

:finish
echo.
echo ===================================================
echo   Update complete.
echo   Run "Launch Pax Historia.bat" to play - it will
echo   reinstall dependencies and rebuild automatically.
echo ===================================================
echo.
pause
exit /b 0

:copyfail
echo.
echo [ERROR] Copying the update failed - see messages above.
echo Your existing install was not fully modified; re-run to retry.
pause
exit /b 1
