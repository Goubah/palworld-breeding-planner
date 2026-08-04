@echo off
cd /d "%~dp0"
echo Starting local server for Palworld Breeding Route Planner...
echo (Close this window to stop the server.)
start "" http://localhost:8743/index.html
py -m http.server 8743
