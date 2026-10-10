#Requires -Version 5.1
<#
.SYNOPSIS
    Builds PhotoCraft for Android on Windows.

.DESCRIPTION
    Builds the Rust engine for the selected ABIs with cargo-ndk, then assembles the APK with
    Gradle. Model weights are only downloaded when -WithModels is passed.

    Everything is checked first (scripts/check-prereqs.sh equivalent is built into this script):
    a missing JDK, NDK or cargo-ndk is reported with the command that installs it instead of
    failing halfway through a Gradle run.

.PARAMETER Debug
    Build the debug variant instead of release.

.PARAMETER Abi
    One or more ABIs: arm64-v8a, armeabi-v7a, x86_64. Defaults to all three.

.PARAMETER WithModels
    Also download the background-removal models (scripts/fetch-models.ps1 -Tier quick).

.PARAMETER SkipNative
    Reuse an existing libphotocraft.so instead of rebuilding the engine.

.PARAMETER Bundle
    Also build the .aab release bundle.

.PARAMETER Install
    Install the APK on the connected device or emulator (adb).

.EXAMPLE
    .\scripts\build-android.ps1
    .\scripts\build-android.ps1 -Debug -Abi arm64-v8a
    .\scripts\build-android.ps1 -WithModels -Install
#>
[CmdletBinding()]
param(
    [switch]$Debug,
    [string[]]$Abi = @('arm64-v8a', 'armeabi-v7a', 'x86_64'),
    [switch]$WithModels,
    [switch]$SkipNative,
    [switch]$Bundle,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root 'android/gradlew.bat'))) {
    $Root = (Get-Location).Path
}
$AndroidDir = Join-Path $Root 'android'
$OutDir = Join-Path $Root 'dist/android'

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Fail { param([string]$Message) Write-Host "`nERROR: $Message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
Write-Step 'Checking prerequisites'

$problems = @()

$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
    $problems += 'java is not on PATH. Install a JDK 17 or newer (https://adoptium.net).'
} else {
    $javaVersion = (& java -version 2>&1) -join ' '
    if ($javaVersion -match 'version "(\d+)') {
        $major = [int]$Matches[1]
        if ($major -lt 17) { $problems += "JDK is $javaVersion but 17 or newer is required." }
        else { Write-Host "  JDK            OK  ($javaVersion)" }
    }
}

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
    $problems += 'cargo is not on PATH. Install Rust from https://rustup.rs (the engine needs it).'
} else {
    Write-Host "  cargo          OK  $(& cargo --version)"
    $ndk = & cargo ndk --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $ndk) {
        $problems += 'cargo-ndk is missing. Install it with: cargo install cargo-ndk@4'
    } else {
        Write-Host "  cargo-ndk      OK  $($ndk | Select-Object -First 1)"
    }
}

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { '' }
if (-not $sdk -or -not (Test-Path $sdk)) {
    $problems += 'ANDROID_HOME is not set (or points to a missing directory). Set it to your Android SDK path.'
} else {
    Write-Host "  Android SDK    OK  $sdk"
    $ndkDirs = Get-ChildItem -Path (Join-Path $sdk 'ndk') -Directory -ErrorAction SilentlyContinue
    if (-not $ndkDirs) {
        $problems += 'No NDK found under the SDK. Install it with: sdkmanager "ndk;27.0.12077973"'
    } else {
        $newest = $ndkDirs | Sort-Object Name | Select-Object -Last 1
        Write-Host "  Android NDK    OK  $($newest.Name)"
        $env:ANDROID_NDK_HOME = $newest.FullName
    }
}

$manifest = Join-Path $Root 'android/app/src/main/assets/models.conf'
if (Test-Path $manifest) { Write-Host '  models.conf    OK' }
else { $problems += 'android/app/src/main/assets/models.conf is missing. Copy scripts/models.conf there.' }

if ($problems.Count -gt 0) {
    Write-Host ''
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Fail 'prerequisites are not met (see above).'
}

# ---------------------------------------------------------------------------
# Models (optional)
# ---------------------------------------------------------------------------
if ($WithModels) {
    Write-Step 'Downloading the background-removal models'
    & (Join-Path $Root 'scripts/fetch-models.ps1') -Tier quick
    if ($LASTEXITCODE -ne 0) { Fail 'the model download failed.' }
    Write-Host '  The balanced and high-quality models are 224 MB and 973 MB:' -ForegroundColor Yellow
    Write-Host '    scripts\fetch-models.ps1 -Tier balanced'
    Write-Host '    scripts\fetch-models.ps1 -Tier hq'
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
$variant = if ($Debug) { 'Debug' } else { 'Release' }
$task = if ($Debug) { 'assembleDebug' } else { 'assembleRelease' }
$gradleArgs = @("-Pphotocraft.abis=$($Abi -join ',')")
if ($SkipNative) { $gradleArgs += '-Pphotocraft.skipNative=true' }
if ($Debug) { $gradleArgs += '-Pphotocraft.cargoProfile=debug' }

Write-Step "Building the Rust engine and the $variant APK"
Write-Host "  gradle task : $task"
Write-Host "  abis        : $($Abi -join ', ')"
Write-Host "  profile     : $(if ($Debug) { 'debug' } else { 'release' })"

Push-Location $AndroidDir
try {
    & .\gradlew.bat --no-daemon --stacktrace @gradleArgs ":app:$task"
    if ($LASTEXITCODE -ne 0) { Fail "gradle $task failed." }

    if ($Bundle) {
        & .\gradlew.bat --no-daemon @gradleArgs ':app:bundleRelease'
        if ($LASTEXITCODE -ne 0) { Fail 'gradle bundleRelease failed.' }
    }
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------
Write-Step 'Collecting the artifacts'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$artifacts = Get-ChildItem -Path (Join-Path $AndroidDir 'app/build/outputs') -Recurse -Include *.apk, *.aab -ErrorAction SilentlyContinue
if (-not $artifacts) { Fail 'no APK was produced — check the Gradle output above.' }

foreach ($a in $artifacts) {
    Copy-Item $a.FullName -Destination $OutDir -Force
    $size = [math]::Round($a.Length / 1MB, 1)
    Write-Host "  $($a.Name)  ($size MB)"
    if ($Install -and $a.Extension -eq '.apk') {
        $adb = Get-Command adb -ErrorAction SilentlyContinue
        if ($adb) { & adb install -r $a.FullName } else { Write-Host '  adb is not on PATH — skipping the install' }
    }
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  artifacts: $OutDir"
Write-Host '  engine   : android\app\src\main\jniLibs\<abi>\libphotocraft.so'
