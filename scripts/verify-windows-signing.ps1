param([Parameter(Mandatory=$true)][string]$AppDirectory, [Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if (-not $env:WINDOWS_PUBLISHER_NAME) { throw 'WINDOWS_PUBLISHER_NAME is required' }
foreach ($file in @((Join-Path $AppDirectory 'Astronomer-Lite.exe'), (Join-Path $AppDirectory 'resources/server/astronomer-lite.exe'), $Installer)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $file ($($signature.Status))" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -ne $env:WINDOWS_PUBLISHER_NAME) { throw "Unexpected signing publisher: $publisher" }
    if (-not $signature.TimeStamperCertificate) { throw "Missing timestamp: $file" }
    Write-Output "Verified publisher and timestamp: $file"
}
