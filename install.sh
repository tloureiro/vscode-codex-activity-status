#!/usr/bin/env bash
set -euo pipefail

# Resolve paths from the checkout, even when invoked from another directory.
cd -- "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: ./install.sh [VS Code CLI options]

Build and install the current source, replacing an existing installation even
when package.json has the same version. Optional arguments are passed to VS Code:

  ./install.sh --profile Work

Requires Node.js 22.22+ and npm. Uses code on PATH or the standard macOS app.
Set CODEX_ACTIVITY_CODE_BIN to use a different VS Code CLI executable.
EOF
  exit 0
fi

for dependency in node npm; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    printf 'Missing %s. Install Node.js 22.22+ and npm first.\n' "$dependency" >&2
    exit 1
  fi
done

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 22)) { console.error("Node.js 22.22+ is required to build the extension."); process.exit(1); }'

activity_code_bin="${CODEX_ACTIVITY_CODE_BIN:-}"
if [[ -z "$activity_code_bin" ]]; then
  if command -v code >/dev/null 2>&1; then
    activity_code_bin="$(command -v code)"
  elif [[ -x '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' ]]; then
    activity_code_bin='/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  else
    printf 'VS Code CLI not found. Install its code command on PATH or set CODEX_ACTIVITY_CODE_BIN.\n' >&2
    exit 1
  fi
fi
if ! command -v "$activity_code_bin" >/dev/null 2>&1; then
  printf 'VS Code CLI is not executable: %s\n' "$activity_code_bin" >&2
  exit 1
fi

npm ci --include=dev
npm run check
npm run package

activity_vsix="$PWD/dist/$(node -p 'const p = require("./package.json"); `${p.name}-${p.version}.vsix`')"
if [[ ! -f "$activity_vsix" ]]; then
  printf 'Expected build artifact was not created: %s\n' "$activity_vsix" >&2
  exit 1
fi

"$activity_code_bin" --install-extension "$activity_vsix" --force "$@"

printf '\nInstalled the current source. Run Developer: Reload Window in VS Code.\n'
printf 'Follow the Set Up Activity Colors notification, or run Codex Activity: Set Up Activity Colors. It configures monitoring in your current window.\n'
