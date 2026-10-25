[CmdletBinding()]
param(
  [switch]$Uninstall,
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$pkgPath = Join-Path $ProfileDir 'package.json'
$lockPath = Join-Path $ProfileDir 'pnpm-lock.yaml'
$workspacePath = Join-Path $ProfileDir 'pnpm-workspace.yaml'
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$nodeModulesPath = Join-Path $ProfileDir 'node_modules\dsh-gbc-theme'
$vendorDir = Join-Path $ProfileDir 'vendor'
$sourceTarball = Get-ChildItem -LiteralPath (Join-Path $here 'dist') -Filter 'dsh-gbc-theme-*.tgz' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $sourceTarball) { throw "No dsh-gbc-theme-*.tgz found in $here\dist" }
$tarballName = Split-Path -Leaf $sourceTarball.FullName
$vendorTarball = Join-Path $vendorDir $tarballName
$bundleName = 'dsh-gbc-theme'

if (-not (Test-Path -LiteralPath $pkgPath)) {
  throw "DSH desktop profile not found: $pkgPath"
}

$nodeCandidates = @(
  (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
  'node.exe'
)
$node = $nodeCandidates | Where-Object { $_ -eq 'node.exe' -or (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $node) { throw 'node.exe not found' }

$pnpmCandidates = @(
  (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'),
  (Join-Path (Split-Path -Parent (Split-Path -Parent $node)) 'pnpm\bin\pnpm.mjs')
)
$pnpm = $pnpmCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pnpm) { throw 'pnpm.mjs not found' }

function Read-JsonFile([string]$path) {
  return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Write-JsonFile([string]$path, $object) {
  $json = $object | ConvertTo-Json -Depth 20
  # BOM-less UTF-8: DSH reads the profile manifest with JSON.parse.
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Set-Bundle([bool]$enabled) {
  $pkg = Read-JsonFile $pkgPath
  $bundles = @($pkg.dsh.profile.bundles)
  if ($enabled) {
    if ($bundles -notcontains $bundleName) { $bundles += $bundleName }
  } else {
    $bundles = @($bundles | Where-Object { $_ -ne $bundleName })
  }
  $pkg.dsh.profile.bundles = $bundles
  Write-JsonFile $pkgPath $pkg
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $ProfileDir ".gbc-theme-backup-$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $pkgPath -Destination (Join-Path $backup 'package.json')
Copy-Item -LiteralPath $lockPath -Destination (Join-Path $backup 'pnpm-lock.yaml')
if (Test-Path -LiteralPath $workspacePath) {
  Copy-Item -LiteralPath $workspacePath -Destination (Join-Path $backup 'pnpm-workspace.yaml')
}
if (Test-Path -LiteralPath $patchPath) {
  Copy-Item -LiteralPath $patchPath -Destination (Join-Path $backup 'cordis.patch.yml')
}
Write-Host "Backup: $backup"

$previousLocation = Get-Location
try {
  Push-Location -LiteralPath $ProfileDir

  if ($Uninstall) {
    Write-Host 'Removing dsh-gbc-theme from the bundle list...'
    Set-Bundle $false
    Write-Host 'Running pnpm remove...'
    $output = & $node $pnpm remove $bundleName --offline --ignore-scripts 2>&1
    $code = $LASTEXITCODE
    $output | Set-Content -LiteralPath (Join-Path $backup 'pnpm-remove.log') -Encoding UTF8
    if ($code -ne 0) {
      Write-Warning "pnpm remove exited $code. The bundle is already disabled; you can delete node_modules\dsh-gbc-theme manually."
    }
    if (Test-Path -LiteralPath $vendorDir) {
      Get-ChildItem -LiteralPath $vendorDir -Filter 'dsh-gbc-theme-*.tgz' -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    }
    if (Test-Path -LiteralPath $nodeModulesPath) { Remove-Item -LiteralPath $nodeModulesPath -Recurse -Force }
    Write-Host 'Uninstalled. Restart DSH to return to the stock shell.'
    return
  }

  if (-not (Test-Path -LiteralPath $sourceTarball.FullName)) {
    throw "Tarball not found: $($sourceTarball.FullName)"
  }
  if (-not (Test-Path -LiteralPath $vendorDir)) { New-Item -ItemType Directory -Path $vendorDir | Out-Null }
  Copy-Item -LiteralPath $sourceTarball.FullName -Destination $vendorTarball -Force

  Write-Host 'Running pnpm add (offline, ignore-scripts)...'
  $output = & $node $pnpm add "file:vendor/$tarballName" --save-exact --offline --ignore-scripts 2>&1
  $code = $LASTEXITCODE
  $output | Set-Content -LiteralPath (Join-Path $backup 'pnpm-add.log') -Encoding UTF8
  if ($code -ne 0) {
    throw "pnpm add failed with exit code $code. See $backup\pnpm-add.log"
  }

  Write-Host 'Enabling bundle in dsh.profile.bundles...'
  Set-Bundle $true

  $pkg = Read-JsonFile $pkgPath
  if (@($pkg.dsh.profile.bundles) -notcontains $bundleName) {
    throw 'Bundle was not added to package.json'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $nodeModulesPath 'lib\client.js'))) {
    throw 'Installed client bundle is missing'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $nodeModulesPath 'package.json'))) {
    throw 'Installed package.json is missing'
  }

  $check = & $node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const b=p.dsh&&p.dsh.profile&&p.dsh.profile.bundles; if(!Array.isArray(b)||!b.includes('dsh-gbc-theme')) process.exit(2); console.log('bundle ok');" $pkgPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Profile manifest validation failed: $check" }

  # Keep only the tarball this install actually points at.
  Get-ChildItem -LiteralPath $vendorDir -Filter 'dsh-gbc-theme-*.tgz' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $tarballName } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

  Write-Host ''
  Write-Host 'Installed dsh-gbc-theme.' -ForegroundColor Green
  Write-Host 'Fully quit DSH (including the tray icon) and start it again.'
  Write-Host 'After restart, look for the small GBC chip at the bottom-right of the chat.'
  Write-Host "Rollback backup: $backup"
} catch {
  Write-Warning "Install failed: $($_.Exception.Message)"
  Write-Host 'Restoring package.json and pnpm-lock.yaml...'
  Copy-Item -LiteralPath (Join-Path $backup 'package.json') -Destination $pkgPath -Force
  Copy-Item -LiteralPath (Join-Path $backup 'pnpm-lock.yaml') -Destination $lockPath -Force
  if (Test-Path -LiteralPath $nodeModulesPath) { Remove-Item -LiteralPath $nodeModulesPath -Recurse -Force }
  if (Test-Path -LiteralPath $vendorTarball) { Remove-Item -LiteralPath $vendorTarball -Force }
  throw
} finally {
  Pop-Location
}
