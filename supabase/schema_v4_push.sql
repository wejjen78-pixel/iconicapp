-- ICONIC APP — Fase 4: notificações push (rodar no SQL Editor)
-- Pré-requisito: já ter rodado schema.sql (e schema_v2_saas.sql se aplicável)

-- ── ASSINATURAS DE PUSH (um dispositivo/navegador por linha) ────────────────
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  barbeiro_id text, -- null = dono (visão geral da barbearia)
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

-- Cada usuário só vê/gerencia as próprias assinaturas.
create policy "push_subscriptions_self_select" on push_subscriptions
  for select using (profile_id = auth.uid());

create policy "push_subscriptions_self_insert" on push_subscriptions
  for insert with check (profile_id = auth.uid() and org_id = auth_org_id());

create policy "push_subscriptions_self_delete" on push_subscriptions
  for delete using (profile_id = auth.uid());

-- A Edge Function que dispara os pushes usa a service_role key, que ignora RLS
-- (não precisa de policy extra pra isso).
