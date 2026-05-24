@echo off
title QianMian - AI Chat
cd /d "%~dp0"

echo.
echo   ==============================
echo     QianMian - AI Multi-Char Chat
echo   ==============================
echo.

echo   [1/4] Checking Python...

python --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python"
    goto :deps
)

py --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=py"
    goto :deps
)

echo   [X] Python not found!
echo   Download: https://www.python.org/downloads/
echo.
pause
exit /b

:deps
echo   [OK] Python found

echo   [2/4] Checking dependencies...
%PYTHON% -m pip show flask >nul 2>&1
if errorlevel 1 (
    echo   [*] Installing flask and requests...
    %PYTHON% -m pip install flask requests
)
echo   [OK] Dependencies ready

echo   [3/4] Starting server...
netstat -ano | findstr ":5000" | findstr "LISTENING" >nul
if errorlevel 1 (
    start "QianMian-Server" /MIN /D "%~dp0" %PYTHON% app.py
    echo   [*] Waiting for server to start...
    timeout /t 3 /nobreak >nul
) else (
    echo   [OK] Server already running
)

echo   [4/4] Opening browser...
start http://localhost:5000
echo.
echo   ==============================
echo     Visit http://localhost:5000
echo     Closing this window will NOT stop the server
echo   ==============================
echo.
pause
