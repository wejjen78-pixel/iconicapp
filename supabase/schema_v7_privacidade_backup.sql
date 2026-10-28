-- ICONIC APP — privacidade dos barbeiros e backup automático (v7) — rodar no SQL Editor
-- Pode rodar mais de uma vez.
-- Pré-requisito: schema.sql, schema_v4_lancamentos.sql, schema_v6_avisos.sql
--
-- 1) org_data guarda salários (clt), custos, saldo da conta, CNPJ e o histórico
--    de ações. Antes qualquer login da barbearia podia ler tudo pela API; agora
--    só o dono lê o org_data. O barbeiro recebe, pela função abaixo, só o que
--    as telas dele usam.
-- 2) Vales: cada barbeiro só enxerga os próprios.
-- 3) Backup: bucket privado "backups", gravado pelo robô (que entra como dono).

-- ── 1. org_data só para o dono ─────────────────────────────────────────────
drop policy if exists "org_data_select" on org_data;
create policy "org_data_select" on org_data for select using (
  org_id = auth_org_id() and auth_role() = 'dono'
);

create or replace function org_data_barbeiro() returns jsonb
language sql stable security definer set search_path = public as $$
  select data - 'clt' - 'custos' - 'saldoAtual' - 'cnpj' - 'auditLog'
              - 'profitPrem' - 'profitItens' - 'comisExcl' - 'importHistory'
              - 'diaPagAssin' - 'diaPagAvulso'
  from org_data where org_id = auth_org_id()
$$;
grant execute on function org_data_barbeiro() to authenticated;

-- ── 2. vales: barbeiro só os próprios ──────────────────────────────────────
drop policy if exists "org_lancamentos_select" on org_lancamentos;
create policy "org_lancamentos_select" on org_lancamentos for select using (
  org_id = auth_org_id()
  and (auth_role() = 'dono' or tipo <> 'vales' or payload->>'bId' = auth_barbeiro_id())
);

-- ── 3. backups (bucket privado; só o dono grava e lê) ──────────────────────
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists "backups_dono_insert" on storage.objects;
create policy "backups_dono_insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'backups' and auth_role() = 'dono' and (storage.foldername(name))[1] = auth_org_id()::text
);
drop policy if exists "backups_dono_update" on storage.objects;
create policy "backups_dono_update" on storage.objects for update to authenticated using (
  bucket_id = 'backups' and auth_role() = 'dono' and (storage.foldername(name))[1] = auth_org_id()::text
);
drop policy if exists "backups_dono_select" on storage.objects;
create policy "backups_dono_select" on storage.objects for select to authenticated using (
  bucket_id = 'backups' and auth_role() = 'dono' and (storage.foldername(name))[1] = auth_org_id()::text
);
