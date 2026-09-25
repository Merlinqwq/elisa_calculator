@echo off
cd /d "%~dp0"
python -m elisa.server --open-browser
if errorlevel 1 (
  echo.
  echo The ELISA tool could not start. Check that Python is installed, then run:
  echo python -m pip install -r requirements.txt
  pause
)
