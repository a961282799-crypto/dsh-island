@echo off
cd /d "%~dp0"
echo == Running tests...
call npm test
if errorlevel 1 (
  echo.
  echo Tests failed, nothing was published.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish.ps1"
