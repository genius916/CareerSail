#!/bin/bash
echo ""
echo "  ⛵  CareerSail · 职航 — 求职看板"
echo "  ─────────────────────────────────"
echo ""
echo "  正在启动服务..."
echo ""

cd "$(dirname "$0")"
node server.js
