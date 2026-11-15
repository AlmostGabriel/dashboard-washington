/* Testes da API: acesso, cargos, gravação, lixeira e histórico. */
import { readFileSync } from 'node:fs';
import { criarD1 } from './d1-falso.mjs';
import worker from '../src/index.js';

const DB = criarD1();
DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const env = { DB, PIMENTA: 'pimenta-de-teste' };

const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (t) => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));

/* convites de teste */
for (const [codigo, nome, cargo, max] of [
  ['WASH-DEV-4827', 'Desenvolvedor', 'dev', null],
  ['WASH-GESTOR-9153', 'Gestor 1', 'gestor', 1],
  ['WASH-OPER-6240', 'Operador', 'operador', null],
]) {
  DB.prepare(`INSERT INTO convites (codigo_hash,nome,cargo,max_usos,ativo,criado_em) VALUES (?,?,?,?,1,?)`)
    .bind(await sha(codigo + env.PIMENTA), nome, cargo, max, Date.now())._exec();
}

const ORIGEM = 'https://dashboard-washington.pages.dev';
const chamar = (metodo, rota, corpo, token) => worker.fetch(new Request('https://api.local' + rota, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', Origin: ORIGEM, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: corpo ? JSON.stringify(corpo) : undefined,
}), env);

let ok = 0, falhou = 0;
const T = async (nome, fn) => { try { await fn(); console.log('  ok  ', nome); ok++; } catch (e) { console.log('  FALHOU', nome, '→', e.message); falhou++; } };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

console.log('\n== acesso ==');
let dev, gestor, oper;

await T('cria conta de dev com código válido', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'wash-dev-4827', nome: 'Gabriel', email: 'G@Teste.com', apelido: 'Gabriel', senha: 'senha123' });
  igual(r.status, 201); dev = (await r.json());
  igual(dev.usuario.cargo, 'dev'); igual(dev.usuario.email, 'g@teste.com', 'e-mail normalizado:');
});
await T('recusa código inválido', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'NAO-EXISTE', nome: 'X', email: 'x@t.com', senha: 'senha123' });
  igual(r.status, 400);
});
await T('recusa e-mail repetido', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'WASH-DEV-4827', nome: 'Outro', email: 'g@teste.com', senha: 'senha123' });
  igual(r.status, 400);
});
await T('recusa senha curta', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'WASH-DEV-4827', nome: 'X', email: 'curta@t.com', senha: '123' });
  igual(r.status, 400);
});
await T('cria gestor e operador', async () => {
  gestor = await (await chamar('POST', '/acesso/criar', { codigo: 'WASH-GESTOR-9153', nome: 'Maria', email: 'm@t.com', senha: 'senha123' })).json();
  oper = await (await chamar('POST', '/acesso/criar', { codigo: 'WASH-OPER-6240', nome: 'Joao', email: 'j@t.com', senha: 'senha123' })).json();
  igual(gestor.usuario.cargo, 'gestor'); igual(oper.usuario.cargo, 'operador');
});
await T('convite de uso único esgota', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'WASH-GESTOR-9153', nome: 'Z', email: 'z@t.com', senha: 'senha123' });
  igual(r.status, 400);
});
await T('entra com senha certa', async () => {
  const r = await chamar('POST', '/acesso/entrar', { email: 'g@teste.com', senha: 'senha123' });
  igual(r.status, 200); const j = await r.json(); if (!j.token) throw new Error('sem token');
});
await T('entra pelo nome de usuário', async () => {
  const r = await chamar('POST', '/acesso/entrar', { identificador: 'GABRIEL', senha: 'senha123' });
  igual(r.status, 200); const j = await r.json(); igual(j.usuario.apelido, 'gabriel');
});
await T('recusa nome de usuário repetido', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'WASH-DEV-4827', nome: 'Outro', email: 'outro@t.com', apelido: 'gabriel', senha: 'senha123' });
  igual(r.status, 400);
});
await T('recusa nome de usuário com formato inválido', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'WASH-DEV-4827', nome: 'X', email: 'fmt@t.com', apelido: 'a b!', senha: 'senha123' });
  igual(r.status, 400);
});
await T('nome de usuário é opcional', async () => {
  const r = await chamar('POST', '/acesso/criar', { codigo: 'WASH-DEV-4827', nome: 'Sem Apelido', email: 'sem@t.com', senha: 'senha123' });
  igual(r.status, 201);
});
await T('recusa senha errada', async () => {
  const r = await chamar('POST', '/acesso/entrar', { email: 'g@teste.com', senha: 'errada' });
  igual(r.status, 401);
});
await T('trava após 8 tentativas', async () => {
  for (let i = 0; i < 8; i++) await chamar('POST', '/acesso/entrar', { email: 'trava@t.com', senha: 'x' });
  const r = await chamar('POST', '/acesso/entrar', { email: 'trava@t.com', senha: 'x' });
  igual(r.status, 429);
});
await T('sem token é recusado', async () => igual((await chamar('GET', '/dados')).status, 401));
await T('token inventado é recusado', async () => igual((await chamar('GET', '/dados', null, 'token-falso')).status, 401));

console.log('\n== gravação e cargos ==');
await T('operador grava registro', async () => {
  const r = await chamar('POST', '/registros', { registros: [{ id: 'p1', entidade: 'pedido', dados: { numero_pedido: '1001', cliente: 'ACME', qtd_poste: 50 } }] }, oper.token);
  igual(r.status, 200); igual((await r.json()).gravados, 1);
});
await T('registro volta no /dados', async () => {
  const j = await (await chamar('GET', '/dados', null, oper.token)).json();
  igual(j.registros.length, 1); igual(j.registros[0].dados.cliente, 'ACME');
});
await T('alteração sobe a versão', async () => {
  await chamar('POST', '/registros', { registros: [{ id: 'p1', entidade: 'pedido', dados: { numero_pedido: '1001', cliente: 'ACME', qtd_poste: 80 } }] }, gestor.token);
  const j = await (await chamar('GET', '/dados', null, dev.token)).json();
  igual(j.registros[0].versao, 2); igual(j.registros[0].dados.qtd_poste, 80);
});
await T('operador NÃO remove', async () => igual((await chamar('DELETE', '/registros/p1', null, oper.token)).status, 403));
await T('gestor remove para a lixeira', async () => {
  igual((await chamar('DELETE', '/registros/p1', null, gestor.token)).status, 200);
  const j = await (await chamar('GET', '/lixeira', null, dev.token)).json();
  igual(j.itens.length, 1); igual(j.itens[0].removido_por_email, 'm@t.com');
});
await T('restaura da lixeira', async () => {
  igual((await chamar('POST', '/lixeira/restaurar/p1', null, gestor.token)).status, 200);
  igual((await (await chamar('GET', '/lixeira', null, dev.token)).json()).itens.length, 0);
});
await T('operador NÃO altera ajustes', async () => igual((await chamar('POST', '/ajustes/metas', { valor: { x: 1 } }, oper.token)).status, 403));
await T('gestor salva meta compartilhada', async () => {
  igual((await chamar('POST', '/ajustes/metas', { valor: { '2026': { '01': { psp: 500 } } } }, gestor.token)).status, 200);
  const j = await (await chamar('GET', '/dados', null, oper.token)).json();
  igual(j.ajustes[0].valor['2026']['01'].psp, 500, 'operador enxerga a meta do gestor:');
});
await T('sincronização incremental filtra por data', async () => {
  const t = Date.now();
  await new Promise((r) => setTimeout(r, 5));
  await chamar('POST', '/registros', { registros: [{ id: 'p2', entidade: 'pedido', dados: { cliente: 'NOVO' } }] }, dev.token);
  const j = await (await chamar('GET', `/dados?desde=${t}`, null, dev.token)).json();
  igual(j.registros.length, 1); igual(j.registros[0].id, 'p2');
});

console.log('\n== contas e histórico ==');
await T('operador NÃO lista contas', async () => igual((await chamar('GET', '/usuarios', null, oper.token)).status, 403));
await T('dev lista contas e convites', async () => {
  const j = await (await chamar('GET', '/usuarios', null, dev.token)).json();
  igual(j.usuarios.length, 4); igual(j.convites.length, 3);
});
await T('dev desativa conta e derruba a sessão', async () => {
  const alvo = (await (await chamar('GET', '/usuarios', null, dev.token)).json()).usuarios.find((u) => u.email === 'j@t.com');
  igual((await chamar('PATCH', '/usuarios/' + alvo.id, { ativo: false }, dev.token)).status, 200);
  igual((await chamar('GET', '/dados', null, oper.token)).status, 401, 'sessão do operador caiu:');
});
await T('dev não altera a própria conta', async () => {
  igual((await chamar('PATCH', '/usuarios/' + dev.usuario.id, { cargo: 'operador' }, dev.token)).status, 400);
});
await T('histórico registra quem fez o quê', async () => {
  const j = await (await chamar('GET', '/historico', null, dev.token)).json();
  const acoes = j.itens.map((i) => i.acao);
  for (const a of ['login', 'conta_criada', 'gravou', 'removeu', 'restaurou', 'ajustou', 'alterou_conta', 'login_falhou']) {
    if (!acoes.includes(a)) throw new Error('faltou registrar: ' + a);
  }
  const rem = j.itens.find((i) => i.acao === 'removeu');
  igual(rem.email, 'm@t.com', 'remoção atribuída ao gestor:');
});
await T('redefinir senha exige código do cargo certo', async () => {
  igual((await chamar('POST', '/acesso/redefinir', { codigo: 'WASH-OPER-6240', email: 'm@t.com', senha: 'nova12345' })).status, 400);
  igual((await chamar('POST', '/acesso/redefinir', { codigo: 'WASH-DEV-4827', email: 'm@t.com', senha: 'nova12345' })).status, 200);
  igual((await chamar('POST', '/acesso/entrar', { email: 'm@t.com', senha: 'senha123' })).status, 401, 'senha antiga recusada:');
  igual((await chamar('POST', '/acesso/entrar', { email: 'm@t.com', senha: 'nova12345' })).status, 200, 'senha nova aceita:');
});
await T('troca a própria senha dentro do sistema', async () => {
  const nova = await (await chamar('POST', '/acesso/criar', { codigo: 'WASH-DEV-4827', nome: 'Troca', email: 'troca@t.com', senha: 'senhaAntiga1' })).json();
  igual((await chamar('POST', '/acesso/senha', { atual: 'errada', nova: 'senhaNova123' }, nova.token)).status, 403, 'senha atual errada:');
  igual((await chamar('POST', '/acesso/senha', { atual: 'senhaAntiga1', nova: '123' }, nova.token)).status, 400, 'nova senha curta:');
  igual((await chamar('POST', '/acesso/senha', { atual: 'senhaAntiga1', nova: 'senhaAntiga1' }, nova.token)).status, 400, 'nova igual à atual:');
  igual((await chamar('POST', '/acesso/senha', { atual: 'senhaAntiga1', nova: 'senhaNova123' }, nova.token)).status, 200);
  igual((await chamar('POST', '/acesso/entrar', { email: 'troca@t.com', senha: 'senhaAntiga1' })).status, 401, 'senha antiga recusada:');
  igual((await chamar('POST', '/acesso/entrar', { email: 'troca@t.com', senha: 'senhaNova123' })).status, 200, 'senha nova aceita:');
  igual((await chamar('GET', '/dados', null, nova.token)).status, 200, 'quem trocou continua conectado:');
});
await T('CORS responde ao preflight', async () => {
  const r = await worker.fetch(new Request('https://api.local/dados', { method: 'OPTIONS', headers: { Origin: ORIGEM } }), env);
  igual(r.status, 204); igual(r.headers.get('Access-Control-Allow-Origin'), ORIGEM);
});
await T('origem desconhecida não recebe liberação', async () => {
  const r = await worker.fetch(new Request('https://api.local/saude', { headers: { Origin: 'https://site-malicioso.com' } }), env);
  if (r.headers.get('Access-Control-Allow-Origin') === 'https://site-malicioso.com') throw new Error('liberou origem errada');
});

console.log(`\n${ok} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
