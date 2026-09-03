param(
    [string]$BaseUrl = "http://localhost:5173",
    [string]$CitiesPath = (Join-Path $PSScriptRoot "FAULT_LINES_2014_CITIES_RECOVERED.geojson")
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $CitiesPath)) { throw "Cities file not found: $CitiesPath" }

$uri = "$($BaseUrl.TrimEnd('/'))/api/runtime/json/citiesGeojson"
Write-Host "Repairing the ACTIVE scenario's cities.geojson..."
Invoke-RestMethod -Uri $uri -Method Put -ContentType "application/json" -InFile $CitiesPath | Out-Null

$check = Invoke-RestMethod -Uri $uri -Method Get
$count = @($check.features).Count
Write-Host "Verified active cities.geojson feature count: $count"
if ($count -ne 2527) { throw "Expected 2527 Fault Lines cities, got $count." }

Write-Host "Success. Refresh the game page."
