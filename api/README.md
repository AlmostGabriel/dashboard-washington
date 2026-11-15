# API do Dashboard Washington

Worker que fica na frente do banco D1 compartilhado. Toda escrita passa por
aqui, é atribuída a uma pessoa e deixa registro no histórico.

## Criar o banco

No painel da Cloudflare: **Storage & Databases → D1 → Create database**,
nome `dashboard-washington`. Copie o **Database ID** e cole em
`wrangler.jsonc`, no lugar de `PREENCHER_APOS_CRIAR_O_BANCO`.

Depois, na aba **Console** do banco, cole e execute o conteúdo de
`schema.sql`.

## Segredo

O Worker precisa de uma variável secreta `PIMENTA`, usada para embaralhar os
códigos de convite. Defina em **Settings → Variables and Secrets → Add →
Secret**, com o nome `PIMENTA`.

## Rotas

| Método | Rota | Quem pode |
|---|---|---|
| POST | `/acesso/entrar` | qualquer um |
| POST | `/acesso/criar` | quem tem código de convite |
| POST | `/acesso/redefinir` | quem tem código do próprio cargo |
| GET | `/acesso/eu` | conectado |
| POST | `/acesso/sair` | conectado |
| GET | `/dados?desde=<ms>` | conectado |
| POST | `/registros` | conectado |
| DELETE | `/registros/:id` | dev, gestor |
| GET | `/lixeira` | conectado |
| POST | `/lixeira/restaurar/:id` | dev, gestor |
| GET | `/historico` | conectado |
| POST | `/ajustes/:chave` | dev, gestor |
| GET | `/usuarios` | dev |
| PATCH | `/usuarios/:id` | dev |

## Princípios

- Nada é apagado: remover grava `removido_em` e manda para a lixeira.
- Toda alteração entra em `historico`, com quem, quando, antes e depois.
- Senha nunca é guardada: só a derivação PBKDF2 com sal por conta.
- Login trava por 15 minutos após 8 tentativas erradas no mesmo e-mail.
