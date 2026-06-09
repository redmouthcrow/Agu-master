@echo off
setlocal EnableExtensions

rem Agu - one-click dev server (port 5180, see web/vite.config.ts)
cd /d "%~dp0web"
if not exist "%CD%\package.json" (
  echo [ERROR] package.json not found in: %CD%
  echo         Make sure start.bat is in the Agu-master project root.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [INFO] First run - installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
  )
)

echo [INFO] Starting dev server at http://localhost:5180
echo [INFO] If 5180 is busy, Vite will pick the next free port.
echo.

call npm run dev

echo.
pause
