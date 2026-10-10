#Requires -Version 5.1
<#
.SYNOPSIS
    Downloads and verifies PhotoCraft's local background-removal models (Windows).
.DESCRIPTION
    Reads scripts/models.conf (the same manifest the Android app ships) and, for every selected
    model: downloads it with resume support and retries, verifies the HTTP status, the exact byte
    size when the distributor publishes one, and the SHA-256 when one is published; rejects
    anything under the manifest's sanity floor; skips a model that is already present and valid;
    and exits non-zero - never "success" - when a model is missing or corrupt.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\fetch-models.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\fetch-models.ps1 -Tier quick -Dest C:\models
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\fetch-models.ps1 -Verify
#>
[CmdletBinding()]
param(
    [string]$Dest = (Join-Path $PSScriptRoot '..\android\models'),
    [string]$Manifest = (Join-Path $PSScriptRoot 'models.conf'),
    [string]$Only = '',
    [ValidateSet('', 'quick', 'balanced', 'hq')]
    [string]$Tier = '',
    [switch]$Verify,
    [switch]$Force,
    [int]$Retries = 3,
    [switch]$Bundle
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'Continue'

function Write-Ok($msg) { Write-Host "  " -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green -NoNewline; Write-Host " $msg" }
function Write-Warn($msg) { Write-Host "  " -NoNewline; Write-Host "!" -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
function Write-Fail($msg) { Write-Host "  " -NoNewline; Write-Host ([char]0x2717) -ForegroundColor Red -NoNewline; Write-Host " $msg" }
function Write-Step($msg) { Write-Host "  $msg" }

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Returns $null when the file is good, or the reason it is not.
function Test-ModelFile([string]$Path, [long]$ExpectedBytes, [string]$ExpectedSha, [long]$MinBytes) {
    if (-not (Test-Path -LiteralPath $Path)) { return 'the file is missing' }
    $size = (Get-Item -LiteralPath $Path).Length
    if ($MinBytes -gt 0 -and $size -lt $MinBytes) {
        return "only $size bytes, expected at least $MinBytes - truncated download or an error page"
    }
    if ($ExpectedBytes -gt 0 -and $size -ne $ExpectedBytes) {
        return "size $size, expected $ExpectedBytes"
    }
    if ($ExpectedSha -and $ExpectedSha -ne '-') {
        $actual = Get-FileSha256 $Path
        $want = $ExpectedSha.ToLowerInvariant()
        if ($actual -ne $want) { return "checksum $actual, expected $want" }
    }
    return $null
}

# Downloads one URL with resume support. Returns the HTTP status code (0 on a transport failure).
function Invoke-Download([string]$Url, [string]$Target) {
    $part = "$Target.part"
    $existing = 0
    if (Test-Path -LiteralPath $part) { $existing = (Get-Item -LiteralPath $part).Length }
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.AllowAutoRedirect = $true
        $request.Timeout = 60000
        $request.ReadWriteTimeout = 60000
        $request.UserAgent = 'Photocraft-dev'
        if ($existing -gt 0) { $request.AddRange($existing) }
        $response = $request.GetResponse()
        $status = [int]$response.StatusCode
        $stream = $response.GetResponseStream()
        $mode = if ($status -eq 206 -and $existing -gt 0) { 'Append' } else { 'Create' }
        $file = [System.IO.File]::Open($part, $mode, 'Write', 'ReadWrite')
        try {
            $buffer = New-Object byte[] (1024 * 1024)
            $total = $existing
            $length = $response.ContentLength
            while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $file.Write($buffer, 0, $read)
                $total += $read
                if ($length -gt 0) {
                    $pct = [math]::Min(100, [math]::Round(($total + $existing) / ($length + $existing) * 100))
                    Write-Progress -Activity "Downloading $([System.IO.Path]::GetFileName($Target))" -Status "$pct%" -PercentComplete $pct
                }
            }
        }
        finally {
            $file.Close()
            $stream.Close()
            $response.Close()
            Write-Progress -Activity "Downloading" -Completed
        }
        return $status
    }
    catch {
        $message = $_.Exception.Message
        if ($_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode.value__
        }
        Write-Warn "transport error: $message"
        return 0
    }
}

if (-not (Test-Path -LiteralPath $Manifest)) { Write-Fail "manifest not found: $Manifest"; exit 1 }
$Dest = [System.IO.Path]::GetFullPath($Dest)

Write-Host 'PhotoCraft model acquisition'
Write-Host "  manifest : $Manifest"
Write-Host "  target   : $Dest"
Write-Host "  mode     : $(if ($Verify) { 'verify' } else { 'download' })"
Write-Host ''

$selected = 0
$missing = 0

foreach ($raw in (Get-Content -LiteralPath $Manifest)) {
    $line = $raw.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    $f = $line -split '\|'
    if ($f.Count -lt 10) { Write-Fail "malformed manifest line: $line"; $missing++; continue }
    $id, $label, $tierName, $inputSize, $file, $bytes, $sha, $min, $url, $mirrors = $f[0..9]
    $id = $id.Trim()
    if ($Tier -and $tierName -ne $Tier) { continue }
    if ($Only -and -not (",$Only," -like "*,$id,*")) { continue }
    $selected++

    [long]$expectedBytes = 0; [void][long]::TryParse($bytes, [ref]$expectedBytes)
    [long]$minBytes = 0; [void][long]::TryParse($min, [ref]$minBytes)
    $target = Join-Path $Dest $file

    if ($Verify) {
        $reason = Test-ModelFile $target $expectedBytes $sha $minBytes
        if ($reason) { Write-Fail "${id}: $reason"; $missing++ } else { Write-Ok "$id: $file ($((Get-Item $target).Length) bytes) verified" }
        continue
    }

    if (-not (Test-Path -LiteralPath $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }

    if (-not $Force) {
        $reason = Test-ModelFile $target $expectedBytes $sha $minBytes
        if (-not $reason) {
            Write-Ok "$id`: already present and valid - skipping the download (use -Force to replace it)"
            continue
        }
    }

    $urls = @($url)
    if ($mirrors -and $mirrors -ne '-') { $urls += ($mirrors -split ';') }

    $ok = $false
    $reason = ''
    $lastStatus = 0
    foreach ($candidate in $urls) {
        for ($attempt = 1; $attempt -le $Retries; $attempt++) {
            Write-Step "$id`: downloading $label from $candidate (attempt $attempt/$Retries)"
            $status = Invoke-Download $candidate $target
            $lastStatus = $status
            if ($status -ne 200 -and $status -ne 206) { Write-Warn "$id`: HTTP $status from $candidate" }
            $reason = Test-ModelFile "$target.part" $expectedBytes $sha $minBytes
            if (($status -eq 200 -or $status -eq 206) -and -not $reason) { $ok = $true; break }
            if ($reason) { Write-Warn "$id`: $reason" }
            if ($minBytes -gt 0 -and (Test-Path "$target.part") -and ((Get-Item "$target.part").Length -lt $minBytes)) {
                Move-Item -LiteralPath "$target.part" -Destination "$target.part.rejected" -Force
            }
            Start-Sleep -Seconds 2
        }
        if ($ok) { break }
        Write-Warn "$id`: giving up on $candidate"
        Remove-Item -LiteralPath "$target.part" -Force -ErrorAction SilentlyContinue
    }

    if (-not $ok) {
        if (-not $reason -and (Test-Path "$target.part.rejected")) {
            $reason = Test-ModelFile "$target.part.rejected" $expectedBytes $sha $minBytes
        }
        if ($reason) { Write-Fail "$id`: the downloaded copy did not verify - $reason" }
        else { Write-Fail "$id`: no data was written (last HTTP status: $lastStatus)" }
        Write-Fail "$id`: could not download a valid copy from any source"
        Remove-Item -LiteralPath "$target.part","$target.part.rejected" -Force -ErrorAction SilentlyContinue
        $missing++
        continue
    }

    Move-Item -LiteralPath "$target.part" -Destination $target -Force
    Remove-Item -LiteralPath "$target.part.rejected" -Force -ErrorAction SilentlyContinue
    $reason = Test-ModelFile $target $expectedBytes $sha $minBytes
    if ($reason) { Write-Fail "$id`: $reason"; $missing++ }
    else { Write-Ok "$id`: $file ($((Get-Item $target).Length) bytes) verified" }
}

if ($selected -eq 0) { Write-Fail "no model in $Manifest matches -Tier '$Tier' -Only '$Only'"; exit 1 }

if ($missing -gt 0) {
    Write-Host ''
    Write-Host "$missing of $selected model(s) could not be fetched or verified." -ForegroundColor Red
    Write-Host 'The app still runs: Quick Remove uses the engine''s built-in Select Subject and needs'
    Write-Host 'no model. High-quality removal stays unavailable until the model is present.'
    exit 1
}

if ($Bundle) {
    $assets = Join-Path $PSScriptRoot '..\android\app\src\main\assets\models'
    New-Item -ItemType Directory -Path $assets -Force | Out-Null
    $total = 0
    foreach ($raw in (Get-Content -LiteralPath $Manifest)) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $file = ($line -split '\|')[4]
        $src = Join-Path $Dest $file
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $assets $file) -Force
            $total += (Get-Item -LiteralPath $src).Length
        }
    }
    Write-Host "Bundled into $assets ($total bytes)."
    if ($total -gt 150000000) { Write-Warn 'more than 150 MB of APK assets - most users should download models at runtime' }
}

Write-Host ''
Write-Host "All $selected model(s) present and verified in $Dest" -ForegroundColor Green
Write-Host 'Install them on a device with:'
Write-Host "  adb push $Dest\<file> /sdcard/Android/data/ai.storyteller.photocraft/files/models/"
Write-Host 'or let the app download them itself: Editor > AI > High quality > Download model.'
