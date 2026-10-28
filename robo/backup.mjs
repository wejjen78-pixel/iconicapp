// Backup diário — roda no fim do lançamento das 6:00 (lancamento-diario.yml).
// Sem navegador: entra como o dono e grava no bucket privado "backups" do
// Supabase uma cópia de todos os lançamentos + configurações (org_data).
//   <org>/diario/<dia-da-semana>.json  → os últimos 7 dias (sobrescreve)
//   <org>/mensal/<AAAA-MM>.json        → um por mês (o último dia do mês fica)
// Nada vai para o GitHub (repositório público).
//
// Segredos: ICONIC_EMAIL, ICONIC_SENHA, VITE_SUPABASE_ANON_KEY

const SUPABASE_URL = "https://hjihmdlpntrnjkduwelp.supabase.co";

function exigir(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Segredo ${nome} não configurado no GitHub.`);
  return v;
}

const apikey = exigir("VITE_SUPABASE_ANON_KEY");
const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey, "Content-Type": "application/json" },
  body: JSON.stringify({ email: exigir("ICONIC_EMAIL").trim(), password: exigir("ICONIC_SENHA") }),
}).then((r) => r.json());
if (!login.access_token) throw new Error("Login no Iconic falhou: " + (login.error_description || login.msg || "?"));
const headers = { apikey, Authorization: "Bearer " + login.access_token };

const get = async (caminho, extras = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: { ...headers, ...extras } });
  if (!res.ok) throw new Error(`Falha ao ler ${caminho.split("?")[0]} (HTTP ${res.status}).`);
  return res;
};

const perfil = (await (await get(`profiles?select=org_id&id=eq.${login.user.id}`)).json())[0];
if (!perfil?.org_id) throw new Error("Perfil do dono não encontrado.");
const org = perfil.org_id;

const orgData = (await (await get(`org_data?select=data&org_id=eq.${org}`)).json())[0]?.data || null;

// Lançamentos em blocos de 1000 (limite da API), todos ao mesmo tempo.
const cont = await get(`org_lancamentos?select=id&org_id=eq.${org}`, { Prefer: "count=exact", Range: "0-0" });
const total = Number((cont.headers.get("content-range") || "").split("/")[1] || 0);
const PAG = 1000;
const blocos = await Promise.all(
  Array.from({ length: Math.ceil(total / PAG) + 1 }, (_, i) =>
    get(`org_lancamentos?select=tipo,app_id,dt,payload&org_id=eq.${org}&order=id.asc`, { Range: `${i * PAG}-${i * PAG + PAG - 1}` })
      .then((r) => r.json())
  )
);
const lancamentos = blocos.flat();
if (lancamentos.length < total) throw new Error(`Backup incompleto: ${lancamentos.length} de ${total} lançamentos.`);

const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dias = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const diaSemana = dias[new Date(hoje + "T12:00:00Z").getUTCDay()];
const corpo = JSON.stringify({ geradoEm: new Date().toISOString(), dia: hoje, org_data: orgData, lancamentos });

for (const caminho of [`${org}/diario/${diaSemana}.json`, `${org}/mensal/${hoje.slice(0, 7)}.json`]) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/backups/${caminho}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
    body: corpo,
  });
  if (!res.ok) throw new Error(`Falha ao gravar o backup (HTTP ${res.status}: ${(await res.text()).slice(0, 120)}).`);
}
console.log(`Backup ok: ${lancamentos.length} lançamentos, ${Math.round(corpo.length / 1024)} KB (diário de ${diaSemana} e mensal ${hoje.slice(0, 7)}).`);
