@echo off
setlocal
for /f "tokens=5" %p in ('netstat -ano ^| findstr :8951 ^| findstr LISTENING') do taskkill /pid %p /f >/dev/null 2>nul
echo workbench server stopped
timeout /t 2 >nul
