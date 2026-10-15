@echo off
title OKayMaps Launcher

:: Ensure the script runs from the CP folder
cd /d "%~dp0"

:: Activate the virtual environment
call venv\Scripts\activate.bat

:: Open the app in the browser after giving the server a moment to start
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:8000"

:: Start the FastAPI backend (also serves the frontend at http://localhost:8000)
uvicorn backend.main:app --reload
