# PowerShell installation script for jev-judge on Windows
$ErrorActionPreference = 'Stop'

$Repo = "Ridlo543/jev-judge"
$InstallDir = Join-Path $HOME "bin"

Write-Host "=== Installing jev-judge (Universal Decision Runner & MCP) ===" -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$BaseUrl = "https://github.com/$Repo/releases/latest/download"
$CliDest = Join-Path $InstallDir "jev.exe"
$McpDest = Join-Path $InstallDir "jev-mcp.exe"

Write-Host "Downloading jev-windows-x64.exe -> $CliDest..."
Invoke-WebRequest -Uri "$BaseUrl/jev-windows-x64.exe" -OutFile $CliDest -UseBasicParsing

Write-Host "Downloading jev-mcp-windows-x64.exe -> $McpDest..."
Invoke-WebRequest -Uri "$BaseUrl/jev-mcp-windows-x64.exe" -OutFile $McpDest -UseBasicParsing

# Check user PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host "Adding $InstallDir to User PATH..." -ForegroundColor Yellow
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir"
}

Write-Host "`nSuccessfully installed jev and jev-mcp to $InstallDir!" -ForegroundColor Green
Write-Host "Test your installation:"
Write-Host "  jev --help"
Write-Host "  jev setup"
