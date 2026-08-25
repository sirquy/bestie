@echo off
setlocal

where bestie >nul 2>&1
if errorlevel 1 (
  echo Bestie CLI was not found on PATH.
  exit /b 1
)

set "BESTIE_NO_BANNER=1"

bestie service status | findstr /C:"Windows startup command installed at" >nul
if errorlevel 1 (
  echo Bestie Windows startup is not installed. Installing and starting it now.
  bestie service install
) else (
  echo Bestie Windows startup is installed. Restarting the service.
  bestie service restart
)

if errorlevel 1 (
  echo Bestie service startup failed.
  exit /b 1
)

bestie daemon status --channel all
exit /b 0