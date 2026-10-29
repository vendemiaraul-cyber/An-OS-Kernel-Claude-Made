@echo off
rem Starts ConMon Lab on this PC at http://localhost:8080 (needs nothing installed).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 pause
