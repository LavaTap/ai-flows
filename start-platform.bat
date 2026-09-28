@echo off
chcp 65001 >nul
title AI 评审平台
echo ========================================
echo   AI 评审平台启动中...
echo   端口: 4311
echo   演示密码: 123456
echo   输入 quit 回车可停止服务
echo ========================================
echo.

REM 检查并清理 4311 端口占用
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4311 " ^| findstr "LISTENING"') do (
  echo 检测到端口 4311 被进程 %%a 占用，正在终止...
  taskkill /F /PID %%a >nul 2>&1
  timeout /t 1 /nobreak >nul
)

echo 启动平台服务...
start /b npx tsx src/index.ts platform --port 4311

:WAITLOOP
set /p input=
if /i "%input%"=="quit" (
  echo 正在停止平台服务...
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4311 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
  )
  taskkill /F /IM node.exe /FI "WINDOWTITLE eq AI 评审平台*" >nul 2>&1
  echo 已停止。
  timeout /t 1 /nobreak >nul
  exit
)
goto WAITLOOP
