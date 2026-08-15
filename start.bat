@echo off
chcp 65001 >nul 2>&1
title CareerSail · 职航

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    echo 安装完成后重新双击此文件启动。
    pause
    exit /b 1
)

:: 启动服务
cd /d "%~dp0"
echo 正在启动 CareerSail · 职航...
node dashboard/server.js
pause
