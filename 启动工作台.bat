@echo off
setlocal
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH
  pause
  exit /b 1
)
echo Starting Coconut Workbench on http://127.0.0.1:8951/
start "" /min node server.mjs --port=8951
timeout /t 1 >nul
exit /b 0
