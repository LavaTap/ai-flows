@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: 端口配置
set "SERVE_PORT=4310"
set "PLATFORM_PORT=4311"
set "PROJECT_DIR=d:\code\ai-flows"
:: 节点03代码评审的目标仓库（留空则默认用 PROJECT_DIR）
set "REPO_DIR="

echo ============================================
echo   AI-Flows 平台启动器
echo ============================================
echo.

:: 1. 清理端口占用
echo [1/4] 清理端口占用 (%SERVE_PORT%, %PLATFORM_PORT%)...
call :killPort %SERVE_PORT%
call :killPort %PLATFORM_PORT%

:: 2. 启动报告服务
echo [2/4] 启动报告服务 (端口 %SERVE_PORT%)...
cd /d "%PROJECT_DIR%"
start /B "" npx tsx src/index.ts serve --port %SERVE_PORT%
timeout /t 2 /nobreak >nul

set "SERVE_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%SERVE_PORT%" ^| findstr "LISTENING"') do (
    set "SERVE_PID=%%a"
)
if defined SERVE_PID (
    echo   报告服务 PID: %SERVE_PID%
) else (
    echo   警告：报告服务可能启动失败
)

:: 3. 启动管线平台
echo [3/4] 启动 AI 管线平台 (端口 %PLATFORM_PORT%)...
if "%REPO_DIR%"=="" (
    start /B "" npx tsx src/index.ts platform --port %PLATFORM_PORT%
) else (
    start /B "" npx tsx src/index.ts platform --port %PLATFORM_PORT% --repo "%REPO_DIR%"
)
timeout /t 2 /nobreak >nul

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
echo 登录密码 : 123456（演示账号见 db/users.json）
if not "%REPO_DIR%"=="" echo 评审仓库 : %REPO_DIR%
echo --------------------------------------------
echo.
echo 输入 quit 后按回车结束所有进程
echo.

:loop
set /p input=
if /i "!input!"=="quit" goto quit
goto loop

:quit
echo.
echo [4/4] 正在结束进程...
if defined SERVE_PID (
    taskkill /F /PID %SERVE_PID% >nul 2>&1
    echo   已终止报告服务 PID %SERVE_PID%
)
if defined PLATFORM_PID (
    taskkill /F /PID %PLATFORM_PID% >nul 2>&1
    echo   已终止平台服务 PID %PLATFORM_PID%
)
:: 兜底：按端口再清一遍
call :killPort %SERVE_PORT%
call :killPort %PLATFORM_PORT%
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
