# Open Historia: checks the files about to be sent to SignPath carry the
# metadata SignPath Foundation requires (docs/code-signing.md): product name
# "Open Historia" and the build's own product version, the same in every file.
# .signpath/artifact-configuration.xml enforces the same on SignPath's side;
# this fails the run before a signing request waits for an approval.
#
#   ./scripts/check-signing-metadata.ps1 -Version 0.0.412 -Path release/win-unpacked -Include '*.exe' [-Unpacked]
#
# -Unpacked also checks the programs and native modules under
# resources/app.asar.unpacked (the system speech program), as the app's
# signing request sends them.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$Include,
  [switch]$Unpacked
)

$ProductName = 'Open Historia'
$files = @(Get-ChildItem -Path $Path -Filter $Include -File)
if ($Unpacked) {
  $extra = Join-Path $Path 'resources/app.asar.unpacked'
  if (Test-Path $extra) {
    $files += @(Get-ChildItem -Path $extra -Recurse -File -Include *.exe, *.node)
  }
}
if ($files.Count -eq 0) { Write-Error "No files matching $Include under $Path"; exit 1 }

$bad = 0
foreach ($file in $files) {
  $info = $file.VersionInfo
  $name = "$($info.ProductName)".Trim()
  $productVersion = "$($info.ProductVersion)".Trim()
  $ok = ($name -eq $ProductName) -and ($productVersion -eq $Version)
  Write-Host ("{0}  product '{1}' {2}  {3}" -f ($(if ($ok) { 'OK ' } else { 'BAD' })), $name, $productVersion, $file.FullName)
  if (-not $ok) { $bad += 1 }
}
if ($bad -gt 0) {
  Write-Error "$bad file(s) do not say product '$ProductName' version $Version"
  exit 1
}
