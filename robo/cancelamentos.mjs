// Aviso de cancelamento de assinante — roda de hora em hora no GitHub Actions
// (.github/workflows/avisos-cancelamento.yml). Sem navegador: entra no Supabase
// como o dono, pergunta à galaxpay-sync quais assinaturas foram canceladas desde
// ontem e avisa o dono (sininho + celular) uma única vez por assinatura.
//
// Segredos: ICONIC_EMAIL, ICONIC_SENHA, VITE_SUPABASE_ANON_KEY, VAPID_PRIVADA

import webpush from "web-push";

const SUPABASE_URL = "https://hjihmdlpntrnjkduwelp.supabase.co";
const ICONIC_URL = "https://wejjen78-pixel.github.io/iconicapp/";
const VAPID_PUBLICA = "BDRu0BVE2knfRY4OQ97MJRU8i2RjqYC5rjmxqAn26JUXLvOYQKnCtT-gOrJRfZt9BQqvQ23C93Lo6mU3Ll8ObQg";
const reais = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function exigir(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Segredo ${nome} não configurado no GitHub.`);
  return v;
}

const diaSP = (deslocDias = 0) => {
  const d = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + deslocDias);
  return d.toISOString().slice(0, 10);
};

const apikey = exigir("VITE_SUPABASE_ANON_KEY");
const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey, "Content-Type": "application/json" },
  body: JSON.stringify({ email: exigir("ICONIC_EMAIL").trim(), password: exigir("ICONIC_SENHA") }),
}).then((r) => r.json());
if (!login.access_token) throw new Error("Login no Iconic falhou: " + (login.error_description || login.msg || "?"));
const headers = { apikey, Authorization: "Bearer " + login.access_token, "Content-Type": "application/json" };

const rest = async (metodo, caminho, corpo, extras = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { ...headers, ...extras },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
};

const resp = await fetch(`${SUPABASE_URL}/functions/v1/galaxpay-sync`, {
  method: "POST",
  headers,
  body: JSON.stringify({ acao: "cancelamentos", desde: diaSP(-1) }),
}).then((r) => r.json());
if (resp.error) throw new Error("Cel Cash: " + resp.error);

const novos = [];
for (const c of resp.cancelamentos) {
  const chave = `cancel:${c.id}`;
  const ja = await rest("GET", `avisos?select=id&chave=eq.${encodeURIComponent(chave)}&limit=1`);
  if (ja.ok && ja.body.length) continue; // já avisado
  novos.push({
    barbeiro_id: null,
    chave,
    dt: diaSP(),
    lido: false,
    titulo: `❌ ${c.cliente || "Assinante"} cancelou o plano`,
    corpo: `${c.plano ? c.plano + " · " : ""}${reais(c.valor)}/mês\nCancelado em ${c.cancelada.split(" ")[0].split("-").reverse().join("/")}. Vale um contato para entender o motivo.`,
    dados: c,
  });
}
console.log(`${resp.cancelamentos.length} cancelamento(s) desde ${resp.desde}; ${novos.length} novo(s) para avisar.`);
if (!novos.length) process.exit(0);

const ins = await rest("POST", "avisos?on_conflict=org_id,chave", novos, { Prefer: "resolution=ignore-duplicates,return=minimal" });
if (!ins.ok) throw new Error(`Não consegui gravar os avisos (HTTP ${ins.status}).`);

const subs = await rest("GET", "push_subs?select=id,sub&role=eq.dono");
const privada = process.env.VAPID_PRIVADA;
if (!privada || !subs.ok || !subs.body.length) {
  console.log("Avisos gravados no sininho; nenhum aparelho do dono para notificar.");
  process.exit(0);
}
webpush.setVapidDetails(ICONIC_URL, VAPID_PUBLICA, privada);
for (const a of novos) {
  for (const s of subs.body) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ titulo: a.titulo, corpo: a.corpo, tag: a.chave, url: "./?avisos=1" }));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await rest("DELETE", `push_subs?id=eq.${s.id}`);
      else console.log(`push falhou (${e.statusCode || "?"})`);
    }
  }
}
console.log(`Notificação enviada para ${subs.body.length} aparelho(s) do dono.`);
