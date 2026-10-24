@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: ===== 配置 =====
set "SERVE_PORT=4310"
set "PLATFORM_PORT=4311"
set "PROJECT_DIR=d:\code\ai-flows"
:: 节点03代码评审的目标仓库（留空则默认用 PROJECT_DIR，路径含空格时请用第2种写法自行加引号）
set "REPO_DIR="
:: 隐性日志进程启动时回看的行数
set "LOG_LINES=50"

:: 两个可见窗口的标题（退出时按标题关窗；日志进程隐性运行、无窗口）
set "T_SERVE=AI-Flows 评审服务"
set "T_PLATFORM=AI-Flows 管线平台"

echo ============================================
echo   AI-Flows 平台启动器（评审 + 管线 + 日志）
echo ============================================
echo.

:: 1. 清理端口占用
echo [1/5] 清理端口占用 (%SERVE_PORT%, %PLATFORM_PORT%)...
call :killPort %SERVE_PORT%
call :killPort %PLATFORM_PORT%

:: 2. 评审报告服务（独立窗口，端口 4310）
echo [2/5] 启动评审报告服务 (端口 %SERVE_PORT%)...
start "%T_SERVE%" /D "%PROJECT_DIR%" cmd /k "chcp 65001 >nul & npx tsx src/index.ts serve --port %SERVE_PORT%"

:: 3. AI 管线平台（独立窗口，端口 4311；节点03触发真实评审）
echo [3/5] 启动 AI 管线平台 (端口 %PLATFORM_PORT%)...
if "%REPO_DIR%"=="" (
    start "%T_PLATFORM%" /D "%PROJECT_DIR%" cmd /k "chcp 65001 >nul & npx tsx src/index.ts platform --port %PLATFORM_PORT%"
) else (
    start "%T_PLATFORM%" /D "%PROJECT_DIR%" cmd /k npx tsx src/index.ts platform --port %PLATFORM_PORT% --repo "%REPO_DIR%"
)

:: 4. 两个日志跟读进程（隐性窗口后台运行，不弹窗；日志在平台 /logs 页查看）
echo [4/5] 启动日志进程（隐性窗口后台运行：AI 请求 / 网页访问）...
start "" /B /D "%PROJECT_DIR%" cmd /c "npx tsx src/index.ts logs --kind ai --lines %LOG_LINES% --follow <nul >nul 2>&1"
start "" /B /D "%PROJECT_DIR%" cmd /c "npx tsx src/index.ts logs --kind web --lines %LOG_LINES% --follow <nul >nul 2>&1"

:: 5. 等端口起来，打印占用情况
timeout /t 3 /nobreak >nul
echo [5/5] 检查服务端口...

set "SERVE_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%SERVE_PORT%" ^| findstr "LISTENING"') do (
    set "SERVE_PID=%%a"
)
if defined SERVE_PID (
    echo   评审服务 PID: %SERVE_PID%
) else (
    echo   警告：评审服务可能启动失败
)

set "PLATFORM_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PLATFORM_PORT%" ^| findstr "LISTENING"') do (
    set "PLATFORM_PID=%%a"
)
if defined PLATFORM_PID (
    echo   平台进程 PID: %PLATFORM_PID%
) else (
    echo   警告：平台服务可能启动失败
)

echo.
echo --------------------------------------------
echo 报告列表 : http://127.0.0.1:%SERVE_PORT%/
echo 管线平台 : http://127.0.0.1:%PLATFORM_PORT%/
echo 系统日志 : http://127.0.0.1:%PLATFORM_PORT%/logs   （账户设置 -^> 日志）
echo 日志文件 : %PROJECT_DIR%\logs\ai.log / web.log
echo 登录密码 : 123456（演示账号见 db/users.json）
if not "%REPO_DIR%"=="" echo 评审仓库 : %REPO_DIR%
echo --------------------------------------------
echo.
echo 已打开窗口：评审服务 / 管线平台（日志进程在后台隐性运行，可在平台 /logs 页查看）
echo 输入 quit 后按回车结束所有进程
echo.

:loop
set /p input=
if /i "!input!"=="quit" goto quit
goto loop

:quit
echo.
echo 正在结束进程...
:: 先按窗口标题关掉两个可见子窗口（日志进程隐性运行无窗口，靠下面的兜底清）
for %%T in ("%T_SERVE%" "%T_PLATFORM%") do (
    taskkill /F /FI "WINDOWTITLE eq %%~T" >nul 2>&1
)
if defined SERVE_PID (
    taskkill /F /PID %SERVE_PID% >nul 2>&1
    echo   已终止评审服务 PID %SERVE_PID%
)
if defined PLATFORM_PID (
    taskkill /F /PID %PLATFORM_PID% >nul 2>&1
    echo   已终止平台服务 PID %PLATFORM_PID%
)
call :killPort %SERVE_PORT%
call :killPort %PLATFORM_PORT%
:: 兜底：按命令行特征收尾（把服务与隐性日志进程一并清干净）
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -match 'src/index\.ts (serve|platform) --port (%SERVE_PORT%|%PLATFORM_PORT%)\b') -or ($_.CommandLine -match 'src/index\.ts logs --kind') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo.
echo 已退出。
pause >nul
exit /b

:killPort
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%~1" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        echo   终止占用端口 %~1 的进程 PID %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
exit /b