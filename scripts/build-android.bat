@echo off
rem ---------------------------------------------------------------------------
rem PhotoCraft for Android - Windows build launcher (CMD).
rem
rem This is a thin wrapper: it runs scripts/build-android.ps1, which does the real
rem work (prerequisite checks, cargo-ndk engine build, Gradle assembly). Use it from
rem a plain Command Prompt where PowerShell scripts are not directly callable.
rem
rem Usage:
rem   scripts\build-android.bat
rem   scripts\build-android.bat -Debug
rem   scripts\build-android.bat -Abi arm64-v8a
rem   scripts\build-android.bat -WithModels -Install
rem
rem All switches are passed through to the PowerShell script:
rem   -Debug  -Abi <abi>[,<abi>]  -WithModels  -SkipNative  -Bundle  -Install
rem ---------------------------------------------------------------------------

setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%build-android.ps1"

if not exist "%PS1%" (
    echo ERROR: %PS1% not found.
    exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
    where pwsh >nul 2>nul
    if errorlevel 1 (
        echo ERROR: neither powershell nor pwsh was found on PATH.
        exit /b 1
    )
    set "PS=pwsh"
) else (
    set "PS=powershell"
)

echo Building PhotoCraft for Android (%PS% -ExecutionPolicy Bypass -File "%PS1%")
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*

if errorlevel 1 (
    echo.
    echo Build failed. See the output above.
    exit /b 1
)

echo.
echo Artifacts are in dist\android
exit /b 0
