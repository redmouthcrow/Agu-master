@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Agu one-click launcher: env check -> deps -> dev server (port 5180)
rem Usage: start.bat          normal (uses cache when valid)
rem        start.bat --recheck  force full environment check

set "ROOT=%~dp0"
set "WEB=%ROOT%web"
set "MARKER=%WEB%\.agu-env-ready"
set "FORCE_RECHECK=0"
set "MIN_NODE_MAJOR=18"

if /i "%~1"=="--recheck" set "FORCE_RECHECK=1"
if /i "%~1"=="/recheck" set "FORCE_RECHECK=1"

cd /d "%WEB%"
if not exist "%CD%\package.json" (
  echo [ERROR] package.json not found in: %CD%
  echo         Place start.bat in the Agu-master project root.
  goto :Fail
)

if "%FORCE_RECHECK%"=="1" (
  if exist "%MARKER%" del /f /q "%MARKER%" >nul 2>&1
  echo [INFO] --recheck: running full environment check...
)

if "%FORCE_RECHECK%"=="0" if exist "%MARKER%" (
  call :FastPath
  if not errorlevel 1 goto :StartDev
  echo [INFO] Cache outdated or incomplete, re-checking environment...
)

call :EnsureNode
if errorlevel 1 goto :Fail

call :EnsureDeps
if errorlevel 1 goto :Fail

call :WriteMarker
goto :StartDev

rem ---------------------------------------------------------------------------
:FastPath
rem Skip heavy checks when marker matches current node/npm/lock and deps exist
if not exist "node_modules\" exit /b 1
if not exist "package-lock.json" exit /b 1

set "MARK_NODE="
set "MARK_NPM="
set "MARK_LOCK="
for /f "usebackq tokens=1,2 delims==" %%a in ("%MARKER%") do (
  if /i "%%a"=="node" set "MARK_NODE=%%b"
  if /i "%%a"=="npm" set "MARK_NPM=%%b"
  if /i "%%a"=="lock" set "MARK_LOCK=%%b"
)
if not defined MARK_NODE exit /b 1
if not defined MARK_NPM exit /b 1
if not defined MARK_LOCK exit /b 1

call :CollectVersions
if not "!NODE_VER!"=="!MARK_NODE!" exit /b 1
if not "!NPM_VER!"=="!MARK_NPM!" exit /b 1

set "LOCK_SIG="
for %%A in ("package-lock.json") do set "LOCK_SIG=%%~zA"
if not "!LOCK_SIG!"=="!MARK_LOCK!" exit /b 1

echo [OK] Environment cached ^(Node !NODE_VER!, npm !NPM_VER!^)
exit /b 0

rem ---------------------------------------------------------------------------
:EnsureNode
echo.
echo === Step 1/3: Node.js environment ===

call :RefreshPath
where node >nul 2>&1
if errorlevel 1 (
  echo [WARN] Node.js not found on PATH.
  call :TryInstallNode
  if errorlevel 1 goto :NodeFail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [WARN] npm not found on PATH.
  call :TryInstallNode
  if errorlevel 1 goto :NodeFail
)

call :CollectVersions
echo [OK] Node !NODE_VER!
echo [OK] npm  !NPM_VER!

call :CheckNodeMajor
if errorlevel 1 (
  echo [ERROR] Node.js !MIN_NODE_MAJOR!+ required. Current: !NODE_VER!
  echo         Download: https://nodejs.org/
  exit /b 1
)

exit /b 0

:NodeFail
echo.
echo [ERROR] Could not set up Node.js automatically.
echo         1. Install Node.js LTS from https://nodejs.org/
echo         2. Close this window, open a new one, run start.bat again
echo         Or run: start.bat --recheck
exit /b 1

rem ---------------------------------------------------------------------------
:TryInstallNode
echo [INFO] Attempting to install Node.js LTS via winget...

where winget >nul 2>&1
if errorlevel 1 (
  echo [WARN] winget not available ^(Windows 10/11 App Installer^).
  exit /b 1
)

winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo [WARN] winget install failed. Install Node.js manually.
  exit /b 1
)

echo [INFO] Node.js installed. Refreshing PATH...
call :RefreshPath

where node >nul 2>&1
if errorlevel 1 exit /b 1
where npm >nul 2>&1
if errorlevel 1 exit /b 1

exit /b 0

rem ---------------------------------------------------------------------------
:RefreshPath
rem Append common Node install locations after winget or first install
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\node.exe" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Node.js" /v InstallPath 2^>nul') do (
  if exist "%%b\node.exe" set "PATH=%%b;%PATH%"
)
exit /b 0

rem ---------------------------------------------------------------------------
:CollectVersions
set "NODE_VER="
set "NPM_VER="
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
if not defined NODE_VER set "NODE_VER=unknown"
if not defined NPM_VER set "NPM_VER=unknown"
exit /b 0

rem ---------------------------------------------------------------------------
:CheckNodeMajor
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set "NODE_MAJOR=%%m"
if not defined NODE_MAJOR exit /b 1
if !NODE_MAJOR! LSS %MIN_NODE_MAJOR% exit /b 1
exit /b 0

rem ---------------------------------------------------------------------------
:EnsureDeps
echo.
echo === Step 2/3: Project dependencies ===

set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="0" if exist "package-lock.json" (
  set "MARK_LOCK="
  if exist "%MARKER%" (
    for /f "usebackq tokens=1,2 delims==" %%a in ("%MARKER%") do (
      if /i "%%a"=="lock" set "MARK_LOCK=%%b"
    )
  )
  set "LOCK_SIG="
  for %%A in ("package-lock.json") do set "LOCK_SIG=%%~zA"
  if not defined MARK_LOCK set "NEED_INSTALL=1"
  if defined MARK_LOCK if not "!LOCK_SIG!"=="!MARK_LOCK!" set "NEED_INSTALL=1"
)

if "%NEED_INSTALL%"=="0" (
  echo [OK] node_modules up to date
  exit /b 0
)

echo [INFO] Running npm install ^(first run or lockfile changed^)...
call npm install
if errorlevel 1 (
  echo [WARN] npm install failed, retrying with npmmirror...
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check network or proxy settings.
    exit /b 1
  )
)

echo [OK] Dependencies installed
exit /b 0

rem ---------------------------------------------------------------------------
:WriteMarker
echo.
echo === Step 3/3: Save environment cache ===

call :CollectVersions
set "LOCK_SIG="
if exist "package-lock.json" (
  for %%A in ("package-lock.json") do set "LOCK_SIG=%%~zA"
) else (
  set "LOCK_SIG=0"
)

(
  echo node=!NODE_VER!
  echo npm=!NPM_VER!
  echo lock=!LOCK_SIG!
) > "%MARKER%"

echo [OK] Cached to web\.agu-env-ready ^(skip check next time^)
echo      Force recheck: start.bat --recheck
exit /b 0

rem ---------------------------------------------------------------------------
:StartDev
echo.
echo === Starting dev server ===
echo [INFO] URL: http://localhost:5180
echo [INFO] If 5180 is busy, Vite picks the next free port.
echo [INFO] Press Ctrl+C to stop.
echo.

call npm run dev

echo.
pause
exit /b 0

rem ---------------------------------------------------------------------------
:Fail
echo.
pause
exit /b 1
