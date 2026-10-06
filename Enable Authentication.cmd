@echo off
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0backend\switch_auth.py" firebase
if errorlevel 1 echo Could not change mode. Check the message above.
pause
