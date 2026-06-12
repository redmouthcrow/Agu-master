@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."
set "AGU_DESKTOP=1"
set "BROWSER=none"
set "LOG=%~dp0..\.vite-desktop.log"
echo [%date% %time%] dev-desktop.cmd started in %CD% > "%LOG%"
where node >> "%LOG%" 2>&1
where npm >> "%LOG%" 2>&1
call npm run dev >> "%LOG%" 2>&1
echo [%date% %time%] Vite exited, errorlevel=%ERRORLEVEL% >> "%LOG%"
endlocal
