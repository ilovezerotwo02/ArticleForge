@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ArticleForge

if not exist node_modules (
  echo Installing dependencies, please wait...
  call npm install
)

echo.
echo   ArticleForge  ->  http://127.0.0.1:5178
echo   Close this window to stop the server.
echo.

start "" http://127.0.0.1:5178
node server.js
pause
