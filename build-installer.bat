@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "WEB=%ROOT%web"
set "DESKTOP=%ROOT%desktop"

echo === AguMaster Windows Installer Build ===
echo.
echo This builds an NSIS setup.exe for fresh Windows PCs.
echo Target machine does NOT need Node.js - only this build machine does.
echo.

if not exist "%WEB%\package.json" (
  echo [ERROR] web\ not found
  goto :Fail
)
if not exist "%DESKTOP%\package.json" (
  echo [ERROR] desktop\ not found
  goto :Fail
)

call :EnsureNode
if errorlevel 1 goto :Fail

echo [1/5] Installing web dependencies...
cd /d "%WEB%"
call npm install
if errorlevel 1 goto :Fail

echo [2/5] Building web frontend...
call npm run build
if errorlevel 1 goto :Fail

echo [3/5] Installing desktop dependencies...
cd /d "%DESKTOP%"
call npm install
if errorlevel 1 goto :Fail

echo [4/5] Stopping AguMaster and cleaning release output...
call npm run prepack:clean
if errorlevel 1 goto :Fail

echo [5/5] Packaging NSIS installer (may take several minutes)...
call npm run pack:builder
if errorlevel 1 (
  echo.
  echo [HINT] Packaging failed. prepack already tried to kill AguMaster and clear release.
  echo        Close any Explorer window on desktop\release and retry build-installer.bat
  echo [HINT] If electron.exe is missing, delete corrupted cache:
  echo        %%LOCALAPPDATA%%\electron\Cache\electron-v33*.zip
  goto :Fail
)

echo.
echo === Build complete ===
set "OUT_DIR=release\staging"
if exist "%DESKTOP%\release\.active-output" (
  set /p OUT_DIR=<"%DESKTOP%\release\.active-output"
)
echo Installer: %DESKTOP%\!OUT_DIR!\AguMaster-*-win-x64-setup.exe
echo.
dir /b "%DESKTOP%\!OUT_DIR!\AguMaster-*-win-x64-setup.exe" 2>nul
if errorlevel 1 (
  echo [WARN] Setup exe not found - check desktop\!OUT_DIR!\
) else (
  for %%F in ("%DESKTOP%\!OUT_DIR!\AguMaster-*-win-x64-setup.exe") do (
    echo Full path: %%~fF
    echo Size: %%~zF bytes
  )
)
echo.
echo Copy the setup.exe to the target PC and run it to install AguMaster.
goto :End

:EnsureNode
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ LTS on this build machine.
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found on PATH.
  exit /b 1
)
exit /b 0

:Fail
echo.
echo [ERROR] Build failed.
pause
exit /b 1

:End
pause
exit /b 0
