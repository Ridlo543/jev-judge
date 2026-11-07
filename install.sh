#!/usr/bin/env bash
set -euo pipefail

REPO="Ridlo543/jev-judge"
INSTALL_DIR="${HOME}/.local/bin"

echo "=== Installing jev-judge (Universal Decision Runner & MCP) ==="

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)
    case "$ARCH" in
      x86_64|amd64)
        CLI_ASSET="jev-linux-x64"
        MCP_ASSET="jev-mcp-linux-x64"
        ;;
      aarch64|arm64)
        CLI_ASSET="jev-linux-arm64"
        MCP_ASSET="jev-mcp-linux-arm64"
        ;;
      *)
        echo "Error: Unsupported Linux architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  darwin)
    case "$ARCH" in
      arm64|aarch64)
        CLI_ASSET="jev-darwin-arm64"
        MCP_ASSET="jev-mcp-darwin-arm64"
        ;;
      *)
        echo "Error: Intel macOS (x86_64) is not currently precompiled. Use 'npx -y github:Ridlo543/jev-judge'." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Error: Unsupported OS: $OS. For Windows, run install.ps1 via PowerShell." >&2
    exit 1
    ;;
esac

mkdir -p "$INSTALL_DIR"

BASE_URL="https://github.com/${REPO}/releases/latest/download"

echo "Downloading ${CLI_ASSET} -> ${INSTALL_DIR}/jev..."
curl -fsSL "${BASE_URL}/${CLI_ASSET}" -o "${INSTALL_DIR}/jev"
chmod +x "${INSTALL_DIR}/jev"

echo "Downloading ${MCP_ASSET} -> ${INSTALL_DIR}/jev-mcp..."
curl -fsSL "${BASE_URL}/${MCP_ASSET}" -o "${INSTALL_DIR}/jev-mcp"
chmod +x "${INSTALL_DIR}/jev-mcp"

echo ""
echo "Successfully installed jev and jev-mcp into ${INSTALL_DIR}!"

# Check if INSTALL_DIR is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "Notice: ${INSTALL_DIR} is not in your current PATH."
  echo "Add it to your shell config (~/.bashrc, ~/.zshrc, or ~/.profile):"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "Test the installation:"
echo "  jev --help"
echo "  jev setup"
