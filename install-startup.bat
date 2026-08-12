@echo off
chcp 65001 >nul
title CareerSail · 开机自启安装

echo.
echo   ⛵ CareerSail 职航 — 开机自启动安装
echo   ─────────────────────────────────────
echo.

cd /d "%~dp0"

:: 获取 Windows 启动文件夹路径
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "%STARTUP_DIR%" (
    echo   ❌ 未找到启动文件夹
    pause
    exit /b 1
)

:: 创建 VBS 启动脚本的快捷方式
set "VBS_PATH=%~dp0startup.vbs"
set "LINK_PATH=%STARTUP_DIR%\CareerSail.lnk"

:: 使用 PowerShell 创建快捷方式
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LINK_PATH%'); $s.TargetPath = '%VBS_PATH%'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'CareerSail 求职看板自动启动'; $s.Save()"

if %errorlevel% equ 0 (
    echo   ✓ 开机自启动已安装！
    echo.
    echo   📌 快捷方式位置: %LINK_PATH%
    echo   🚀 每次登录电脑后，服务会在后台静默运行
    echo.
    echo   🔄 正在立即启动服务...
    :: 立即启动服务（静默后台运行）
    start "" /b cscript //nologo "%VBS_PATH%"
    :: 等待服务启动
    timeout /t 3 /nobreak >nul
    echo   ✓ 服务已启动！
    echo   🌐 浏览器访问: http://localhost:8430/dashboard.html
    echo.
    echo   💡 提示: 如需取消开机自启，双击 uninstall-startup.bat
) else (
    echo   ❌ 安装失败，请检查权限
)

echo.
pause