// Edge Function: galaxpay-sync
// Busca os pagamentos de planos (assinaturas) no Cel Cash (antigo GalaxPay)
// pela API v2 e lança automaticamente no "pote" (Galaxy Pay) da organização,
// sem expor as credenciais ao navegador.
//
// Body (todos opcionais):
//   date        "AAAA-MM-DD"  — sincroniza só esse dia (padrão: hoje)
//   startDate / endDate       — intervalo, no lugar de `date`
//   dryRun      true          — só calcula e devolve a prévia, não grava nada
//   valor       "bruto" | "liquido" — lança o valor pago ou já sem a taxa (padrão: bruto)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// api.cel.cash/v2 (endereço novo da marca) devolve 503; o domínio antigo segue respondendo a mesma API v2.
const CELCASH_API = "https://api.galaxpay.com.br/v2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Status do Cel Cash que representam dinheiro que efetivamente entrou.
const PAID_STATUSES = [
  "captured",
  "payedBoleto",
  "moreValueBoleto",
  "lessValueBoleto",
  "payedPix",
  "payExternal",
];

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function hojeSP() {
  // Data local do Brasil (a Edge Function roda em UTC).
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function celcashErro(data: any, fallback: string) {
  return data?.error?.message || data?.message || data?.Errors?.[0]?.message || fallback;
}

// Erros 502/503/504 do Cel Cash costumam ser instabilidade passageira do
// servidor deles — tenta de novo algumas vezes antes de desistir.
async function fetchComRetry(url: string, init: RequestInit, tentativas = 3): Promise<Response> {
  for (let i = 0; i < tentativas; i++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    if ([502, 503, 504].includes(res.status) && i < tentativas - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    return res;
  }
  throw new Error("Cel Cash: sem resposta após " + tentativas + " tentativas.");
}

async function celcashToken(galaxId: string, galaxHash: string, scope = "transactions.read") {
  const res = await fetchComRetry(CELCASH_API + "/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${galaxId}:${galaxHash}`),
    },
    body: JSON.stringify({ grant_type: "authorization_code", scope }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new Error("Cel Cash recusou as credenciais: " + celcashErro(data, `HTTP ${res.status}`));
  }
  return data.access_token as string;
}

// Lista todas as transações pagas cujo status mudou no intervalo, paginando de 100 em 100.
async function celcashTransacoesPagas(token: string, startDate: string, endDate: string) {
  const all: any[] = [];
  for (let startAt = 0; ; startAt += 100) {
    const qs = new URLSearchParams({
      updateStatusFrom: startDate,
      updateStatusTo: endDate,
      status: PAID_STATUSES.join(","),
      startAt: String(startAt),
      limit: "100",
      order: "createdAt.asc",
    });
    const res = await fetchComRetry(`${CELCASH_API}/transactions?${qs}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error("Cel Cash recusou a consulta: " + celcashErro(data, `HTTP ${res.status}`));
    }
    const page = data.Transactions || [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

// ── Relatório de taxas do mês ──────────────────────────────────────────────
// Cartão: a taxa é descontada no depósito (~30 dias depois), nas
// ConciliationOccurrences — conta pela data do depósito, como o relatório de
// Conciliação do painel. Pix/boleto: taxa (fee) cobrada no próprio pagamento.
// Pagamento por fora (payExternal): não passa pelo Cel Cash, sem taxa.

const centavos = (v: unknown) => (Number(v) || 0) / 100;
const r2 = (v: number) => Math.round(v * 100) / 100;

function metodoDe(t: any) {
  if (t.status === "payExternal" || t.payedOutsideGalaxPay) return "fora";
  if (t.status === "payedPix") return "pix";
  if (/Boleto$/.test(t.status)) return "boleto";
  return "cartao";
}

function ultimoDia(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

function mesAnterior(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
}

async function relatorioTaxas(token: string, mes: string) {
  const inicio = mes + "-01";
  const fim = ultimoDia(mes);
  // Depósitos do mês vêm de cartões pagos até ~1 mês antes: busca 2 meses.
  const trans = await celcashTransacoesPagas(token, mesAnterior(mes) + "-01", fim);
  const noMes = (d: string) => d >= inicio && d <= fim;

  const cobrancas = [];
  const depositos = [];
  for (const t of trans) {
    const metodo = metodoDe(t);
    const data = String(t.statusDate || t.paydayDate || t.payday || "").slice(0, 10);
    const ocorr = (t.ConciliationOccurrences || []).filter((o: any) => o.type !== "canceled");
    for (const o of ocorr) {
      const dep = String(o.depositDate || "").slice(0, 10);
      if (noMes(dep)) {
        depositos.push({ id: t.galaxPayId, deposito: dep, taxa: centavos(o.taxValue), liquido: centavos(o.liquidValue) });
      }
    }
    if (!noMes(data)) continue;
    const taxaCartao = ocorr.length ? r2(ocorr.reduce((s: number, o: any) => s + centavos(o.taxValue), 0)) : null;
    cobrancas.push({
      id: t.galaxPayId,
      data,
      cliente: t.Subscription?.Customer?.name || t.Customer?.name || t.Charge?.[0]?.Customer?.name || "",
      plano: Number(t.subscriptionGalaxPayId || t.Subscription?.galaxPayId) > 0,
      descricao: t.additionalInfo || t.Subscription?.additionalInfo || "",
      parcela: t.installment || null,
      metodo,
      valor: centavos(t.value),
      // Cartão sem depósito ainda: taxa pendente (null).
      taxa: metodo === "cartao" ? taxaCartao : metodo === "fora" ? 0 : centavos(t.fee),
      status: t.statusDescription || t.status,
    });
  }

  const soma = (arr: any[], k: string) => r2(arr.reduce((s, x) => s + (Number(x[k]) || 0), 0));
  const por = (m: string) => cobrancas.filter((c) => c.metodo === m);
  const cartaoDep = { qtd: depositos.length, taxa: soma(depositos, "taxa"), liquido: soma(depositos, "liquido") };
  const pixBoleto = [...por("pix"), ...por("boleto")];
  const fora = por("fora");
  const recebido = soma(cobrancas.filter((c) => c.metodo !== "fora"), "valor");
  const taxaMes = r2(cartaoDep.taxa + soma(pixBoleto, "taxa"));

  return {
    mes,
    resumo: {
      taxaMes,
      percentual: recebido ? r2((taxaMes / recebido) * 100) : 0,
      recebido,
      cartao: { cobrado: soma(por("cartao"), "valor"), qtd: por("cartao").length, depositos: cartaoDep },
      pix: { valor: soma(por("pix"), "valor"), qtd: por("pix").length, taxa: soma(por("pix"), "taxa") },
      boleto: { valor: soma(por("boleto"), "valor"), qtd: por("boleto").length, taxa: soma(por("boleto"), "taxa") },
      fora: { valor: soma(fora, "valor"), qtd: fora.length },
    },
    cobrancas: cobrancas.sort((a, b) => b.data.localeCompare(a.data)),
  };
}

// ── Painel de assinaturas do mês ───────────────────────────────────────────
// Pagantes, valor e ticket vêm dos pagamentos de planos do mês. Novos,
// reativações e cancelamentos vêm da lista de assinaturas: reativação = cliente
// que já tinha uma assinatura anterior; cancelamento = cancelada no mês
// (data da última atualização).

async function celcashAssinaturas(token: string) {
  const all: any[] = [];
  for (let startAt = 0; ; startAt += 100) {
    const qs = new URLSearchParams({ startAt: String(startAt), limit: "100", order: "createdAt.asc" });
    const res = await fetchComRetry(`${CELCASH_API}/subscriptions?${qs}`, { headers: { Authorization: "Bearer " + token } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error("Cel Cash recusou a lista de assinaturas: " + celcashErro(data, `HTTP ${res.status}`));
    const page = data.Subscriptions || [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

async function relatorioAssinaturas(token: string, mes: string) {
  const inicio = mes + "-01";
  const fim = ultimoDia(mes);
  const noMes = (d: string) => d >= inicio && d <= fim;
  const clienteDe = (s: any) => String(s.Customer?.galaxPayId || s.Customer?.document || s.Customer?.name || s.galaxPayId);

  const pagas = (await celcashTransacoesPagas(token, inicio, fim)).filter(
    (t) => Number(t.subscriptionGalaxPayId || t.Subscription?.galaxPayId) > 0
  );
  const porAssinatura = new Map<string, number>();
  for (const t of pagas) {
    const id = String(t.subscriptionGalaxPayId || t.Subscription?.galaxPayId);
    porAssinatura.set(id, (porAssinatura.get(id) || 0) + centavos(t.value));
  }
  const valor = r2([...porAssinatura.values()].reduce((s, v) => s + v, 0));

  const subs = await celcashAssinaturas(token);
  const criada = (s: any) => String(s.createdAt || "").slice(0, 10);
  const fimDe = (s: any) => (s.status === "active" ? "9999-12-31" : String(s.updatedAt || s.createdAt || "").slice(0, 10));
  const porCliente = new Map<string, any[]>();
  for (const s of subs) {
    const c = clienteDe(s);
    if (!porCliente.has(c)) porCliente.set(c, []);
    porCliente.get(c)!.push(s);
  }
  const diasEntre = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
  // Troca de plano: o Cel Cash cancela a assinatura antiga e cria outra para o
  // mesmo cliente. Se a nova nasce até 15 dias depois do fim da anterior (ou com
  // a anterior ainda ativa), não é cancelamento nem reativação.
  const JANELA_TROCA = 15;
  const anterior = (s: any) =>
    porCliente.get(clienteDe(s))!.filter((p) => p !== s && criada(p) < criada(s)).sort((a, b) => criada(b).localeCompare(criada(a)))[0];
  const posterior = (s: any) =>
    porCliente.get(clienteDe(s))!.filter((p) => p !== s && criada(p) >= criada(s)).sort((a, b) => criada(a).localeCompare(criada(b)))[0];
  const ehTrocaEntrada = (s: any) => {
    const p = anterior(s);
    return !!p && diasEntre(fimDe(p) === "9999-12-31" ? criada(s) : fimDe(p), criada(s)) <= JANELA_TROCA;
  };
  const ehTrocaSaida = (s: any) => {
    const n = posterior(s);
    return !!n && diasEntre(fimDe(s), criada(n)) <= JANELA_TROCA;
  };
  const resumo = (s: any) => ({
    id: s.galaxPayId,
    cliente: s.Customer?.name || "",
    plano: s.additionalInfo || "",
    valor: centavos(s.value),
    criada: String(s.createdAt || "").slice(0, 10),
    atualizada: String(s.updatedAt || "").slice(0, 10),
  });
  const criadasNoMes = subs.filter((s) => noMes(criada(s)));
  const novos = criadasNoMes.filter((s) => !anterior(s)).map(resumo);
  const trocas = criadasNoMes.filter((s) => anterior(s) && ehTrocaEntrada(s)).map(resumo);
  const reativacoes = criadasNoMes.filter((s) => anterior(s) && !ehTrocaEntrada(s)).map(resumo);
  const cancelamentos = subs.filter((s) => s.status === "canceled" && noMes(fimDe(s)) && !ehTrocaSaida(s)).map(resumo);

  return {
    mes,
    resumo: {
      pagantes: porAssinatura.size,
      valor,
      ticket: porAssinatura.size ? r2(valor / porAssinatura.size) : 0,
      ativasHoje: subs.filter((s) => s.status === "active").length,
      novos: novos.length,
      reativacoes: reativacoes.length,
      cancelamentos: cancelamentos.length,
      trocas: trocas.length,
    },
    novos,
    reativacoes,
    cancelamentos,
    trocas,
  };
}

// ── Cancelamentos recentes (para o aviso no celular do dono) ───────────────
// Só as assinaturas canceladas/atualizadas desde `desde` — rápido, sem baixar
// a lista inteira. Troca de plano (o cliente tem outra assinatura ativa ou
// criada até 15 dias depois) não conta como cancelamento.

async function cancelamentosRecentes(token: string, desde: string) {
  const get = async (params: Record<string, string>) => {
    const out: any[] = [];
    for (let startAt = 0; ; startAt += 100) {
      const qs = new URLSearchParams({ ...params, startAt: String(startAt), limit: "100" });
      const res = await fetchComRetry(`${CELCASH_API}/subscriptions?${qs}`, { headers: { Authorization: "Bearer " + token } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error("Cel Cash recusou a consulta de assinaturas: " + celcashErro(data, `HTTP ${res.status}`));
      const page = data.Subscriptions || [];
      out.push(...page);
      if (page.length < 100) break;
    }
    return out;
  };
  const canceladas = (await get({ status: "canceled", createdAtOrUpdatedAtFrom: desde })).filter(
    (s) => String(s.updatedAt || "").slice(0, 10) >= desde.slice(0, 10)
  );
  const reais = [];
  for (const s of canceladas) {
    const cliente = s.Customer?.galaxPayId;
    if (cliente) {
      const outras = (await get({ customerGalaxPayIds: String(cliente) })).filter((o) => o.galaxPayId !== s.galaxPayId);
      const fim = Date.parse(String(s.updatedAt || s.createdAt));
      const troca = outras.some((o) => o.status === "active" || Math.abs(Date.parse(String(o.createdAt)) - fim) <= 15 * 86_400_000);
      if (troca) continue;
    }
    reais.push({
      id: s.galaxPayId,
      cliente: s.Customer?.name || "",
      plano: s.additionalInfo || "",
      valor: centavos(s.value),
      cancelada: String(s.updatedAt || "").slice(0, 16).replace("T", " "),
    });
  }
  return { desde, cancelamentos: reais };
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
      return json({ error: "Cel Cash ainda não configurado. Salve suas credenciais primeiro." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const startDate = body.date || body.startDate || hojeSP();
    const endDate = body.date || body.endDate || startDate;
    const dryRun = body.dryRun === true;
    const liquido = body.valor === "liquido";

    // Assinaturas pedem permissão extra; só pede quando precisa, para não afetar a sincronização.
    const precisaAssinaturas = body.acao === "assinaturas" || body.acao === "cancelamentos";
    const token = await celcashToken(integ.galax_id, integ.galax_hash, precisaAssinaturas ? "transactions.read subscriptions.read" : "transactions.read");
    if (body.acao === "cancelamentos") {
      const desde = /^\d{4}-\d{2}-\d{2}/.test(body.desde || "") ? body.desde : hojeSP();
      return json({ success: true, ...(await cancelamentosRecentes(token, desde)) });
    }
    if (body.acao === "taxas") {
      const mes = /^\d{4}-\d{2}$/.test(body.mes || "") ? body.mes : hojeSP().slice(0, 7);
      return json({ success: true, ...(await relatorioTaxas(token, mes)) });
    }
    if (body.acao === "assinaturas") {
      const mes = /^\d{4}-\d{2}$/.test(body.mes || "") ? body.mes : hojeSP().slice(0, 7);
      return json({ success: true, ...(await relatorioAssinaturas(token, mes)) });
    }
    const pagas = await celcashTransacoesPagas(token, startDate, endDate);

    // O pote é só dos planos (assinaturas). Cobranças avulsas — ex.: sobrancelha
    // que o cliente do clube pagou no cartão — ficam de fora.
    const ehPlano = (t: any) => Number(t.subscriptionGalaxPayId || t.Subscription?.galaxPayId) > 0;
    const transactions = pagas.filter(ehPlano);
    const avulsas = pagas.filter((t) => !ehPlano(t));
    const foraDoPlano = {
      qtd: avulsas.length,
      valor: Math.round(avulsas.reduce((s, t) => s + (Number(t.value) || 0), 0)) / 100,
    };

    // "pote" vive em org_lancamentos (uma linha por lançamento). O extId evita
    // lançar a mesma transação duas vezes se sincronizar o mesmo dia de novo.
    const { data: existingRows } = await admin
      .from("org_lancamentos")
      .select("payload")
      .eq("org_id", profile.org_id)
      .eq("tipo", "pote");
    const existingExtIds = new Set(
      (existingRows || []).map((r: any) => r.payload?.extId).filter(Boolean)
    );

    // Valores da API v2 vêm em centavos.
    let bruto = 0, taxas = 0, jaLancadas = 0;
    const newRows = [];
    for (const t of transactions) {
      const valBruto = (Number(t.value) || 0) / 100;
      const valTaxa = (Number(t.fee) || 0) / 100;
      bruto += valBruto;
      taxas += valTaxa;
      const extId = "galaxpay:" + t.galaxPayId;
      if (existingExtIds.has(extId)) { jaLancadas++; continue; }
      const appId = Math.random().toString(36).substr(2, 8);
      const dt = String(t.statusDate || t.paydayDate || t.payday || startDate).slice(0, 10);
      newRows.push({
        org_id: profile.org_id,
        tipo: "pote",
        app_id: appId,
        dt,
        payload: {
          id: appId,
          val: Math.round((liquido ? valBruto - valTaxa : valBruto) * 100) / 100,
          dt,
          obs: "Cel Cash · " + (t.statusDescription || t.status),
          extId,
        },
      });
    }

    const resumo = {
      startDate,
      endDate,
      total: transactions.length,
      jaLancadas,
      novas: newRows.length,
      bruto: Math.round(bruto * 100) / 100,
      taxas: Math.round(taxas * 100) / 100,
      liquido: Math.round((bruto - taxas) * 100) / 100,
      valorNovas: Math.round(newRows.reduce((s, r) => s + r.payload.val, 0) * 100) / 100,
      foraDoPlano,
    };

    if (dryRun) return json({ success: true, dryRun: true, ...resumo });

    let added = 0;
    if (newRows.length) {
      const { error: insErr } = await admin.from("org_lancamentos").insert(newRows);
      if (insErr) return json({ error: "Falha ao gravar no pote: " + insErr.message }, 500);
      added = newRows.length;
    }

    await admin
      .from("org_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_sync_count: added })
      .eq("org_id", profile.org_id);

    return json({ success: true, added, ...resumo });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
