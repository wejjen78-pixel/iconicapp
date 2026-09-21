// Edge Function: daily-goal-check
// Roda 1x por dia (agendada via cron) perto do fim do expediente e manda uma
// notificação push pra quem estiver com o faturamento do dia bem abaixo da
// meta diária — pro barbeiro (só o dele) e pro dono (visão da barbearia toda).
//
// Não é chamada pelo navegador: protegida por um segredo compartilhado
// (header "x-cron-secret"), configurado como CRON_SECRET nos secrets da função.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const THRESHOLD_PCT = Number(Deno.env.get("GOAL_ALERT_THRESHOLD_PCT") ?? "50");

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function diasNoMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function sumHoje(list: any[], hoje: string, getVal: (x: any) => number, bId?: number) {
  return list
    .filter((x) => x.dt === hoje && (bId === undefined || x.bId === bId))
    .reduce((a, x) => a + getVal(x), 0);
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:contato@iconicapp.com";
  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: "VAPID keys não configuradas." }), { status: 500 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: orgs, error: orgsErr } = await admin.from("organizations").select("id");
  if (orgsErr) return new Response(JSON.stringify({ error: orgsErr.message }), { status: 500 });

  const hoje = todayStr();
  const now = new Date();
  const dim = diasNoMes(now);

  let sent = 0;
  let evaluated = 0;
  const errors: string[] = [];

  for (const org of orgs || []) {
    const { data: row } = await admin.from("org_data").select("data").eq("org_id", org.id).single();
    const d = row?.data || {};
    const barbs: any[] = d.barbs || [];
    const avul: any[] = d.avul || [];
    const ext: any[] = d.ext || [];
    const extAv: any[] = d.extAv || [];
    const prod: any[] = d.prod || [];
    const pote: any[] = d.pote || [];
    const lote: any[] = d.lote || [];
    const orgMeta: number = d.meta || 0;

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, barbeiro_id")
      .eq("org_id", org.id);
    if (!subs?.length) continue;

    const alerts: { barbeiroId: string | null; pct: number }[] = [];

    // ── Dono: visão da barbearia inteira ──────────────────────────────────
    if (orgMeta > 0) {
      const metaDiaOrg = orgMeta / dim;
      const fatHoje =
        sumHoje(pote, hoje, (x) => x.val) +
        sumHoje(avul, hoje, (x) => x.val * (x.qt || 1)) +
        sumHoje(lote, hoje, (x) => x.vb) +
        sumHoje([...ext, ...extAv], hoje, (x) => x.val) +
        sumHoje(prod, hoje, (x) => x.val * (x.qt || 1));
      const pct = metaDiaOrg > 0 ? (fatHoje / metaDiaOrg) * 100 : 100;
      evaluated++;
      if (pct < THRESHOLD_PCT) alerts.push({ barbeiroId: null, pct });
    }

    // ── Cada barbeiro: só avulso + extras + produtos lançados no nome dele ─
    for (const b of barbs) {
      if (!b.meta) continue;
      const metaDiaB = b.meta / dim;
      const fatHojeB =
        sumHoje(avul, hoje, (x) => x.val * (x.qt || 1), b.id) +
        sumHoje([...ext, ...extAv], hoje, (x) => x.val, b.id) +
        sumHoje(prod, hoje, (x) => x.val * (x.qt || 1), b.id);
      const pct = metaDiaB > 0 ? (fatHojeB / metaDiaB) * 100 : 100;
      evaluated++;
      if (pct < THRESHOLD_PCT) alerts.push({ barbeiroId: String(b.id), pct });
    }

    for (const alert of alerts) {
      const targets = subs.filter((s) => (s.barbeiro_id || null) === alert.barbeiroId);
      const barbNome = alert.barbeiroId ? barbs.find((b) => String(b.id) === alert.barbeiroId)?.nome : null;
      const title = alert.barbeiroId ? "📉 Seu dia está abaixo da meta" : "📉 Faturamento de hoje abaixo da meta";
      const body = alert.barbeiroId
        ? `${(barbNome || "Você").split(" ")[0]}, o faturamento de hoje está em ${alert.pct.toFixed(0)}% da meta diária. Dá tempo de reverter!`
        : `A barbearia está em ${alert.pct.toFixed(0)}% da meta diária hoje.`;

      for (const sub of targets) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title, body }),
          );
          sent++;
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          } else {
            errors.push(String(e?.message || e));
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ evaluated, sent, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
