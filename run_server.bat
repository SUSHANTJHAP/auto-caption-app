@echo off
echo Waiting for dependencies to install...
:loop
IF EXIST "node_modules\" (
    echo Starting server...
    node server.js
) ELSE (
    timeout /t 5 >nul
    goto loop
)
