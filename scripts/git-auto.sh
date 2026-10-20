#!/bin/zsh
# Commit diário automático do Place Sprints e envio ao GitHub.
# .env, data/, anexos e segredos já ficam de fora pelo .gitignore.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
git add -A
if git diff --cached --quiet; then exit 0; fi
git commit -q -m "auto: $(date '+%Y-%m-%d %H:%M')"
git push -q origin main
