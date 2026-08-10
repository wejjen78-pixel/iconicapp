// Edge Function: galaxpay-sync
// Busca transações pagas no GalaxPay (Cel Cash) e lança automaticamente
// no "pote" (Galaxy Pay) da organização, sem expor as credenciais ao navegador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Status do GalaxPay que representam dinheiro que efetivamente entrou.
const PAID_STATUSES = new Set([
  "captured",
  "payedBoleto",
  "moreValueBoleto",
  "lessValueBoleto",
  "payedPix",
  "payExternal",
]);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
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
      return json({ error: "GalaxPay ainda não configurado. Salve suas credenciais primeiro." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const startDate = body.startDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = body.endDate || now.toISOString().slice(0, 10);

    const gpRes = await fetch("https://celcash.celcoin.com.br/webservice/getTransactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Auth: { galaxId: integ.galax_id, galaxHash: integ.galax_hash },
        Request: { startDate, endDate, typeDate: "dateOfLastUpdate" },
      }),
    });
    const gpData = await gpRes.json().catch(() => null);
    if (!gpData) return json({ error: "Resposta inválida do GalaxPay." }, 502);
    if (gpData.type === false) {
      return json({ error: "GalaxPay recusou a requisição: " + (gpData.message || gpData.Errors?.[0]?.message || "verifique as credenciais.") }, 400);
    }

    const transactions = (gpData.transactions || []).filter((t: any) => PAID_STATUSES.has(t.status));

    // "pote" agora vive em org_lancamentos (uma linha por lançamento), não mais
    // dentro do bloco JSON único de org_data — evita reescrever o histórico
    // inteiro a cada sincronização.
    const { data: existingRows } = await admin
      .from("org_lancamentos")
      .select("payload")
      .eq("org_id", profile.org_id)
      .eq("tipo", "pote");
    const existingExtIds = new Set(
      (existingRows || []).map((r: any) => r.payload?.extId).filter(Boolean)
    );

    const newRows = [];
    for (const t of transactions) {
      const extId = "galaxpay:" + t.internalId;
      if (existingExtIds.has(extId)) continue;
      const appId = Math.random().toString(36).substr(2, 8);
      const dt = (t.payday || startDate).slice(0, 10);
      newRows.push({
        org_id: profile.org_id,
        tipo: "pote",
        app_id: appId,
        dt,
        payload: {
          id: appId,
          val: parseFloat(t.value) || 0,
          dt,
          obs: "GalaxPay · " + (t.statusDescription || t.status),
          extId,
        },
      });
    }

    let added = 0;
    if (newRows.length) {
      const { error: insErr } = await admin.from("org_lancamentos").insert(newRows);
      if (!insErr) added = newRows.length;
    }

    await admin
      .from("org_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_sync_count: added })
      .eq("org_id", profile.org_id);

    return json({ success: true, added, total: transactions.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
