# PowerShell installation script for systemone-judge on Windows
$ErrorActionPreference = 'Stop'

$Repo = "Ridlo543/systemone-judge"
$InstallDir = Join-Path $HOME "bin"

Write-Host "=== Installing systemone (Universal Decision Runner & MCP) ===" -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$BaseUrl = "https://github.com/$Repo/releases/latest/download"
$S1CliDest = Join-Path $InstallDir "systemone.exe"
$S1McpDest = Join-Path $InstallDir "systemone-mcp.exe"

Write-Host "Downloading systemone-windows-x64.exe -> $S1CliDest..."
Invoke-WebRequest -Uri "$BaseUrl/systemone-windows-x64.exe" -OutFile $S1CliDest -UseBasicParsing

Write-Host "Downloading systemone-mcp-windows-x64.exe -> $S1McpDest..."
Invoke-WebRequest -Uri "$BaseUrl/systemone-mcp-windows-x64.exe" -OutFile $S1McpDest -UseBasicParsing
# Create short alias 's1.exe' and backward-compatible 'jev.exe'
Copy-Item -Path $S1CliDest -Destination (Join-Path $InstallDir "s1.exe") -Force
Copy-Item -Path $S1CliDest -Destination (Join-Path $InstallDir "jev.exe") -Force
Copy-Item -Path $S1McpDest -Destination (Join-Path $InstallDir "s1-mcp.exe") -Force
Copy-Item -Path $S1McpDest -Destination (Join-Path $InstallDir "jev-mcp.exe") -Force

# Check user PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host "Adding $InstallDir to User PATH..." -ForegroundColor Yellow
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir"
}

Write-Host "`nSuccessfully installed systemone, s1, and jev to $InstallDir!" -ForegroundColor Green
Write-Host "Test your installation:"
Write-Host "  systemone --help"
Write-Host "  s1 --help"
Write-Host "  systemone setup"
