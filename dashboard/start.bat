@echo off
chcp 65001 >nul
title CareerSail · 职航
echo.
echo   ⛵  CareerSail · 职航 — 求职助手
echo   ─────────────────────────────────
echo.
echo   正在启动服务...
echo.

cd /d "%~dp0"
node server.js

pause