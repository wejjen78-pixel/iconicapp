-- ICONIC BARBEARIA — schema multi-tenant (Supabase / Postgres)
-- Rode este arquivo inteiro no SQL Editor do Supabase (Project > SQL Editor > New query > Run)
--
-- Estratégia: cada barbearia (organization) tem UM documento JSON com todos os
-- lançamentos/config — o mesmo formato que o app já usa hoje (era salvo via
-- window.storage). Isso evita reescrever toda a lógica de cálculo do app.
-- (Dá pra normalizar em tabelas relacionais depois, se o produto crescer.)

create extension if not exists "pgcrypto";

-- ── ORGANIZAÇÕES (cada barbearia cliente) ───────────────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text unique not null,
  criado_em timestamptz not null default now()
);

-- ── PERFIS (vincula usuário do Supabase Auth a uma organização) ────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  nome text not null,
  role text not null check (role in ('dono','barb')),
  barbeiro_id text, -- id do barbeiro dentro do jsonb (bId), não FK
  criado_em timestamptz not null default now()
);

-- ── DADOS DA BARBEARIA (documento único por organização) ───────────────────
create table org_data (
  org_id uuid primary key references organizations(id) on delete cascade,
  data jsonb not null default '{}',
  atualizado_em timestamptz not null default now()
);

-- ── HELPERS ──────────────────────────────────────────────────────────────────
create or replace function auth_org_id() returns uuid
language sql stable security definer as $$
  select org_id from profiles where id = auth.uid()
$$;

create or replace function auth_role() returns text
language sql stable security definer as $$
  select role from profiles where id = auth.uid()
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table org_data enable row level security;

create policy "org_select" on organizations for select using (id = auth_org_id());

create policy "profiles_self" on profiles for select using (id = auth.uid());

create policy "org_data_select" on org_data for select using (org_id = auth_org_id());
-- Só o dono grava; barbeiro só lê (mesma regra que já existe na UI do app).
create policy "org_data_write" on org_data for insert with check (org_id = auth_org_id() and auth_role() = 'dono');
create policy "org_data_update" on org_data for update using (org_id = auth_org_id() and auth_role() = 'dono') with check (org_id = auth_org_id() and auth_role() = 'dono');

-- ── SEED: criar a primeira barbearia (Iconic) ───────────────────────────────
insert into organizations (nome, slug) values ('Iconic Barbearia', 'iconic-barbearia');

insert into org_data (org_id, data)
select id, jsonb_build_object(
  'barbs', jsonb_build_array(
    jsonb_build_object('id',1,'nome','Brendo Neves','cor','#7c3aed','meta',8000,'metaAssin',4000,'metaAvulso',4000,'foto','','cnpj',''),
    jsonb_build_object('id',2,'nome','Ithalo Souza','cor','#0891b2','meta',7000,'metaAssin',3500,'metaAvulso',3500,'foto','','cnpj',''),
    jsonb_build_object('id',3,'nome','Luís Vitor','cor','#059669','meta',7500,'metaAssin',3750,'metaAvulso',3750,'foto','','cnpj',''),
    jsonb_build_object('id',4,'nome','Welton','cor','#dc2626','meta',6500,'metaAssin',3250,'metaAvulso',3250,'foto','','cnpj',''),
    jsonb_build_object('id',5,'nome','Pedro Lucas','cor','#d97706','meta',6000,'metaAssin',3000,'metaAvulso',3000,'foto','','cnpj','')
  ),
  'meta', 60000,
  'txB', 45,
  'txBar', 55,
  'cnpj', '',
  'svcs', '[]'::jsonb, 'avul', '[]'::jsonb, 'ext', '[]'::jsonb, 'extAv', '[]'::jsonb,
  'prod', '[]'::jsonb, 'pote', '[]'::jsonb, 'lote', '[]'::jsonb,
  'assinD', jsonb_build_object('ativas',0,'novas',0,'canceladas',0),
  'assinV', '[]'::jsonb, 'vales', '[]'::jsonb,
  'prodLst', jsonb_build_array(
    jsonb_build_object('nome','Pomada Heavy Hold Rednek','v',49,'comissao',0.20),
    jsonb_build_object('nome','Pomada Matte Rednek','v',49,'comissao',0.20),
    jsonb_build_object('nome','Pomada Efeito Seco Rednek','v',49,'comissao',0.20),
    jsonb_build_object('nome','Pomada em Pó Red Nek','v',54.9,'comissao',0.20),
    jsonb_build_object('nome','Pomada extra brilho RedNek','v',49,'comissao',0.20),
    jsonb_build_object('nome','Grooming B.urb','v',75,'comissao',0.20),
    jsonb_build_object('nome','Grooming Rednek','v',56.9,'comissao',0.20),
    jsonb_build_object('nome','Shampoo B.urb','v',59,'comissao',0.20),
    jsonb_build_object('nome','Shampoo + Barba B.urb','v',55,'comissao',0.20),
    jsonb_build_object('nome','Shampoo + Minoxwax Red Nek','v',74.9,'comissao',0.20),
    jsonb_build_object('nome','Leave-in B.urb','v',75,'comissao',0.20),
    jsonb_build_object('nome','Balm B.urb','v',75,'comissao',0.20),
    jsonb_build_object('nome','Balm Rednek','v',54.9,'comissao',0.20),
    jsonb_build_object('nome','Minoxwax 8% Red Nek','v',79,'comissao',0.20),
    jsonb_build_object('nome','Óleo ELEMENT','v',49.9,'comissao',0.20),
    jsonb_build_object('nome','Escova','v',39.9,'comissao',0.20),
    jsonb_build_object('nome','Coca Cola Lata 350ML','v',7,'comissao',0),
    jsonb_build_object('nome','Guaraná Antártica 350ML','v',7,'comissao',0),
    jsonb_build_object('nome','Guaravita','v',3,'comissao',0),
    jsonb_build_object('nome','Monster Green','v',12,'comissao',0),
    jsonb_build_object('nome','Redbull Lata','v',13,'comissao',0),
    jsonb_build_object('nome','Redbull Sugarfree','v',13,'comissao',0)
  ),
  'estoque', jsonb_build_object(
    'Pomada Heavy Hold Rednek',10,'Pomada Matte Rednek',4,'Pomada Efeito Seco Rednek',5,
    'Pomada em Pó Red Nek',5,'Pomada extra brilho RedNek',0,'Grooming B.urb',5,
    'Grooming Rednek',2,'Shampoo B.urb',1,'Shampoo + Barba B.urb',3,
    'Shampoo + Minoxwax Red Nek',6,'Leave-in B.urb',8,'Balm B.urb',6,
    'Balm Rednek',8,'Minoxwax 8% Red Nek',11,'Óleo ELEMENT',1,
    'Escova',6,'Coca Cola Lata 350ML',12,'Guaraná Antártica 350ML',10,
    'Guaravita',13,'Monster Green',6,'Redbull Lata',11,'Redbull Sugarfree',4
  ),
  'niveis', jsonb_build_array(
    jsonb_build_object('nome','Bronze','valor',5000,'cor','#b45309','icon','🥉'),
    jsonb_build_object('nome','Prata','valor',8000,'cor','#6b7280','icon','🥈'),
    jsonb_build_object('nome','Ouro','valor',12000,'cor','#d97706','icon','🥇'),
    jsonb_build_object('nome','Diamante','valor',18000,'cor','#0891b2','icon','💎')
  ),
  'metasBon', jsonb_build_array(
    jsonb_build_object('id','sob','nome','Sobrancelha','meta',40,'bon',100,'tipo','extra','vUnit',20),
    jsonb_build_object('id','hid','nome','Hidratação','meta',15,'bon',100,'tipo','extra','vUnit',30),
    jsonb_build_object('id','dep','nome','Dep. Nariz','meta',20,'bon',100,'tipo','extra','vUnit',15),
    jsonb_build_object('id','sel','nome','Selagem','meta',5,'bon',100,'tipo','extra','vUnit',80),
    jsonb_build_object('id','lim','nome','Limpeza Pele','meta',20,'bon',100,'tipo','extra','vUnit',50),
    jsonb_build_object('id','prod','nome','Produto','meta',15,'bon',100,'tipo','prod','vUnit',40),
    jsonb_build_object('id','pig','nome','Pigmentação','meta',15,'bon',100,'tipo','extra','vUnit',20),
    jsonb_build_object('id','cam','nome','Camuflagem','meta',10,'bon',100,'tipo','extra','vUnit',30),
    jsonb_build_object('id','assi','nome','Assinatura','meta',10,'bon',100,'tipo','assin','vUnit',40)
  ),
  'coaching', '[]'::jsonb, 'metaHist', '[]'::jsonb, 'horasTrab', '{}'::jsonb, 'auditLog', '[]'::jsonb,
  'instaMeta', jsonb_build_object('storiesQt',20,'storiesBon',50,'reelsQt',10,'reelsBon',50),
  'instaLancamentos', '[]'::jsonb, 'desafioPessoal', '{}'::jsonb
)
from organizations where slug = 'iconic-barbearia';

-- PASSO MANUAL: depois de criar o usuário "dono" em Authentication > Users, rode
-- (trocando o UUID pelo id do usuário que aparece na lista de Users):
--
-- insert into profiles (id, org_id, nome, role)
-- select '<uuid-do-usuario-criado>', id, 'Dono', 'dono' from organizations where slug = 'iconic-barbearia';
