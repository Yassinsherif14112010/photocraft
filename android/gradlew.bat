@rem ---------------------------------------------------------------------------
@rem PhotoCraft Gradle bootstrap for Windows (CMD and PowerShell).
@rem
@rem The stock Android Studio wrapper needs a binary gradle-wrapper.jar, which this repository
@rem does not commit. This script does the same job with tools Windows already has: it reads
@rem gradle\wrapper\gradle-wrapper.properties, downloads the Gradle distribution once into
@rem %USERPROFILE%\.gradle\wrapper\dists and runs that distribution's own bin\gradle.bat.
@rem Prefer scripts\build-android.ps1 for a full, guided build.
@rem ---------------------------------------------------------------------------
@echo off
setlocal enabledelayedexpansion

set "APP_HOME=%~dp0"
set "WRAPPER_PROPS=%APP_HOME%gradle\wrapper\gradle-wrapper.properties"
if not exist "%WRAPPER_PROPS%" (
  echo gradlew.bat: missing %WRAPPER_PROPS% 1>&2
  exit /b 1
)

set "DISTRIBUTION_URL="
for /f "usebackq tokens=1,* delims==" %%a in ("%WRAPPER_PROPS%") do (
  if "%%a"=="distributionUrl" set "DISTRIBUTION_URL=%%b"
)
if "%DISTRIBUTION_URL%"=="" (
  echo gradlew.bat: distributionUrl is missing from %WRAPPER_PROPS% 1>&2
  exit /b 1
)
set "DISTRIBUTION_URL=%DISTRIBUTION_URL:\:=:%"

for %%f in ("%DISTRIBUTION_URL%") do set "ZIP_NAME=%%~nxf%%~xf"
for %%f in ("%DISTRIBUTION_URL%") do set "ZIP_NAME=%%~nxf"
set "DIST_NAME=%ZIP_NAME:-bin.zip=%"
set "DIST_NAME=%DIST_NAME:-all.zip=%"
set "DIST_NAME=%DIST_NAME:.zip=%"

if "%GRADLE_USER_HOME%"=="" set "GRADLE_USER_HOME=%USERPROFILE%\.gradle"
set "DIST_PARENT=%GRADLE_USER_HOME%\wrapper\dists\%DIST_NAME%"
set "DIST_DIR=%DIST_PARENT%\gradle"
set "MARKER=%DIST_PARENT%\%ZIP_NAME%.ok"

if not exist "%DIST_DIR%\bin\gradle.bat" (
  if not exist "%MARKER%" (
    if not exist "%DIST_PARENT%" mkdir "%DIST_PARENT%"
    echo Downloading %DIST_NAME% ...
    curl -fSL --retry 3 -o "%DIST_PARENT%\%ZIP_NAME%.part" "%DISTRIBUTION_URL%"
    if errorlevel 1 (
      echo gradlew.bat: download failed: %DISTRIBUTION_URL% 1>&2
      exit /b 1
    )
    powershell -NoProfile -Command "Expand-Archive -Force -Path '%DIST_PARENT%\%ZIP_NAME%.part' -DestinationPath '%DIST_PARENT%'"
    if errorlevel 1 (
      echo gradlew.bat: could not unpack the Gradle distribution 1>&2
      exit /b 1
    )
    if not exist "%DIST_DIR%\bin\gradle.bat" (
      for /d %%d in ("%DIST_PARENT%\gradle-*") do (
        if exist "%%d\bin\gradle.bat" (
          rmdir /s /q "%DIST_DIR%" 2>nul
          move "%%d" "%DIST_DIR%" >nul
        )
      )
    )
    del /q "%DIST_PARENT%\%ZIP_NAME%.part" 2>nul
    echo. > "%MARKER%"
  )
)

if not exist "%DIST_DIR%\bin\gradle.bat" (
  echo gradlew.bat: no bin\gradle.bat in %DIST_DIR% 1>&2
  exit /b 1
)

call "%DIST_DIR%\bin\gradle.bat" --project-dir "%APP_HOME%" %*
exit /b %ERRORLEVEL%
