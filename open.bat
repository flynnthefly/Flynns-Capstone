@echo off
REM Change directory to the folder of this script
cd /d "%~dp0"

REM Optional: show where we are
echo Running from: %cd%

REM Run your Python app
python src\run.py

pause
