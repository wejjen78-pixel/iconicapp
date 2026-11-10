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

await page.waitForTimeout(2500);

// Em vez de clicar por texto (ambíguo — há "Clientes" em mais de um lugar do menu),
// extrai todos os links de rota (href com #/) do menu lateral: href + texto visível.
// É só estrutura de navegação, zero dado de cliente.
const links = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("a[href*='#/']")).map((a) => ({
    href: a.getAttribute("href"),
    texto: (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
  })).filter((l) => l.texto);
});
log(`=== LINKS DO MENU (${links.length}) ===`);
log(JSON.stringify(links));

// Tenta achar e abrir diretamente o link cujo texto é "Clientes" dentro da árvore de Relatórios/Agendamentos,
// usando o próprio texto do link (não um clique ambíguo em vários elementos).
const candidato = links.find((l) => /clientes/i.test(l.texto) && /rel/i.test(l.href));
log(`Candidato a relatório de clientes: ${candidato ? JSON.stringify(candidato) : "nenhum achado por heurística — ver lista completa acima"}`);

if (candidato) {
  await page.goto(`${APPBARBER_URL}/index.php${candidato.href.replace(/^#/, "#")}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  log(`URL atual: ${page.url()}`);
  const estrutura = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select")).map((s) => ({
      id: s.id || null, name: s.name || null,
      options: Array.from(s.options).map((o) => ({ value: o.value, text: o.text.trim() })),
    }));
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
      id: i.id || null, name: i.name || null, type: i.type, placeholder: i.placeholder || null,
    }));
    const botoesRel = Array.from(document.querySelectorAll("button, a.btn, a[class*='btn']")).map((b) => ({
      id: b.id || null, classe: b.className || null, texto: (b.innerText || "").trim().slice(0, 40),
    })).filter((b) => b.texto || b.id);
    return { selects, inputs, botoesRel, titulo: document.title };
  });
  log("=== ESTRUTURA DA TELA DE CLIENTES (sem dados de cliente) ===");
  log(JSON.stringify(estrutura));
}

await browser.close();
