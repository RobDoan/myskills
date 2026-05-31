#!/usr/bin/env bash
# Spawns three tagged Gemini agents on hcom — one per brainstorming persona.
# Each agent has a dedicated system prompt (from prompts/gemini-*.md) and is
# addressable via @<tag>- (e.g., @user-stand-in-).
#
# Usage:
#   ./setup-gemini-agents.sh                # spawn all three in background (headless)
#   ./setup-gemini-agents.sh --interactive  # open terminal windows instead
#   ./setup-gemini-agents.sh --model gemini-2.5-flash
#
# Safe to re-run: hcom launches fresh agents each call. Stop old ones manually
# with `hcom kill tag:user-stand-in` etc. if you want to avoid accumulation.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPTS_DIR="$PLUGIN_ROOT/prompts"

mode="--headless"
extra_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--interactive) mode=""; shift ;;
    -h|--help)
      sed -n '3,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) extra_args+=("$1"); shift ;;
  esac
done

if ! command -v hcom >/dev/null 2>&1; then
  echo "Error: hcom CLI not found on PATH." >&2
  exit 1
fi

spawn_agent() {
  local tag="$1"
  local prompt_file="$2"
  if [[ ! -f "$prompt_file" ]]; then
    echo "Error: prompt file missing: $prompt_file" >&2
    exit 1
  fi
  local sys_prompt
  sys_prompt="$(cat "$prompt_file")"
  echo "Launching Gemini agent: tag=$tag  prompt=$prompt_file"
  # shellcheck disable=SC2086
  hcom 1 gemini \
    --tag "$tag" \
    --go \
    --hcom-system-prompt "$sys_prompt" \
    ${mode} \
    "${extra_args[@]}" \
    >/tmp/hcom-spawn-"$tag".log 2>&1 &
  sleep 2
}

spawn_agent "user-stand-in" "$PROMPTS_DIR/gemini-user.md"
spawn_agent "critic"        "$PROMPTS_DIR/gemini-critic.md"
spawn_agent "spec-reviewer" "$PROMPTS_DIR/gemini-spec-reviewer.md"

echo
echo "Waiting 5s for agents to settle..."
sleep 5
echo
echo "Current hcom agents:"
hcom list 2>&1 | grep -E 'user-stand-in|critic|spec-reviewer' || echo "(none found — check /tmp/hcom-spawn-*.log for errors)"
