: << 'CMDBLOCK'
@echo off
node "%~dp0..\scripts\auto-answer.mjs"
exit /b %errorlevel%
CMDBLOCK

#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# Auto-install dependencies on first run
if [ ! -d "$PLUGIN_ROOT/scripts/node_modules" ]; then
  npm install --prefix "$PLUGIN_ROOT/scripts" --silent 2>/dev/null
fi

node "$PLUGIN_ROOT/scripts/auto-answer.mjs"
exit $?
