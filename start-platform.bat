@echo off
setlocal EnableDelayedExpansion

:: ===== config =====
set "SERVE_PORT=4310"
set "PLATFORM_PORT=4311"
set "PROJECT_DIR=d:\code\ai-flows"
:: target repo for node 03 review (empty = PROJECT_DIR)
set "REPO_DIR="
:: lines to read back for hidden log processes
set "LOG_LINES=50"

echo ============================================
echo   AI-Flows launcher (serve + platform + logs)
echo ============================================
echo.

:: 1. free ports
echo [1/5] Freeing ports (%SERVE_PORT%, %PLATFORM_PORT%)...
call :killPort %SERVE_PORT%
call :killPort %PLATFORM_PORT%

:: 2. report server (hidden, port 4310)
echo [2/5] Starting report server (port %SERVE_PORT%)...
powershell -NoProfile -Command "Start-Process -FilePath 'npx.cmd' -ArgumentList 'tsx','src/index.ts','serve','--port','%SERVE_PORT%' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden"

:: 3. platform (hidden, port 4311; node 03 triggers real review)
echo [3/5] Starting platform (port %PLATFORM_PORT%)...
if "%REPO_DIR%"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath 'npx.cmd' -ArgumentList 'tsx','src/index.ts','platform','--port','%PLATFORM_PORT%' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden"
) else (
    powershell -NoProfile -Command "Start-Process -FilePath 'npx.cmd' -ArgumentList 'tsx','src/index.ts','platform','--port','%PLATFORM_PORT%','--repo','%REPO_DIR%' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden"
)

:: 4. log tail processes (hidden, view at platform /logs page)
echo [4/5] Starting log processes (hidden: ai / web)...
start "" /B /D "%PROJECT_DIR%" cmd /c "npx tsx src/index.ts logs --kind ai --lines %LOG_LINES% --follow <nul >nul 2>&1"
start "" /B /D "%PROJECT_DIR%" cmd /c "npx tsx src/index.ts logs --kind web --lines %LOG_LINES% --follow <nul >nul 2>&1"

:: 5. wait for ports (poll up to 30s), then report
echo [5/5] Waiting for service ports...
set /a _wait=0
:waitPorts
set "SERVE_PID="
set "PLATFORM_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%SERVE_PORT%" ^| findstr "LISTENING"') do set "SERVE_PID=%%a"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PLATFORM_PORT%" ^| findstr "LISTENING"') do set "PLATFORM_PID=%%a"
if defined SERVE_PID if defined PLATFORM_PID goto portsReady
set /a _wait+=1
if !_wait! geq 30 goto portsReady
ping -n 2 127.0.0.1 >nul 2>&1
goto waitPorts
:portsReady

if defined SERVE_PID (
    echo   Report server PID: %SERVE_PID%
) else (
    echo   WARNING: report server may have failed
)
if defined PLATFORM_PID (
    echo   Platform PID: %PLATFORM_PID%
) else (
    echo   WARNING: platform may have failed
)

echo.
echo --------------------------------------------
echo Reports  : http://127.0.0.1:%SERVE_PORT%/
echo Platform : http://127.0.0.1:%PLATFORM_PORT%/
echo Logs     : http://127.0.0.1:%PLATFORM_PORT%/logs   (Account - Logs)
echo Logfiles : %PROJECT_DIR%\logs\ai.log / web.log
echo Password : 123456  (accounts in db/users.json)
if not "%REPO_DIR%"=="" echo Repo     : %REPO_DIR%
echo --------------------------------------------
echo.
echo All processes run hidden (no windows).
echo Type quit and press Enter to stop everything.
echo.

:loop
set /p input=
if /i "!input!"=="quit" goto quit
goto loop

:quit
echo.
echo Stopping processes...
if defined SERVE_PID (
    taskkill /F /PID %SERVE_PID% >nul 2>&1
    echo   Stopped report server PID %SERVE_PID%
)
if defined PLATFORM_PID (
    taskkill /F /PID %PLATFORM_PID% >nul 2>&1
    echo   Stopped platform PID %PLATFORM_PID%
)
call :killPort %SERVE_PORT%
call :killPort %PLATFORM_PORT%
:: fallback: kill by command line (services + hidden log processes)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -match 'src/index\.ts (serve|platform) --port (%SERVE_PORT%|%PLATFORM_PORT%)\b') -or ($_.CommandLine -match 'src/index\.ts logs --kind') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo.
echo Done.
pause >nul
exit /b

:killPort
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%~1" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        echo   Killing PID %%a on port %~1
        taskkill /F /PID %%a >nul 2>&1
    )
)
exit /b
