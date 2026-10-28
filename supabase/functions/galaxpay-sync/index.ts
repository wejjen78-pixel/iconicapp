// Edge Function: galaxpay-sync
// Busca os pagamentos de planos (assinaturas) no Cel Cash (antigo GalaxPay)
// pela API v2 e lança automaticamente no "pote" (Galaxy Pay) da organização,
// sem expor as credenciais ao navegador.
//
// Body (todos opcionais):
//   date        "AAAA-MM-DD"  — sincroniza só esse dia (padrão: hoje)
//   startDate / endDate       — intervalo, no lugar de `date`
//   dryRun      true          — só calcula e devolve a prévia, não grava nada
//   valor       "bruto" | "liquido" — lança o valor pago ou já sem a taxa (padrão: bruto)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// api.cel.cash/v2 (endereço novo da marca) devolve 503; o domínio antigo segue respondendo a mesma API v2.
const CELCASH_API = "https://api.galaxpay.com.br/v2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Status do Cel Cash que representam dinheiro que efetivamente entrou.
const PAID_STATUSES = [
  "captured",
  "payedBoleto",
  "moreValueBoleto",
  "lessValueBoleto",
  "payedPix",
  "payExternal",
];

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function hojeSP() {
  // Data local do Brasil (a Edge Function roda em UTC).
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function celcashErro(data: any, fallback: string) {
  return data?.error?.message || data?.message || data?.Errors?.[0]?.message || fallback;
}

async function celcashToken(galaxId: string, galaxHash: string) {
  const res = await fetch(CELCASH_API + "/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${galaxId}:${galaxHash}`),
    },
    body: JSON.stringify({ grant_type: "authorization_code", scope: "transactions.read" }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new Error("Cel Cash recusou as credenciais: " + celcashErro(data, `HTTP ${res.status}`));
  }
  return data.access_token as string;
}

// Lista todas as transações pagas cujo status mudou no intervalo, paginando de 100 em 100.
async function celcashTransacoesPagas(token: string, startDate: string, endDate: string) {
  const all: any[] = [];
  for (let startAt = 0; ; startAt += 100) {
    const qs = new URLSearchParams({
      updateStatusFrom: startDate,
      updateStatusTo: endDate,
      status: PAID_STATUSES.join(","),
      startAt: String(startAt),
      limit: "100",
      order: "createdAt.asc",
    });
    const res = await fetch(`${CELCASH_API}/transactions?${qs}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error("Cel Cash recusou a consulta: " + celcashErro(data, `HTTP ${res.status}`));
    }
    const page = data.Transactions || [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Cliente com o JWT de quem chamou, só para identificar o usuário.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);

    // Cliente com service role: ignora RLS, só usado depois de validar o papel do usuário.
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("org_id, role")
      .eq("id", userData.user.id)
      .single();
    if (!profile) return json({ error: "Perfil não encontrado." }, 404);
    if (profile.role !== "dono") return json({ error: "Só o dono pode sincronizar." }, 403);

    const { data: integ } = await admin
      .from("org_integrations")
      .select("galax_id, galax_hash")
      .eq("org_id", profile.org_id)
      .single();
    if (!integ?.galax_id || !integ?.galax_hash) {
      return json({ error: "Cel Cash ainda não configurado. Salve suas credenciais primeiro." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const startDate = body.date || body.startDate || hojeSP();
    const endDate = body.date || body.endDate || startDate;
    const dryRun = body.dryRun === true;
    const liquido = body.valor === "liquido";

    const token = await celcashToken(integ.galax_id, integ.galax_hash);
    const pagas = await celcashTransacoesPagas(token, startDate, endDate);

    // O pote é só dos planos (assinaturas). Cobranças avulsas — ex.: sobrancelha
    // que o cliente do clube pagou no cartão — ficam de fora.
    const ehPlano = (t: any) => Number(t.subscriptionGalaxPayId || t.Subscription?.galaxPayId) > 0;
    const transactions = pagas.filter(ehPlano);
    const avulsas = pagas.filter((t) => !ehPlano(t));
    const foraDoPlano = {
      qtd: avulsas.length,
      valor: Math.round(avulsas.reduce((s, t) => s + (Number(t.value) || 0), 0)) / 100,
    };

    // "pote" vive em org_lancamentos (uma linha por lançamento). O extId evita
    // lançar a mesma transação duas vezes se sincronizar o mesmo dia de novo.
    const { data: existingRows } = await admin
      .from("org_lancamentos")
      .select("payload")
      .eq("org_id", profile.org_id)
      .eq("tipo", "pote");
    const existingExtIds = new Set(
      (existingRows || []).map((r: any) => r.payload?.extId).filter(Boolean)
    );

    // Valores da API v2 vêm em centavos.
    let bruto = 0, taxas = 0, jaLancadas = 0;
    const newRows = [];
    for (const t of transactions) {
      const valBruto = (Number(t.value) || 0) / 100;
      const valTaxa = (Number(t.fee) || 0) / 100;
      bruto += valBruto;
      taxas += valTaxa;
      const extId = "galaxpay:" + t.galaxPayId;
      if (existingExtIds.has(extId)) { jaLancadas++; continue; }
      const appId = Math.random().toString(36).substr(2, 8);
      const dt = String(t.statusDate || t.paydayDate || t.payday || startDate).slice(0, 10);
      newRows.push({
        org_id: profile.org_id,
        tipo: "pote",
        app_id: appId,
        dt,
        payload: {
          id: appId,
          val: Math.round((liquido ? valBruto - valTaxa : valBruto) * 100) / 100,
          dt,
          obs: "Cel Cash · " + (t.statusDescription || t.status),
          extId,
        },
      });
    }

    const resumo = {
      startDate,
      endDate,
      total: transactions.length,
      jaLancadas,
      novas: newRows.length,
      bruto: Math.round(bruto * 100) / 100,
      taxas: Math.round(taxas * 100) / 100,
      liquido: Math.round((bruto - taxas) * 100) / 100,
      valorNovas: Math.round(newRows.reduce((s, r) => s + r.payload.val, 0) * 100) / 100,
      foraDoPlano,
    };

    if (dryRun) return json({ success: true, dryRun: true, ...resumo });

    let added = 0;
    if (newRows.length) {
      const { error: insErr } = await admin.from("org_lancamentos").insert(newRows);
      if (insErr) return json({ error: "Falha ao gravar no pote: " + insErr.message }, 500);
      added = newRows.length;
    }

    await admin
      .from("org_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_sync_count: added })
      .eq("org_id", profile.org_id);

    return json({ success: true, added, ...resumo });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
