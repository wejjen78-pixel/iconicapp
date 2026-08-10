-- ICONIC APP — normaliza lançamentos em linhas próprias (v4) — rodar no SQL Editor
-- Pré-requisito: já ter rodado schema.sql, schema_v2_saas.sql, schema_v3_galaxpay.sql
--
-- Motivo: org_data.data guardava TODOS os lançamentos (fichas, avulsos, extras,
-- produtos, pote, etc.) desde o início num único JSON, reescrito por inteiro a
-- cada autosave. Isso cresceu a ponto de estourar o tempo limite de escrita do
-- banco (statement timeout) em barbearias com bastante movimento. Esta tabela
-- guarda cada lançamento como uma linha própria — criar/editar/excluir um
-- lançamento agora grava só aquela linha, nunca o histórico inteiro.

create table org_lancamentos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  tipo text not null check (tipo in ('svcs','avul','ext','extAv','prod','pote','lote','assinV','vales','coaching','instaLancamentos')),
  app_id text not null, -- o id gerado pelo app (uid()) para cada lançamento
  dt date,
  payload jsonb not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (org_id, tipo, app_id)
);

create index org_lancamentos_org_tipo_idx on org_lancamentos (org_id, tipo);
create index org_lancamentos_org_dt_idx on org_lancamentos (org_id, dt);

alter table org_lancamentos enable row level security;

create policy "org_lancamentos_select" on org_lancamentos for select using (org_id = auth_org_id());
create policy "org_lancamentos_insert" on org_lancamentos for insert with check (org_id = auth_org_id() and auth_role() = 'dono');
create policy "org_lancamentos_update" on org_lancamentos for update using (org_id = auth_org_id() and auth_role() = 'dono') with check (org_id = auth_org_id() and auth_role() = 'dono');
create policy "org_lancamentos_delete" on org_lancamentos for delete using (org_id = auth_org_id() and auth_role() = 'dono');

-- Grant explícito (a RLS sozinha não basta — sem isso a tabela fica inacessível
-- mesmo com policy correta, mesmo bug que já pegamos em org_integrations/organizations).
grant select, insert, update, delete on org_lancamentos to authenticated;

-- ── MIGRAÇÃO: copia os lançamentos que já existem em org_data.data para a tabela nova ──
-- Idempotente (on conflict do nothing) — pode rodar mais de uma vez sem duplicar.
insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'svcs', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'svcs','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'avul', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'avul','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'ext', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'ext','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'extAv', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'extAv','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'prod', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'prod','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'pote', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'pote','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'lote', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'lote','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'assinV', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'assinV','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'vales', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'vales','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'coaching', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'coaching','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

insert into org_lancamentos (org_id, tipo, app_id, dt, payload)
select org_id, 'instaLancamentos', elem->>'id', nullif(elem->>'dt','')::date, elem
from org_data, jsonb_array_elements(coalesce(data->'instaLancamentos','[]'::jsonb)) as elem
where elem->>'id' is not null
on conflict (org_id, tipo, app_id) do nothing;

-- Confira o resultado (deve bater com as contagens que você já tinha visto):
select tipo, count(*) from org_lancamentos group by tipo order by tipo;
