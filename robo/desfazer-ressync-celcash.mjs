// Script de emergência (uso único): desfaz os lançamentos de "pote" que a
// ressincronização de Cel Cash em intervalo (01/10 a 31/10) duplicou, porque
// o dono já lançava esses dias à mão antes do robô existir — os lançamentos
// manuais não têm "extId", então a checagem de duplicidade (que só olha
// extId) não os viu e inseriu tudo de novo.
//
// Alvo: linhas org_lancamentos com tipo=pote, payload->>extId começando com
// "galaxpay:" e criadas dentro da janela de execução do backfill (02/11,
// ~19:55 a 20:00 UTC) — não toca em nada sincronizado em dias anteriores
// (esses são legítimos, de dias que o robô já cobria sozinho).
//
// Variáveis: ICONIC_EMAIL, ICONIC_SENHA (segredos do GitHub).
// CONFIRMAR=1 para apagar de verdade; sem isso, só mostra quantos/quanto seria apagado.

import { chromium } from "playwright";

const ICONIC_URL = "https://wejjen78-pixel.github.io/iconicapp/";
const SUPABASE_URL = "https://hjihmdlpntrnjkduwelp.supabase.co";
const JANELA_DE = "2026-11-02T19:55:00Z";
const JANELA_ATE = "2026-11-02T20:00:00Z";
const CONFIRMAR = process.env.CONFIRMAR === "1";

function exigir(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Segredo ${nome} não configurado no GitHub.`);
  return v;
}
function log(...a) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
}

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await context.newPage();

let apikey = null;
page.on("request", (req) => {
  if (!apikey && req.url().startsWith(SUPABASE_URL)) apikey = req.headers()["apikey"] || null;
});

await page.goto(ICONIC_URL, { waitUntil: "networkidle" });
await page.fill('input[name="email"]', exigir("ICONIC_EMAIL").trim());
await page.fill('input[name="password"]', exigir("ICONIC_SENHA"));
const resposta = page.waitForResponse((r) => r.url().includes("/auth/v1/token"), { timeout: 30_000 }).catch(() => null);
await page.click('button[type="submit"]');
const r = await resposta;
if (r && !r.ok()) throw new Error(`Login recusado (HTTP ${r.status()}).`);
await page.getByText("Importar Excel", { exact: true }).first().waitFor({ timeout: 60_000 });
log("Iconic: login ok");

const token = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
  return k ? JSON.parse(localStorage.getItem(k))?.access_token : null;
});

const filtro =
  `tipo=eq.pote&payload->>extId=like.galaxpay:*` +
  `&criado_em=gte.${encodeURIComponent(JANELA_DE)}&criado_em=lte.${encodeURIComponent(JANELA_ATE)}`;

const selecionados = await page.evaluate(
  async ({ url, token, apikey }) => {
    const res = await fetch(url, { headers: { apikey, Authorization: "Bearer " + token } });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  },
  { url: `${SUPABASE_URL}/rest/v1/org_lancamentos?select=id,dt,payload&${filtro}&order=dt.asc`, token, apikey }
);
if (!selecionados.ok) throw new Error(`Falha ao consultar (HTTP ${selecionados.status}): ${JSON.stringify(selecionados.body)}`);

const linhas = selecionados.body;
const total = linhas.reduce((s, l) => s + (Number(l.payload?.val) || 0), 0);
const primeiraDt = linhas[0]?.dt;
const ultimaDt = linhas[linhas.length - 1]?.dt;
log(`Encontradas ${linhas.length} linhas pra desfazer, somando R$ ${total.toFixed(2)}, de ${primeiraDt} a ${ultimaDt}.`);

if (!CONFIRMAR) {
  log("Modo consulta (CONFIRMAR não é 1) — nada foi apagado.");
} else {
  const del = await page.evaluate(
    async ({ url, token, apikey }) => {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { apikey, Authorization: "Bearer " + token, Prefer: "return=representation" },
      });
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    },
    { url: `${SUPABASE_URL}/rest/v1/org_lancamentos?${filtro}`, token, apikey }
  );
  if (!del.ok) throw new Error(`Falha ao apagar (HTTP ${del.status}): ${JSON.stringify(del.body)}`);
  log(`Apagadas ${del.body.length} linhas.`);
}

await browser.close();
