@echo off
cd /d "%~dp0"
if not exist "client\node_modules" (
  echo Dependencies are not installed. Run npm run install:all first.
  pause
  exit /b 1
)
start "Taptap API" cmd /c "npm run dev --prefix server"
start "Taptap Website" cmd /c "npm run dev --prefix client"
timeout /t 3 >nul
start "" "http://localhost:5173"
