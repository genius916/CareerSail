@echo off
chcp 65001 >nul
title CareerSail · 取消开机自启

echo.
echo   ⛵ CareerSail 职航 — 取消开机自启动
echo   ─────────────────────────────────
echo.

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK_PATH=%STARTUP_DIR%\CareerSail.lnk"

if exist "%LINK_PATH%" (
    del "%LINK_PATH%"
    echo   ✓ 开机自启动已取消
) else (
    echo   ℹ️ 未找到开机自启动快捷方式
)

echo.
pause