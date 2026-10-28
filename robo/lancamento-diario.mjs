// Robô do lançamento diário — roda no GitHub Actions (.github/workflows/lancamento-diario.yml).
//
// Para o dia alvo (padrão: ontem, horário de Brasília):
//   A) AppBarber: exporta o "Ranking Profissional x Serviço" em Excel e importa
//      no Iconic pela própria tela "Importar Excel" (mesma lógica de quando o
//      dono faz à mão). Pula se o dia já tiver lançamentos importados.
//   B) Cel Cash: chama a Edge Function galaxpay-sync (só planos) para o dia.
//
// Variáveis de ambiente (segredos do GitHub):
//   APPBARBER_EMAIL, APPBARBER_SENHA, ICONIC_EMAIL, ICONIC_SENHA
// Opcionais: DATA=AAAA-MM-DD (dia alvo), PREVIA=1 (não grava nada), PARTES=appbarber,celcash

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ICONIC_URL = "https://wejjen78-pixel.github.io/iconicapp/";
const APPBARBER_URL = "https://sistema.appbarber.com.br";
const SUPABASE_URL = "https://hjihmdlpntrnjkduwelp.supabase.co";
const SAIDA = path.resolve("saida");

const PREVIA = process.env.PREVIA === "1";
const PARTES = (process.env.PARTES || "appbarber,celcash").split(",").map((s) => s.trim());

function ontemSP() {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const d = new Date(hoje + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const DATA = process.env.DATA || ontemSP();
const [ANO, MES, DIA] = DATA.split("-");
const DATA_BR = `${DIA}/${MES}/${ANO}`;

function exigir(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Segredo ${nome} não configurado no GitHub.`);
  return v;
}

function log(...a) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
}

const resumo = [];
function registrar(linha) {
  log(linha);
  resumo.push(linha);
}

async function print(page, nome) {
  try {
    await page.screenshot({ path: path.join(SAIDA, nome + ".png"), fullPage: true });
  } catch {}
}

// ── Iconic ─────────────────────────────────────────────────────────────────

async function entrarIconic(context) {
  const page = await context.newPage();
  // Guarda a apikey que o próprio app manda ao Supabase, para consultas REST.
  let apikey = null;
  page.on("request", (req) => {
    if (!apikey && req.url().startsWith(SUPABASE_URL)) apikey = req.headers()["apikey"] || null;
  });
  await page.goto(ICONIC_URL, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', exigir("ICONIC_EMAIL"));
  await page.fill('input[name="password"]', exigir("ICONIC_SENHA"));
  await page.click('button[type="submit"]');
  await page.getByText("Importar Excel", { exact: true }).first().waitFor({ timeout: 60_000 });
  log("Iconic: login ok");
  return { page, getApikey: () => apikey };
}

async function sessaoIconic(page) {
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
    return k ? JSON.parse(localStorage.getItem(k))?.access_token : null;
  });
}

// Quantos lançamentos importados de Excel (src "pdf") já existem no dia.
async function importadosNoDia(page, apikey) {
  const token = await sessaoIconic(page);
  const url =
    `${SUPABASE_URL}/rest/v1/org_lancamentos?select=id&dt=eq.${DATA}` +
    `&tipo=in.(svcs,avul,extAv,prod)&payload->>src=eq.pdf&limit=1`;
  const r = await page.evaluate(
    async ({ url, token, apikey }) => {
      const res = await fetch(url, { headers: { apikey, Authorization: "Bearer " + token } });
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    },
    { url, token, apikey }
  );
  if (!r.ok) throw new Error(`Falha ao consultar lançamentos do dia (HTTP ${r.status}).`);
  return r.body.length;
}

async function abrirAba(page, nome) {
  await page.getByText(nome, { exact: true }).first().click();
  await page.waitForTimeout(1500);
}

// ── Parte A: AppBarber → Iconic ────────────────────────────────────────────

async function exportarAppBarber(context) {
  const page = await context.newPage();
  await page.goto(`${APPBARBER_URL}/login.php`, { waitUntil: "networkidle" });
  const rejeitar = page.getByText("Rejeitar não essenciais");
  if (await rejeitar.isVisible().catch(() => false)) await rejeitar.click();

  await page.fill("#login-name", exigir("APPBARBER_EMAIL"));
  await page.fill("#login-pass", exigir("APPBARBER_SENHA"));
  await page.click("#login-button");

  // Ou entra no sistema, ou pede verificação em duas etapas, ou mostra erro.
  const resultado = await Promise.race([
    page.waitForURL(/index\.php/, { timeout: 60_000 }).then(() => "ok"),
    page.locator("#frm2fa").waitFor({ state: "visible", timeout: 60_000 }).then(() => "2fa"),
  ]).catch(() => "timeout");
  if (resultado !== "ok") {
    await print(page, "appbarber-login");
    if (resultado === "2fa") throw new Error("AppBarber pediu verificação em duas etapas (código) — o robô não consegue responder.");
    throw new Error("AppBarber não completou o login (possível bloqueio do reCAPTCHA ou senha errada). Veja appbarber-login.png.");
  }
  log("AppBarber: login ok");

  await page.goto(`${APPBARBER_URL}/index.php#/relGerencialRankings`, { waitUntil: "networkidle" });
  await page.locator("#DataIni").waitFor({ timeout: 60_000 });
  for (const id of ["#DataIni", "#DataFim"]) {
    await page.click(id, { clickCount: 3 });
    await page.keyboard.type(DATA_BR);
    await page.keyboard.press("Escape");
  }
  // O select do tipo é escondido por um plugin (select2): define pelo jQuery.
  await page.evaluate(() => {
    const s = document.getElementById("ranTipo");
    s.value = "9"; // Profissional x Serviços(Quantidade)
    window.jQuery(s).val("9").trigger("change");
  });
  await page.click("#btnPesquisarRanking");

  const detalhes = page.locator("#btnDetalhesProSer");
  const temDados = await detalhes.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
  if (!temDados) {
    await print(page, "appbarber-relatorio");
    return { arquivo: null, total: 0 };
  }
  await detalhes.click();
  const info = page.locator("#tabelaRanking5_info");
  await info.waitFor({ timeout: 30_000 });
  const total = Number((await info.innerText()).match(/de\s+(\d+)\s+registros/)?.[1] || 0);
  if (!total) return { arquivo: null, total: 0 };

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator('a.buttons-excel[aria-controls="tabelaRanking5"]').click(),
  ]);
  const arquivo = path.join(SAIDA, `appbarber-${DIA}${MES}${ANO}.xlsx`);
  await download.saveAs(arquivo);
  log(`AppBarber: Excel baixado (${total} registros)`);
  await page.close();
  return { arquivo, total };
}

async function importarNoIconic(page, arquivo, total) {
  await abrirAba(page, "Importar Excel");
  await page.locator('input[type="file"][accept*=".xlsx"]').setInputFiles(arquivo);
  await page.getByRole("button", { name: "Analisar" }).click();
  const lidos = page.getByText(/\d+ registros lidos/).last();
  await lidos.waitFor({ timeout: 60_000 });
  const n = Number((await lidos.innerText()).match(/(\d+) registros lidos/)[1]);
  await print(page, "iconic-analise");
  if (n !== total) throw new Error(`Iconic leu ${n} registros, mas o AppBarber tem ${total}. Nada aplicado.`);

  if (PREVIA) {
    registrar(`AppBarber ${DATA_BR}: ${total} registros (PRÉVIA — não aplicado).`);
    return;
  }
  await page.getByRole("button", { name: /Aplicar todos/ }).click();
  await page.getByText(/registros aplicados!/).first().waitFor({ timeout: 60_000 });
  await print(page, "iconic-aplicado");
}

// O app salva sozinho ~1s depois de aplicar; espera os lançamentos aparecerem no banco.
async function esperarSalvo(iconic) {
  for (let i = 0; i < 20; i++) {
    await iconic.page.waitForTimeout(3000);
    if ((await importadosNoDia(iconic.page, iconic.getApikey())) > 0) return;
  }
  throw new Error("Importação aplicada, mas os lançamentos não apareceram salvos no banco em 60 s.");
}

async function parteAppBarber(context, iconic) {
  const ja = await importadosNoDia(iconic.page, iconic.getApikey());
  if (ja > 0) {
    registrar(`AppBarber ${DATA_BR}: dia já tem lançamentos importados — pulado.`);
    return;
  }
  const { arquivo, total } = await exportarAppBarber(context);
  if (!arquivo) {
    registrar(`AppBarber ${DATA_BR}: sem atendimentos no relatório.`);
    return;
  }
  await importarNoIconic(iconic.page, arquivo, total);
  if (!PREVIA) {
    await esperarSalvo(iconic);
    registrar(`AppBarber ${DATA_BR}: ${total} registros importados e salvos no Iconic.`);
  }
}

// ── Parte B: Cel Cash → pote ───────────────────────────────────────────────

async function parteCelCash(iconic) {
  const token = await sessaoIconic(iconic.page);
  const r = await iconic.page.evaluate(
    async ({ url, token, body }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(body),
      });
      return res.json().catch(() => ({ error: "Resposta inválida (HTTP " + res.status + ")" }));
    },
    { url: `${SUPABASE_URL}/functions/v1/galaxpay-sync`, token, body: { date: DATA, dryRun: PREVIA } }
  );
  if (r.error) throw new Error("Cel Cash: " + r.error);
  const fora = r.foraDoPlano?.qtd ? ` (${r.foraDoPlano.qtd} avulso(s) de R$ ${r.foraDoPlano.valor} ficaram de fora)` : "";
  if (PREVIA) {
    registrar(`Cel Cash ${DATA_BR}: ${r.novas} pagamento(s) de planos, R$ ${r.valorNovas} (PRÉVIA — não lançado)${fora}.`);
  } else {
    registrar(`Cel Cash ${DATA_BR}: ${r.added} pagamento(s) de planos lançados no pote, R$ ${r.valorNovas}${r.jaLancadas ? `; ${r.jaLancadas} já estavam lançados` : ""}${fora}.`);
  }
}

// ── Execução ───────────────────────────────────────────────────────────────

fs.mkdirSync(SAIDA, { recursive: true });
log(`Dia alvo: ${DATA_BR}${PREVIA ? " (PRÉVIA)" : ""} · partes: ${PARTES.join(", ")}`);

const browser = await chromium.launch();
const context = await browser.newContext({
  acceptDownloads: true,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  viewport: { width: 1440, height: 900 },
});

const falhas = [];
let iconic = null;
try {
  iconic = await entrarIconic(context);
} catch (e) {
  falhas.push("Iconic: login falhou — " + e.message);
}

if (iconic) {
  if (PARTES.includes("celcash")) {
    try { await parteCelCash(iconic); } catch (e) { falhas.push(e.message); await print(iconic.page, "erro-celcash"); }
  }
  if (PARTES.includes("appbarber")) {
    try { await parteAppBarber(context, iconic); } catch (e) { falhas.push("AppBarber: " + e.message); await print(iconic.page, "erro-appbarber-iconic"); }
  }
}

await browser.close();

for (const f of falhas) registrar("❌ " + f);
const md = `### Lançamento diário — ${DATA_BR}${PREVIA ? " (prévia)" : ""}\n\n${resumo.map((l) => "- " + l).join("\n")}\n`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.exit(falhas.length ? 1 : 0);
