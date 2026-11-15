/* Imitação mínima do D1 em cima do SQLite do Node, só para testar a API
   fora da Cloudflare. Cobre prepare/bind/first/all/run e batch. */
import { DatabaseSync } from 'node:sqlite';

export function criarD1(caminho = ':memory:') {
  const db = new DatabaseSync(caminho);
  const prep = (sql) => {
    let args = [];
    const self = {
      bind(...a) { args = a.map((v) => (v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v))); return self; },
      async first() { const st = db.prepare(sql); const r = st.all(...args); return r.length ? r[0] : null; },
      async all() { const st = db.prepare(sql); return { results: st.all(...args), success: true }; },
      async run() { const st = db.prepare(sql); const info = st.run(...args); return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } }; },
      _exec() { const st = db.prepare(sql); if (/^\s*select/i.test(sql)) return st.all(...args); return st.run(...args); },
    };
    return self;
  };
  return {
    prepare: prep,
    async batch(stmts) { const out = []; db.exec('BEGIN'); try { for (const s of stmts) out.push({ success: true, results: s._exec() }); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return out; },
    exec(sql) { db.exec(sql); },
    _db: db,
  };
}
