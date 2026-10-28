-- ICONIC APP — salvar credenciais do Cel Cash (v5) — rodar no SQL Editor
-- Pré-requisito: já ter rodado schema_v3_galaxpay.sql
--
-- Motivo: o app salvava com upsert (insert ... on conflict do update). Quando a
-- linha já existe, o Postgres exige que ela passe numa policy de SELECT — e
-- org_integrations não tem SELECT de propósito (o hash nunca volta ao navegador).
-- Resultado: "new row violates row-level security policy for table org_integrations"
-- ao atualizar as credenciais. Esta função grava sem precisar ler.

create or replace function set_galaxpay_creds(p_galax_id text, p_galax_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth_org_id() is null or auth_role() is distinct from 'dono' then
    raise exception 'Só o dono pode salvar as credenciais.';
  end if;
  if coalesce(trim(p_galax_id), '') = '' or coalesce(trim(p_galax_hash), '') = '' then
    raise exception 'Preencha o Galax ID e o Galax Hash.';
  end if;

  insert into org_integrations (org_id, provider, galax_id, galax_hash)
  values (auth_org_id(), 'galaxpay', trim(p_galax_id), trim(p_galax_hash))
  on conflict (org_id) do update
    set provider = 'galaxpay',
        galax_id = excluded.galax_id,
        galax_hash = excluded.galax_hash;
end;
$$;

revoke all on function set_galaxpay_creds(text, text) from public;
grant execute on function set_galaxpay_creds(text, text) to authenticated;
