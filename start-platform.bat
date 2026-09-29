@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: 本 worktree 只启动 AI 管线平台（报告服务由主仓库 d:\code\ai-flows 的 bat 负责）
:: 端口与主仓库（4310/4311）错开，便于两个 worktree 同时运行
set "PLATFORM_PORT=4317"
set "PROJECT_DIR=d:\code\ai-chat"
:: 节点03代码评审的目标仓库（留空则默认用 PROJECT_DIR）
set "REPO_DIR="

echo ============================================
echo   AI-Chat worktree 平台启动器
echo ============================================
echo.

:: 1. 清理端口占用（顺带清掉旧服务）
echo [1/3] 清理端口占用 (%PLATFORM_PORT%)...
call :killPort %PLATFORM_PORT%

:: 2. 启动管线平台
echo [2/3] 启动 AI 管线平台 (端口 %PLATFORM_PORT%)...
cd /d "%PROJECT_DIR%"
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
echo 管线平台 : http://127.0.0.1:%PLATFORM_PORT%/
echo AI 对话  : http://127.0.0.1:%PLATFORM_PORT%/chat
echo 登录密码 : 123456（演示账号见 db/users.json）
echo 代码路径 : %PROJECT_DIR%
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
echo [3/3] 正在结束进程...
if defined PLATFORM_PID (
    taskkill /F /PID %PLATFORM_PID% >nul 2>&1
    echo   已终止平台服务 PID %PLATFORM_PID%
)
:: 兜底：按端口再清一遍
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