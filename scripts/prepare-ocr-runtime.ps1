param(
  [string]$Python = $env:OVERWATCH_OCR_BUILD_PYTHON,
  [string[]]$ModelTier = @("tiny", "small", "medium"),
  [string[]]$Language = @("auto"),
  [switch]$Force,
  [switch]$SkipModelWarmup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RuntimeDir = Join-Path $Root "ocr-runtime"
$ModelsHome = Join-Path $Root "ocr-models"
$Requirements = Join-Path $Root "ocr-service\requirements.txt"
$WarmupScript = Join-Path $Root "ocr-service\warmup_models.py"
$RuntimePython = Join-Path $RuntimeDir "Scripts\python.exe"
$StampFile = Join-Path $RuntimeDir ".requirements.sha256"

function Get-Sha256 {
  param([string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace "-", "")
    }
    finally {
      $sha.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

$RequirementsHash = Get-Sha256 $Requirements

function Resolve-Python {
  param([string]$RequestedPython)

  if ($RequestedPython) {
    Invoke-Python -PythonCommand $RequestedPython -Arguments @("-c", "import sys; assert sys.maxsize > 2**32; assert (3, 11) <= sys.version_info[:2] <= (3, 13)")
    return $RequestedPython
  }

  $candidates = @(
    "py -3.12",
    "py -3.11",
    "python"
  )

  foreach ($candidate in $candidates) {
    try {
      Invoke-Python -PythonCommand $candidate -Arguments @("-c", "import sys; assert sys.maxsize > 2**32; assert (3, 11) <= sys.version_info[:2] <= (3, 13)")

      return $candidate
    }
    catch {
      continue
    }
  }

  throw "No usable Python was found. Install 64-bit Python 3.11-3.13 or set OVERWATCH_OCR_BUILD_PYTHON."
}

function Invoke-Python {
  param(
    [string]$PythonCommand,
    [string[]]$Arguments
  )

  if ($PythonCommand.StartsWith("py ")) {
    $parts = $PythonCommand.Split(" ")
    & $parts[0] $parts[1] @Arguments
  }
  else {
    & $PythonCommand @Arguments
  }
}

if ($Force -and (Test-Path $RuntimeDir)) {
  Remove-Item -LiteralPath $RuntimeDir -Recurse -Force
}

$runtimeIsCurrent =
  (Test-Path $RuntimePython) -and
  (Test-Path $StampFile) -and
  ((Get-Content $StampFile -Raw).Trim() -eq $RequirementsHash)

if (-not $runtimeIsCurrent) {
  $ResolvedPython = Resolve-Python $Python

  if (-not (Test-Path $RuntimePython)) {
    Write-Host "Creating embedded OCR Python runtime at $RuntimeDir"
    Invoke-Python -PythonCommand $ResolvedPython -Arguments @("-m", "venv", $RuntimeDir)
  }

  Write-Host "Installing PaddleOCR dependencies into embedded runtime"
  & $RuntimePython -m pip install --upgrade pip setuptools wheel
  & $RuntimePython -m pip install --no-cache-dir -r $Requirements
  & $RuntimePython -m pip check
  Set-Content -LiteralPath $StampFile -Value $RequirementsHash -Encoding ascii
}
else {
  Write-Host "Embedded OCR runtime is already up to date."
}

if (-not $SkipModelWarmup) {
  New-Item -ItemType Directory -Force -Path $ModelsHome | Out-Null

  $previousHome = $env:HOME
  $previousUserProfile = $env:USERPROFILE
  $previousModelSource = $env:PADDLE_PDX_MODEL_SOURCE

  try {
    $env:HOME = $ModelsHome
    $env:USERPROFILE = $ModelsHome
    if (-not $env:PADDLE_PDX_MODEL_SOURCE) {
      $env:PADDLE_PDX_MODEL_SOURCE = "bos"
    }

    Write-Host "Warming PaddleOCR models into $ModelsHome"
    & $RuntimePython $WarmupScript --tiers $ModelTier --languages $Language --device cpu --cpu-threads 2
  }
  finally {
    $env:HOME = $previousHome
    $env:USERPROFILE = $previousUserProfile
    $env:PADDLE_PDX_MODEL_SOURCE = $previousModelSource
  }
}

Write-Host "Embedded PaddleOCR runtime is ready."
