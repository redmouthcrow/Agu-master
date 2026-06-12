@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "WEB=%ROOT%web"
set "DESKTOP=%ROOT%desktop"
set "VITE_LOG=%WEB%\.vite-desktop.log"
set "AGU_DEV_PORT=5180"

echo === AguMaster Desktop (Win11 / Electron) ===
echo.

if not exist "%WEB%\package.json" (
  echo [ERROR] web\ not found
  goto :Fail
)

call :EnsureNode
if errorlevel 1 goto :Fail

cd /d "%WEB%"
if not exist "node_modules\" (
  echo [INFO] Installing web dependencies...
  call npm install
  if errorlevel 1 goto :Fail
)

if exist "%VITE_LOG%" del /f /q "%VITE_LOG%" >nul 2>&1

echo [INFO] Starting Vite on http://127.0.0.1:%AGU_DEV_PORT% ...
start "AguMaster Vite" /MIN cmd /k "%WEB%\scripts\dev-desktop.cmd"

echo [INFO] Waiting for Vite ^(max 90s^)...
set /a WAIT=0
:WaitLoop
timeout /t 2 /nobreak >nul
set /a WAIT+=2
call :ProbeVite
if not errorlevel 1 goto :StartElectron
echo [INFO] Still waiting... !WAIT!s ^(see %VITE_LOG%^)
if !WAIT! GEQ 90 (
  echo [ERROR] Vite did not respond on port %AGU_DEV_PORT% within 90s.
  call :ShowViteLog
  goto :Fail
)
goto :WaitLoop

:StartElectron
echo [OK] Vite is ready.
cd /d "%DESKTOP%"
if not exist "node_modules\.bin\tsc.cmd" (
  echo [INFO] Installing desktop dependencies...
  call npm install
  if errorlevel 1 goto :Fail
)
if not exist "node_modules\.bin\tsc.cmd" (
  echo [ERROR] desktop dependencies incomplete ^(tsc missing^). Run: cd desktop ^&^& npm install
  goto :Fail
)

echo [INFO] Launching Electron ^(dashboard + widget^)...
set "AGU_DEV_PORT=%AGU_DEV_PORT%"
call npm run dev
goto :End

rem ---------------------------------------------------------------------------
:EnsureNode
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo         Install Node.js LTS or run start.bat once, then retry.
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found on PATH.
  exit /b 1
)
exit /b 0

:ProbeVite
rem curl.exe is built into Windows 10+; more reliable than PowerShell from batch
where curl >nul 2>&1
if errorlevel 1 goto :ProbeVitePs
curl.exe -fsS -o NUL "http://127.0.0.1:%AGU_DEV_PORT%/" >nul 2>&1
exit /b %ERRORLEVEL%

:ProbeVitePs
powershell -NoProfile -Command "if ((Test-NetConnection -ComputerName 127.0.0.1 -Port %AGU_DEV_PORT% -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }"
exit /b %ERRORLEVEL%

:ShowViteLog
if not exist "%VITE_LOG%" (
  echo [INFO] No log file at %VITE_LOG%
  echo        Check minimized window titled "AguMaster Vite".
  exit /b 0
)
echo.
echo === Last lines of .vite-desktop.log ===
powershell -NoProfile -Command "Get-Content -Path '%VITE_LOG%' -Tail 30"
echo =======================================
exit /b 0

:Fail
echo.
call :ShowViteLog
pause
exit /b 1

:End
pause
exit /b 0
