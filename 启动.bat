@echo off
rem ============================================================
rem  白膜工作台启动器（本地服务器 + 浏览器）
rem  双击即用。关闭最小化的服务器窗口即退出。
rem ============================================================
setlocal
cd /d %~dp0
set PORT=8123

where pythonw >nul 2>nul
if %errorlevel%==0 goto :pyserver
where py >nul 2>nul
if %errorlevel%==0 goto :pylauncher
where node >nul 2>nul
if %errorlevel%==0 goto :nodeserver
echo [ERROR] No python/node found. Install Python 3 first.
pause
exit /b 1

:pyserver
start "" /min pythonw -m http.server %PORT% --bind 127.0.0.1
goto :open

:pylauncher
start "" /min py -3 -m http.server %PORT% --bind 127.0.0.1
goto :open

:nodeserver
start "" /min node server.js %PORT%

:open
ping -n 2 127.0.0.1 >nul
start "" http://127.0.0.1:%PORT%/index.html
exit /b 0
