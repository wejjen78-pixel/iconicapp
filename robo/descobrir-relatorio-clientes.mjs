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

// Tentativas anteriores (clique por texto; extração de a[href*='#/']) falharam:
// o menu lateral não usa <a href> simples pros itens — provavelmente são
// <li>/<span>/<div> com ng-click ou que só aparecem depois de expandir um
// item "pai" (ex.: "Relatórios"). Esta versão: (1) dump de QUALQUER elemento
// clicável/com atributo Angular na área do menu (só rótulos de menu, nunca
// dado de cliente); (2) tenta expandir "Relatórios" e "Agendamentos" clicando
// e re-dump depois de cada clique, pra comparar antes/depois.

async function dumpMenu(label) {
  const info = await page.evaluate(() => {
    function describe(el) {
      return {
        tag: el.tagName.toLowerCase(),
        texto: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
        href: el.getAttribute ? el.getAttribute("href") : null,
        classe: el.className || null,
        attrsAngular: Array.from(el.attributes || [])
          .map((a) => a.name)
          .filter((n) => /^(ng-|data-ng-|ui-sref|\(click\)|routerlink)/i.test(n)),
      };
    }
    // Candidatos a "contêiner do menu lateral": tenta seletores comuns primeiro.
    const seletoresMenu = ["aside", "nav", ".sidebar", "#sidebar", ".main-sidebar", ".sidebar-menu", ".treeview-menu", "[class*='sidebar']", "[class*='menu-lateral']"];
    let container = null;
    for (const sel of seletoresMenu) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 10) { container = el; break; }
    }
    const escopo = container || document.body;
    const candidatos = Array.from(escopo.querySelectorAll("a, li, span, div, button"))
      .filter((el) => {
        const t = (el.innerText || el.textContent || "").trim();
        return t.length > 0 && t.length < 40 && el.children.length <= 6;
      })
      .map(describe)
      .filter((d) => d.texto);
    // dedup por (tag+texto+href)
    const vistos = new Set();
    const dedup = candidatos.filter((d) => {
      const k = d.tag + "|" + d.texto + "|" + d.href;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    return { containerAchado: !!container, containerSeletor: container ? container.className || container.tagName : null, total: dedup.length, itens: dedup.slice(0, 400) };
  });
  log(`=== MENU (${label}) — container=${info.containerAchado} (${info.containerSeletor}) itens=${info.total} ===`);
  log(JSON.stringify(info.itens));
}

await dumpMenu("inicial");

// Tenta expandir itens "pai" clicando por texto exato, um de cada vez, e redumpando.
for (const termo of ["Relatórios", "Agendamentos", "Relatorios"]) {
  const el = page.getByText(termo, { exact: false }).first();
  const visivel = await el.isVisible().catch(() => false);
  if (!visivel) { log(`"${termo}": não visível, pulando.`); continue; }
  await el.click().catch((e) => log(`"${termo}": clique falhou — ${e.message}`));
  await page.waitForTimeout(1200);
  await dumpMenu(`após clicar "${termo}"`);
}

await browser.close();
