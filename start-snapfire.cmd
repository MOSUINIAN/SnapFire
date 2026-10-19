@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo SnapFire: Electron runtime was not found.
  echo.
  echo Run these commands in this folder first:
  echo   npm install
  echo.
  echo If the Electron download is blocked:
  echo   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  echo   node node_modules\electron\install.js
  echo.
  pause
  exit /b 1
)

if not exist "out\main\index.js" (
  echo.
  echo SnapFire has not been built yet. Building now...
  call npm run build
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
