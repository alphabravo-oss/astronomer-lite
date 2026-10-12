param([Parameter(Mandatory=$true)][string]$Installer, [switch]$RequireWindows11)
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
if ($RequireWindows11 -and ($os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000)) { throw 'A Windows 11 workstation is required' }
$installation = Join-Path ([System.IO.Path]::GetTempPath()) ('Astronomer Lite-' + [guid]::NewGuid().ToString())
try {
    $process = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList "/S /D=$installation" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "NSIS install failed: $($process.ExitCode)" }
    $env:LITE_DESKTOP_EXECUTABLE = Join-Path $installation 'Astronomer Lite.exe'
    Push-Location (Join-Path $PSScriptRoot '../web')
    try {
        & ./node_modules/.bin/playwright.cmd test --config playwright.desktop.config.ts --reporter=line,json
        if ($LASTEXITCODE -ne 0) { throw 'Packaged desktop test failed' }
    } finally { Pop-Location }
} finally {
    $uninstaller = Join-Path $installation 'Uninstall Astronomer Lite.exe'
    if (Test-Path $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "NSIS uninstall failed: $($process.ExitCode)" }
        # NSIS uninstaller may delegate to a temporary process before exiting.
        for ($i = 0; $i -lt 30 -and (Test-Path $env:LITE_DESKTOP_EXECUTABLE); $i++) { Start-Sleep -Seconds 1 }
        if (Test-Path $env:LITE_DESKTOP_EXECUTABLE) { throw 'Uninstall left the application executable behind' }
    }
}
Write-Output "Install/launch/uninstall passed: $($os.Caption) build $($os.BuildNumber)"
