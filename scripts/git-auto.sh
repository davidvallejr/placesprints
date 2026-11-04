#!/bin/zsh
# Commit diário automático do Place Sprints e envio ao GitHub — SÓ com a suíte verde («Neo aprende sobre si», 04/11: CI de casa).
# .env, data/, anexos e segredos já ficam de fora pelo .gitignore. Suíte vermelha: não comita, não envia; 1 linha no log e 1 aviso no sino (dedupe 12 h).
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
git add -A
if git diff --cached --quiet; then exit 0; fi
if ! node scripts/testar.mjs > data/testes-ultima.log 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M') suíte vermelha — commit e push NÃO feitos (veja data/testes-ultima.log)"
  node -e "import('./src/lib/notificacoes.js').then(m => m.notificar({ tipo: 'testes_vermelhos', nivel: 'erro', sistema: 'arquiteto', titulo: 'Suíte de testes vermelha: commit automático segurado', corpo: 'Veja data/testes-ultima.log. O código só vai ao GitHub com a suíte verde.', link: '/integracoes', dedupeMin: 720 }))" || true
  git reset -q
  exit 0
fi
git commit -q -m "auto: $(date '+%Y-%m-%d %H:%M')"
git push -q origin main
