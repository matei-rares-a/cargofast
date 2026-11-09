@echo off
:: TLDR: Porneste CarGoFast (Vite + three.js): instaleaza dependintele daca lipsesc, apoi ruleaza modul din RUN_MODE.
:: Ruleaza cu "start.bat" (foloseste configurarile de mai jos) sau cu override: "start.bat -p <mode> <port> <open_browser>",
:: ex: "start.bat -p test" sau "start.bat -p dev 8080 0". Necesita Node.js (npm) in PATH.
setlocal EnableExtensions

:: =========================================================================
:: CONFIGURATION
:: =========================================================================
:: "dev" = server local | "build" = build in dist\ | "test" = ruleaza testele o data
set RUN_MODE=dev

:: numeric 1024-65535; portul serverului de dev (daca e ocupat, Vite alege urmatorul liber)
set DEV_PORT=5173

:: 1 = deschide browserul la pornirea serverului de dev | 0 = nu deschide
set OPEN_BROWSER=1

:: 1 = ruleaza "npm install" daca lipseste node_modules | 0 = oprire cu eroare
set AUTO_INSTALL=1

:: =========================================================================
:: CLI OVERRIDE: start.bat -p <mode> <port> <open_browser>  (argumentele lipsa raman din CONFIGURATION)
:: =========================================================================
if /i "%~1"=="-p" (
    if not "%~2"=="" set RUN_MODE=%~2
    if not "%~3"=="" set DEV_PORT=%~3
    if not "%~4"=="" set OPEN_BROWSER=%~4
)

:: =========================================================================
:: VALIDATION (fail-fast)
:: =========================================================================
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm nu a fost gasit in PATH. Instaleaza Node.js: https://nodejs.org/en/download/ 1>&2
    exit /b 1
)

if not exist package.json (
    echo ERROR: package.json lipseste in "%~dp0". Ruleaza scriptul din radacina proiectului. 1>&2
    exit /b 1
)

if /i not "%RUN_MODE%"=="dev" if /i not "%RUN_MODE%"=="build" if /i not "%RUN_MODE%"=="test" (
    echo ERROR: RUN_MODE="%RUN_MODE%" invalid. Valori permise: dev ^| build ^| test. 1>&2
    exit /b 1
)

if /i "%RUN_MODE%"=="dev" (
    echo %DEV_PORT%| findstr /r "^[0-9][0-9]*$" >nul
    if errorlevel 1 (
        echo ERROR: DEV_PORT="%DEV_PORT%" invalid. Trebuie sa fie numeric. 1>&2
        exit /b 1
    )
)

:: =========================================================================
:: SETUP
:: =========================================================================
if not exist node_modules (
    if not "%AUTO_INSTALL%"=="1" (
        echo ERROR: node_modules lipseste si AUTO_INSTALL=0. Ruleaza "npm install" sau seteaza AUTO_INSTALL=1. 1>&2
        exit /b 1
    )
    echo node_modules lipseste, rulez npm install...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install a esuat. 1>&2
        exit /b 1
    )
)

:: =========================================================================
:: RUN
:: =========================================================================
if /i "%RUN_MODE%"=="build" goto :run_build
if /i "%RUN_MODE%"=="test" goto :run_test

:: vite.config.js deschide browserul doar daca SANDBOX_URL nu e setat
if "%OPEN_BROWSER%"=="1" (set "SANDBOX_URL=") else (set "SANDBOX_URL=1")
call npm run dev -- --port %DEV_PORT%
exit /b %ERRORLEVEL%

:run_build
call npm run build
exit /b %ERRORLEVEL%

:run_test
call npm run test:run
exit /b %ERRORLEVEL%
