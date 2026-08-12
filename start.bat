@echo off
chcp 65001 >nul
title CareerSail · 职航

echo.
echo   ⛵ CareerSail 职航 — 求职看板
echo   ─────────────────────────────
echo.
echo   💡 想开机自启动？双击 install-startup.bat 安装，以后每次登录自动静默运行
echo.

cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ 未检测到 Node.js，请先安装：https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo   ✓ Node.js 已就绪
echo   🚀 启动服务中...

:: 启动服务（端口 8430）
node dashboard\server.js

:: 如果异常退出，暂停以便查看错误
if %errorlevel% neq 0 (
    echo.
    echo   ⚠️ 服务异常退出，请检查上方错误信息
    pause
)