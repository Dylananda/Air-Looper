@echo off
rem Arranca el servidor local y abre la prueba en el navegador.
rem Deja esta ventana abierta mientras pruebas; cerrarla apaga el servidor.
cd /d "%~dp0prueba-latencia"
start "" http://localhost:8000/teclado.html
python -m http.server 8000
if errorlevel 1 py -m http.server 8000
pause
