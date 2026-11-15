# Dashboard Washington

Sistema de gestão comercial (pedidos, produção, entregas, financeiro e metas) que roda
inteiro dentro do navegador. **Nenhum dado sai do computador do usuário**: as planilhas
importadas e todos os registros ficam no IndexedDB do próprio navegador. Este repositório
guarda apenas o código do sistema.

Desenvolvido por **@GabrielCreates**. Uso permitido somente com autorização do desenvolvedor.

---

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `index.html` | O sistema inteiro: código, estilos e fontes em um arquivo só |
| `sw.js` | Faz o sistema funcionar offline e avisar quando há versão nova |
| `manifest.webmanifest` | Permite instalar como aplicativo no celular e no computador |
| `icon-192.png`, `icon-512.png` | Ícones do aplicativo |
| `.nojekyll` | Impede o GitHub de processar os arquivos (obrigatório, não apague) |

**Os cinco arquivos precisam estar juntos, na mesma pasta.** Mandar só o `index.html`
faz o sistema funcionar, mas sem atualização automática e sem instalação.

---

## Publicar pela primeira vez (GitHub Pages)

Tudo pelo site do GitHub, sem instalar nada no computador.

1. Entre em <https://github.com/new>.
   - **Repository name:** `dashboard-washington`
   - Marque **Public** (no plano gratuito o Pages só funciona em repositório público —
     o *código* fica visível, os *dados* dos usuários não, porque nunca saem do navegador deles).
   - Clique em **Create repository**.

2. Na tela seguinte, clique em **uploading an existing file**.

3. Arraste os **cinco arquivos** desta pasta para a área de upload.
   Se o `.nojekyll` não aparecer ao arrastar, ative "mostrar arquivos ocultos" no seu
   gerenciador de arquivos, ou crie-o depois em **Add file → Create new file**, com o
   nome `.nojekyll` e conteúdo vazio.

4. Escreva em **Commit changes**: `versão 1.0.0` e clique em **Commit changes**.

5. Vá em **Settings → Pages** (menu da esquerda).
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` e pasta `/ (root)` → **Save**.

6. Espere 1 a 2 minutos e recarregue a página. Vai aparecer o endereço:

   ```
   https://dev01gabrielcreates.github.io/dashboard-washington/
   ```

   **Esse endereço é o sistema.** Mande esse link para as duas pessoas — e nunca mais
   mande arquivo.

---

## Publicar uma atualização (o dia a dia)

Toda vez que o sistema mudar:

1. Abra `VERSION` no projeto e troque o número (`1.0.0` → `1.0.1`).
   O número **tem que mudar**, senão o navegador dos usuários não percebe a atualização.
2. Rode `python3 build.py`.
3. No repositório do GitHub: **Add file → Upload files**, arraste `index.html` e `sw.js`
   da pasta `dist/site`, escreva a mensagem (`versão 1.0.1`) e confirme.

Pronto. Na próxima vez que cada usuário abrir o sistema — ou quando voltar para a aba —
aparece o aviso **"Nova versão disponível"** com o botão **Atualizar agora**. Os dados
deles continuam intactos: a atualização troca só o código.

Quem quiser conferir a versão clica no número no rodapé do menu lateral (`v1.0.1`);
o clique também força a busca por atualização.

---

## Para os usuários

Mande este texto para as duas pessoas:

> O sistema agora fica neste endereço: **(cole o link)**
>
> 1. Abra no Chrome ou no Edge e salve nos favoritos.
> 2. No computador, clique no ícone de instalar na barra de endereço (ou menu ⋮ →
>    *Instalar Dashboard Washington*) para ele virar um aplicativo com ícone próprio.
>    No celular: menu do navegador → *Adicionar à tela de início*.
> 3. Depois da primeira abertura ele funciona **sem internet**.
> 4. Quando eu publicar melhorias, aparece um aviso "Nova versão disponível". É só clicar
>    em *Atualizar agora*.
>
> Seus dados ficam só no seu navegador. Faça backup de vez em quando pelo menu
> **Administração → Backup**.

---

## Migrando os dados que já existem

O navegador trata o arquivo aberto do computador (`file://`) e o endereço na internet
(`https://`) como dois lugares diferentes. Os dados **não passam sozinhos** de um para o
outro. Faça uma vez:

1. Abra o `index.html` antigo, vá em **Administração → Backup** e clique em **Exportar backup**.
2. Abra o endereço novo.
3. **Administração → Backup → Restaurar backup** e escolha o arquivo exportado.

Cada usuário faz isso na própria máquina. Depois disso, nunca mais.

---

## Alternativa: acesso restrito (Cloudflare Pages)

Se preferir que **só e-mails autorizados** consigam abrir o sistema:

1. Crie conta grátis em <https://dash.cloudflare.com>.
2. **Workers & Pages → Create → Pages → Upload assets**, dê o nome do projeto e arraste
   os cinco arquivos.
3. Depois, em **Zero Trust → Access → Applications → Add an application → Self-hosted**,
   aponte para o endereço do projeto e, na política, escolha **Emails** e liste os e-mails
   das duas pessoas e o seu.

A partir daí, quem abrir o link precisa informar o e-mail e receber um código de acesso.
As atualizações funcionam igual: sobe os arquivos novos, os usuários veem o aviso.

---

## Perguntas rápidas

**Os dados vão para o GitHub?**
Não. O repositório guarda só o código. Pedidos, planilhas, NFs e metas ficam no navegador
de cada usuário e não são enviados a lugar nenhum.

**Cada um vê os dados do outro?**
Não. Cada navegador tem a própria base. Se o objetivo for uma base compartilhada entre as
três pessoas, isso exige um banco de dados num servidor — é outro projeto, e deixaria de
ser offline.

**Continua funcionando abrindo o arquivo direto, sem internet?**
Sim. O `index.html` sozinho funciona como sempre funcionou; só não recebe atualização
automática (o rodapé mostra "arquivo local").

**Esqueci de trocar o número da versão.**
Os usuários continuam na versão antiga e não recebem aviso. Troque o número em `VERSION`,
gere de novo e suba — aí o aviso aparece.
