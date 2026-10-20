# Pôr o `sprint90.place2u.com.br` no túnel — passo a passo para o David

O túnel nomeado `place-sprints` já roda neste Mac como LaunchAgent `com.place2u.cloudflared` (log em `/tmp/cloudflared-place-sprints.log`) e já serve `meli.place2u.com.br` e `diagnosticomeli.place2u.com.br`, os dois para `http://127.0.0.1:3012`. O Sprint 90 entra no **mesmo túnel e no mesmo servidor**: só muda o hostname. Quem decide o que o host novo alcança é a guarda do servidor (lista fechada por host exato, `ROTA_PUBLICA_S90` em `src/lib/guarda-local.js`), não o túnel.

O `cloudflared` deste Mac fica em `~/.local/bin/cloudflared`.

## 1. Cópia de segurança da configuração

```sh
cp ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak-$(date +%Y%m%d-%H%M%S)
```

## 2. Ingress: o host novo ANTES do catch-all

Edite `~/.cloudflared/config.yml` e acrescente as duas linhas do `sprint90` logo antes de `- service: http_status:404`. As linhas `tunnel:` e `credentials-file:` do topo não mudam. O bloco `ingress` fica assim:

```yaml
ingress:
  - hostname: meli.place2u.com.br
    service: http://127.0.0.1:3012
  - hostname: diagnosticomeli.place2u.com.br
    service: http://127.0.0.1:3012
  - hostname: sprint90.place2u.com.br
    service: http://127.0.0.1:3012
  - service: http_status:404
```

A regra de catch-all (`http_status:404`) precisa continuar sendo a última: regra depois dela nunca é avaliada.

Confira antes de reiniciar:

```sh
~/.local/bin/cloudflared tunnel ingress validate
~/.local/bin/cloudflared tunnel ingress rule https://sprint90.place2u.com.br
```

O segundo comando precisa apontar a regra do `sprint90` (não a 404).

## 3. DNS

```sh
~/.local/bin/cloudflared tunnel route dns place-sprints sprint90.place2u.com.br
```

Cria o CNAME do `sprint90` apontando para o túnel (mesmo comando usado no `diagnosticomeli` em 05/10).

## 4. Reiniciar o cloudflared

```sh
launchctl kickstart -k gui/$(id -u)/com.place2u.cloudflared
tail -n 30 /tmp/cloudflared-place-sprints.log
```

No log, procure as linhas `Registered tunnel connection` e nenhum erro de ingress.

## 5. `.env` do place-sprints

Acrescente em `~/place-sprints/.env`, numa linha só e **sem comentário na mesma linha** (o leitor do `.env` trata o resto da linha como valor: `host   # comentário` vira o host e a guarda devolve 403 para tudo):

```
SPRINT90_PUBLIC_HOST=sprint90.place2u.com.br
```

Sem essa linha, nada do Sprint 90 existe para o túnel (a guarda recusa). Tirar do ar = apagar a linha e reiniciar o servidor.

## 6. Reiniciar o servidor pelo fluxo combinado

O `.env` só é lido quando o servidor sobe.

- **Se o LaunchAgent do servidor já foi instalado** (`automacao/com.place2u.place-sprints.servidor.plist`):
  ```sh
  launchctl kickstart -k gui/$(id -u)/com.place2u.place-sprints.servidor
  ```
- **Se ainda roda por `nohup`** (situação de 08/10/2026): pare o processo atual e suba de novo como antes.
  ```sh
  lsof -nP -iTCP:3012 -sTCP:LISTEN          # anote o PID
  kill PID
  while lsof -nP -iTCP:3012 -sTCP:LISTEN >/dev/null; do sleep 1; done
  cd ~/place-sprints && nohup /bin/zsh scripts/dev.sh >> data/server.log 2>&1 &
  ```
  Melhor ainda: aproveite esta janela para migrar para o LaunchAgent (passo a passo no comentário do topo do plist). Nunca deixe os dois rodando: disputam a porta 3012.

## 7. Verificar

Pela internet (de preferência do celular fora do Wi-Fi, ou `curl` de outra rede):

| Teste | Esperado |
|---|---|
| `dig +short sprint90.place2u.com.br` | IPs da Cloudflare |
| `curl -s -o /dev/null -w "%{http_code}\n" https://sprint90.place2u.com.br/` | `200` com a F1 no ar (landing). Antes da F1: `403` — também prova que o túnel chega ao servidor |
| `https://sprint90.place2u.com.br/c/termos` | `200` (F1) |
| `https://sprint90.place2u.com.br/cliente` e `/api/estado` | `403` (o painel interno nunca passa por este host) |
| `https://meli.place2u.com.br/c/painel` | `403` (o painel do Sprint 90 só existe no host exato) |
| `https://diagnosticomeli.place2u.com.br/diagnostico` | `200` (nada mudou no comercial) |
| `tail -n 30 ~/place-sprints/data/server.log` | servidor de pé, sem erro na subida |

## 8. Depois (F3)

O webhook do Mercado Pago (credenciais de **teste**) aponta para `https://sprint90.place2u.com.br/webhook/mp`. Só configure no painel do MP quando a F3 estiver no ar e o LaunchAgent do servidor instalado: webhook perdido com o servidor fora do ar = pagamento recebido sem ativação.

## Desfazer

1. Apagar `SPRINT90_PUBLIC_HOST` do `.env` e reiniciar o servidor (passo 6): tudo do Sprint 90 some na hora.
2. Opcional: tirar as duas linhas do ingress, `cloudflared tunnel ingress validate`, reiniciar o cloudflared (passo 4) e apagar o CNAME `sprint90` no painel DNS da Cloudflare (o `route dns` não apaga).
