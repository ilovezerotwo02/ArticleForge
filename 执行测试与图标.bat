@echo off
chcp 65001 >nul
title ArticleForge - smoke test and icon
cd /d "%~dp0"

echo ===== 1. Node.js version =====
node --version || (echo Node.js not found in PATH. Please install Node.js 18+. & pause & exit /b 1)

echo.
echo ===== 2. Smoke test: intel search + watch digest =====
node scripts\test-intel.mjs

echo.
echo ===== 3. Generate icon: build\icon.png + build\icon.ico =====
node scripts\make-icon.mjs

echo.
echo All done. Check the output above.
pause
