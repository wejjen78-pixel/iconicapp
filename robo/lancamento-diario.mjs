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
const PARTES = (process.env.PARTES || "appbarber,celcash,relatorio").split(",").map((s) => s.trim());

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
    await page.screenshot({ path: path.join(SAIDA, nome + ".png"), timeout: 15_000 });
  } catch (e) {
    log(`print ${nome} falhou: ${e.message}`);
  }
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
  await page.fill('input[name="email"]', exigir("ICONIC_EMAIL").trim());
  await page.fill('input[name="password"]', exigir("ICONIC_SENHA"));
  const tam = await page.evaluate(() => {
    const e = document.querySelector('input[name="email"]');
    return { email: e.value.length, emailValido: e.validity.valid, senha: document.querySelector('input[name="password"]').value.length };
  });
  registrar(`Iconic: campos preenchidos (e-mail ${tam.email} caracteres, senha ${tam.senha})`);
  if (!tam.emailValido) {
    throw new Error("o segredo ICONIC_EMAIL não está no formato de e-mail (ex.: nome@gmail.com) — o navegador não deixa enviar o login.");
  }
  const resposta = page.waitForResponse((r) => r.url().includes("/auth/v1/token"), { timeout: 30_000 }).catch(() => null);
  await page.click('button[type="submit"]');
  const r = await resposta;
  registrar(`Iconic: resposta do login: ${r ? "HTTP " + r.status() : "nenhum pedido de login saiu"}`);
  if (r && !r.ok()) {
    const corpo = await r.json().catch(() => ({}));
    throw new Error(`servidor recusou o login (HTTP ${r.status()}: ${corpo.error_description || corpo.msg || corpo.error || "?"}). Confira os segredos ICONIC_EMAIL/ICONIC_SENHA.`);
  }
  try {
    await page.getByText("Importar Excel", { exact: true }).first().waitFor({ timeout: 60_000 });
  } catch {
    await print(page, "iconic-login");
    const erro = await page.locator("form .card div, form div").filter({ hasText: /inválid|incorret|erro|Invalid/i }).first().innerText().catch(() => "");
    const texto = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(erro ? `mensagem do Iconic: "${erro}"` : `não chegou à tela principal. Tela: "${texto}"`);
  }
  log("Iconic: login ok");
  return { page, getApikey: () => apikey };
}

async function sessaoIconic(page) {
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
    return k ? JSON.parse(localStorage.getItem(k))?.access_token : null;
  });
}

// Relatórios do AppBarber importados no Iconic. Cada um tem seus tipos de
// lançamento, para a checagem de "dia já importado" ser independente.
const RELATORIOS = [
  { nome: "Serviços", tipo: "9", btn: "#btnDetalhesProSer", tabela: "tabelaRanking5", tipos: "svcs,avul,extAv" },
  { nome: "Produtos", tipo: "11", btn: "#btnDetalhesProPro", tabela: "tabelaRanking6", tipos: "prod" },
];

// Quantos lançamentos importados de Excel (src "pdf") já existem no dia.
async function importadosNoDia(page, apikey, tipos) {
  const token = await sessaoIconic(page);
  const url =
    `${SUPABASE_URL}/rest/v1/org_lancamentos?select=id&dt=eq.${DATA}` +
    `&tipo=in.(${tipos})&payload->>src=eq.pdf&limit=1`;
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

async function entrarAppBarber(context) {
  const page = await context.newPage();
  await page.goto(`${APPBARBER_URL}/login.php`, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
  return page;
}

async function exportarRelatorio(page, rel) {
  await page.goto(`${APPBARBER_URL}/index.php#/relGerencialRankings`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }); // tela limpa a cada relatório
  await page.locator("#DataIni").waitFor({ timeout: 60_000 });
  // A tela preenche datas padrão quando termina de carregar; espera isso
  // acontecer para não ter as nossas sobrescritas.
  await page.waitForFunction(() => document.getElementById("DataFim")?.value, null, { timeout: 30_000 });
  await page.waitForTimeout(2000);

  // Datas e tipo definidos pelo jQuery da página (a tela lê $("#DataIni").val()):
  // clicar nos campos abre um calendário que fica por cima do campo seguinte.
  const definir = () =>
    page.evaluate(
      ({ dataBr, tipo }) => {
        const $ = window.jQuery;
        $(".date.divDataIni").datepicker("update", dataBr);
        $(".date.divDataFim").datepicker("update", dataBr);
        $("#DataIni").val(dataBr);
        $("#DataFim").val(dataBr);
        $(".datepicker").hide();
        $("#ranTipo").val(tipo).trigger("change");
        return { di: $("#DataIni").val(), df: $("#DataFim").val(), tipo: $("#ranTipo").val() };
      },
      { dataBr: DATA_BR, tipo: rel.tipo }
    );
  let f = await definir();
  await page.waitForTimeout(1000);
  f = await definir(); // de novo, caso algo tenha mudado os campos no meio
  if (f.di !== DATA_BR || f.df !== DATA_BR || f.tipo !== rel.tipo) {
    await print(page, "appbarber-filtros");
    throw new Error(`não consegui definir os filtros do relatório de ${rel.nome} (datas ${f.di} a ${f.df}, tipo ${f.tipo}).`);
  }
  const busca = page.waitForResponse((r) => r.url().includes("buscaRelGerencialRankingv5"), { timeout: 60_000 }).catch(() => null);
  await page.click("#btnPesquisarRanking");
  const rb = await busca;
  log(`AppBarber ${rel.nome}: busca ${rb ? "HTTP " + rb.status() : "não respondeu"}`);

  // Sem vendas no dia, o AppBarber não mostra o botão Detalhes.
  const detalhes = page.locator(rel.btn);
  const temDados = await detalhes.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
  if (!temDados) return { arquivo: null, total: 0 };

  // A tabela de detalhes carrega por AJAX depois de abrir; espera a resposta.
  const detResp = page.waitForResponse((r) => r.url().includes("buscaRelGerencialRankingv5"), { timeout: 60_000 }).catch(() => null);
  await detalhes.click();
  await detResp;
  const info = page.locator(`#${rel.tabela}_info`);
  await info.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const textoInfo = await info.innerText();
  const total = Number(textoInfo.match(/de\s+(\d+)\s+registros/)?.[1] || 0);
  if (!total) return { arquivo: null, total: 0 };

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(`a.buttons-excel[aria-controls="${rel.tabela}"]`).click(),
  ]);
  const arquivo = path.join(SAIDA, `appbarber-${rel.nome.toLowerCase()}-${DIA}${MES}${ANO}.xlsx`);
  await download.saveAs(arquivo);
  log(`AppBarber ${rel.nome}: Excel baixado (${total} registros)`);
  return { arquivo, total };
}

async function importarNoIconic(page, arquivo, total, rel) {
  await abrirAba(page, "Importar Excel");
  const outro = page.getByRole("button", { name: "Importar outro" });
  if (await outro.isVisible().catch(() => false)) await outro.click();
  await page.locator('input[type="file"][accept*=".xlsx"]').setInputFiles(arquivo);
  await page.getByRole("button", { name: "Analisar" }).click();
  // O resultado da análise fica no card ("✅ N registros lidos"); o aviso flutuante é ignorado.
  const lidos = page.getByText(/^✅ \d+ registros lidos/).last();
  await lidos.waitFor({ timeout: 60_000 });
  const n = Number((await lidos.innerText()).match(/(\d+) registros lidos/)[1]);
  await print(page, `iconic-analise-${rel.nome.toLowerCase()}`);
  if (n !== total) throw new Error(`${rel.nome}: Iconic leu ${n} registros, mas o AppBarber tem ${total}. Nada aplicado.`);

  if (PREVIA) {
    registrar(`AppBarber ${rel.nome} ${DATA_BR}: ${total} registros (PRÉVIA — não aplicado).`);
    return;
  }
  await page.getByRole("button", { name: /Aplicar todos/ }).click();
  await page.getByText(new RegExp(`${n} registros aplicados!`)).first().waitFor({ timeout: 60_000 });
  await print(page, `iconic-aplicado-${rel.nome.toLowerCase()}`);
}

// O app salva sozinho ~1s depois de aplicar; espera os lançamentos aparecerem no banco.
async function esperarSalvo(iconic, rel) {
  for (let i = 0; i < 20; i++) {
    await iconic.page.waitForTimeout(3000);
    if ((await importadosNoDia(iconic.page, iconic.getApikey(), rel.tipos)) > 0) return;
  }
  throw new Error(`${rel.nome}: importação aplicada, mas os lançamentos não apareceram salvos no banco em 60 s.`);
}

async function parteAppBarber(context, iconic) {
  let appbarber = null;
  for (const rel of RELATORIOS) {
    try {
      const ja = await importadosNoDia(iconic.page, iconic.getApikey(), rel.tipos);
      if (ja > 0 && !PREVIA) {
        registrar(`AppBarber ${rel.nome} ${DATA_BR}: dia já tem lançamentos importados — pulado.`);
        continue;
      }
      // Na prévia segue até a análise mesmo com o dia já importado (nada é aplicado),
      // para testar o login e a exportação.
      if (ja > 0) registrar(`AppBarber ${rel.nome} ${DATA_BR}: dia já importado — prévia segue só para testar.`);
      appbarber ||= await entrarAppBarber(context);
      const { arquivo, total } = await exportarRelatorio(appbarber, rel);
      if (!arquivo) {
        registrar(`AppBarber ${rel.nome} ${DATA_BR}: nada no relatório do dia.`);
        continue;
      }
      await importarNoIconic(iconic.page, arquivo, total, rel);
      if (!PREVIA) {
        await esperarSalvo(iconic, rel);
        registrar(`AppBarber ${rel.nome} ${DATA_BR}: ${total} registros importados e salvos no Iconic.`);
      }
    } catch (e) {
      if (appbarber) await print(appbarber, `erro-appbarber-${rel.nome.toLowerCase()}`);
      falhas.push(`AppBarber ${rel.nome}: ${e.message}`);
    }
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

// ── Parte C: mini relatório (sininho + notificação no celular) ─────────────

const VAPID_PUBLICA = "BDRu0BVE2knfRY4OQ97MJRU8i2RjqYC5rjmxqAn26JUXLvOYQKnCtT-gOrJRfZt9BQqvQ23C93Lo6mU3Ll8ObQg";
const reais = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function restIconic(iconic, metodo, caminho, corpo, extras = {}) {
  const token = await sessaoIconic(iconic.page);
  return iconic.page.evaluate(
    async ({ url, metodo, corpo, headers }) => {
      const res = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    },
    {
      url: `${SUPABASE_URL}/rest/v1/${caminho}`,
      metodo,
      corpo,
      headers: { apikey: iconic.getApikey(), Authorization: "Bearer " + token, "Content-Type": "application/json", ...extras },
    }
  );
}

function textoBarbeiro(r) {
  const nome = r.nome.split(" ")[0];
  const meta = r.realizado >= r.metaDia
    ? `✅ Bateu a meta: ${reais(r.realizado)} de ${reais(r.metaDia)}`
    : `💰 Realizado ${reais(r.realizado)} · Meta ${reais(r.metaDia)} → faltaram ${reais(r.metaDia - r.realizado)}`;
  const linhas = [meta, `✂️ ${r.atend} atendimento(s) · ✨ ${r.extras} extra(s) · 🧴 ${r.produtos} produto(s)`];
  if (r.semVenda > 0) linhas.push(`⚠️ ${r.semVenda} atendimento(s) sem venda de extra/produto`);
  return { titulo: `${nome}, seu dia ${DIA}/${MES}`, corpo: linhas.join("\n") };
}

function textoDono(lista) {
  const linhas = lista.map((r) => {
    const nome = r.nome.split(" ")[0];
    return r.realizado >= r.metaDia
      ? `✅ ${nome}: ${reais(r.realizado)} de ${reais(r.metaDia)}`
      : `❌ ${nome}: ${reais(r.realizado)} de ${reais(r.metaDia)} (faltaram ${reais(r.metaDia - r.realizado)})`;
  });
  const atend = lista.reduce((t, r) => t + r.atend, 0);
  const sem = lista.reduce((t, r) => t + r.semVenda, 0);
  linhas.push(`⚠️ ${sem} de ${atend} atendimento(s) sem venda de extra/produto`);
  return { titulo: `Equipe ${DIA}/${MES}: ${lista.filter((r) => r.realizado >= r.metaDia).length} de ${lista.length} bateram a meta`, corpo: linhas.join("\n") };
}

async function parteRelatorio(iconic) {
  // Recarrega para o app já ter os lançamentos de hoje (serviços, produtos, pote).
  await iconic.page.reload({ waitUntil: "domcontentloaded" });
  await iconic.page.waitForFunction(() => window.__iconic?.pronto === true, null, { timeout: 90_000 });
  await iconic.page.waitForTimeout(3000);
  const lista = await iconic.page.evaluate((d) => window.__iconic.resumoDia(d), DATA);
  if (!lista.length) {
    registrar(`Relatório ${DATA_BR}: nenhum barbeiro com movimento no dia — nada enviado.`);
    return;
  }

  const avisos = [
    ...lista.map((r) => ({ barbeiro_id: String(r.bId), chave: `${DATA}:${r.bId}`, ...textoBarbeiro(r), dados: r })),
    { barbeiro_id: null, chave: `${DATA}:equipe`, ...textoDono(lista), dados: { barbeiros: lista } },
  ];
  if (PREVIA) {
    for (const a of avisos) registrar(`Relatório (PRÉVIA) · ${a.titulo} — ${a.corpo.replace(/\n/g, " | ")}`);
    return;
  }

  const ins = await restIconic(
    iconic, "POST", "avisos?on_conflict=org_id,chave",
    avisos.map((a) => ({ ...a, dt: DATA, lido: false })),
    { Prefer: "resolution=merge-duplicates,return=minimal" }
  );
  if (!ins.ok) throw new Error(`não consegui gravar os avisos (HTTP ${ins.status}: ${ins.body?.message || "?"}).`);

  const subs = await restIconic(iconic, "GET", "push_subs?select=id,role,barbeiro_id,sub");
  if (!subs.ok) throw new Error(`não consegui ler as inscrições de notificação (HTTP ${subs.status}).`);
  const privada = process.env.VAPID_PRIVADA;
  if (!privada) {
    registrar(`Relatório ${DATA_BR}: ${avisos.length} aviso(s) no sininho; notificação no celular desligada (segredo VAPID_PRIVADA não configurado).`);
    return;
  }
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(ICONIC_URL, VAPID_PUBLICA, privada);

  let enviadas = 0, falhou = 0;
  for (const s of subs.body) {
    const aviso = s.role === "dono"
      ? avisos.find((a) => a.barbeiro_id === null)
      : avisos.find((a) => a.barbeiro_id === String(s.barbeiro_id));
    if (!aviso) continue; // barbeiro sem movimento no dia
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ titulo: aviso.titulo, corpo: aviso.corpo, tag: aviso.chave, url: "./?avisos=1" }));
      enviadas++;
    } catch (e) {
      falhou++;
      // 404/410: o aparelho cancelou a inscrição — remove para não tentar de novo.
      if (e.statusCode === 404 || e.statusCode === 410) await restIconic(iconic, "DELETE", `push_subs?id=eq.${s.id}`);
      else log(`push falhou (${e.statusCode || "?"}): ${e.body || e.message}`);
    }
  }
  registrar(`Relatório ${DATA_BR}: ${avisos.length} aviso(s) no sininho; ${enviadas} notificação(ões) enviada(s)${falhou ? `, ${falhou} falharam` : ""}.`);
}

// ── Aviso de falha para o dono (sininho + notificação) ─────────────────────
// Só funciona se o login no Iconic deu certo (é ele que dá acesso ao banco);
// se o próprio login falhar, sobra o e-mail que o GitHub manda quando o job falha.

async function avisarFalha(iconic, falhas) {
  const execucao = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "";
  const aviso = {
    barbeiro_id: null,
    chave: `${DATA}:falha`,
    dt: DATA,
    lido: false,
    titulo: `⚠️ Lançamento de ${DIA}/${MES} com problema`,
    corpo: falhas.map((f) => "• " + f.slice(0, 160)).join("\n") + "\nConfira o dia no Iconic ou rode o robô de novo pelo GitHub.",
    dados: { falhas, execucao },
  };
  const ins = await restIconic(iconic, "POST", "avisos?on_conflict=org_id,chave", [aviso], { Prefer: "resolution=merge-duplicates,return=minimal" });
  if (!ins.ok) log(`aviso de falha não gravado (HTTP ${ins.status})`);

  const privada = process.env.VAPID_PRIVADA;
  const subs = await restIconic(iconic, "GET", "push_subs?select=id,sub&role=eq.dono");
  if (!privada || !subs.ok || !subs.body.length) {
    registrar("Aviso de falha: gravado no sininho (sem notificação no celular — nenhum aparelho do dono ativado).");
    return;
  }
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(ICONIC_URL, VAPID_PUBLICA, privada);
  let enviadas = 0;
  for (const s of subs.body) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ titulo: aviso.titulo, corpo: aviso.corpo, tag: aviso.chave, url: "./?avisos=1" }));
      enviadas++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await restIconic(iconic, "DELETE", `push_subs?id=eq.${s.id}`);
    }
  }
  registrar(`Aviso de falha: gravado no sininho e enviado para ${enviadas} aparelho(s) do dono.`);
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
    await parteAppBarber(context, iconic);
  }
  if (PARTES.includes("relatorio")) {
    try { await parteRelatorio(iconic); } catch (e) { falhas.push("Relatório: " + e.message); await print(iconic.page, "erro-relatorio"); }
  }
  // TESTAR_AVISO=1 (disparo manual) simula uma falha para conferir o aviso no celular.
  if (process.env.TESTAR_AVISO === "1") falhas.push("Teste do aviso de falha (nada deu errado de verdade).");
  if (falhas.length && (!PREVIA || process.env.TESTAR_AVISO === "1")) {
    try { await avisarFalha(iconic, falhas); } catch (e) { log("aviso de falha não enviado: " + e.message); }
  }
}

await browser.close();

for (const f of falhas) registrar("❌ " + f);
const md = `### Lançamento diário — ${DATA_BR}${PREVIA ? " (prévia)" : ""}\n\n${resumo.map((l) => "- " + l).join("\n")}\n`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
// O teste do aviso (TESTAR_AVISO) não conta como falha de verdade.
process.exit(falhas.filter((f) => !f.startsWith("Teste do aviso")).length ? 1 : 0);
