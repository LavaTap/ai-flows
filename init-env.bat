@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::   AI-Flows environment init
::     1. check Node >= 22
::     2. Node deps   : npm install  (CN mirror / npmmirror)
::     3. Python deps : project root venv (aliyun PyPI mirror)
::     4. repair CSS  : relative href="./x.css" -> absolute "/x.css"
::   Non-destructive: node_modules and venv are kept, only filled in.
::   Double-click to run.
:: ============================================================

:: ===== config =====
set "NPM_MIRROR=https://registry.npmmirror.com"
set "PY_MIRROR=https://mirrors.aliyun.com/pypi/simple/"
set "PY_PKGS=requests beautifulsoup4 pandas openpyxl selenium webdriver-manager"

:: project dir = folder of this script (trailing backslash stripped)
set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "VENV_DIR=%PROJECT_DIR%\venv"

:: "/nogui" = suppress the final pause (used when called from start-platform.bat)
set "NOPAUSE="
if /i "%~1"=="/nogui" set "NOPAUSE=1"

echo ============================================
echo   AI-Flows environment init
echo   project : %PROJECT_DIR%
echo ============================================
echo.

:: ---------- [1/4] check node ----------
echo [1/4] Checking Node.js (need ^>= 22)...
where node >nul 2>&1
if errorlevel 1 (
    echo   ERROR: node not found in PATH. Install Node.js 22+ first.
    goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
    echo   ERROR: npm not found in PATH.
    goto :fail
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
set "NODEV=!NODEV:v=!"
for /f "tokens=1 delims=." %%a in ("!NODEV!") do set "NODEMAJOR=%%a"
echo   node v!NODEV!
if !NODEMAJOR! LSS 22 (
    echo   ERROR: Node 22 or newer is required, found v!NODEV!.
    goto :fail
)

:: ---------- [2/4] node deps ----------
echo.
echo [2/4] Installing Node dependencies (mirror: %NPM_MIRROR%)...
pushd "%PROJECT_DIR%"
if not exist "node_modules" echo   node_modules not found, will create it.
call npm install --registry "%NPM_MIRROR%"
if not errorlevel 1 goto :nodeOk
echo   WARN: npm install failed (native build?). Retry with --ignore-scripts...
call npm install --ignore-scripts --registry "%NPM_MIRROR%"
if errorlevel 1 (
    echo   ERROR: npm install failed. Check network / proxy settings.
    popd
    goto :fail
)
:nodeOk
echo   node dependencies ready.
popd

:: ---------- [3/4] python venv deps ----------
echo.
echo [3/4] Python venv dependencies (mirror: %PY_MIRROR%)...
where python >nul 2>&1
if errorlevel 1 (
    echo   WARN: python not found in PATH. Skipping venv setup.
    goto :skipPy
)
if exist "%VENV_DIR%\Scripts\python.exe" (
    echo   venv found at %VENV_DIR% , keeping it.
) else (
    echo   venv not found, creating %VENV_DIR% ...
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo   WARN: failed to create venv. Skipping venv setup.
        goto :skipPy
    )
)
echo   installing: %PY_PKGS%
"%VENV_DIR%\Scripts\python.exe" -m pip install %PY_PKGS% -i "%PY_MIRROR%"
if errorlevel 1 (
    echo   WARN: some packages failed. Re-run this script to retry.
) else (
    echo   python dependencies ready.
)
:skipPy

:: ---------- [4/4] repair absolute-path css links ----------
echo.
echo [4/4] Repairing relative CSS links in web\*.html to absolute...
powershell -NoProfile -Command "$q=[char]34; $rel='href='+$q+'./'; $web='%PROJECT_DIR%\web'; $enc=New-Object Text.UTF8Encoding $false; $files=@(Get-ChildItem -LiteralPath $web -Filter *.html); $todo=@($files | Where-Object { [IO.File]::ReadAllText($_.FullName,[Text.Encoding]::UTF8).Contains($rel) }); foreach($f in $todo){ $c=[IO.File]::ReadAllText($f.FullName,[Text.Encoding]::UTF8); [IO.File]::WriteAllText($f.FullName, $c.Replace($rel,'href='+$q+'/'), $enc) }; $left=@($files | Where-Object { [IO.File]::ReadAllText($_.FullName,[Text.Encoding]::UTF8).Contains($rel) }); Write-Host ('  repaired: '+$todo.Count+' file(s), still relative: '+$left.Count)"
if errorlevel 1 (
    echo   WARN: CSS link repair failed. Pages may 404 under sub-paths.
) else (
    echo   CSS links OK.
)

echo.
echo ============================================
echo   Done. Environment is ready.
echo ============================================
echo.
echo   Start services : start-platform.bat
echo   Type-check     : npx tsc --noEmit
echo.
if not defined NOPAUSE pause
exit /b 0

:fail
echo.
echo *** Initialization failed. Fix the issue and re-run. ***
echo.
if not defined NOPAUSE pause
exit /b 1