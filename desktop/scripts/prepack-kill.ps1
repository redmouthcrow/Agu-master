param(
  [Parameter(Mandatory = $true)]
  [string]$DesktopRoot
)

$ErrorActionPreference = 'SilentlyContinue'

function Normalize-Path([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }
  return $Value.ToLowerInvariant().Replace('/', '\')
}

$desktop = Normalize-Path $DesktopRoot
$release = Normalize-Path (Join-Path $DesktopRoot 'release')
$staging = Normalize-Path (Join-Path $DesktopRoot 'release\staging')

function Close-ExplorerWindowsUnder([string]$Needle) {
  if ([string]::IsNullOrWhiteSpace($Needle)) {
    return
  }

  $shell = New-Object -ComObject Shell.Application
  foreach ($win in @($shell.Windows())) {
    try {
      $loc = Normalize-Path $win.Document.Folder.Self.Path
      if ($loc -and ($loc -like "*$Needle*")) {
        $win.Quit()
        Write-Host "[prepack] closed Explorer window: $($win.Document.Folder.Self.Path)"
      }
    } catch {
      # ignore non-folder windows
    }
  }
}

Close-ExplorerWindowsUnder $release
Close-ExplorerWindowsUnder $staging

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $name = $_.Name
  $path = Normalize-Path $_.ExecutablePath
  $cmd = Normalize-Path $_.CommandLine

  $isAgu = ($name -eq 'AguMaster.exe')
  $isProjectElectron = ($name -eq 'electron.exe') -and (
    ($path -like "*$desktop*") -or ($cmd -like "*$desktop*")
  )
  $isReleaseElectron = ($name -eq 'electron.exe') -and (
    ($path -like "*$release*") -or ($cmd -like "*$release*") -or
    ($path -like "*$staging*") -or ($cmd -like "*$staging*")
  )

  if ($isAgu -or $isProjectElectron -or $isReleaseElectron) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[prepack] stopped $name pid=$($_.ProcessId)"
  }
}

# NSIS / electron-builder helper processes tied to this project
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $name = $_.Name
  if ($name -ne 'makensis.exe' -and $name -ne '7za.exe') {
    return
  }
  $cmd = Normalize-Path $_.CommandLine
  if ($cmd -like "*$desktop*") {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[prepack] stopped leftover $name pid=$($_.ProcessId)"
  }
}
