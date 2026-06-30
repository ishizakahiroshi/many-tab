$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$validateScript = Join-Path $PSScriptRoot 'validate-extension.ps1'

if (Test-Path -LiteralPath $validateScript -PathType Leaf) {
  & $validateScript
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$version = $manifest.version
$slug = 'many-tab'

$distDir = Join-Path $root 'dist\release-assets'
$stagingDir = Join-Path $root "dist\staging\$slug"
$zipPath = Join-Path $distDir "$slug-v$version-webstore.zip"

if (Test-Path -LiteralPath $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagingDir, $distDir | Out-Null

$files = @(
  'manifest.json',
  'background.js',
  'content-main.js',
  'content-isolated.js',
  'popup.html',
  'popup.js',
  'lib/cookies.js',
  'lib/dnr.js',
  'lib/sessions.js',
  'lib/logbuf.js',
  '_locales/ja/messages.json',
  '_locales/en/messages.json',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'icons/icon.svg',
  'LICENSE',
  'PRIVACY.md'
)

foreach ($file in $files) {
  $source = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Required file missing: $file"
  }

  $target = Join-Path $stagingDir $file
  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
Write-Host "Created: $zipPath"
Write-Host "SHA256:  $hash"
