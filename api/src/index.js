/* =========================================================================
   Dashboard Washington · API
   Worker que fica na frente do banco D1. Toda escrita passa por aqui, é
   atribuída a uma pessoa e deixa registro no histórico. Nada é apagado de
   verdade: remover marca a data e manda para a lixeira.
   ========================================================================= */

const ORIGENS = [
  'https://dashboard-washington.pages.dev',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
];
/* O runtime da Cloudflare limita o PBKDF2 a 100.000 iterações. */
const DIAS_SESSAO = 30;
const MAX_TENTATIVAS = 8;        // por e-mail, em 15 minutos
const JANELA_TENTATIVAS = 15 * 60 * 1000;

/* ---------------- utilidades ---------------- */
const agora = () => Date.now();
const uid = () => crypto.randomUUID();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

async function sha256(txt) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(txt)));
}
async function derivar(senha, sal) {
  const k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(sal), iterations: 100000, hash: 'SHA-256' }, k, 256));
}
const novoSal = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
const novoToken = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
const normEmail = (v) => String(v || '').trim().toLowerCase();
const normApelido = (v) => String(v || '').trim().toLowerCase();
const APELIDO_OK = /^[a-z0-9._-]{3,24}$/;

/* aceita o endereço de produção e as prévias que o Pages cria por branch */
const origemValida = (o) => ORIGENS.includes(o) || /^https:\/\/[a-z0-9-]+\.dashboard-washington\.pages\.dev$/.test(o);
function cors(req) {
  const o = req.headers.get('Origin') || '';
  const permitida = origemValida(o) ? o : ORIGENS[0];
  return {
    'Access-Control-Allow-Origin': permitida,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (req, dados, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } });
const erro = (req, msg, status = 400, extra = {}) => json(req, { erro: msg, ...extra }, status);

/* ---------------- histórico ---------------- */
async function registrar(env, ctx, acao, alvoTipo, alvoId, antes, depois, resumo) {
  await env.DB.prepare(
    `INSERT INTO historico (quando, usuario_id, email, acao, alvo_tipo, alvo_id, antes, depois, resumo)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(agora(), ctx?.id || null, ctx?.email || null, acao, alvoTipo, alvoId || null,
    antes ? JSON.stringify(antes) : null, depois ? JSON.stringify(depois) : null, resumo || null).run();
}

/* ---------------- sessão ---------------- */
async function quemE(req, env) {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const r = await env.DB.prepare(
    `SELECT u.id, u.email, u.apelido, u.nome, u.cargo, s.expira_em
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND u.ativo = 1`
  ).bind(token).first();
  if (!r || r.expira_em < agora()) return null;
  return { id: r.id, email: r.email, apelido: r.apelido, nome: r.nome, cargo: r.cargo, token };
}
const ehDev = (c) => c && c.cargo === 'dev';
const podeEscrever = (c) => c && ['dev', 'gestor', 'operador'].includes(c.cargo);
const podeImportar = (c) => c && ['dev', 'gestor'].includes(c.cargo);
const podeRemover = (c) => c && ['dev', 'gestor'].includes(c.cargo);

/* ---------------- rotas de acesso ---------------- */
async function entrar(req, env) {
  const { email: e, identificador: ident, senha, agente } = await req.json();
  const email = normEmail(ident != null ? ident : e);   // pode ser e-mail ou nome de usuário
  if (!email || !senha) return erro(req, 'Informe o e-mail ou nome de usuário e a senha.');

  const desde = agora() - JANELA_TENTATIVAS;
  const falhas = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM historico WHERE acao = 'login_falhou' AND email = ? AND quando > ?`
  ).bind(email, desde).first();
  if ((falhas?.n || 0) >= MAX_TENTATIVAS) {
    return erro(req, 'Muitas tentativas. Espere 15 minutos e tente de novo.', 429);
  }

  const u = await env.DB.prepare(`SELECT * FROM usuarios WHERE (email = ? OR apelido = ?) AND ativo = 1`).bind(email, email).first();
  if (!u) { await registrar(env, { email }, 'login_falhou', 'usuario', null, null, null, 'conta não encontrada'); return erro(req, 'Usuário ou senha incorretos.', 401); }
  if (await derivar(senha, u.sal) !== u.hash) {
    await registrar(env, { id: u.id, email: u.email }, 'login_falhou', 'usuario', u.id, null, null, 'senha incorreta');
    return erro(req, 'Usuário ou senha incorretos.', 401);
  }

  const token = novoToken();
  const exp = agora() + DIAS_SESSAO * 864e5;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessoes (token, usuario_id, criada_em, expira_em, agente) VALUES (?,?,?,?,?)`).bind(token, u.id, agora(), exp, String(agente || '').slice(0, 200)),
    env.DB.prepare(`UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?`).bind(agora(), u.id),
    env.DB.prepare(`DELETE FROM sessoes WHERE expira_em < ?`).bind(agora()),
  ]);
  await registrar(env, { id: u.id, email }, 'login', 'usuario', u.id, null, null, 'entrou no sistema');
  return json(req, { token, expira_em: exp, usuario: { id: u.id, email: u.email, apelido: u.apelido, nome: u.nome, cargo: u.cargo } });
}

async function criarConta(req, env) {
  const { codigo, nome, email: e, apelido: ap, senha } = await req.json();
  const email = normEmail(e);
  const apelido = normApelido(ap);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro(req, 'Informe um e-mail válido.');
  if (apelido && !APELIDO_OK.test(apelido)) return erro(req, 'O nome de usuário aceita de 3 a 24 caracteres: letras, números, ponto, hífen e sublinhado.');
  if (String(senha || '').length < 6) return erro(req, 'A senha precisa ter ao menos 6 caracteres.');
  if (!String(nome || '').trim()) return erro(req, 'Informe seu nome.');

  const h = await sha256(String(codigo || '').trim().toUpperCase().replace(/\s+/g, '') + env.PIMENTA);
  const conv = await env.DB.prepare(`SELECT * FROM convites WHERE codigo_hash = ? AND ativo = 1`).bind(h).first();
  if (!conv) return erro(req, 'Código de convite inválido ou desativado.');
  if (conv.max_usos != null && conv.usos >= conv.max_usos) return erro(req, 'Esse código de convite já foi usado o número máximo de vezes.');

  const existe = await env.DB.prepare(`SELECT email, apelido FROM usuarios WHERE email = ? OR (apelido IS NOT NULL AND apelido = ?)`).bind(email, apelido || '\u0000').first();
  if (existe) return erro(req, existe.email === email ? 'Já existe uma conta com esse e-mail.' : 'Esse nome de usuário já está em uso.');

  const sal = novoSal();
  const u = { id: uid(), email, apelido: apelido || null, nome: String(nome).trim(), cargo: conv.cargo, sal, hash: await derivar(senha, sal), criado_em: agora() };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO usuarios (id,email,apelido,nome,cargo,sal,hash,ativo,criado_em,ultimo_acesso) VALUES (?,?,?,?,?,?,?,1,?,?)`)
      .bind(u.id, u.email, u.apelido, u.nome, u.cargo, u.sal, u.hash, u.criado_em, u.criado_em),
    env.DB.prepare(`UPDATE convites SET usos = usos + 1 WHERE codigo_hash = ?`).bind(h),
  ]);
  await registrar(env, u, 'conta_criada', 'usuario', u.id, null, { email, nome: u.nome, cargo: u.cargo }, `criou a conta pelo convite ${conv.nome}`);

  const token = novoToken(); const exp = agora() + DIAS_SESSAO * 864e5;
  await env.DB.prepare(`INSERT INTO sessoes (token, usuario_id, criada_em, expira_em) VALUES (?,?,?,?)`).bind(token, u.id, agora(), exp).run();
  return json(req, { token, expira_em: exp, usuario: { id: u.id, email, apelido: u.apelido, nome: u.nome, cargo: u.cargo } }, 201);
}

async function redefinir(req, env) {
  const { codigo, email: e, identificador: ident, senha } = await req.json();
  const email = normEmail(ident != null ? ident : e);
  if (String(senha || '').length < 6) return erro(req, 'A senha precisa ter ao menos 6 caracteres.');
  const u = await env.DB.prepare(`SELECT * FROM usuarios WHERE (email = ? OR apelido = ?) AND ativo = 1`).bind(email, email).first();
  if (!u) return erro(req, 'Não existe conta com esse e-mail ou nome de usuário.');
  const h = await sha256(String(codigo || '').trim().toUpperCase().replace(/\s+/g, '') + env.PIMENTA);
  const conv = await env.DB.prepare(`SELECT * FROM convites WHERE codigo_hash = ? AND ativo = 1`).bind(h).first();
  if (!conv) return erro(req, 'Código de convite inválido.');
  if (conv.cargo !== u.cargo && conv.cargo !== 'dev') return erro(req, 'Esse código é de outro cargo. Use o código do cargo da conta.');

  const sal = novoSal();
  await env.DB.batch([
    env.DB.prepare(`UPDATE usuarios SET sal = ?, hash = ? WHERE id = ?`).bind(sal, await derivar(senha, sal), u.id),
    env.DB.prepare(`DELETE FROM sessoes WHERE usuario_id = ?`).bind(u.id),
  ]);
  await registrar(env, { id: u.id, email }, 'senha_redefinida', 'usuario', u.id, null, null, `redefiniu a senha com o convite ${conv.nome}`);

  const token = novoToken(); const exp = agora() + DIAS_SESSAO * 864e5;
  await env.DB.prepare(`INSERT INTO sessoes (token, usuario_id, criada_em, expira_em) VALUES (?,?,?,?)`).bind(token, u.id, agora(), exp).run();
  return json(req, { token, expira_em: exp, usuario: { id: u.id, email: u.email, apelido: u.apelido, nome: u.nome, cargo: u.cargo } });
}

async function trocarSenha(req, env, ctx) {
  const { atual, nova } = await req.json();
  if (String(nova || '').length < 6) return erro(req, 'A nova senha precisa ter ao menos 6 caracteres.');
  const u = await env.DB.prepare(`SELECT * FROM usuarios WHERE id = ?`).bind(ctx.id).first();
  if (!u) return erro(req, 'Conta não encontrada.', 404);
  if (await derivar(String(atual || ''), u.sal) !== u.hash) return erro(req, 'A senha atual está incorreta.', 403);
  if (String(atual) === String(nova)) return erro(req, 'A nova senha precisa ser diferente da atual.');
  const sal = novoSal();
  await env.DB.batch([
    env.DB.prepare(`UPDATE usuarios SET sal = ?, hash = ? WHERE id = ?`).bind(sal, await derivar(nova, sal), u.id),
    /* derruba as outras sessões, mantendo a de quem está trocando */
    env.DB.prepare(`DELETE FROM sessoes WHERE usuario_id = ? AND token != ?`).bind(u.id, ctx.token),
  ]);
  await registrar(env, ctx, 'senha_trocada', 'usuario', u.id, null, null, 'trocou a própria senha');
  return json(req, { ok: true });
}

/* ---------------- dados ---------------- */
async function baixar(req, env, ctx) {
  const url = new URL(req.url);
  const desde = Number(url.searchParams.get('desde') || 0);
  const [regs, fontes, ajustes] = await Promise.all([
    env.DB.prepare(`SELECT id, entidade, dados, fonte_id, origem, criado_em, alterado_em, alterado_por, versao, removido_em FROM registros WHERE alterado_em > ? ORDER BY alterado_em`).bind(desde).all(),
    env.DB.prepare(`SELECT * FROM fontes WHERE importada_em > ? OR removida_em > ?`).bind(desde, desde).all(),
    env.DB.prepare(`SELECT * FROM ajustes WHERE alterado_em > ?`).bind(desde).all(),
  ]);
  const linhas = (regs.results || []).map((r) => ({ ...r, dados: JSON.parse(r.dados), origem: r.origem ? JSON.parse(r.origem) : null }));
  return json(req, {
    agora: agora(),
    registros: linhas,
    fontes: fontes.results || [],
    ajustes: (ajustes.results || []).map((a) => ({ ...a, valor: JSON.parse(a.valor) })),
  });
}

async function gravar(req, env, ctx) {
  const corpo = await req.json();
  const lista = Array.isArray(corpo.registros) ? corpo.registros : [];
  if (!lista.length) return erro(req, 'Nada para gravar.');
  if (lista.length > 2000) return erro(req, 'Envie no máximo 2000 registros por vez.');

  const t = agora();
  const stmts = [];
  for (const r of lista) {
    const id = r.id || uid();
    const dados = JSON.stringify(r.dados || {});
    stmts.push(env.DB.prepare(
      `INSERT INTO registros (id, entidade, dados, fonte_id, origem, criado_por, criado_em, alterado_por, alterado_em, versao)
       VALUES (?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, alterado_por = excluded.alterado_por,
         alterado_em = excluded.alterado_em, versao = registros.versao + 1, removido_em = NULL, removido_por = NULL`
    ).bind(id, r.entidade, dados, r.fonte_id || null, r.origem ? JSON.stringify(r.origem) : null, ctx.id, t, ctx.id, t));
  }
  await env.DB.batch(stmts);
  await registrar(env, ctx, lista.length > 1 ? 'gravou_lote' : 'gravou', 'registro', lista.length === 1 ? (lista[0].id || null) : null, null, null,
    `gravou ${lista.length} registro(s)`);
  return json(req, { ok: true, gravados: lista.length, agora: t });
}

async function remover(req, env, ctx, id) {
  const atual = await env.DB.prepare(`SELECT * FROM registros WHERE id = ?`).bind(id).first();
  if (!atual) return erro(req, 'Registro não encontrado.', 404);
  const t = agora();
  await env.DB.prepare(`UPDATE registros SET removido_em = ?, removido_por = ?, alterado_em = ? WHERE id = ?`).bind(t, ctx.id, t, id).run();
  await registrar(env, ctx, 'removeu', 'registro', id, JSON.parse(atual.dados), null, `moveu para a lixeira um registro de ${atual.entidade}`);
  return json(req, { ok: true });
}

async function restaurar(req, env, ctx, id) {
  const atual = await env.DB.prepare(`SELECT * FROM registros WHERE id = ?`).bind(id).first();
  if (!atual) return erro(req, 'Registro não encontrado.', 404);
  const t = agora();
  await env.DB.prepare(`UPDATE registros SET removido_em = NULL, removido_por = NULL, alterado_em = ? WHERE id = ?`).bind(t, id).run();
  await registrar(env, ctx, 'restaurou', 'registro', id, null, JSON.parse(atual.dados), `restaurou da lixeira um registro de ${atual.entidade}`);
  return json(req, { ok: true });
}

async function lixeira(req, env) {
  const r = await env.DB.prepare(
    `SELECT g.id, g.entidade, g.dados, g.removido_em, u.nome AS removido_por_nome, u.email AS removido_por_email
       FROM registros g LEFT JOIN usuarios u ON u.id = g.removido_por
      WHERE g.removido_em IS NOT NULL ORDER BY g.removido_em DESC LIMIT 500`
  ).all();
  return json(req, { itens: (r.results || []).map((x) => ({ ...x, dados: JSON.parse(x.dados) })) });
}

async function historico(req, env) {
  const url = new URL(req.url);
  const limite = Math.min(500, Number(url.searchParams.get('limite') || 200));
  const r = await env.DB.prepare(
    `SELECT id, quando, email, acao, alvo_tipo, alvo_id, resumo FROM historico ORDER BY quando DESC LIMIT ?`
  ).bind(limite).all();
  return json(req, { itens: r.results || [] });
}

async function salvarAjuste(req, env, ctx, chave) {
  const { valor } = await req.json();
  const antes = await env.DB.prepare(`SELECT valor FROM ajustes WHERE chave = ?`).bind(chave).first();
  await env.DB.prepare(
    `INSERT INTO ajustes (chave, valor, alterado_por, alterado_em) VALUES (?,?,?,?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, alterado_por = excluded.alterado_por, alterado_em = excluded.alterado_em`
  ).bind(chave, JSON.stringify(valor), ctx.id, agora()).run();
  await registrar(env, ctx, 'ajustou', 'ajuste', chave, antes ? JSON.parse(antes.valor) : null, valor, `alterou ${chave}`);
  return json(req, { ok: true });
}

async function listarUsuarios(req, env) {
  const r = await env.DB.prepare(
    `SELECT id, email, apelido, nome, cargo, ativo, criado_em, ultimo_acesso FROM usuarios ORDER BY criado_em`
  ).all();
  const c = await env.DB.prepare(`SELECT nome, cargo, usos, max_usos, ativo FROM convites ORDER BY cargo, nome`).all();
  return json(req, { usuarios: r.results || [], convites: c.results || [] });
}

async function mudarUsuario(req, env, ctx, id) {
  const { cargo, ativo } = await req.json();
  const u = await env.DB.prepare(`SELECT * FROM usuarios WHERE id = ?`).bind(id).first();
  if (!u) return erro(req, 'Conta não encontrada.', 404);
  if (u.id === ctx.id) return erro(req, 'Você não pode alterar a própria conta por aqui.');
  const novoCargo = cargo || u.cargo, novoAtivo = ativo == null ? u.ativo : (ativo ? 1 : 0);
  await env.DB.batch([
    env.DB.prepare(`UPDATE usuarios SET cargo = ?, ativo = ? WHERE id = ?`).bind(novoCargo, novoAtivo, id),
    ...(novoAtivo ? [] : [env.DB.prepare(`DELETE FROM sessoes WHERE usuario_id = ?`).bind(id)]),
  ]);
  await registrar(env, ctx, 'alterou_conta', 'usuario', id, { cargo: u.cargo, ativo: u.ativo }, { cargo: novoCargo, ativo: novoAtivo },
    `alterou a conta de ${u.email}`);
  return json(req, { ok: true });
}

/* ---------------- roteador ---------------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const m = req.method;

    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (p === '/' || p === '/saude') return json(req, { ok: true, servico: 'dashboard-washington', agora: agora() });

    try {
      if (p === '/acesso/entrar' && m === 'POST') return await entrar(req, env);
      if (p === '/acesso/criar' && m === 'POST') return await criarConta(req, env);
      if (p === '/acesso/redefinir' && m === 'POST') return await redefinir(req, env);

      const ctx = await quemE(req, env);
      if (!ctx) return erro(req, 'Sessão expirada. Entre de novo.', 401);

      if (p === '/acesso/eu' && m === 'GET') return json(req, { usuario: ctx });
      if (p === '/acesso/sair' && m === 'POST') {
        await env.DB.prepare(`DELETE FROM sessoes WHERE token = ?`).bind(ctx.token).run();
        await registrar(env, ctx, 'logout', 'usuario', ctx.id, null, null, 'saiu do sistema');
        return json(req, { ok: true });
      }

      if (p === '/acesso/senha' && m === 'POST') return await trocarSenha(req, env, ctx);
      if (p === '/dados' && m === 'GET') return await baixar(req, env, ctx);
      if (p === '/registros' && m === 'POST') {
        if (!podeEscrever(ctx)) return erro(req, 'Seu cargo não pode gravar.', 403);
        return await gravar(req, env, ctx);
      }
      if (p.startsWith('/registros/') && m === 'DELETE') {
        if (!podeRemover(ctx)) return erro(req, 'Seu cargo não pode remover registros.', 403);
        return await remover(req, env, ctx, decodeURIComponent(p.slice('/registros/'.length)));
      }
      if (p.startsWith('/lixeira/restaurar/') && m === 'POST') {
        if (!podeRemover(ctx)) return erro(req, 'Seu cargo não pode restaurar registros.', 403);
        return await restaurar(req, env, ctx, decodeURIComponent(p.slice('/lixeira/restaurar/'.length)));
      }
      if (p === '/lixeira' && m === 'GET') return await lixeira(req, env);
      if (p === '/historico' && m === 'GET') return await historico(req, env);

      if (p.startsWith('/ajustes/') && m === 'POST') {
        if (!podeImportar(ctx)) return erro(req, 'Seu cargo não pode alterar configurações compartilhadas.', 403);
        return await salvarAjuste(req, env, ctx, decodeURIComponent(p.slice('/ajustes/'.length)));
      }

      if (p === '/usuarios' && m === 'GET') {
        if (!ehDev(ctx)) return erro(req, 'Somente o Desenvolvedor vê as contas.', 403);
        return await listarUsuarios(req, env);
      }
      if (p.startsWith('/usuarios/') && m === 'PATCH') {
        if (!ehDev(ctx)) return erro(req, 'Somente o Desenvolvedor altera contas.', 403);
        return await mudarUsuario(req, env, ctx, decodeURIComponent(p.slice('/usuarios/'.length)));
      }

      return erro(req, 'Rota não encontrada.', 404);
    } catch (e) {
      return erro(req, 'Erro no servidor: ' + (e && e.message ? e.message : String(e)), 500);
    }
  },
};
