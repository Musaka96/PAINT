@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0.."
npx vite preview --outDir dist-itch --port 4173 --strictPort
