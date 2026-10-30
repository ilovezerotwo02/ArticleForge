@echo off
chcp 65001 >nul
title ArticleForge - rebuild portable exe
cd /d "%~dp0"

echo [1/3] Sync vendor deps (marked / katex)...
call npm run vendor || (echo FAILED at vendor & pause & exit /b 1)

echo.
echo [2/3] Regenerate icon (new design)...
call npm run icon || (echo FAILED at icon & pause & exit /b 1)

echo.
echo [3/3] Build portable exe...
call npm run build || (echo FAILED at build & pause & exit /b 1)

echo.
echo OK! Output: release\ArticleForge-1.0.4-portable.exe
pause
