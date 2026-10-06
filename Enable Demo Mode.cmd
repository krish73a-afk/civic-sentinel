@echo off
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0backend\switch_auth.py" local_demo
if errorlevel 1 echo Could not change mode. Check the message above.
pause
