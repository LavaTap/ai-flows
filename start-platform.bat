@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 平台端口（可用 AI_FLOWS_PORT 覆盖）
set PORT=4311
rem 评审目标仓库（请输入要评审的仓库绝对路径）
set REPO=d:/code/private/text-code

echo ============================================
echo   AI-FLOWS 管线平台启动
echo   目标仓库 : %REPO%
echo   端口     : %PORT%
echo   按 Ctrl+C 停止
echo ============================================
echo.

npx tsx src/index.ts platform --port %PORT% --repo %REPO%

if errorlevel 1 (
  echo.
  echo 平台启动失败，请检查 node / npx 环境。
  pause
)
endlocal