// Script de uso único (leitura): confere as taxas de comissão configuradas
// (data.txB / data.txBar em org_data) — não grava nada.
// Variáveis: ICONIC_EMAIL, ICONIC_SENHA (segredos do GitHub).

import { chromium } from "playwright";

const ICONIC_URL = "https://wejjen78-pixel.github.io/iconicapp/";
const SUPABASE_URL = "https://hjihmdlpntrnjkduwelp.supabase.co";

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

const resp = await page.evaluate(
  async ({ url, token, apikey }) => {
    const res = await fetch(url, { headers: { apikey, Authorization: "Bearer " + token } });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  },
  { url: `${SUPABASE_URL}/rest/v1/org_data?select=data-%3E%3EtxB,data-%3E%3EtxBar`, token, apikey }
);
if (!resp.ok) throw new Error(`Falha ao consultar (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
log(`Taxas configuradas agora: ${JSON.stringify(resp.body[0])}`);

await browser.close();
