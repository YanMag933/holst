@echo off
cd /d "%~dp0"
echo.
echo  Holst PWA
echo  Open on this PC:  http://127.0.0.1:8765
echo  Then install on the phone from an HTTPS link (GitHub Pages).
echo.
python -m http.server 8765
pause
