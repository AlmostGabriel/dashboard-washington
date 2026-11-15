-- =====================================================================
-- Dashboard Washington · banco compartilhado (Cloudflare D1 / SQLite)
-- Princípio: nada é apagado de verdade. Toda alteração deixa rastro.
-- =====================================================================

-- Pessoas com acesso. O cargo vem daqui, não mais do código do sistema.
CREATE TABLE IF NOT EXISTS usuarios (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  apelido     TEXT,
  nome        TEXT NOT NULL,
  cargo       TEXT NOT NULL CHECK (cargo IN ('dev','gestor','operador')),
  sal         TEXT NOT NULL,
  hash        TEXT NOT NULL,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   INTEGER NOT NULL,
  ultimo_acesso INTEGER
);

-- Nome de usuário é opcional, mas quando existe não se repete.
CREATE UNIQUE INDEX IF NOT EXISTS ix_usuarios_apelido ON usuarios(apelido);

-- Sessões abertas. Permite encerrar o acesso de alguém na hora.
CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  criada_em  INTEGER NOT NULL,
  expira_em  INTEGER NOT NULL,
  agente     TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessoes_usuario ON sessoes(usuario_id);

-- Registros do sistema (pedidos, produção, faturamento, clientes…).
-- O conteúdo fica em JSON para acompanhar o formato das planilhas sem
-- exigir migração de esquema a cada campo novo.
CREATE TABLE IF NOT EXISTS registros (
  id          TEXT PRIMARY KEY,
  entidade    TEXT NOT NULL,
  dados       TEXT NOT NULL,
  fonte_id    TEXT,
  origem      TEXT,
  criado_por  TEXT REFERENCES usuarios(id),
  criado_em   INTEGER NOT NULL,
  alterado_por TEXT REFERENCES usuarios(id),
  alterado_em INTEGER NOT NULL,
  versao      INTEGER NOT NULL DEFAULT 1,
  removido_em INTEGER,
  removido_por TEXT REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS ix_reg_entidade ON registros(entidade, removido_em);
CREATE INDEX IF NOT EXISTS ix_reg_fonte    ON registros(fonte_id);
CREATE INDEX IF NOT EXISTS ix_reg_alterado ON registros(alterado_em);

-- Planilhas importadas, para o sistema saber de onde veio cada registro.
CREATE TABLE IF NOT EXISTS fontes (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  entidade   TEXT NOT NULL,
  situacao   TEXT NOT NULL DEFAULT 'active',
  importada_por TEXT REFERENCES usuarios(id),
  importada_em  INTEGER NOT NULL,
  removida_em   INTEGER
);

-- Configurações compartilhadas: metas, nomes de módulos, regras.
CREATE TABLE IF NOT EXISTS ajustes (
  chave        TEXT PRIMARY KEY,
  valor        TEXT NOT NULL,
  alterado_por TEXT REFERENCES usuarios(id),
  alterado_em  INTEGER NOT NULL
);

-- Histórico: toda criação, alteração e remoção, com o antes e o depois.
CREATE TABLE IF NOT EXISTS historico (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quando     INTEGER NOT NULL,
  usuario_id TEXT REFERENCES usuarios(id),
  email      TEXT,
  acao       TEXT NOT NULL,
  alvo_tipo  TEXT NOT NULL,
  alvo_id    TEXT,
  antes      TEXT,
  depois     TEXT,
  resumo     TEXT
);
CREATE INDEX IF NOT EXISTS ix_hist_quando ON historico(quando DESC);
CREATE INDEX IF NOT EXISTS ix_hist_alvo   ON historico(alvo_tipo, alvo_id);
CREATE INDEX IF NOT EXISTS ix_hist_user   ON historico(usuario_id, quando DESC);

-- Convites: os códigos saem do código-fonte e passam a viver no banco,
-- então dá para criar e revogar sem publicar versão nova.
CREATE TABLE IF NOT EXISTS convites (
  codigo_hash TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  cargo       TEXT NOT NULL CHECK (cargo IN ('dev','gestor','operador')),
  usos        INTEGER NOT NULL DEFAULT 0,
  max_usos    INTEGER,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   INTEGER NOT NULL
);
