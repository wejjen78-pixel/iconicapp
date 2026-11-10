// Script de investigação (uso único, só leitura): navega até o relatório
// "Dias Sem vir (Último Agendamento)" no AppBarber e imprime a ESTRUTURA da
// tela (ids/seletores de filtros, cabeçalhos de coluna, rota da página) —
// nunca o conteúdo das linhas (nome/telefone/e-mail de cliente), porque o
// log desta Action é público.
//
// Variáveis: APPBARBER_EMAIL, APPBARBER_SENHA (segredos do GitHub).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const APPBARBER_URL = "https://sistema.appbarber.com.br";
const SAIDA = path.resolve("saida");
fs.mkdirSync(SAIDA, { recursive: true });

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

await page.goto(`${APPBARBER_URL}/login.php`, { waitUntil: "domcontentloaded", timeout: 60_000 });
const rejeitar = page.getByText("Rejeitar não essenciais");
if (await rejeitar.isVisible().catch(() => false)) await rejeitar.click();
await page.fill("#login-name", exigir("APPBARBER_EMAIL"));
await page.fill("#login-pass", exigir("APPBARBER_SENHA"));
await page.click("#login-button");
const resultado = await Promise.race([
  page.waitForURL(/index\.php/, { timeout: 60_000 }).then(() => "ok"),
  page.locator("#frm2fa").waitFor({ state: "visible", timeout: 60_000 }).then(() => "2fa"),
]).catch(() => "timeout");
if (resultado !== "ok") {
  if (resultado === "2fa") throw new Error("AppBarber pediu verificação em duas etapas — o robô não consegue responder.");
  throw new Error("AppBarber não completou o login (possível bloqueio do reCAPTCHA ou senha errada).");
}
log("AppBarber: login ok");

// Tenta abrir o menu lateral Relatórios → Agendamentos → Clientes clicando pelo texto visível
// (não dependemos de saber a rota de antemão).
async function tentarClicar(texto) {
  const loc = page.getByText(texto, { exact: true }).first();
  const visivel = await loc.isVisible().catch(() => false);
  if (visivel) {
    await loc.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

await page.waitForTimeout(2000);
const abriuRelatorios = await tentarClicar("Relatórios");
log(`Cliquei em "Relatórios": ${abriuRelatorios}`);
const abriuAgendamentos = await tentarClicar("Agendamentos");
log(`Cliquei em "Agendamentos": ${abriuAgendamentos}`);
const abriuClientes = await tentarClicar("Clientes");
log(`Cliquei em "Clientes": ${abriuClientes}`);
await page.waitForTimeout(2500);

const url = page.url();
log(`URL atual: ${url}`);

// Estrutura dos filtros (selects, inputs, botões) — só ids/labels/opções, nunca dados de linha.
const estrutura = await page.evaluate(() => {
  const selects = Array.from(document.querySelectorAll("select")).map((s) => ({
    id: s.id || null,
    name: s.name || null,
    options: Array.from(s.options).map((o) => ({ value: o.value, text: o.text.trim() })),
  }));
  const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
    id: i.id || null,
    name: i.name || null,
    type: i.type,
    placeholder: i.placeholder || null,
  }));
  const botoes = Array.from(document.querySelectorAll("button, a.btn, a[class*='btn']")).map((b) => ({
    id: b.id || null,
    classe: b.className || null,
    texto: (b.innerText || "").trim().slice(0, 40),
  })).filter((b) => b.texto || b.id);
  // Cabeçalhos de tabela: são só rótulos de coluna (Cliente, Celular, etc.), nunca dado de linha.
  const tabelas = Array.from(document.querySelectorAll("table")).map((t) => ({
    id: t.id || null,
    classe: t.className || null,
    cabecalhos: Array.from(t.querySelectorAll("thead th")).map((th) => th.innerText.trim()),
  }));
  return { selects, inputs, botoes, tabelas, titulo: document.title };
});

log("=== ESTRUTURA DA PÁGINA (sem dados de cliente) ===");
log(JSON.stringify(estrutura, null, 2));

await browser.close();
