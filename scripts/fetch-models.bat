@rem ---------------------------------------------------------------------------
@rem PhotoCraft - download and verify the local background-removal models (Windows CMD).
@rem
@rem Windows users never need a .sh file: this launcher runs the PowerShell implementation
@rem (scripts\fetch-models.ps1), which downloads every model in scripts\models.conf, verifies
@rem HTTP status, size and SHA-256, resumes interrupted downloads and exits non-zero on failure.
@rem
@rem Usage:
@rem   scripts\fetch-models.bat
@rem   scripts\fetch-models.bat -Tier quick
@rem   scripts\fetch-models.bat -Verify
@rem   scripts\fetch-models.bat -Dest C:\photocraft-models
@rem ---------------------------------------------------------------------------
@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%fetch-models.ps1"

if not exist "%PS1%" (
  echo fetch-models.bat: missing %PS1% 1>&2
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  where pwsh >nul 2>nul
  if errorlevel 1 (
    echo fetch-models.bat: neither powershell nor pwsh was found in PATH 1>&2
    exit /b 1
  )
  set "PS=pwsh"
) else (
  set "PS=powershell"
)

%PS% -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo fetch-models.bat failed with exit code %EXITCODE%. 1>&2
)

exit /b %EXITCODE%
