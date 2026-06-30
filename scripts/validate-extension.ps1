$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$errors = [System.Collections.Generic.List[string]]::new()

function Add-ValidationError {
  param([string]$Message)
  $script:errors.Add($Message) | Out-Null
}

function Test-RequiredFile {
  param([string]$RelativePath)

  $path = Join-Path $root $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Add-ValidationError "Missing required file: $RelativePath"
  }
}

function Get-PngDimension {
  param(
    [byte[]]$Bytes,
    [int]$Offset
  )

  return (($Bytes[$Offset] -shl 24) -bor
    ($Bytes[$Offset + 1] -shl 16) -bor
    ($Bytes[$Offset + 2] -shl 8) -bor
    $Bytes[$Offset + 3])
}

function Test-PngIcon {
  param(
    [string]$RelativePath,
    [int]$ExpectedSize
  )

  $path = Join-Path $root $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Add-ValidationError "Missing icon: $RelativePath"
    return
  }

  $bytes = [System.IO.File]::ReadAllBytes($path)
  $signature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  if ($bytes.Length -lt 24) {
    Add-ValidationError "Icon is too small to be a valid PNG: $RelativePath"
    return
  }

  for ($i = 0; $i -lt $signature.Length; $i++) {
    if ($bytes[$i] -ne $signature[$i]) {
      Add-ValidationError "Icon is not a PNG file: $RelativePath"
      return
    }
  }

  $width = Get-PngDimension -Bytes $bytes -Offset 16
  $height = Get-PngDimension -Bytes $bytes -Offset 20
  if ($width -ne $ExpectedSize -or $height -ne $ExpectedSize) {
    Add-ValidationError "Icon has unexpected dimensions: $RelativePath ($width x $height, expected $ExpectedSize x $ExpectedSize)"
  }
}

function Test-JavaScriptSyntax {
  param([string[]]$RelativePaths)

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Warning 'Node.js was not found; skipping JavaScript syntax checks.'
    return
  }

  foreach ($relativePath in $RelativePaths) {
    $path = Join-Path $root $relativePath
    $output = & $node.Source --check $path 2>&1
    if ($LASTEXITCODE -ne 0) {
      Add-ValidationError "JavaScript syntax check failed for $relativePath`n$output"
    }
  }
}

function Test-PowerShellSyntax {
  param([string[]]$RelativePaths)

  foreach ($relativePath in $RelativePaths) {
    $path = Join-Path $root $relativePath
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors) | Out-Null
    foreach ($parseError in $parseErrors) {
      Add-ValidationError "PowerShell syntax check failed for $relativePath`: $($parseError.Message)"
    }
  }
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'manifest.json is missing.'
}

try {
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
} catch {
  throw "manifest.json is not valid JSON: $($_.Exception.Message)"
}

if ($manifest.manifest_version -ne 3) {
  Add-ValidationError 'manifest_version must be 3.'
}
if (-not $manifest.name) {
  Add-ValidationError 'manifest.name is required.'
}
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') {
  Add-ValidationError "manifest.version must use x.y.z format: $($manifest.version)"
}
if ($manifest.description -notmatch '^__MSG_') {
  if ($manifest.description.Length -gt 132) {
    Add-ValidationError "manifest.description must be 132 chars or less (current: $($manifest.description.Length))."
  }
}

# i18n: default_locale が指定されているなら _locales/<lang>/messages.json を検証する。
# - default_locale の messages.json は必須
# - 全 locale で appName と appDescription が定義されていること
# - 全 locale で key set が一致していること（片方更新忘れを防ぐ）
# - 各 locale の appDescription.message は 132 文字以内
if ($manifest.default_locale) {
  $defaultLocaleFile = Join-Path $root "_locales/$($manifest.default_locale)/messages.json"
  if (-not (Test-Path -LiteralPath $defaultLocaleFile -PathType Leaf)) {
    Add-ValidationError "default_locale=$($manifest.default_locale) but _locales/$($manifest.default_locale)/messages.json missing"
  }

  $localesRoot = Join-Path $root '_locales'
  if (Test-Path -LiteralPath $localesRoot -PathType Container) {
    $localeDirs = Get-ChildItem -Path $localesRoot -Directory
    $baselineKeys = $null
    $baselineLocale = $null
    foreach ($d in $localeDirs) {
      $msgsPath = Join-Path $d.FullName 'messages.json'
      if (-not (Test-Path -LiteralPath $msgsPath -PathType Leaf)) {
        Add-ValidationError "_locales/$($d.Name)/messages.json missing"
        continue
      }
      try {
        $msgs = Get-Content -Raw -LiteralPath $msgsPath | ConvertFrom-Json
      } catch {
        Add-ValidationError "_locales/$($d.Name)/messages.json is not valid JSON: $($_.Exception.Message)"
        continue
      }
      if (-not $msgs.appName) {
        Add-ValidationError "_locales/$($d.Name)/messages.json must define 'appName'"
      }
      if (-not $msgs.appDescription) {
        Add-ValidationError "_locales/$($d.Name)/messages.json must define 'appDescription'"
      } elseif ($msgs.appDescription.message.Length -gt 132) {
        Add-ValidationError "_locales/$($d.Name)/messages.json: appDescription.message must be 132 chars or less (current: $($msgs.appDescription.message.Length))"
      }
      $keys = $msgs.PSObject.Properties.Name | Sort-Object
      if ($null -eq $baselineKeys) {
        $baselineKeys = $keys
        $baselineLocale = $d.Name
      } else {
        $onlyBaseline = $baselineKeys | Where-Object { $keys -notcontains $_ }
        $onlyThis = $keys | Where-Object { $baselineKeys -notcontains $_ }
        if ($onlyBaseline) {
          Add-ValidationError "Locale key parity: keys in $baselineLocale missing from $($d.Name): $($onlyBaseline -join ', ')"
        }
        if ($onlyThis) {
          Add-ValidationError "Locale key parity: keys in $($d.Name) missing from ${baselineLocale}: $($onlyThis -join ', ')"
        }
      }
    }
  }
}
if ($manifest.background.type -ne 'module') {
  Add-ValidationError 'background.type must be module.'
}
if (-not $manifest.background.service_worker) {
  Add-ValidationError 'background.service_worker is required.'
}
if (-not $manifest.action.default_popup) {
  Add-ValidationError 'action.default_popup is required.'
}

# many-tab 固有の必須 permission
$permissions = @($manifest.permissions)
foreach ($permission in @('declarativeNetRequestWithHostAccess', 'cookies', 'storage', 'tabs', 'scripting', 'webNavigation')) {
  if ($permissions -notcontains $permission) {
    Add-ValidationError "Missing manifest permission: $permission"
  }
}
# many-tab は広い host_permissions を要求せず optional 側で取る規約
if ($manifest.host_permissions) {
  Add-ValidationError 'host_permissions must stay empty for this extension; use optional_host_permissions instead.'
}
$optionalHostPermissions = @($manifest.optional_host_permissions)
if ($optionalHostPermissions -notcontains '*://*/*') {
  Add-ValidationError 'optional_host_permissions must contain "*://*/*" for runtime per-domain grants.'
}

$requiredFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@(
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
  'README.md',
  'LICENSE',
  'PRIVACY.md',
  'CHANGELOG.md',
  'scripts/validate-extension.ps1',
  'scripts/package-webstore.ps1'
) | ForEach-Object { $requiredFiles.Add($_) | Out-Null }
$requiredFiles.Add([string]$manifest.background.service_worker) | Out-Null
$requiredFiles.Add([string]$manifest.action.default_popup) | Out-Null

$iconEntries = @{}
foreach ($property in $manifest.icons.PSObject.Properties) {
  $iconEntries[$property.Name] = [string]$property.Value
}
foreach ($property in $manifest.action.default_icon.PSObject.Properties) {
  $iconEntries[$property.Name] = [string]$property.Value
}
foreach ($iconPath in $iconEntries.Values) {
  $requiredFiles.Add($iconPath) | Out-Null
}
foreach ($file in $requiredFiles) {
  Test-RequiredFile $file
}

foreach ($entry in $iconEntries.GetEnumerator()) {
  $size = 0
  if ([int]::TryParse($entry.Key, [ref]$size)) {
    Test-PngIcon -RelativePath $entry.Value -ExpectedSize $size
  }
}

$moduleImportPattern = "(?m)^\s*import\s+(?:[\s\S]*?\s+from\s+)?['""](?<path>\./[^'""]+)['""]"
foreach ($relativePath in @('background.js', 'popup.js')) {
  $sourcePath = Join-Path $root $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
  $source = Get-Content -Raw -LiteralPath $sourcePath
  foreach ($match in [regex]::Matches($source, $moduleImportPattern)) {
    $importPath = $match.Groups['path'].Value.TrimStart('./')
    Test-RequiredFile $importPath
  }
}

$popupHtml = Get-Content -Raw -LiteralPath (Join-Path $root 'popup.html')
if ($popupHtml -match '(?is)<script(?![^>]*\bsrc=)[^>]*>') {
  Add-ValidationError 'popup.html must not contain inline scripts.'
}
if ($popupHtml -match '(?is)\son[a-z]+\s*=') {
  Add-ValidationError 'popup.html must not contain inline event handlers.'
}
if ($popupHtml -match '(?is)<(?:script|link|img|iframe|object|embed)[^>]+(?:src|href)\s*=\s*["'']https?://') {
  Add-ValidationError 'popup.html must not load remote resources.'
}
if ($popupHtml -notmatch '<script[^>]+type="module"[^>]+src="popup\.js"') {
  Add-ValidationError 'popup.html must load popup.js as a module script.'
}

$changelogPath = Join-Path $root 'CHANGELOG.md'
if (Test-Path -LiteralPath $changelogPath -PathType Leaf) {
  $changelog = Get-Content -Raw -LiteralPath $changelogPath
  $versionHeading = "## [$($manifest.version)]"
  if (-not $changelog.Contains($versionHeading) -and $changelog -notmatch '(?m)^## \[Unreleased\]') {
    Add-ValidationError "CHANGELOG.md must contain $versionHeading or an Unreleased section."
  }
}

Test-JavaScriptSyntax @('background.js', 'content-main.js', 'content-isolated.js', 'popup.js', 'lib/cookies.js', 'lib/dnr.js', 'lib/sessions.js', 'lib/logbuf.js')
Test-PowerShellSyntax @('scripts/validate-extension.ps1', 'scripts/package-webstore.ps1')

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Host "ERROR: $_" -ForegroundColor Red }
  exit 1
}

Write-Host 'Extension validation passed.'
