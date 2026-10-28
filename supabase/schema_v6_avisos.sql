-- ICONIC APP — avisos (sininho) e notificações no celular (v6) — rodar no SQL Editor
-- Pode rodar mais de uma vez: recria as regras (policies) sem erro.
-- Pré-requisito: schema.sql e schema_v2_saas.sql
--
-- avisos: mini relatório diário de cada barbeiro (e o resumo da equipe para o
-- dono), gravado pelo robô das 6:00. push_subs: os aparelhos que aceitaram
-- receber notificação (Web Push). org/usuário/barbeiro são preenchidos pelo
-- banco a partir do perfil de quem se inscreve — o navegador não escolhe.

create table if not exists avisos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default auth_org_id() references organizations(id) on delete cascade,
  barbeiro_id text,            -- null = aviso do dono (resumo da equipe)
  chave text not null,         -- ex.: "2026-10-27:3" — evita aviso repetido no mesmo dia
  dt date not null,
  titulo text not null,
  corpo text not null,
  dados jsonb not null default '{}',
  lido boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (org_id, chave)
);
create index if not exists avisos_org_dt_idx on avisos (org_id, dt desc);

alter table avisos enable row level security;

create or replace function auth_barbeiro_id() returns text
language sql stable security definer set search_path = public as $$
  select barbeiro_id from profiles where id = auth.uid()
$$;

-- Dono vê os avisos dele (barbeiro_id null) e os da equipe; barbeiro só os próprios.
drop policy if exists "avisos_select" on avisos;
create policy "avisos_select" on avisos for select using (
  org_id = auth_org_id() and (auth_role() = 'dono' or barbeiro_id = auth_barbeiro_id())
);
drop policy if exists "avisos_insert" on avisos;
create policy "avisos_insert" on avisos for insert with check (
  org_id = auth_org_id() and auth_role() = 'dono'
);
-- Marcar como lido: cada um só nos avisos que pode ver.
drop policy if exists "avisos_update" on avisos;
create policy "avisos_update" on avisos for update using (
  org_id = auth_org_id() and (auth_role() = 'dono' or barbeiro_id = auth_barbeiro_id())
);
grant select, insert, update on avisos to authenticated;

create table if not exists push_subs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  barbeiro_id text,
  role text not null,
  endpoint text not null unique,
  sub jsonb not null,          -- PushSubscription.toJSON(): endpoint + keys
  criado_em timestamptz not null default now()
);

alter table push_subs enable row level security;

create or replace function push_subs_preenche() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.org_id := auth_org_id();
  new.role := auth_role();
  new.barbeiro_id := auth_barbeiro_id();
  return new;
end;
$$;
drop trigger if exists push_subs_preenche on push_subs;
create trigger push_subs_preenche before insert or update on push_subs
  for each row execute function push_subs_preenche();

drop policy if exists "push_subs_insert" on push_subs;
create policy "push_subs_insert" on push_subs for insert with check (user_id = auth.uid());
drop policy if exists "push_subs_update" on push_subs;
create policy "push_subs_update" on push_subs for update using (user_id = auth.uid());
-- O robô entra como dono para enviar: dono lê todas as inscrições da barbearia.
drop policy if exists "push_subs_select" on push_subs;
create policy "push_subs_select" on push_subs for select using (
  user_id = auth.uid() or (org_id = auth_org_id() and auth_role() = 'dono')
);
drop policy if exists "push_subs_delete" on push_subs;
create policy "push_subs_delete" on push_subs for delete using (
  user_id = auth.uid() or (org_id = auth_org_id() and auth_role() = 'dono')
);
grant select, insert, update, delete on push_subs to authenticated;
