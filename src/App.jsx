import{useState,useEffect,useRef,useCallback}from"react";
import{BarChart,Bar,AreaChart,Area,LineChart,Line,PieChart,Pie,Cell,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid,ReferenceLine,RadarChart,PolarGrid,PolarAngleAxis,Radar}from"recharts";
import{supabase}from"./lib/supabaseClient";
import logoPreto from"./assets/logo-preto.png";
import logoBranco from"./assets/logo-branco.png";

// ── CONSTANTES ──────────────────────────────────────────────────────────────
const FICHAS_DEF={"Club Premium - Cabelo (Ilimitado)":30,"Club Basic - Cabelo (Ter/Qua)":30,"Club Black - Cabelo":30,"Club Gold - Cabelo":30,"Retoque - Club Cabelo":30,"Club Premium - Cabelo & Barba (Ilimitado).":50,"Club Premium - Cabelo & Barba (Ilimitado)":50,"Club Basic - Cabelo & Barba (Ter/Qua)":50,"Club Gold - Cabelo & Barba":50,"Retoque - Club Cabelo & Barba":50,"Club - Barba":20,"Club - Pézinho + Barba":25,"Club - Pezinho + Barba":25,"Club - Pezinho":10,"Club - Pézinho":10};
const TIPO_FICHAS={corte:30,barba:20,cortebarba:50,acabbarba:25,pezinho:10};
const SVC_DEF=[{nome:"Corte",v:40},{nome:"Corte e Barba",v:70},{nome:"Corte e Sobrancelha",v:55},{nome:"Corte + Barba e Sobrancelha",v:75},{nome:".Barba",v:30},{nome:"Pezinho e Barba",v:45},{nome:"Pézinho",v:15},{nome:"Corte e Pigmentação",v:60},{nome:"Corte, somente 1 pente.",v:35}];
const EXT_DEF=["Sobrancelha","Depilação Nasal","Hidratação Barba","Hidratação Cabelo","Limpeza de pele","Pigmentação","Camuflagem Barba","Camuflagem Capilar","Selagem Capilar"];
const MESES=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const LogoSVG=({height=48,invert=false})=><img src={invert?logoBranco:logoPreto} alt="Iconic App" style={{height,display:"block",margin:"0 auto",borderRadius:8}}/>;

const uid=()=>Math.random().toString(36).substr(2,8);
const R=v=>(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const hj=()=>new Date().toISOString().split("T")[0];

// ── COR DINÂMICA (vermelho → verde conforme % da meta) ────────────────────────
function interpolateColor(a,b,t){const r=Math.round(a[0]+(b[0]-a[0])*t);const g=Math.round(a[1]+(b[1]-a[1])*t);const bl=Math.round(a[2]+(b[2]-a[2])*t);return`rgb(${r},${g},${bl})`;}
function pctColor(p){const c=Math.max(0,Math.min(100,p||0));if(c<50)return interpolateColor([220,38,38],[217,119,6],c/50);return interpolateColor([217,119,6],[5,150,105],(c-50)/50);}

// ── HELPERS ──────────────────────────────────────────────────────────────────
const normSvc=s=>s?s.trim().replace(/&amp;/g,"&").replace(/\s+/g," "):s;
const getTipoFicha=svc=>{if(!svc)return null;const k=normSvc(svc).toLowerCase();if(k.includes("cabelo & barba")||k.includes("cabelo e barba"))return"cortebarba";if(k.includes("pézinho + barba")||k.includes("pezinho + barba"))return"acabbarba";if(k==="club - barba")return"barba";if(k==="club - pezinho"||k==="club - pézinho")return"pezinho";if(k.includes("club")||k.includes("retoque"))return"corte";return null;};
const getFichasPorTipo=svc=>{const t=getTipoFicha(svc);return t?TIPO_FICHAS[t]:0;};
const isClub=svc=>{if(!svc)return false;const k=normSvc(svc).toLowerCase();return k.startsWith("club ")||k.startsWith("retoque - club");};
const EXT_KEYS=["sobrancelha","depilação nasal","hidratação barba","hidratação cabelo","limpeza de pele","pigmentação","camuflagem barba","camuflagem capilar","selagem capilar"];
const SVC_COMP_SOB=["corte e sobrancelha","corte + barba e sobrancelha","corte e barba e sobrancelha"];
const isExtraSob=svc=>{const k=normSvc(svc||"").toLowerCase();if(!k.includes("sobrancelha"))return false;if(SVC_COMP_SOB.some(c=>k.includes(c)))return false;if(k.includes("corte")||k.includes("barba"))return false;return true;};
const isExtra=svc=>{const k=normSvc(svc||"").toLowerCase();if(k.includes("sobrancelha"))return isExtraSob(svc);return EXT_KEYS.some(e=>k.includes(e));};
const matchProd=(svc,pl)=>{const k=normSvc(svc||"").toLowerCase();return pl.find(p=>k.includes(normSvc(p.nome).toLowerCase().substring(0,8)))||null;};
const groupRows=(rows,pl)=>{const fichas=[],avulsos=[],extras=[],produtos=[];rows.forEach(r=>{const sn=normSvc(r.svc);if(isClub(sn))fichas.push({...r,svc:sn,fich:getFichasPorTipo(sn)});else if(isExtra(sn))extras.push({...r,svc:sn});else{const pd=matchProd(sn,pl);if(pd)produtos.push({...r,svc:sn,prod:pd.nome,comissao:pd.comissao});else avulsos.push({...r,svc:sn});}});return{fichas,avulsos,extras,produtos,total:rows.length};};
const PDF_BARB_MAP_BASE=[["brendo",1],["ithalo",2],["luís vitor",3],["luis vitor",3],["luís",3],["welton",4],["pedro lucas",5],["pedro",5]];
const findBarbByName=(n,barbs)=>{if(!n)return null;const nl=n.toLowerCase().trim();for(const[palavra,alvo]of PDF_BARB_MAP_BASE){if(nl.includes(palavra)){const b=barbs.find(x=>x.id===alvo);if(b)return b;}}return barbs.find(b=>b.nome.toLowerCase().split(" ").some(p=>p.length>3&&nl.includes(p)))||null;};
function monthsBetween(de,ate){const arr=[];let m=de.m,a=de.a;let guard=0;while((a<ate.a||(a===ate.a&&m<=ate.m))&&guard<36){arr.push({m,a});m++;if(m>11){m=0;a++;}guard++;}return arr;}

const extenso=v=>{const n=Math.round(v*100)/100;const[int,dec]=n.toFixed(2).split(".");const u=["","UM","DOIS","TRÊS","QUATRO","CINCO","SEIS","SETE","OITO","NOVE","DEZ","ONZE","DOZE","TREZE","QUATORZE","QUINZE","DEZESSEIS","DEZESSETE","DEZOITO","DEZENOVE"];const d=["","","VINTE","TRINTA","QUARENTA","CINQUENTA","SESSENTA","SETENTA","OITENTA","NOVENTA"];const c=["","CEM","DUZENTOS","TREZENTOS","QUATROCENTOS","QUINHENTOS","SEISCENTOS","SETECENTOS","OITOCENTOS","NOVECENTOS"];const toH=n=>{if(n===0)return"";if(n<20)return u[n];if(n<100){const r=n%10;return d[Math.floor(n/10)]+(r?" E "+u[r]:"");}const r=n%100;const h=Math.floor(n/100);return(n===100?"CEM":c[h])+(r?" E "+toH(r):"");};const mil=Math.floor(+int/1000);const res=+int%1000;let txt="";if(mil>0)txt+=(mil===1?"UM MIL":toH(mil)+" MIL")+(res>0?" E ":"");txt+=toH(res)||(!mil?"ZERO":"");const dv=+dec;txt+=dv>0?" E "+toH(dv)+" CENTAVOS":" REAIS";if(!txt.includes("CENTAVOS")&&!txt.includes("REAIS"))txt+=" REAIS";return txt;};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
:root{--pri:#0e7490;--pri-d:#155e75;--pri-lt:#67e8f9;--pri-bg:#ecfeff;--pri-bd:#a5f3fc;
--ink:#101828;--ink-2:#475467;--ink-3:#98a2b3;--bd:#e9ecf2;--bd-2:#f2f4f7;--bg:#f7f8fa;
--sh:0 1px 2px rgba(16,24,40,.04);--sh-2:0 4px 14px rgba(16,24,40,.07)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--ink);font-size:14px;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:#d0d5dd;border-radius:3px}::-webkit-scrollbar-thumb:hover{background:#b7bec9}
.inp{background:#fff;border:1px solid #dfe3ea;color:var(--ink);padding:9px 12px;font-family:'Inter',sans-serif;font-size:13px;border-radius:9px;width:100%;outline:none;transition:border .15s,box-shadow .15s}
.inp:focus{border-color:var(--pri);box-shadow:0 0 0 3px #0e74901f}
.btn{background:var(--pri);color:#fff;border:none;padding:10px 20px;font-family:'Inter',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border-radius:9px;transition:all .15s;box-shadow:var(--sh)}
.btn:hover{background:var(--pri-d);box-shadow:var(--sh-2)}.btn:active{transform:translateY(1px)}
.bsm{padding:6px 13px!important;font-size:11px!important}
.bg{background:#fff;border:1px solid #dfe3ea;color:var(--ink-2);padding:8px 14px;font-family:'Inter',sans-serif;font-size:12px;font-weight:500;cursor:pointer;border-radius:9px;transition:all .15s}
.bg:hover{border-color:var(--pri);color:var(--pri);background:var(--pri-bg)}
.bg.on{border-color:var(--pri);color:var(--pri);background:var(--pri-bg);font-weight:600}
.bdel{background:none;border:none;color:#cbd2dc;cursor:pointer;font-size:15px;padding:2px 4px;border-radius:5px;transition:all .15s}
.bdel:hover{color:#dc2626;background:#fef2f2}
.card{background:#fff;border:1px solid var(--bd);border-radius:14px;padding:18px;box-shadow:var(--sh)}
.lbl{font-size:10.5px;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:6px}
.st{font-size:10.5px;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.09em;margin-bottom:14px}
.row{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--bd-2);font-size:13px;transition:background .12s}
.row:hover{background:#fafbfc}.row:last-child{border-bottom:none}
.av{border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.shell{display:flex;min-height:100vh}
.sb{width:238px;min-width:238px;background:#0b1220;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;flex-shrink:0}
.sb::-webkit-scrollbar-thumb{background:#ffffff1a}
.sblogo{padding:22px 20px 18px;text-align:center}
.sblogo img{margin:0 auto}
.brand{font-size:15px;font-weight:700;color:#fff;margin-top:8px;letter-spacing:.02em}.brand span{color:var(--pri-lt)}
.sub{font-size:11px;color:#ffffff4d;margin-top:3px;letter-spacing:.14em;text-transform:uppercase}
.sbnav{flex:1;padding:6px 10px 14px}
.ni{display:flex;align-items:center;gap:11px;padding:9px 12px;margin-bottom:2px;color:#ffffff8a;font-size:13px;font-weight:500;cursor:pointer;border-radius:9px;transition:all .15s;white-space:nowrap}
.ni:hover{background:#ffffff0f;color:#fff}
.ni.on{background:linear-gradient(90deg,#0e749038,#0e749010);color:var(--pri-lt);font-weight:600;box-shadow:inset 2px 0 0 var(--pri-lt)}
.ni svg{width:17px;height:17px;flex-shrink:0;opacity:.65;stroke-width:1.7}.ni.on svg{opacity:1}
.sbft{padding:12px;border-top:1px solid #ffffff12;margin:0 10px 8px}
.sfui{display:flex;align-items:center;gap:10px;margin-bottom:10px;background:#ffffff0a;border:1px solid #ffffff10;border-radius:11px;padding:10px}
.sfav{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:#0e749040;color:var(--pri-lt);flex-shrink:0;overflow:hidden}
.sfnm{font-size:12.5px;color:#fff;font-weight:600}
.sfrole{font-size:10px;color:var(--pri-lt);background:#0e749030;border-radius:20px;padding:1px 7px;display:inline-block;margin-top:3px;font-weight:600}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.tb{background:#fffffff2;backdrop-filter:blur(8px);border-bottom:1px solid var(--bd);padding:14px 26px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;position:sticky;top:0;z-index:50}
.tbt{font-size:18px;font-weight:700;letter-spacing:-.01em}
.pb{padding:22px 26px;flex:1}
.toast{position:fixed;bottom:20px;right:20px;background:#fff;border:1px solid var(--bd);box-shadow:var(--sh-2);border-radius:11px;padding:10px 16px;font-size:12px;color:#059669;z-index:999}
.dp{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.grp-hd{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#fafbfc;border-radius:10px;cursor:pointer;margin-bottom:2px;border:1px solid var(--bd);transition:all .15s}
.grp-hd:hover{background:var(--pri-bg);border-color:var(--pri-bd)}
.recharts-cartesian-axis-tick text{fill:var(--ink-3);font-size:10.5px}
.recharts-default-tooltip{border-radius:10px!important}
@keyframes pop{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
.celebrate{animation:pop .5s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pb>div>*{animation:fadeUp .28s ease both}
@media(max-width:900px){.sb{width:58px;min-width:58px}.ni span,.brand,.sub,.sfnm,.sfrole{display:none}.ni{justify-content:center;padding:11px}.sblogo{padding:14px 8px;display:flex;justify-content:center}.sbnav{padding:6px}.sbft{padding:8px;margin:0 6px 6px}.sfui{justify-content:center;padding:6px;background:none;border:none}.pb{padding:14px 12px}.tb{padding:12px 14px}}
@media(max-width:700px){.g4{grid-template-columns:1fr 1fr}.g3{grid-template-columns:1fr 1fr}}
@media(max-width:480px){.g2,.g3,.g4{grid-template-columns:1fr}}
`;

const ICO={dash:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,barb:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7c0 4-3 6-8 6S4 11 4 7"/><circle cx="12" cy="4" r="2"/><path d="M8 17l-3 4m7-4v4m5-4l3 4"/></svg>,lanc:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14"/></svg>,gal:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-3 3-5 6-5 10s2 7 5 10M12 2c3 3 5 6 5 10s-2 7-5 10"/></svg>,assi:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,ext:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>,rel:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,gest:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,equi:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,game:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4M8 10v4M15 12h2"/></svg>,intel:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/></svg>,pdf:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,fech:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>,cfg:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,meu:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,tv:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,sair:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>,estoque:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,pump:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,insta:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor" stroke="none"/></svg>,comis:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>,custos:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a1.5 1.5 0 000 3h4v-3z"/></svg>,profit:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>};

// ── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function CT({active,payload,label}){if(!active||!payload?.length)return null;return <div style={{background:"#101828",border:"1px solid #1f2a3a",borderRadius:10,padding:"9px 13px",fontSize:12,boxShadow:"0 8px 24px rgba(16,24,40,.18)"}}><div style={{color:"#98a2b3",marginBottom:5,fontSize:11,fontWeight:500}}>{label}</div>{payload.map((p,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:7,color:"#fff",fontWeight:600,marginTop:i?3:0}}><span style={{width:7,height:7,borderRadius:"50%",background:p.color||"#0e7490",flexShrink:0}}/><span style={{color:"#cbd5e1",fontWeight:500}}>{p.name}:</span> {p.value>200?R(p.value):p.value}</div>)}</div>;}
function DB({v}){const pos=v>=0;return <span className="dp" style={{background:pos?"#dcfce7":"#fef2f2",color:pos?"#059669":"#dc2626"}}>{pos?"▲":"▼"}{Math.abs(v).toFixed(1)}%</span>;}
function PB({val,max,cor,lbl,sub,pct=true,lg=false}){const p=max>0?Math.min(100,(val/max)*100):0;const h=lg?8:5;const[w,setW]=useState(0);useEffect(()=>{const t=setTimeout(()=>setW(p),100);return()=>clearTimeout(t);},[p]);return <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>{lbl&&<span style={{fontSize:11,color:"#888"}}>{lbl}</span>}{pct&&<span style={{fontSize:11,fontWeight:600,color:p>=100?"#059669":p>70?"#d97706":"#dc2626"}}>{p.toFixed(1)}%</span>}</div><div style={{background:"#f0f0f5",borderRadius:4,height:h}}><div style={{height:h,borderRadius:4,width:w+"%",background:p>=100?"#059669":cor||"#0e7490",transition:"width .8s, background .5s"}}/></div>{sub&&<div style={{fontSize:11,color:"#aaa",marginTop:3}}>{sub}</div>}</div>;}
function KPI({lbl,val,cor,glow=false,delta,sub}){return <div className="card" style={{padding:"15px 16px",borderTop:glow?"3px solid "+(cor||"#0e7490"):"1px solid var(--bd)",background:"#fff"}}>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
    <div style={{fontSize:10,color:"#98a2b3",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",lineHeight:1.3}}>{lbl}</div>
    {delta!=null&&<span className="dp" style={{background:delta>=0?"#dcfce7":"#fef2f2",color:delta>=0?"#059669":"#dc2626",flexShrink:0}}>{delta>=0?"▲":"▼"}{Math.abs(delta).toFixed(1)}%</span>}
  </div>
  <div style={{fontSize:23,fontWeight:800,color:cor||"#101828",letterSpacing:"-.02em",lineHeight:1.1}}>{val}</div>
  {sub&&<div style={{fontSize:11,color:"#98a2b3",marginTop:4}}>{sub}</div>}
</div>;}
function BAv({b,size=30,fs=12}){if(b?.foto?.length>50)return <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,border:"2px solid "+(b.cor||"#888")+"55"}}><img src={b.foto} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>;return <div className="av" style={{width:size,height:size,fontSize:fs,background:((b?.cor)||"#888")+"22",color:(b?.cor)||"#888"}}>{((b?.nome)||"?").charAt(0)}</div>;}
function EditModal({item,fields,barbs,onSave,onClose}){const[tmp,setTmp]=useState({...item});const upd=(k,v)=>setTmp(t=>({...t,[k]:v}));return <div style={{position:"fixed",inset:0,background:"#0008",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}><div style={{background:"#fff",borderRadius:12,padding:24,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}><div style={{fontWeight:700,fontSize:15,marginBottom:16}}>✏️ Editar</div>{fields.map(f=><div key={f.key} style={{marginBottom:11}}><span className="lbl">{f.label}</span>{f.type==="barbSelect"?<select className="inp" value={tmp[f.key]||1} onChange={e=>upd(f.key,+e.target.value)}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select>:f.type==="select"?<select className="inp" value={tmp[f.key]||""} onChange={e=>upd(f.key,e.target.value)}>{(f.options||[]).map(o=><option key={o}>{o}</option>)}</select>:f.type==="date"?<input type="date" className="inp" value={tmp[f.key]||""} onChange={e=>upd(f.key,e.target.value)}/>:f.type==="number"?<input type="number" className="inp" value={tmp[f.key]||0} onChange={e=>upd(f.key,parseFloat(e.target.value)||0)}/>:<input type="text" className="inp" value={tmp[f.key]||""} onChange={e=>upd(f.key,e.target.value)}/>}</div>)}<div style={{display:"flex",gap:10,marginTop:16}}><button className="btn" onClick={()=>onSave(tmp)}>Salvar</button><button className="bg" onClick={onClose}>Cancelar</button></div></div></div>;}
function GrupoColapsavel({titulo,cor,qt,total,children,acoes,isPts=false}){const[open,setOpen]=useState(false);return <div style={{marginBottom:8}}><div className="grp-hd" onClick={()=>setOpen(o=>!o)}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:13}}>{open?"▼":"▶"}</span><span style={{fontWeight:600,fontSize:13,color:cor||"#1a1a2e"}}>{titulo}</span><span style={{background:cor+"18",color:cor,borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:600}}>{qt}x</span></div><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontWeight:700,color:cor||"#1a1a2e"}}>{isPts?total+"pts":R(total)}</span>{acoes&&<div onClick={e=>e.stopPropagation()}>{acoes}</div>}</div></div>{open&&<div style={{border:"1px solid #e8e8f0",borderTop:"none",borderRadius:"0 0 7px 7px",overflow:"hidden"}}>{children}</div>}</div>;}

// ── LOGIN / CADASTRO (Supabase Auth) ────────────────────────────────────────
function Login({onProvisioned}){
  const[mode,setMode]=useState("login"); // login | signup | check-email | forgot | forgot-sent
  const[email,setEmail]=useState("");const[pw,setPw]=useState("");const[err,setErr]=useState("");const[load,setLoad]=useState(false);const[show,setShow]=useState(false);
  const[shopName,setShopName]=useState("");const[donoNome,setDonoNome]=useState("");

  async function go(){
    setLoad(true);setErr("");
    const{error}=await supabase.auth.signInWithPassword({email:email.trim(),password:pw});
    if(error)setErr(error.message==="Invalid login credentials"?"E-mail ou senha incorretos.":error.message);
    setLoad(false);
  }

  async function forgot(){
    if(!email.trim()){setErr("Digite seu e-mail.");return;}
    setLoad(true);setErr("");
    const redirectTo=window.location.origin+import.meta.env.BASE_URL;
    const{error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo});
    if(error){setErr(error.message);setLoad(false);return;}
    setMode("forgot-sent");setLoad(false);
  }

  async function signup(){
    if(!shopName.trim()||!donoNome.trim()||!email.trim()||!pw){setErr("Preencha todos os campos.");return;}
    if(pw.length<6){setErr("A senha precisa ter pelo menos 6 caracteres.");return;}
    setLoad(true);setErr("");
    // guarda nome da barbearia/dono nos metadados do usuário: se o Supabase exigir
    // confirmação de e-mail, a organização só é criada depois, no primeiro login
    // (ver App > efeito de perfil), usando esses metadados.
    const{data,error}=await supabase.auth.signUp({email:email.trim(),password:pw,options:{data:{shop_name:shopName.trim(),dono_nome:donoNome.trim()}}});
    if(error){setErr(error.message);setLoad(false);return;}
    if(!data.session){
      // e-mail de confirmação exigido nas configurações do projeto
      setMode("check-email");setLoad(false);return;
    }
    onProvisioned&&onProvisioned();
    setLoad(false);
  }

  if(mode==="check-email")return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:360}}>
    <div style={{textAlign:"center",marginBottom:24}}><LogoSVG height={60}/></div>
    <div className="card" style={{padding:24,textAlign:"center"}}>
      <div style={{fontSize:32,marginBottom:10}}>📧</div>
      <div style={{fontWeight:700,marginBottom:8}}>Confirme seu e-mail</div>
      <div style={{fontSize:13,color:"#666",marginBottom:16}}>Enviamos um link de confirmação para <b>{email}</b>. Depois de confirmar, volte aqui e faça login.</div>
      <button className="bg" style={{width:"100%"}} onClick={()=>setMode("login")}>Voltar para login</button>
    </div>
  </div></div>;

  if(mode==="forgot-sent")return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:360}}>
    <div style={{textAlign:"center",marginBottom:24}}><LogoSVG height={60}/></div>
    <div className="card" style={{padding:24,textAlign:"center"}}>
      <div style={{fontSize:32,marginBottom:10}}>📬</div>
      <div style={{fontWeight:700,marginBottom:8}}>Link enviado!</div>
      <div style={{fontSize:13,color:"#666",marginBottom:16}}>Enviamos um link para redefinir sua senha para <b>{email}</b>. Clique nele para escolher uma nova senha.</div>
      <button className="bg" style={{width:"100%"}} onClick={()=>{setMode("login");setErr("");}}>Voltar para login</button>
    </div>
  </div></div>;

  if(mode==="forgot")return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:360}}>
    <div style={{textAlign:"center",marginBottom:24}}><LogoSVG height={60}/></div>
    <form className="card" style={{padding:24}} onSubmit={e=>{e.preventDefault();forgot();}}>
      <div style={{fontWeight:700,marginBottom:4}}>Esqueceu sua senha?</div>
      <div style={{fontSize:12,color:"#666",marginBottom:16}}>Digite seu e-mail e enviamos um link para redefinir.</div>
      <div style={{marginBottom:16}}><span className="lbl">E-mail</span><input type="email" name="email" autoComplete="email" className="inp" value={email} onChange={e=>setEmail(e.target.value)}/></div>
      {err&&<div style={{padding:"7px 11px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,marginBottom:13,fontSize:12,color:"#dc2626"}}>{err}</div>}
      <button type="submit" className="btn" style={{width:"100%"}} disabled={load}>{load?"...":"Enviar link"}</button>
      <div style={{textAlign:"center",marginTop:14,fontSize:12,color:"#888"}}><span style={{color:"#0e7490",cursor:"pointer",fontWeight:600}} onClick={()=>{setMode("login");setErr("");}}>Voltar para login</span></div>
    </form>
  </div></div>;

  return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:360}}>
    <div style={{textAlign:"center",marginBottom:24}}><LogoSVG height={60}/></div>
    {/* form real com autoComplete correto: assim o navegador oferece salvar a senha e preenche sozinho da próxima vez */}
    <form className="card" style={{padding:24}} autoComplete="on" onSubmit={e=>{e.preventDefault();mode==="signup"?signup():go();}}>
      {mode==="signup"&&<>
        <div style={{marginBottom:13}}><span className="lbl">Nome da barbearia</span><input className="inp" name="organization" autoComplete="organization" value={shopName} onChange={e=>setShopName(e.target.value)}/></div>
        <div style={{marginBottom:13}}><span className="lbl">Seu nome</span><input className="inp" name="name" autoComplete="name" value={donoNome} onChange={e=>setDonoNome(e.target.value)}/></div>
      </>}
      <div style={{marginBottom:13}}><span className="lbl">E-mail</span><input type="email" name="email" autoComplete="email" className="inp" value={email} onChange={e=>setEmail(e.target.value)}/></div>
      <div style={{marginBottom:8}}><span className="lbl">Senha</span><div style={{position:"relative"}}><input type={show?"text":"password"} name="password" autoComplete={mode==="signup"?"new-password":"current-password"} className="inp" value={pw} onChange={e=>setPw(e.target.value)} style={{paddingRight:36}}/><button type="button" onClick={()=>setShow(s=>!s)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#aaa",cursor:"pointer"}}>{show?"🙈":"👁"}</button></div></div>
      {mode==="login"&&<div style={{textAlign:"right",marginBottom:8}}><span style={{fontSize:11,color:"#0e7490",cursor:"pointer"}} onClick={()=>{setMode("forgot");setErr("");}}>Esqueceu a senha?</span></div>}
      {err&&<div style={{padding:"7px 11px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,marginBottom:13,fontSize:12,color:"#dc2626"}}>{err}</div>}
      <button type="submit" className="btn" style={{width:"100%"}} disabled={load}>{load?"...":mode==="login"?"Entrar":"Criar minha barbearia"}</button>
      <div style={{textAlign:"center",marginTop:14,fontSize:12,color:"#888"}}>{mode==="login"?<>Ainda não tem conta? <span style={{color:"#0e7490",cursor:"pointer",fontWeight:600}} onClick={()=>{setMode("signup");setErr("");}}>Criar barbearia</span></>:<>Já tem conta? <span style={{color:"#0e7490",cursor:"pointer",fontWeight:600}} onClick={()=>{setMode("login");setErr("");}}>Entrar</span></>}</div>
    </form>
  </div></div>;
}

// ── DEFINIR NOVA SENHA (link de recuperação) ─────────────────────────────────
function ResetPassword(){
  const[pw,setPw]=useState("");const[pw2,setPw2]=useState("");const[err,setErr]=useState("");const[load,setLoad]=useState(false);const[done,setDone]=useState(false);
  async function go(){
    if(pw.length<6){setErr("A senha precisa ter pelo menos 6 caracteres.");return;}
    if(pw!==pw2){setErr("As senhas não coincidem.");return;}
    setLoad(true);setErr("");
    const{error}=await supabase.auth.updateUser({password:pw});
    if(error){setErr(error.message);setLoad(false);return;}
    setDone(true);setLoad(false);
  }
  return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:360}}>
    <div style={{textAlign:"center",marginBottom:24}}><LogoSVG height={60}/></div>
    <form className="card" style={{padding:24}} onSubmit={e=>{e.preventDefault();go();}}>
      {done?<div style={{textAlign:"center"}}><div style={{fontSize:32,marginBottom:10}}>✅</div><div style={{fontWeight:700,marginBottom:8}}>Senha atualizada!</div><div style={{fontSize:13,color:"#666"}}>Já pode continuar usando o app normalmente.</div></div>:<>
        <div style={{fontWeight:700,marginBottom:4}}>Defina sua nova senha</div>
        <div style={{fontSize:12,color:"#666",marginBottom:16}}>Escolha uma senha nova para sua conta.</div>
        <div style={{marginBottom:13}}><span className="lbl">Nova senha</span><input type="password" name="new-password" autoComplete="new-password" className="inp" value={pw} onChange={e=>setPw(e.target.value)}/></div>
        <div style={{marginBottom:16}}><span className="lbl">Confirme a nova senha</span><input type="password" name="new-password-confirm" autoComplete="new-password" className="inp" value={pw2} onChange={e=>setPw2(e.target.value)}/></div>
        {err&&<div style={{padding:"7px 11px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,marginBottom:13,fontSize:12,color:"#dc2626"}}>{err}</div>}
        <button type="submit" className="btn" style={{width:"100%"}} disabled={load}>{load?"...":"Salvar nova senha"}</button>
      </>}
    </form>
  </div></div>;
}

// ── COMPLETAR CADASTRO (conta autenticada sem barbearia vinculada ainda) ────
function CompleteSignup({onDone,onLogout}){
  const[shopName,setShopName]=useState("");const[donoNome,setDonoNome]=useState("");const[err,setErr]=useState("");const[load,setLoad]=useState(false);
  async function go(){
    if(!shopName.trim()||!donoNome.trim()){setErr("Preencha os dois campos.");return;}
    setLoad(true);setErr("");
    const{error}=await supabase.rpc("create_my_organization",{org_name:shopName.trim(),dono_nome:donoNome.trim()});
    if(error){setErr(error.message);setLoad(false);return;}
    onDone&&onDone();
  }
  return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:360}}>
    <div style={{textAlign:"center",marginBottom:24}}><LogoSVG height={60}/></div>
    <div className="card" style={{padding:24}}>
      <div style={{fontWeight:700,marginBottom:4}}>Falta pouco!</div>
      <div style={{fontSize:12,color:"#666",marginBottom:16}}>Seu e-mail já está confirmado. Só falta criar sua barbearia.</div>
      <div style={{marginBottom:13}}><span className="lbl">Nome da barbearia</span><input className="inp" value={shopName} onChange={e=>setShopName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/></div>
      <div style={{marginBottom:16}}><span className="lbl">Seu nome</span><input className="inp" value={donoNome} onChange={e=>setDonoNome(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/></div>
      {err&&<div style={{padding:"7px 11px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,marginBottom:13,fontSize:12,color:"#dc2626"}}>{err}</div>}
      <button className="btn" style={{width:"100%"}} onClick={go} disabled={load}>{load?"...":"Criar minha barbearia"}</button>
      <div style={{textAlign:"center",marginTop:14,fontSize:12,color:"#888"}}><span style={{color:"#0e7490",cursor:"pointer",fontWeight:600}} onClick={onLogout}>Sair</span></div>
    </div>
  </div></div>;
}

// ── ASSISTENTE DE PRIMEIRO ACESSO ────────────────────────────────────────────
function OnboardingWizard({orgNome,meta,txB,txBar,barbs,setBarbs,onSaveConfig,onFinish,onSkip}){
  const[step,setStep]=useState(0);
  const[metaTmp,setMetaTmp]=useState(String(meta));
  const[txTmp,setTxTmp]=useState(txB);
  const[novoNome,setNovoNome]=useState("");const[novaMeta,setNovaMeta]=useState("5000");
  const CORES=["#0e7490","#0284c7","#059669","#dc2626","#d97706","#db2777","#4f46e5"];
  function addBarb(){
    if(!novoNome.trim())return;
    const novoId=(barbs.reduce((max,b)=>Math.max(max,b.id),0))+1;
    const cor=CORES[barbs.length%CORES.length];
    setBarbs(bs=>[...bs,{id:novoId,nome:novoNome.trim(),cor,meta:parseFloat(novaMeta)||5000,metaAssin:0,metaAvulso:0,foto:"",cnpj:""}]);
    setNovoNome("");setNovaMeta("5000");
  }
  function removeBarb(id){setBarbs(bs=>bs.filter(b=>b.id!==id));}
  const steps=["Bem-vindo","Configurações","Equipe","Pronto"];
  return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:460}}>
    <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:18}}>{steps.map((s,i)=><div key={i} style={{width:i===step?24:8,height:8,borderRadius:4,background:i<=step?"#0e7490":"#ddd",transition:"all .3s"}}/>)}</div>
    <div className="card" style={{padding:28}}>
      {step===0&&<div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:10}}>💈</div>
        <div style={{fontWeight:800,fontSize:19,marginBottom:8}}>Bem-vindo, {orgNome}!</div>
        <div style={{fontSize:13,color:"#666",lineHeight:1.6,marginBottom:20}}>Vamos configurar sua barbearia em 3 passos rápidos: metas e taxas, sua equipe, e pronto — já pode começar a lançar dados.</div>
        <button className="btn" style={{width:"100%"}} onClick={()=>setStep(1)}>Vamos começar</button>
        <div style={{marginTop:12,fontSize:12,color:"#aaa",cursor:"pointer"}} onClick={onSkip}>Pular e ir direto pro dashboard</div>
      </div>}
      {step===1&&<div>
        <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>💰 Metas e taxas</div>
        <div style={{fontSize:12,color:"#666",marginBottom:18}}>Você pode ajustar isso a qualquer momento em Config.</div>
        <div style={{marginBottom:14}}><span className="lbl">Meta de faturamento mensal</span><input className="inp" type="number" value={metaTmp} onChange={e=>setMetaTmp(e.target.value)}/></div>
        <div style={{marginBottom:14}}><span className="lbl">% de comissão do barbeiro (o resto fica com a barbearia)</span><input className="inp" type="number" value={txTmp} onChange={e=>setTxTmp(+e.target.value||0)}/><div style={{fontSize:11,color:"#888",marginTop:4}}>Barbeiro fica com {txTmp}%, barbearia fica com {100-txTmp}%</div></div>
        <div style={{display:"flex",gap:10,marginTop:10}}><button className="bg" style={{flex:1}} onClick={()=>setStep(0)}>Voltar</button><button className="btn" style={{flex:2}} onClick={()=>{onSaveConfig(parseFloat(metaTmp)||10000,txTmp,100-txTmp);setStep(2);}}>Próximo</button></div>
      </div>}
      {step===2&&<div>
        <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>👥 Sua equipe</div>
        <div style={{fontSize:12,color:"#666",marginBottom:14}}>Adicione seus barbeiros (dá pra adicionar mais depois em Config).</div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <input className="inp" style={{flex:2}} placeholder="Nome do barbeiro" value={novoNome} onChange={e=>setNovoNome(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addBarb()}/>
          <input className="inp" style={{flex:1}} type="number" placeholder="Meta" value={novaMeta} onChange={e=>setNovaMeta(e.target.value)}/>
          <button className="btn bsm" onClick={addBarb}>+</button>
        </div>
        {barbs.length===0?<div style={{color:"#ccc",fontSize:12,textAlign:"center",padding:"10px 0"}}>Nenhum barbeiro adicionado ainda.</div>:<div style={{marginBottom:10}}>{barbs.map(b=><div key={b.id} className="row"><div style={{width:10,height:10,borderRadius:"50%",background:b.cor,flexShrink:0}}/><span style={{flex:1,fontSize:13}}>{b.nome}</span><span style={{fontSize:11,color:"#888"}}>{R(b.meta)}</span><button className="bdel" onClick={()=>removeBarb(b.id)}>×</button></div>)}</div>}
        <div style={{display:"flex",gap:10,marginTop:14}}><button className="bg" style={{flex:1}} onClick={()=>setStep(1)}>Voltar</button><button className="btn" style={{flex:2}} onClick={()=>setStep(3)}>Próximo</button></div>
      </div>}
      {step===3&&<div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:10}}>🎉</div>
        <div style={{fontWeight:800,fontSize:19,marginBottom:8}}>Tudo pronto!</div>
        <div style={{fontSize:13,color:"#666",marginBottom:20}}>{barbs.length>0?`Sua equipe (${barbs.length} barbeiro${barbs.length>1?"s":""}) já está cadastrada. Você pode começar a lançar dados agora.`:"Você pode adicionar sua equipe a qualquer momento em Config → Barbeiros."}</div>
        <button className="btn" style={{width:"100%"}} onClick={onFinish}>Ir para o Dashboard</button>
      </div>}
    </div>
  </div></div>;
}

// ── RECIBO HTML ───────────────────────────────────────────────────────────────
function gerarRecibo(bS,barbs,mes,ano,tPote,txB,cnpjBarbearia,MESES,nomeEmpresa){
  const totalLiq=bS.cLiq;const totalVal=bS.tVale;
  const barbInfo=barbs.find(b=>b.id===bS.id)||{};
  const barbCnpj=barbInfo.cnpj||"";
  const diaFim=new Date(ano,mes+1,0);
  const diaFimStr=diaFim.toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
  const comSvc=(bS.fAv+bS.fEx)*(txB/100);
  const comAssin=bS.cPote;
  const comProd=bS.fPr;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo ${bS.nome} - ${MESES[mes]} ${ano}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;padding:36px;color:#1a1a2e;max-width:700px;margin:0 auto;font-size:13px}
h1{font-size:17px;font-weight:700;text-align:center;margin-bottom:18px;letter-spacing:1px;text-transform:uppercase}
p{line-height:1.7;margin-bottom:14px;text-align:justify}
table{width:100%;border-collapse:collapse;margin:14px 0}
th{text-align:left;padding:8px 10px;font-size:11px;color:#555;border-bottom:2px solid #1a1a2e;background:#f5f5f5}
th:last-child{text-align:right}
td{padding:9px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:middle}
td:last-child{text-align:right;font-weight:600}
.sec td{background:#f0f0f8;font-weight:700;font-size:11px;color:#555;letter-spacing:.5px;padding:5px 10px;text-align:left!important}
.sub td{background:#fafafe;font-weight:700;border-top:1px solid #ddd;color:#0e7490}
.tot td{font-weight:800;border-top:3px solid #1a1a2e;border-bottom:none;font-size:15px;color:#059669}
.tot td:last-child{color:#059669}
.neg{color:#dc2626!important}
.box{display:flex;justify-content:space-between;align-items:center;margin:14px 0;padding:14px 16px;border:2px solid #1a1a2e;border-radius:6px;font-size:17px;font-weight:800}
.sigs{display:flex;justify-content:space-between;margin-top:60px;gap:20px}
.sig-box{flex:1;text-align:center}
.sig-line{border-top:1px solid #333;padding-top:8px;font-weight:700;font-size:13px}
.sig-sub{font-size:11px;color:#555;margin-top:3px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:14px;border-bottom:2px solid #1a1a2e}
.btn-print{display:block;margin:24px auto 0;background:#1a1a2e;color:#fff;border:none;padding:11px 32px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}
@media print{.btn-print{display:none}}
</style></head><body>
  <div class="hdr">
  <div><div style="font-weight:900;font-size:22px">${nomeEmpresa||""}</div>
    <div style="font-size:11px;color:#888;margin-top:2px">CNPJ: ${cnpjBarbearia}</div></div>
  <div style="text-align:right">
    <div style="font-weight:700;font-size:13px">RECIBO DE COMISSÕES</div>
    <div style="font-size:11px;color:#888">${MESES[mes].toUpperCase()} / ${ano}</div>
    <div style="font-size:11px;color:#888">01/${String(mes+1).padStart(2,"0")}/${ano} — ${String(diaFim.getDate()).padStart(2,"0")}/${String(mes+1).padStart(2,"0")}/${ano}</div>
  </div>
</div>
<h1>Recibo de Pagamento de Comissões</h1>
<p>Declaro para os devidos fins o recebimento de honorário no valor líquido de <strong>${R(totalLiq)} (${extenso(totalLiq)})</strong>${totalVal>0?`, sendo já descontado o valor de <strong>${R(totalVal)} (${extenso(totalVal)})</strong> referente a vale adiantamento ou débito de comanda`:""},referente ao período de 01/${String(mes+1).padStart(2,"0")}/${ano} até ${String(diaFim.getDate()).padStart(2,"0")}/${String(mes+1).padStart(2,"0")}/${ano}, da empresa <strong>${nomeEmpresa||""}</strong>.</p>
<table>
  <thead><tr><th>Descrição</th><th style="text-align:right">Comissão</th></tr></thead>
  <tbody>
    <tr class="sec"><td colspan="2">SERVIÇOS AVULSOS E EXTRAS</td></tr>
    <tr><td>Serviços avulsos (${txB}%)</td><td>${R(bS.fAv*(txB/100))}</td></tr>
    <tr><td>Extras / Upsell (${txB}%)</td><td>${R(bS.fEx*(txB/100))}</td></tr>
    <tr class="sub"><td>Subtotal</td><td>${R(comSvc)}</td></tr>
    <tr class="sec"><td colspan="2">ASSINATURA (PACOTES)</td></tr>
    <tr><td>Participação no pote — ${bS.ftot}pts (${(bS.pct*100).toFixed(2)}%) · taxa ${txB}%</td><td>${R(comAssin)}</td></tr>
    <tr class="sub"><td>Subtotal</td><td>${R(comAssin)}</td></tr>
    <tr class="sec"><td colspan="2">PRODUTOS</td></tr>
    <tr><td>Comissão sobre vendas — ${bS.qProd} unid</td><td>${R(comProd)}</td></tr>
    <tr class="sub"><td>Subtotal</td><td>${R(comProd)}</td></tr>
    ${bS.bonTotal>0?`<tr class="sec"><td colspan="2">BONIFICAÇÕES</td></tr><tr><td>Bônus por metas atingidas</td><td>${R(bS.bonTotal)}</td></tr>`:""}
    ${totalVal>0?`<tr><td class="neg">Vales / Adiantamentos</td><td class="neg">- ${R(totalVal)}</td></tr>`:""}
    <tr class="tot"><td>TOTAL A RECEBER</td><td>${R(totalLiq)}</td></tr>
  </tbody>
</table>
<div class="box"><span>Total Líquido</span><span style="color:#059669">${R(totalLiq)}</span></div>
<div class="sigs">
  <div class="sig-box"><div style="margin-bottom:52px"></div><div class="sig-line">${nomeEmpresa||""}</div><div class="sig-sub">CNPJ: ${cnpjBarbearia}</div></div>
  <div style="flex:1;text-align:center;align-self:flex-end;font-size:11px;color:#888;padding-bottom:6px">${diaFimStr}</div>
  <div class="sig-box"><div style="margin-bottom:52px"></div><div class="sig-line">${bS.nome}</div><div class="sig-sub">Colaborador${barbCnpj?`<br>CNPJ: ${barbCnpj}`:""}</div></div>
</div>
<button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
</body></html>`;
}

// ── SINCRONIZAÇÃO DE LANÇAMENTOS (linha por linha, não mais em bloco único) ────
// Em vez de reescrever o array inteiro no banco a cada mudança, calcula só o
// que foi adicionado/editado desde a última sincronização e envia apenas essa
// diferença. Evita reescrever anos de histórico numa alteração só.
// IMPORTANTE: isto NUNCA infere exclusão a partir do array ter "diminuído" —
// um item sumir daqui pode ser só porque esta aba está com uma foto antiga em
// memória (ex: outra aba/sessão adicionou algo que esta ainda não carregou).
// Exclusão só acontece de forma explícita, chamando excluirRemoto() no exato
// momento em que o usuário clica em excluir.
function useLancamentoSync(tipo,arr,orgId,ready,retryTick,flushRegistry,onSaved,onError){
  const lastRef=useRef(null);const wasReady=useRef(false);const timerRef=useRef(null);const runRef=useRef(null);
  runRef.current=async()=>{
    const prev=lastRef.current||[];
    const prevMap=new Map(prev.map(x=>[x.id,x]));
    const toUpsert=[];
    arr.forEach(item=>{const old=prevMap.get(item.id);if(!old||JSON.stringify(old)!==JSON.stringify(item))toUpsert.push(item);});
    if(!toUpsert.length){lastRef.current=arr;return;}
    // Importar planilha gera centenas de lançamentos de uma vez. Mandar tudo numa
    // requisição só estoura o tempo limite do banco (o lançamento manual, de 1 linha,
    // passava — por isso só a importação falhava). Enviamos em lotes.
    const LOTE=200;const gravados=new Set();
    try{
      for(let i=0;i<toUpsert.length;i+=LOTE){
        const fatia=toUpsert.slice(i,i+LOTE);
        const rows=fatia.map(item=>({org_id:orgId,tipo,app_id:String(item.id),dt:item.dt||null,payload:item,atualizado_em:new Date().toISOString()}));
        const{error}=await supabase.from("org_lancamentos").upsert(rows,{onConflict:"org_id,tipo,app_id"});
        if(error)throw error;
        fatia.forEach(x=>gravados.add(x.id));
      }
      lastRef.current=arr;
      onSaved();
    }catch(err){
      // Guarda o que já foi gravado para a próxima tentativa não repetir tudo.
      if(gravados.size){
        const map=new Map(prev.map(x=>[x.id,x]));
        arr.forEach(x=>{if(gravados.has(x.id))map.set(x.id,x);});
        lastRef.current=[...map.values()];
      }
      onError(err.message||err.code||"Erro desconhecido ao salvar");
    }
  };
  useEffect(()=>{
    if(!flushRegistry)return;
    const fn=()=>{if(timerRef.current){clearTimeout(timerRef.current);timerRef.current=null;runRef.current();}};
    flushRegistry.current.add(fn);
    return()=>flushRegistry.current.delete(fn);
  },[flushRegistry]);
  useEffect(()=>{
    if(!ready||!orgId){wasReady.current=false;lastRef.current=null;return;}
    if(!wasReady.current){wasReady.current=true;lastRef.current=arr;return;}
    if(lastRef.current===arr)return;
    if(timerRef.current)clearTimeout(timerRef.current);
    timerRef.current=setTimeout(()=>{timerRef.current=null;runRef.current();},900);
  },[arr,ready,orgId,retryTick]);
}

// ── APP PRINCIPAL ─────────────────────────────────────────────────────────────
export default function App(){
  const now=new Date();
  const[session,setSession]=useState(null);const[profile,setProfile]=useState(null);const[orgNome,setOrgNome]=useState("");const[orgLogoUrl,setOrgLogoUrl]=useState(null);const[loadAuth,setLoadAuth]=useState(true);
  const[profileTick,setProfileTick]=useState(0);const[passwordRecovery,setPasswordRecovery]=useState(false);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const{data:sub}=supabase.auth.onAuthStateChange((event,sess)=>{if(event==="PASSWORD_RECOVERY")setPasswordRecovery(true);setSession(sess);});
    return()=>sub.subscription.unsubscribe();
  },[]);
  useEffect(()=>{(async()=>{
    if(!session){setProfile(null);setLoadAuth(false);return;}
    setLoadAuth(true);
    let{data:prof}=await supabase.from("profiles").select("*").eq("id",session.user.id).single();
    if(!prof){
      // sem perfil ainda: se o cadastro guardou nome da barbearia nos metadados
      // (fluxo com confirmação de e-mail), provisiona a organização agora.
      const meta=session.user.user_metadata;
      if(meta?.shop_name){
        const{error:rpcErr}=await supabase.rpc("create_my_organization",{org_name:meta.shop_name,dono_nome:meta.dono_nome||""});
        if(!rpcErr){
          const retry=await supabase.from("profiles").select("*").eq("id",session.user.id).single();
          prof=retry.data;
        }
      }
    }
    if(prof){
      setProfile(prof);
      const{data:org}=await supabase.from("organizations").select("nome,logo_url").eq("id",prof.org_id).single();
      if(org){setOrgNome(org.nome);setOrgLogoUrl(org.logo_url||null);}
    }
    setLoadAuth(false);
  })();},[session?.user?.id,profileTick]);
  const user=profile?{id:profile.id,nome:profile.nome,role:profile.role,bId:profile.barbeiro_id?+profile.barbeiro_id:null}:null;
  const logout=async()=>{await supabase.auth.signOut();};
  const isDono=user?.role==="dono";const isBarb=user?.role==="barb";
  const orgId=profile?.org_id||null;

  const[barbs,setBarbs]=useState([]);
  const[svcs,setSvcs]=useState([]);const[avul,setAvul]=useState([]);
  const[ext,setExt]=useState([]);const[extAv,setExtAv]=useState([]);
  const[prod,setProd]=useState([]);const[pote,setPote]=useState([]);const[lote,setLote]=useState([]);
  const[assinD,setAssinD]=useState({ativas:0,novas:0,canceladas:0});
  const[assinV,setAssinV]=useState([]);const[vales,setVales]=useState([]);
  const[meta,setMeta]=useState(35000);const[metaI,setMetaI]=useState("35000");
  const[mes,setMes]=useState(now.getMonth());const[ano,setAno]=useState(now.getFullYear());
  const[prodLst,setProdLst]=useState([]);
  const[estoque,setEstoque]=useState({});const[niveis,setNiveis]=useState([]);
  const[metasBon,setMetasBon]=useState([]);
  const[txB,setTxB]=useState(45);const[txBar,setTxBar]=useState(55);
  const[cnpj,setCnpj]=useState("");
  const[clt,setClt]=useState([]);const[fClt,setFClt]=useState({nome:"",salario:0,dia:5});
  const[custos,setCustos]=useState([]);const[fCusto,setFCusto]=useState({desc:"",categoria:"",tipo:"fixo",direcao:"saida",valor:0,dia:5});
  const[saldoAtual,setSaldoAtual]=useState(0);
  const[diaPagAssin,setDiaPagAssin]=useState(15);const[diaPagAvulso,setDiaPagAvulso]=useState(30);
  const[comisExcl,setComisExcl]=useState([]);
  const[profitAba,setProfitAba]=useState("itens");const[profitCatSel,setProfitCatSel]=useState(null);
  const[profitPrem,setProfitPrem]=useState({cartao:3.5,taxaFixa:0.2,imposto:5,gerente:0});
  const[profitItens,setProfitItens]=useState({});
  const[ss,setSs]=useState("idle");const[sv,setSv]=useState(null);const[loaded,setLoaded]=useState(false);
  const[onboardingSkipped,setOnboardingSkipped]=useState(false);
  const stRef=useRef(null);
  const[editModal,setEditModal]=useState(null);const[barbSel,setBarbSel]=useState(1);
  const[aba,setAba]=useState("dash");
  const[pdfFile,setPdfFile]=useState(null);const[pdfParsed,setPdfParsed]=useState(null);const[pdfEdit,setPdfEdit]=useState(null);
  const[pdfLoading,setPdfLoading]=useState(false);const[pdfProgress,setPdfProgress]=useState(0);
  const[pdfApplied,setPdfApplied]=useState(false);const[pdfErr,setPdfErr]=useState("");
  const[editQtdOpen,setEditQtdOpen]=useState(false);const[lastImportIds,setLastImportIds]=useState(null);
  const[importHistory,setImportHistory]=useState([]);
  const[melhoresDiasOpen,setMelhoresDiasOpen]=useState(false);
  const[meusMelhoresDiasOpen,setMeusMelhoresDiasOpen]=useState(false);
  const[fa,setFa]=useState({bId:1,svc:"Corte",val:40,dt:hj(),obs:"",qt:1,nota:5});
  const[flt,setFlt]=useState({bId:1,vb:"",dt:hj(),obs:""});
  const[ff,setFf]=useState({bId:1,svc:"Club Premium - Cabelo (Ilimitado)",dt:hj(),qt:1});
  const[fe,setFe]=useState({bId:1,svc:"Sobrancelha",val:"",dt:hj(),assi:false,qt:1});
  const[fp,setFp]=useState({bId:1,prod:"",val:0,qt:1,dt:hj()});
  const[fpo,setFpo]=useState({val:"",dt:hj(),obs:"",qt:1});
  const[fv,setFv]=useState({bId:1,val:"",dt:hj(),obs:""});
  const[fav2,setFav2]=useState({bId:1,qt:1,dt:hj()});
  const[notifs,setNotifs]=useState([]);const notifRef=useRef([]);
  const[editNm,setEditNm]=useState(false);const[nmsT,setNmsT]=useState([]);const[metT,setMetT]=useState([]);
  const[editTx,setEditTx]=useState(false);const[txTmp,setTxTmp]=useState({b:45,r:55});
  const[editNv,setEditNv]=useState(false);const[nvTmp,setNvTmp]=useState([]);
  const[tvMode,setTvMode]=useState(false);
  const[desafioEdit,setDesafioEdit]=useState(false);
  const[desafio,setDesafio]=useState({servico:"sobrancelhas",qt:10,pontos:50});
  const[desafioTmp,setDesafioTmp]=useState({servico:"sobrancelhas",qt:10,pontos:50});
  const[desafioPessoal,setDesafioPessoal]=useState({});const[desafioPesEdit,setDesafioPesEdit]=useState(false);const[desafioPesTmp,setDesafioPesTmp]=useState({servico:"",qt:5,pontos:20});
  const[coaching,setCoaching]=useState([]);const[coachTxt,setCoachTxt]=useState("");const[coachDt,setCoachDt]=useState(hj());
  const[metaHist,setMetaHist]=useState([]);
  const[horasTrab,setHorasTrab]=useState({});
  const[auditLog,setAuditLog]=useState([]);
  const[simExtra,setSimExtra]=useState(0);const[simProd,setSimProd]=useState(0);
  const[instaMeta,setInstaMeta]=useState({storiesQt:20,storiesBon:50,reelsQt:10,reelsBon:50});
  const[instaMetaTmp,setInstaMetaTmp]=useState({storiesQt:20,storiesBon:50,reelsQt:10,reelsBon:50});
  const[instaEditMeta,setInstaEditMeta]=useState(false);
  const[instaLancamentos,setInstaLancamentos]=useState([]);
  const[instaForm,setInstaForm]=useState({bId:1,tipo:"story",qt:1,dt:hj()});
  const[histDe,setHistDe]=useState({m:(mes-5+12)%12,a:mes-5<0?ano-1:ano});
  const[histAte,setHistAte]=useState({m:mes,a:ano});
  const[filtDe,setFiltDe]=useState(ano+"-"+String(mes+1).padStart(2,"0")+"-01");
  const[filtAte,setFiltAte]=useState(hj());
  const[barbFiltDe,setBarbFiltDe]=useState(ano+"-"+String(mes+1).padStart(2,"0")+"-01");
  const[barbFiltAte,setBarbFiltAte]=useState(hj());

  function exportarBackup(){
    const dados={barbs,svcs,avul,ext,extAv,prod,pote,lote,assinD,assinV,vales,meta,prodLst,estoque,niveis,metasBon,txB,txBar,cnpj,coaching,metaHist,horasTrab,auditLog,instaMeta,instaLancamentos,desafioPessoal,clt,custos,saldoAtual,diaPagAssin,diaPagAvulso,comisExcl,importHistory,profitPrem,profitItens,_backup:new Date().toISOString()};
    const blob=new Blob([JSON.stringify(dados,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download="backup-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a);a.click();setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
    addNotif("💾","Backup salvo!");
  }
  function importarBackup(e){
    const file=e.target.files[0];if(!file)return;
    if(!window.confirm("Restaurar este backup vai SUBSTITUIR os dados atuais pelo conteúdo do arquivo \""+file.name+"\". Tudo que não estiver no arquivo será apagado. Confirma?")){e.target.value="";return;}
    const reader=new FileReader();
    reader.onload=ev=>{try{
      const d=JSON.parse(ev.target.result);
      // Restaurar backup substitui de verdade (como sempre foi) — por isso apaga
      // explicitamente, no banco, o que não estiver no arquivo restaurado.
      const delDiff=(curr,novo)=>{const keep=new Set((novo||[]).map(x=>x.id));return(curr||[]).filter(x=>!keep.has(x.id)).map(x=>x.id);};
      if(d.barbs)setBarbs(d.barbs);
      if(d.svcs){excluirRemoto("svcs",delDiff(svcs,d.svcs));setSvcs(d.svcs);}
      if(d.avul){excluirRemoto("avul",delDiff(avul,d.avul));setAvul(d.avul);}
      if(d.ext){excluirRemoto("ext",delDiff(ext,d.ext));setExt(d.ext);}
      if(d.extAv){excluirRemoto("extAv",delDiff(extAv,d.extAv));setExtAv(d.extAv);}
      if(d.prod){excluirRemoto("prod",delDiff(prod,d.prod));setProd(d.prod);}
      if(d.pote){excluirRemoto("pote",delDiff(pote,d.pote));setPote(d.pote);}
      if(d.lote){excluirRemoto("lote",delDiff(lote,d.lote));setLote(d.lote);}
      if(d.assinD)setAssinD(d.assinD);
      if(d.assinV){excluirRemoto("assinV",delDiff(assinV,d.assinV));setAssinV(d.assinV);}
      if(d.vales){excluirRemoto("vales",delDiff(vales,d.vales));setVales(d.vales);}
      if(d.meta){setMeta(d.meta);setMetaI(String(d.meta));}
      if(d.prodLst)setProdLst(d.prodLst);if(d.estoque)setEstoque(d.estoque);
      if(d.niveis)setNiveis(d.niveis);if(d.metasBon)setMetasBon(d.metasBon);
      if(d.txB!=null)setTxB(d.txB);if(d.txBar!=null)setTxBar(d.txBar);if(d.cnpj)setCnpj(d.cnpj);
      if(d.coaching){excluirRemoto("coaching",delDiff(coaching,d.coaching));setCoaching(d.coaching);}
      if(d.metaHist)setMetaHist(d.metaHist);if(d.horasTrab)setHorasTrab(d.horasTrab);if(d.auditLog)setAuditLog(d.auditLog);
      if(d.instaMeta)setInstaMeta(d.instaMeta);
      if(d.instaLancamentos){excluirRemoto("instaLancamentos",delDiff(instaLancamentos,d.instaLancamentos));setInstaLancamentos(d.instaLancamentos);}
      if(d.desafioPessoal)setDesafioPessoal(d.desafioPessoal);
      if(d.clt)setClt(d.clt);if(d.custos)setCustos(d.custos);if(d.saldoAtual!=null)setSaldoAtual(d.saldoAtual);
      if(d.diaPagAssin!=null)setDiaPagAssin(d.diaPagAssin);if(d.diaPagAvulso!=null)setDiaPagAvulso(d.diaPagAvulso);
      if(d.comisExcl)setComisExcl(d.comisExcl);if(d.importHistory)setImportHistory(d.importHistory);
      if(d.profitPrem)setProfitPrem(d.profitPrem);if(d.profitItens)setProfitItens(d.profitItens);
      addNotif("✅","Backup restaurado com sucesso!");
    }catch(err){alert("Arquivo inválido!");}};
    reader.readAsText(file);e.target.value="";
  }

  const addNotif=useCallback((icon,msg)=>{const n={id:uid(),icon,msg};notifRef.current=[...notifRef.current.slice(-4),n];setNotifs([...notifRef.current]);setTimeout(()=>{notifRef.current=notifRef.current.filter(x=>x.id!==n.id);setNotifs([...notifRef.current]);},4000);setAuditLog(a=>[{id:n.id,icon,msg,dt:new Date().toLocaleString("pt-BR")},...a].slice(0,200));},[]);
  const findBarb=useCallback(n=>findBarbByName(n,barbs),[barbs]);

  const ABAS_DONO=[["dash","Dashboard"],["pump","PUMP"],["barb","Barbeiro"],["lanc","Lançamento"],["gal","Galaxy Pay"],["assi","Assinatura"],["extv","Extras"],["insta","Instagram"],["rel","Relatório"],["fech","Fechamento"],["comis","Comissões"],["custos","Custos"],["profit","Profit"],["gest","Gestão"],["equi","Equipe"],["game","Gamificação"],["intel","Inteligência"],["pdf","Importar Excel"],["cfg","⚙️ Config"]];
  const ABAS_BARB=[["meu","Meu Desempenho"],["perf","🎯 Performance"],["pump","PUMP"],["dash","Dashboard"],["insta","Instagram"],["game","Gamificação"],["intel","Inteligência"],["equiv","Equipe"]];
  useEffect(()=>{setAba(isDono?"dash":"meu");},[isDono]);
  const abas=isDono?ABAS_DONO:ABAS_BARB;
  const aIcon=k=>({dash:ICO.dash,barb:ICO.barb,lanc:ICO.lanc,gal:ICO.gal,assi:ICO.assi,extv:ICO.ext,rel:ICO.rel,fech:ICO.fech,comis:ICO.comis,custos:ICO.custos,profit:ICO.profit,gest:ICO.gest,equi:ICO.equi,equiv:ICO.equi,game:ICO.game,intel:ICO.intel,pdf:ICO.pdf,cfg:ICO.cfg,meu:ICO.meu,estoque:ICO.estoque,pump:ICO.pump,perf:ICO.pump,insta:ICO.insta}[k]||ICO.dash);
  const aTit=k=>({dash:"Dashboard",barb:"Barbeiro",lanc:"Lançamento",gal:"Galaxy Pay",assi:"Assinatura",extv:"Extras",insta:"📸 Instagram",rel:"Relatório",fech:"Fechamento",comis:"💰 Comissões",custos:"📉 Custos",profit:"📈 Profit",gest:"Gestão",equi:"Equipe",equiv:"Equipe",game:"Gamificação",intel:"Inteligência",pdf:"Importar Excel",cfg:"⚙️ Config",meu:"Meu Desempenho",estoque:"Estoque",pump:"PUMP",perf:"🎯 Centro de Performance"}[k]||k);

  // ── CARREGAR DADOS (Supabase) ────────────────────────────────────────────
  const[loadError,setLoadError]=useState(null);const[loadTick,setLoadTick]=useState(0);
  useEffect(()=>{(async()=>{
    if(!orgId)return;
    setLoadError(null);
    // A API do Supabase corta a resposta em 1000 linhas por requisição, então
    // buscamos em blocos até acabar. Sem isso, quem tem muitos lançamentos
    // carregava só uma fatia arbitrária deles (e os totais vinham errados).
    // A ordenação é por id porque criado_em empata em massa (migração/importação
    // gravam tudo no mesmo instante) e empate torna a paginação instável.
    const PAG=1000;let lancRows=[];let lancErr=null;
    for(let from=0;;from+=PAG){
      const{data:parte,error:errParte}=await supabase.from("org_lancamentos").select("tipo,payload").eq("org_id",orgId).order("id",{ascending:true}).range(from,from+PAG-1);
      if(errParte){lancErr=errParte;break;}
      lancRows=lancRows.concat(parte||[]);
      if(!parte||parte.length<PAG)break;
    }
    const{data:row,error}=await supabase.from("org_data").select("data").eq("org_id",orgId).single();
    // Se a busca falhar, NÃO marcamos como carregado — isso evita que o
    // salvamento automático grave dados vazios por cima dos dados reais.
    if(error){setLoadError(error.message);return;}
    if(lancErr){setLoadError(lancErr.message);return;}
    const d=row?.data;
    if(d){
      if(d.barbs)setBarbs(d.barbs);
      if(d.assinD)setAssinD(d.assinD);
      if(d.meta){setMeta(d.meta);setMetaI(String(d.meta));}
      if(d.prodLst)setProdLst(d.prodLst);if(d.estoque)setEstoque(d.estoque);
      if(d.niveis)setNiveis(d.niveis);if(d.metasBon)setMetasBon(d.metasBon);
      if(d.txB!=null)setTxB(d.txB);if(d.txBar!=null)setTxBar(d.txBar);if(d.cnpj)setCnpj(d.cnpj);
      if(d.metaHist)setMetaHist(d.metaHist);if(d.horasTrab)setHorasTrab(d.horasTrab);if(d.auditLog)setAuditLog(d.auditLog);
      if(d.instaMeta)setInstaMeta(d.instaMeta);if(d.desafioPessoal)setDesafioPessoal(d.desafioPessoal);
      if(d.desafio)setDesafio(d.desafio);
      if(d.clt)setClt(d.clt);if(d.custos)setCustos(d.custos);if(d.saldoAtual!=null)setSaldoAtual(d.saldoAtual);
      if(d.diaPagAssin!=null)setDiaPagAssin(d.diaPagAssin);if(d.diaPagAvulso!=null)setDiaPagAvulso(d.diaPagAvulso);
      if(d.comisExcl)setComisExcl(d.comisExcl);if(d.importHistory)setImportHistory(d.importHistory);
      if(d.profitPrem)setProfitPrem(d.profitPrem);if(d.profitItens)setProfitItens(d.profitItens);
      setSv(d._at||null);
    }
    const grupos={svcs:[],avul:[],ext:[],extAv:[],prod:[],pote:[],lote:[],assinV:[],vales:[],coaching:[],instaLancamentos:[]};
    (lancRows||[]).forEach(r=>{if(grupos[r.tipo])grupos[r.tipo].push(r.payload);});
    setSvcs(grupos.svcs);setAvul(grupos.avul);setExt(grupos.ext);setExtAv(grupos.extAv);
    setProd(grupos.prod);setPote(grupos.pote);setLote(grupos.lote);setAssinV(grupos.assinV);
    setVales(grupos.vales);setCoaching(grupos.coaching);setInstaLancamentos(grupos.instaLancamentos);
    setLoaded(true);
  })();},[orgId,loadTick]);

  // ── AUTO-SAVE (Supabase) ─────────────────────────────────────────────────
  // Nunca salva se o carregamento inicial não foi confirmado (evita sobrescrever dados reais com estado vazio).
  const[saveErrMsg,setSaveErrMsg]=useState("");const[saveRetryTick,setSaveRetryTick]=useState(0);
  const salvarRef=useRef(null);
  salvarRef.current=async()=>{
    if(!loaded||!isDono||!orgId||loadError)return;
    // Os arrays de lançamentos (svcs/avul/ext/extAv/prod/pote/lote/assinV/vales/coaching/instaLancamentos)
    // NÃO entram mais aqui — cada um sincroniza linha a linha via useLancamentoSync, para não reescrever
    // o histórico inteiro a cada mudança (era isso que estourava o tempo limite do banco).
    const payload={barbs,assinD,meta,prodLst,estoque,niveis,metasBon,txB,txBar,cnpj,metaHist,horasTrab,auditLog,instaMeta,desafioPessoal,desafio,clt,custos,saldoAtual,diaPagAssin,diaPagAvulso,comisExcl,importHistory,profitPrem,profitItens,_at:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})};
    const{error}=await supabase.from("org_data").update({data:payload,atualizado_em:new Date().toISOString()}).eq("org_id",orgId);
    if(error){setSs("err");setSaveErrMsg(error.message||error.code||"Erro desconhecido ao salvar");}else{setSv(payload._at);setSaveErrMsg("");setSs("saved");setTimeout(()=>setSs("idle"),2500);}
  };
  useEffect(()=>{if(!loaded||!isDono||!orgId||loadError)return;if(stRef.current)clearTimeout(stRef.current);setSs("saving");stRef.current=setTimeout(()=>{stRef.current=null;salvarRef.current();},1200);},[barbs,assinD,meta,prodLst,estoque,niveis,metasBon,txB,txBar,cnpj,metaHist,horasTrab,auditLog,instaMeta,desafioPessoal,desafio,clt,custos,saldoAtual,diaPagAssin,diaPagAvulso,comisExcl,importHistory,profitPrem,profitItens,loaded,isDono,orgId,loadError,saveRetryTick]);
  // Sincroniza cada tipo de lançamento linha a linha (só a diferença desde a última vez, nunca o histórico inteiro).
  const lancFlushRegistry=useRef(new Set());
  const lancReady=loaded&&isDono&&!!orgId&&!loadError;
  // Uma falha não pode ser apagada da tela por outro tipo de lançamento que salvou
  // logo depois — senão o erro some antes do usuário ver.
  const lancErrRef=useRef(false);
  const notifyLancSaved=useCallback(()=>{if(lancErrRef.current)return;setSv(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));setSaveErrMsg("");setSs("saved");setTimeout(()=>setSs("idle"),2500);},[]);
  const notifyLancErr=useCallback(msg=>{lancErrRef.current=true;setSs("err");setSaveErrMsg(msg);},[]);
  useLancamentoSync("svcs",svcs,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("avul",avul,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("ext",ext,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("extAv",extAv,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("prod",prod,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("pote",pote,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("lote",lote,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("assinV",assinV,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("vales",vales,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("coaching",coaching,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  useLancamentoSync("instaLancamentos",instaLancamentos,orgId,lancReady,saveRetryTick,lancFlushRegistry,notifyLancSaved,notifyLancErr);
  // Salva na hora ao trocar de aba/minimizar, em vez de esperar o debounce (evita perder o ultimo lancamento).
  useEffect(()=>{
    const flush=()=>{if(stRef.current){clearTimeout(stRef.current);stRef.current=null;salvarRef.current();}lancFlushRegistry.current.forEach(fn=>fn());};
    const onVis=()=>{if(document.visibilityState==="hidden")flush();};
    document.addEventListener("visibilitychange",onVis);
    window.addEventListener("pagehide",flush);
    return()=>{document.removeEventListener("visibilitychange",onVis);window.removeEventListener("pagehide",flush);};
  },[]);

  // ── CÁLCULOS ────────────────────────────────────────────────────────────────
  const dim=new Date(ano,mes+1,0).getDate();
  const dAt=now.getMonth()===mes&&now.getFullYear()===ano?now.getDate():dim;
  const hjS=hj();
  const noM=d=>{try{const dt=new Date(d+"T12:00:00");return dt.getMonth()===mes&&dt.getFullYear()===ano;}catch(e){return false;}};
  const noMes=(d,m2,a2)=>{try{const dt=new Date(d+"T12:00:00");return dt.getMonth()===m2&&dt.getFullYear()===a2;}catch(e){return false;}};
  const mA2=mes===0?11:mes-1;const aA2=mes===0?ano-1:ano;const noMA=d=>noMes(d,mA2,aA2);
  const sM=svcs.filter(s=>noM(s.dt));const aM=avul.filter(s=>noM(s.dt));const lM=lote.filter(l=>noM(l.dt));
  const eM=ext.filter(e=>noM(e.dt));const eAM=extAv.filter(e=>noM(e.dt));const pM=prod.filter(p=>noM(p.dt));
  const poM=pote.filter(e=>noM(e.dt));const avVM=assinV.filter(v=>noM(v.dt));
  const aMA=avul.filter(s=>noMA(s.dt));const eMA=[...ext,...extAv].filter(e=>noMA(e.dt));
  const pMA=prod.filter(p=>noMA(p.dt));const poMA=pote.filter(e=>noMA(e.dt));const lMA=lote.filter(l=>noMA(l.dt));
  const tPoteA=poMA.reduce((a,e)=>a+e.val,0);
  const tPote=poM.reduce((a,e)=>a+e.val,0);
  const tSvcU=aM.reduce((a,s)=>a+s.val*s.qt,0)+lM.reduce((a,l)=>a+l.vb,0);
  const tExt=[...eM,...eAM].reduce((a,e)=>a+e.val,0);
  const tProdBruto=pM.reduce((a,p)=>a+p.val*p.qt,0);
  const fat=tPote+tSvcU+tExt+tProdBruto;
  const fatA=tPoteA+aMA.reduce((a,s)=>a+s.val*s.qt,0)+lMA.reduce((a,l)=>a+l.vb,0)+eMA.reduce((a,e)=>a+e.val,0)+pMA.reduce((a,p)=>a+p.val*p.qt,0);
  const cresc=fatA>0?((fat-fatA)/fatA)*100:0;
  const proj=dAt>0?(fat/dAt)*dim:0;const metaDia=meta/dim;
  const ritmo=metaDia*dAt>0?((fat/(metaDia*dAt))*100)-100:0;
  const falta=Math.max(0,meta-fat);
  const tAtS=aM.reduce((a,s)=>a+s.qt,0)+lM.length;const ticketM=tAtS>0?tSvcU/tAtS:0;
  const fatHjVal=poM.filter(e=>e.dt===hjS).reduce((a,e)=>a+e.val,0)+aM.filter(s=>s.dt===hjS).reduce((a,s)=>a+s.val*s.qt,0)+lM.filter(l=>l.dt===hjS).reduce((a,l)=>a+l.vb,0)+[...eM,...eAM].filter(e=>e.dt===hjS).reduce((a,e)=>a+e.val,0)+pM.filter(p=>p.dt===hjS).reduce((a,p)=>a+p.val*p.qt,0);
  const gDia=Array.from({length:dim},(_,i)=>{const d=i+1;const dS=ano+"-"+String(mes+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");return{dia:String(d),pote:poM.filter(e=>e.dt===dS).reduce((a,e)=>a+e.val,0),svc:aM.filter(e=>e.dt===dS).reduce((a,e)=>a+e.val*e.qt,0)+lM.filter(l=>l.dt===dS).reduce((a,l)=>a+l.vb,0),ext:[...eM,...eAM].filter(e=>e.dt===dS).reduce((a,e)=>a+e.val,0),prod:pM.filter(e=>e.dt===dS).reduce((a,e)=>a+e.val*e.qt,0)};}).map(d=>({...d,tot:d.pote+d.svc+d.ext+d.prod}));

  const fbMap=barbs.map(b=>{const ss2=sM.filter(s=>s.bId===b.id);const ftot=ss2.reduce((acc,s)=>acc+(getFichasPorTipo(s.svc)*(s.qt||1)),0);return{...b,ss2,ftot};});
  const tFich=fbMap.reduce((a,b)=>a+b.ftot,0);const vPt=tFich>0?tPote/tFich:0;
  const getB=id=>barbs.find(b=>b.id===id);

  function calcBon(exB,prB,assinB){let bonTotal=0;const bonDet=[];metasBon.forEach(mb=>{let qt=0;if(mb.tipo==="extra"){if(mb.id==="sob")qt=exB.filter(e=>isExtraSob(e.svc)).length;else if(mb.id==="hid")qt=exB.filter(e=>e.svc.toLowerCase().includes("hidrat")).length;else if(mb.id==="dep")qt=exB.filter(e=>e.svc.toLowerCase().includes("depila")).length;else if(mb.id==="sel")qt=exB.filter(e=>e.svc.toLowerCase().includes("selagem")).length;else if(mb.id==="lim")qt=exB.filter(e=>e.svc.toLowerCase().includes("limpeza")).length;else if(mb.id==="pig")qt=exB.filter(e=>e.svc.toLowerCase().includes("pigmenta")).length;else if(mb.id==="cam")qt=exB.filter(e=>e.svc.toLowerCase().includes("camufla")).length;}else if(mb.tipo==="prod")qt=prB.reduce((a,p)=>a+p.qt,0);else if(mb.tipo==="assin")qt=assinB;const bateu=qt>=mb.meta;if(bateu)bonTotal+=mb.bon;bonDet.push({...mb,qt,bateu});});return{bonTotal,bonDet};}

  const calcB=fbMap.map(b=>{
    const tx=txB/100;const pct=tFich>0?b.ftot/tFich:0;const cPote=tPote*pct*tx;
    const avB=aM.filter(s=>s.bId===b.id);const lotB=lM.filter(l=>l.bId===b.id);
    const fAv=avB.reduce((a,s)=>a+s.val*s.qt,0)+lotB.reduce((a,l)=>a+l.vb,0);
    const exB=[...eM,...eAM].filter(e=>e.bId===b.id);const fEx=exB.reduce((a,e)=>a+e.val,0);
    const prB=pM.filter(p=>p.bId===b.id);
    const fPr=prB.reduce((a,p)=>{const pd=prodLst.find(x=>x.nome===p.prod);return a+p.val*p.qt*(pd?.comissao??0.20);},0);
    const fPrBruto=prB.reduce((a,p)=>a+p.val*p.qt,0);
    const cAv=(fAv+fEx)*tx;const totC=cPote+cAv+fPr;
    const assinB2=avVM.filter(v=>v.bId===b.id).reduce((a,v)=>a+v.qt,0);
    const{bonTotal,bonDet}=calcBon(exB,prB,assinB2);
    const totCBon=totC+bonTotal;
    const tVale=vales.filter(v=>v.bId===b.id&&noM(v.dt)).reduce((a,v)=>a+v.val,0);
    const cLiq=Math.max(0,totCBon-tVale);
    const atend=avB.reduce((a,s)=>a+s.qt,0)+exB.length+lotB.length;
    const atS2=avB.reduce((a,s)=>a+s.qt,0)+lotB.length;const ticket=atS2>0?fAv/atS2:0;
    const metaB=b.meta||7000;const pctM=Math.min(100,(totC/metaB)*100);
    const qExt=exB.length;const qProd=prB.reduce((a,p)=>a+p.qt,0);
    const dtsU=new Set([...avB.map(s=>s.dt),...lotB.map(l=>l.dt),...exB.map(e=>e.dt)]);
    const ssMA=svcs.filter(s=>noMA(s.dt)&&s.bId===b.id);const ftMA=ssMA.reduce((a,s)=>a+(getFichasPorTipo(s.svc)*(s.qt||1)),0);
    const avBMA=aMA.filter(s=>s.bId===b.id);const lotBMA=lMA.filter(l=>l.bId===b.id);const exBMA=eMA.filter(e=>e.bId===b.id);
    const fAvMA=avBMA.reduce((a,s)=>a+s.val*s.qt,0)+lotBMA.reduce((a,l)=>a+l.vb,0);const fExMA=exBMA.reduce((a,e)=>a+e.val,0);
    const tFichA=svcs.filter(s=>noMA(s.dt)).reduce((a,s)=>a+(getFichasPorTipo(s.svc)*(s.qt||1)),0);
    const cAnt=tPoteA*(tFichA>0?ftMA/Math.max(tFichA,1):0)+(fAvMA+fExMA)*tx;
    const crescB=cAnt>0?((totC-cAnt)/cAnt)*100:0;
    const faltaB=Math.max(0,metaB-totC);const dRest=Math.max(1,dim-dAt);const vPD=faltaB/dRest;const projB=dAt>0?(totC/dAt)*dim:0;
    const nvAt=niveis.filter(n=>totC>=n.valor).pop()||null;
    let streak=0;const dts2=[...dtsU].sort().reverse();let prev=new Date(hjS);
    for(const ds of dts2){const dd=new Date(ds+"T12:00:00");if(Math.round((prev-dd)/86400000)<=1){streak++;prev=dd;}else break;}
    const notaMedia=avB.length?avB.reduce((a,s)=>a+(s.nota||5),0)/avB.length:null;
    return{...b,pct,cPote,cAv,fAv,fEx,fPr,fPrBruto,totC,totCBon,bonTotal,bonDet,tVale,cLiq,atend,ticket,metaB,pctM,crescB,streak,assinB:assinB2,qExt,qProd,notaMedia,clU:dtsU.size,upsell:dtsU.size>0?Math.min(100,([...exB,...prB,...avVM.filter(v=>v.bId===b.id)].length/dtsU.size)*100):0,faltaB,vPD,projB,nvAt,avB,exB,prB,lotB,ss2:b.ss2,ftot:b.ftot};
  }).sort((a,b2)=>b2.totCBon-a.totCBon);

  const tCP=calcB.reduce((a,b)=>a+b.cPote,0);const tCA=calcB.reduce((a,b)=>a+b.cAv,0);
  const tVG=calcB.reduce((a,b)=>a+b.tVale,0);const tCL=calcB.reduce((a,b)=>a+b.cLiq,0);
  const tBon=calcB.reduce((a,b)=>a+b.bonTotal,0);const maxC=calcB[0]?.totCBon||1;
  const bAtSel=calcB.find(b=>b.id===barbSel)||calcB[0];
  const meuB=isBarb?calcB.find(b=>b.id===user.bId):null;
  const meuRk=isBarb?calcB.findIndex(b=>b.id===user.bId)+1:null;

  const dinhPerdido=metasBon.filter(m=>m.tipo==="extra"||m.tipo==="prod").map(m=>{let realizado=0;if(m.id==="sob")realizado=[...eM,...eAM].filter(e=>isExtraSob(e.svc)).length;else if(m.id==="hid")realizado=[...eM,...eAM].filter(e=>e.svc.toLowerCase().includes("hidrat")).length;else if(m.id==="dep")realizado=[...eM,...eAM].filter(e=>e.svc.toLowerCase().includes("depil")).length;else if(m.id==="sel")realizado=[...eM,...eAM].filter(e=>e.svc.toLowerCase().includes("selagem")).length;else if(m.id==="lim")realizado=[...eM,...eAM].filter(e=>e.svc.toLowerCase().includes("limpeza")).length;else if(m.id==="pig")realizado=[...eM,...eAM].filter(e=>e.svc.toLowerCase().includes("pigmenta")).length;else if(m.id==="cam")realizado=[...eM,...eAM].filter(e=>e.svc.toLowerCase().includes("camufla")).length;else if(m.id==="prod")realizado=pM.reduce((a,p)=>a+p.qt,0);const faltam=Math.max(0,m.meta-realizado);return{...m,realizado,faltam,vPerdido:faltam*(m.vUnit||20)};}).filter(m=>m.faltam>0);
  const totalPerdido=dinhPerdido.reduce((a,m)=>a+m.vPerdido,0);

  // ── HISTÓRICO (para aba Inteligência) ─────────────────────────────────────
  function computeMonthTotals(m2,a2){
    const inM=d=>{try{const dt=new Date(d+"T12:00:00");return dt.getMonth()===m2&&dt.getFullYear()===a2;}catch(e){return false;}};
    const sM2=svcs.filter(s=>inM(s.dt));const aM2=avul.filter(s=>inM(s.dt));const lM2=lote.filter(l=>inM(l.dt));
    const eM2=[...ext,...extAv].filter(e=>inM(e.dt));const pM2=prod.filter(p=>inM(p.dt));const poM2=pote.filter(e=>inM(e.dt));
    const tPote2=poM2.reduce((a,e)=>a+e.val,0);
    const fb2=barbs.map(b=>{const ss=sM2.filter(s=>s.bId===b.id);const ftot=ss.reduce((a,s)=>a+(getFichasPorTipo(s.svc)*(s.qt||1)),0);return{...b,ftot};});
    const tFich2=fb2.reduce((a,b)=>a+b.ftot,0);const tx=txB/100;
    const perBarber=fb2.map(b=>{
      const pct=tFich2>0?b.ftot/tFich2:0;const cPote=tPote2*pct*tx;
      const avB=aM2.filter(s=>s.bId===b.id);const lotB=lM2.filter(l=>l.bId===b.id);
      const fAv=avB.reduce((a,s)=>a+s.val*s.qt,0)+lotB.reduce((a,l)=>a+l.vb,0);
      const exB=eM2.filter(e=>e.bId===b.id);const fEx=exB.reduce((a,e)=>a+e.val,0);
      const prB=pM2.filter(p=>p.bId===b.id);
      const fPr=prB.reduce((a,p)=>{const pd=prodLst.find(x=>x.nome===p.prod);return a+p.val*p.qt*(pd?.comissao??0.20);},0);
      return{id:b.id,nome:b.nome,cor:b.cor,total:cPote+(fAv+fEx)*tx+fPr};
    });
    return{total:perBarber.reduce((a,b)=>a+b.total,0),perBarber};
  }
  const hist6=Array.from({length:6},(_,i)=>{let m2=mes-i,a2=ano;while(m2<0){m2+=12;a2-=1;}const d=computeMonthTotals(m2,a2);return{label:MESES[m2].slice(0,3)+"/"+String(a2).slice(2),m2,a2,...d};}).reverse();
  const histRange=monthsBetween(histDe,histAte).map(({m,a})=>{const d=computeMonthTotals(m,a);return{label:MESES[m].slice(0,3)+"/"+String(a).slice(2),m,a,...d};});
  // Faturamento bruto dos últimos 6 meses (só para o gráfico do Dashboard).
  const fat6=Array.from({length:6},(_,i)=>{
    let m2=mes-i,a2=ano;while(m2<0){m2+=12;a2-=1;}
    const inM=d=>{try{const dt=new Date(d+"T12:00:00");return dt.getMonth()===m2&&dt.getFullYear()===a2;}catch(e){return false;}};
    const assin=pote.filter(x=>inM(x.dt)).reduce((a,x)=>a+x.val,0);
    const serv=avul.filter(x=>inM(x.dt)).reduce((a,x)=>a+x.val*(x.qt||1),0)+lote.filter(x=>inM(x.dt)).reduce((a,x)=>a+x.vb,0);
    const extras=[...ext,...extAv].filter(x=>inM(x.dt)).reduce((a,x)=>a+x.val,0);
    const prods=prod.filter(x=>inM(x.dt)).reduce((a,x)=>a+x.val*(x.qt||1),0);
    return{label:MESES[m2].slice(0,3)+"/"+String(a2).slice(2),Assinatura:Math.round(assin),Avulso:Math.round(serv+extras),Produtos:Math.round(prods),Total:Math.round(assin+serv+extras+prods)};
  }).reverse();

  // ── AÇÕES ──────────────────────────────────────────────────────────────────
  const lanAvul=()=>{setAvul(s=>[{id:uid(),bId:+fa.bId,svc:fa.svc,val:+fa.val||0,dt:fa.dt,obs:fa.obs,qt:+fa.qt||1,nota:+fa.nota||5},...s]);addNotif("💈",barbs.find(b=>b.id===+fa.bId)?.nome.split(" ")[0]+" · "+fa.svc);setFa(f=>({...f,obs:"",qt:1,nota:5}));};
  const lanLote=()=>{const v=+flt.vb;if(!v)return;setLote(l=>[{id:uid(),bId:+flt.bId,vb:v,dt:flt.dt,obs:flt.obs},...l]);addNotif("📦","Lote · "+R(v));setFlt(f=>({...f,vb:"",obs:""}));};
  const lanFich=()=>{const q=+ff.qt||1;for(let i=0;i<q;i++)setSvcs(s=>[{id:uid(),bId:+ff.bId,svc:ff.svc,dt:ff.dt,qt:1,fich:getFichasPorTipo(ff.svc)},...s]);setFf(f=>({...f,qt:1}));};
  const lanExt=()=>{const v=+fe.val;if(!v)return;const q=+fe.qt||1;for(let i=0;i<q;i++){if(fe.assi)setExt(e=>[{id:uid(),bId:+fe.bId,svc:fe.svc,val:v,dt:fe.dt,assi:true},...e]);else setExtAv(e=>[{id:uid(),bId:+fe.bId,svc:fe.svc,val:v,dt:fe.dt,assi:false},...e]);}addNotif("⭐","Upsell: "+fe.svc);setFe(f=>({...f,val:"",qt:1}));};
  const lanProd=()=>{const v=+fp.val;if(!v)return;const pd=prodLst.find(x=>x.nome===fp.prod);setProd(p=>[{id:uid(),bId:+fp.bId,prod:fp.prod,val:v,qt:+fp.qt||1,dt:fp.dt,comissao:pd?pd.comissao:0.20},...p]);addNotif("🛍️",fp.prod);setEstoque(e=>({...e,[fp.prod]:Math.max(0,(e[fp.prod]||0)-(+fp.qt||1))}));setFp(f=>({...f,val:"",qt:1}));};
  useEffect(()=>{
    const dtPadrao=ano+"-"+String(mes+1).padStart(2,"0")+"-01";
    setFpo(f=>({...f,dt:dtPadrao}));
    setFa(f=>({...f,dt:dtPadrao}));
    setFlt(f=>({...f,dt:dtPadrao}));
    setFf(f=>({...f,dt:dtPadrao}));
    setFe(f=>({...f,dt:dtPadrao}));
    setFp(f=>({...f,dt:dtPadrao}));
    setFv(f=>({...f,dt:dtPadrao}));
    setFav2(f=>({...f,dt:dtPadrao}));
    setInstaForm(f=>({...f,dt:dtPadrao}));
    setFiltDe(dtPadrao);setFiltAte(hj());
    setBarbFiltDe(dtPadrao);setBarbFiltAte(hj());
  },[mes,ano]);
  useEffect(()=>{if(prodLst.length&&!fp.prod)setFp(f=>({...f,prod:prodLst[0].nome,val:prodLst[0].v}));},[prodLst]);
  const lanPote=()=>{const v=+fpo.val;if(!v)return;const q=+fpo.qt||1;for(let i=0;i<q;i++)setPote(e=>[{id:uid(),val:v,dt:fpo.dt,obs:fpo.obs},...e]);addNotif("💳","Galaxy Pay · "+R(v*q));setFpo(f=>({...f,val:"",obs:"",qt:1}));};
  const lanVale=()=>{const v=+fv.val;if(!v)return;setVales(vs=>[{id:uid(),bId:+fv.bId,val:v,dt:fv.dt,obs:fv.obs},...vs]);setFv(f=>({...f,val:"",obs:""}));};
  const lanAssin=()=>{const q=+fav2.qt||1;setAssinV(v=>[{id:uid(),bId:+fav2.bId,qt:q,dt:fav2.dt},...v]);addNotif("🌟","Assinaturas: "+q);setFav2(f=>({...f,qt:1}));};
  const lanInsta=()=>{const q=+instaForm.qt||1;setInstaLancamentos(l=>[{id:uid(),bId:+instaForm.bId,tipo:instaForm.tipo,qt:q,dt:instaForm.dt},...l]);addNotif(instaForm.tipo==="story"?"📸":"🎬",(barbs.find(b=>b.id===+instaForm.bId)?.nome.split(" ")[0]||"")+" · "+q+" "+(instaForm.tipo==="story"?"story(s)":"reel(s)"));setInstaForm(f=>({...f,qt:1}));};
  const salvNomes=()=>{
    setBarbs(bs=>{
      const novo=bs.map((b,i)=>({...b,nome:nmsT[i]||b.nome,meta:parseFloat(metT[i])||b.meta}));
      const changes=novo.filter((b,i)=>b.meta!==bs[i].meta).map(b=>({id:uid(),bId:b.id,valor:b.meta,dt:hj()}));
      if(changes.length){setMetaHist(h=>[...changes,...h]);addNotif("🎯","Meta(s) atualizada(s)");}
      return novo;
    });
    setEditNm(false);
  };
  const CORES_NOVO_BARB=["#0e7490","#0284c7","#059669","#dc2626","#d97706","#db2777","#4f46e5"];
  function addBarbeiro(){
    const novoId=(barbs.reduce((max,b)=>Math.max(max,b.id),0))+1;
    const cor=CORES_NOVO_BARB[barbs.length%CORES_NOVO_BARB.length];
    setBarbs(bs=>[...bs,{id:novoId,nome:"Novo Barbeiro",cor,meta:5000,metaAssin:2500,metaAvulso:2500,foto:"",cnpj:""}]);
    setNmsT(n=>[...n,"Novo Barbeiro"]);setMetT(m=>[...m,5000]);
    addNotif("💈","Barbeiro adicionado — edite o nome");
  }
  function removeBarbeiro(id,idx){
    if(!window.confirm("Remover este barbeiro? Lançamentos antigos dele deixam de aparecer nos totais."))return;
    setBarbs(bs=>bs.filter(b=>b.id!==id));
    setNmsT(n=>n.filter((_,j)=>j!==idx));setMetT(m=>m.filter((_,j)=>j!==idx));
  }
  // Exclusão remota explícita — nunca inferida por diferença de array (evita apagar
  // por engano algo que outra aba/sessão adicionou e esta ainda não carregou).
  async function excluirRemoto(tipo,ids){
    if(!ids||!ids.length||!orgId)return;
    // Em lotes: os ids viajam na URL, e apagar uma importação inteira de uma vez
    // gerava uma URL grande demais para o servidor aceitar.
    const LOTE=150;
    for(let i=0;i<ids.length;i+=LOTE){
      const{error}=await supabase.from("org_lancamentos").delete().eq("org_id",orgId).eq("tipo",tipo).in("app_id",ids.slice(i,i+LOTE).map(String));
      if(error){setSs("err");setSaveErrMsg(error.message||"Erro ao excluir");return;}
    }
  }
  function delExtra(id){setExt(v=>v.filter(x=>x.id!==id));setExtAv(v=>v.filter(x=>x.id!==id));excluirRemoto("ext",[id]);excluirRemoto("extAv",[id]);}
  function updExtra(item){setExt(v=>v.map(x=>x.id===item.id?item:x));setExtAv(v=>v.map(x=>x.id===item.id?item:x));}
  function uploadFoto(bId,e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>setBarbs(bs=>bs.map(b=>b.id===bId?{...b,foto:ev.target.result}:b));reader.readAsDataURL(file);}

  const[logoUploading,setLogoUploading]=useState(false);const[logoErr,setLogoErr]=useState("");
  async function uploadLogo(e){
    const file=e.target.files[0];e.target.value="";if(!file||!orgId)return;
    setLogoUploading(true);setLogoErr("");
    const ext=file.name.split(".").pop();
    const path=orgId+"/logo."+ext;
    const{error:upErr}=await supabase.storage.from("logos").upload(path,file,{upsert:true,cacheControl:"3600"});
    if(upErr){setLogoErr(upErr.message);setLogoUploading(false);return;}
    const{data:pub}=supabase.storage.from("logos").getPublicUrl(path);
    const url=pub.publicUrl+"?t="+Date.now();
    const{error:updErr}=await supabase.from("organizations").update({logo_url:url}).eq("id",orgId);
    if(updErr){setLogoErr(updErr.message);setLogoUploading(false);return;}
    setOrgLogoUrl(url);addNotif("🖼️","Logo atualizado!");
    setLogoUploading(false);
  }

  // ── INTEGRAÇÃO GALAXPAY (Cel Cash) ─────────────────────────────────────────
  const[galaxId,setGalaxId]=useState("");const[galaxHash,setGalaxHash]=useState("");
  const[galaxStatus,setGalaxStatus]=useState(null);const[galaxSaving,setGalaxSaving]=useState(false);
  const[galaxSyncing,setGalaxSyncing]=useState(false);const[galaxErr,setGalaxErr]=useState("");
  const refreshGalaxStatus=useCallback(async()=>{
    const{data,error}=await supabase.rpc("get_galaxpay_status");
    if(!error&&data&&data[0])setGalaxStatus(data[0]);
  },[]);
  useEffect(()=>{if(orgId&&isDono)refreshGalaxStatus();},[orgId,isDono,refreshGalaxStatus]);
  async function salvarGalaxCreds(){
    if(!galaxId.trim()||!galaxHash.trim()){setGalaxErr("Preencha os dois campos.");return;}
    setGalaxSaving(true);setGalaxErr("");
    const{error}=await supabase.from("org_integrations").upsert({org_id:orgId,provider:"galaxpay",galax_id:galaxId.trim(),galax_hash:galaxHash.trim()},{onConflict:"org_id"});
    if(error){setGalaxErr(error.message);setGalaxSaving(false);return;}
    setGalaxId("");setGalaxHash("");addNotif("🔗","Credenciais GalaxPay salvas!");
    await refreshGalaxStatus();setGalaxSaving(false);
  }
  async function sincronizarGalaxPay(){
    setGalaxSyncing(true);setGalaxErr("");
    const de=ano+"-"+String(mes+1).padStart(2,"0")+"-01";
    const{data,error}=await supabase.functions.invoke("galaxpay-sync",{body:{startDate:de,endDate:hj()}});
    if(error){setGalaxErr(error.message||"Falha ao sincronizar.");setGalaxSyncing(false);return;}
    if(data?.error){setGalaxErr(data.error);setGalaxSyncing(false);return;}
    addNotif("🔄",(data?.added||0)+" lançamento(s) importado(s) do GalaxPay!");
    if(data?.added>0){
      const{data:rows}=await supabase.from("org_lancamentos").select("payload").eq("org_id",orgId).eq("tipo","pote").order("criado_em",{ascending:false});
      if(rows)setPote(rows.map(r=>r.payload));
    }
    await refreshGalaxStatus();setGalaxSyncing(false);
  }
  function limparTudoBarbeiro(bId){
    if(!window.confirm("Excluir TODOS os lançamentos?"))return;
    const match=s=>s.bId===bId&&noM(s.dt);
    excluirRemoto("svcs",svcs.filter(match).map(x=>x.id));excluirRemoto("avul",avul.filter(match).map(x=>x.id));
    excluirRemoto("ext",ext.filter(match).map(x=>x.id));excluirRemoto("extAv",extAv.filter(match).map(x=>x.id));
    excluirRemoto("prod",prod.filter(match).map(x=>x.id));excluirRemoto("lote",lote.filter(match).map(x=>x.id));
    setSvcs(v=>v.filter(s=>!match(s)));setAvul(v=>v.filter(s=>!match(s)));setExt(v=>v.filter(s=>!match(s)));setExtAv(v=>v.filter(s=>!match(s)));setProd(v=>v.filter(s=>!match(s)));setLote(v=>v.filter(s=>!match(s)));
    addNotif("🗑","Lançamentos apagados!");
  }
  function limparTudoPdf(){
    if(!window.confirm("Excluir TUDO importado via Excel?"))return;
    const match=s=>noM(s.dt)&&s.src==="pdf";
    excluirRemoto("svcs",svcs.filter(match).map(x=>x.id));excluirRemoto("avul",avul.filter(match).map(x=>x.id));
    excluirRemoto("ext",ext.filter(match).map(x=>x.id));excluirRemoto("extAv",extAv.filter(match).map(x=>x.id));
    excluirRemoto("prod",prod.filter(match).map(x=>x.id));
    setSvcs(v=>v.filter(s=>!match(s)));setAvul(v=>v.filter(s=>!match(s)));setExt(v=>v.filter(s=>!match(s)));setExtAv(v=>v.filter(s=>!match(s)));setProd(v=>v.filter(s=>!match(s)));
    addNotif("🗑","Importação removida!");
  }
  function hasPdfMes(){return sM.some(s=>s.src==="pdf")||aM.some(s=>s.src==="pdf")||[...eM,...eAM].some(s=>s.src==="pdf")||pM.some(p=>p.src==="pdf");}
  function excluirUltimoImport(){
    if(!lastImportIds||(!lastImportIds.svcs.length&&!lastImportIds.avul.length&&!lastImportIds.extras.length&&!lastImportIds.prod.length)){addNotif("ℹ️","Nenhum lançamento recente para excluir.");return;}
    if(!window.confirm("Excluir apenas o último lançamento aplicado?"))return;
    excluirRemoto("svcs",lastImportIds.svcs);excluirRemoto("avul",lastImportIds.avul);excluirRemoto("extAv",lastImportIds.extras);excluirRemoto("prod",lastImportIds.prod);
    setSvcs(v=>v.filter(x=>!lastImportIds.svcs.includes(x.id)));
    setAvul(v=>v.filter(x=>!lastImportIds.avul.includes(x.id)));
    setExtAv(v=>v.filter(x=>!lastImportIds.extras.includes(x.id)));
    setProd(v=>v.filter(x=>!lastImportIds.prod.includes(x.id)));
    setLastImportIds(null);
    addNotif("🗑","Último lançamento removido!");
  }
  function addCoaching(){if(!coachTxt.trim())return;setCoaching(c=>[{id:uid(),bId:barbSel,texto:coachTxt.trim(),dt:coachDt},...c]);addNotif("📝","Observação adicionada: "+(getB(barbSel)?.nome.split(" ")[0]||""));setCoachTxt("");}

  function exportarRecibo(bS){
    const html=gerarRecibo(bS,barbs,mes,ano,tPote,txB,cnpj,MESES,orgNome);
    const blob=new Blob([html],{type:"text/html"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="recibo-"+bS.nome.split(" ")[0].toLowerCase()+"-"+MESES[mes].toLowerCase()+ano+".html";
    document.body.appendChild(a);a.click();
    setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
    addNotif("🖨️","Recibo baixado!");
  }

  async function parseExcelFile(file,onP){
    if(!window.XLSX){await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";s.onload=res;s.onerror=()=>rej(new Error("Falha SheetJS"));document.head.appendChild(s);});}
    const XLSX=window.XLSX;const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:""});onP&&onP(40);
    if(!rows.length)throw new Error("Planilha vazia.");
    const keys=Object.keys(rows[0]);const fc=c=>keys.find(k=>c.some(x=>k.toLowerCase().includes(x.toLowerCase())))||null;
    const colProf=fc(["Profissional","Prof","Barbeiro"]);const colSvc=fc(["Serviço","Servico","Service","Pacote"]);const colValItem=fc(["Valor Item","ValorItem"]);const colVal=fc(["Valor","Value","Total"]);const colDt=fc(["Data","Date","Dt"]);
    if(!colProf||!colSvc||!colDt)throw new Error("Colunas não reconhecidas.");
    const pv=v=>{if(!v&&v!==0)return 0;return parseFloat(String(v).replace(/[R$\s]/g,"").replace(",","."))||0;};
    const pd=v=>{const s=String(v);const m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(m){let[,d2,mo,y]=m;if(y.length===2)y="20"+y;return y+"-"+mo.padStart(2,"0")+"-"+d2.padStart(2,"0");}if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);if(!isNaN(v)){const dd=new Date(Math.round((+v-25569)*86400*1000));return dd.toISOString().slice(0,10);}return null;};
    const result=[];
    for(const r of rows){const prof=String(r[colProf]||"").trim();const svc=normSvc(String(r[colSvc]||"").trim());const dt=pd(r[colDt]);if(!prof||!svc||!dt)continue;const val=colValItem?pv(r[colValItem]):pv(r[colVal]);result.push({id:uid(),prof,svc,val,dt});}
    onP&&onP(90);if(!result.length)throw new Error("Nenhum registro válido.");return result;
  }

  async function runImport(){
    if(!pdfFile)return;setPdfLoading(true);setPdfErr("");setPdfParsed(null);setPdfApplied(false);setPdfProgress(10);
    try{
      const rows=await parseExcelFile(pdfFile,p=>setPdfProgress(p));
      setPdfProgress(90);
      const mapped=rows.map(r=>{const b=findBarb(r.prof);return{...r,bId:b?b.id:null,prof:b?b.nome:r.prof};});
      const parsed=groupRows(mapped,prodLst);
      setPdfParsed(parsed);
      const cloned=JSON.parse(JSON.stringify(parsed));
      ["fichas","avulsos","extras","produtos"].forEach(k=>{if(cloned[k])cloned[k]=cloned[k].map(r=>({...r,qtdEdit:1}));});
      setPdfEdit(cloned);
      setPdfProgress(100);
      addNotif("📊",parsed.total+" registros lidos!");
    }catch(e){setPdfErr(e.message||"Erro");setPdfProgress(0);}
    setPdfLoading(false);
  }

  function applyPdf(){
    const src=pdfEdit||pdfParsed;if(!src)return;
    const expand=(rows,mapFn)=>{const out=[];(rows||[]).forEach(r=>{const n=r.qtdEdit||1;for(let i=0;i<n;i++)out.push(mapFn(r));});return out;};
    const newFichas=expand(src.fichas,r=>({id:uid(),bId:r.bId||1,svc:r.svc,dt:r.dt,qt:1,fich:getFichasPorTipo(r.svc),src:"pdf"}));
    const newAvulsos=expand(src.avulsos,r=>({id:uid(),bId:r.bId||1,svc:r.svc,val:r.val,dt:r.dt,qt:1,src:"pdf"}));
    const newExtras=expand(src.extras,r=>({id:uid(),bId:r.bId||1,svc:r.svc,val:r.val,dt:r.dt,assi:false,src:"pdf"}));
    const newProdutos=expand(src.produtos,r=>({id:uid(),bId:r.bId||1,prod:r.prod||r.svc,val:r.val,qt:1,dt:r.dt,comissao:r.comissao||0.20,src:"pdf"}));
    if(newFichas.length)setSvcs(s=>[...newFichas,...s]);
    if(newAvulsos.length)setAvul(s=>[...newAvulsos,...s]);
    if(newExtras.length)setExtAv(s=>[...newExtras,...s]);
    if(newProdutos.length)setProd(s=>[...newProdutos,...s]);
    const ids={svcs:newFichas.map(x=>x.id),avul:newAvulsos.map(x=>x.id),extras:newExtras.map(x=>x.id),prod:newProdutos.map(x=>x.id)};
    setLastImportIds(ids);
    setImportHistory(h=>[{id:uid(),dt:new Date().toLocaleString("pt-BR"),fichas:newFichas.length,avulsos:newAvulsos.length,extras:newExtras.length,produtos:newProdutos.length,ids},...h].slice(0,15));
    setPdfApplied(true);addNotif("✅",(newFichas.length+newAvulsos.length+newExtras.length+newProdutos.length)+" registros aplicados!");
  }
  function excluirImportHist(histId){
    const item=importHistory.find(h=>h.id===histId);if(!item)return;
    const totalItem=item.fichas+item.avulsos+item.extras+item.produtos;
    if(!window.confirm("Excluir os "+totalItem+" registros importados em "+item.dt+"?"))return;
    excluirRemoto("svcs",item.ids.svcs);excluirRemoto("avul",item.ids.avul);excluirRemoto("extAv",item.ids.extras);excluirRemoto("prod",item.ids.prod);
    setSvcs(v=>v.filter(x=>!item.ids.svcs.includes(x.id)));
    setAvul(v=>v.filter(x=>!item.ids.avul.includes(x.id)));
    setExtAv(v=>v.filter(x=>!item.ids.extras.includes(x.id)));
    setProd(v=>v.filter(x=>!item.ids.prod.includes(x.id)));
    setImportHistory(h=>h.filter(x=>x.id!==histId));
    addNotif("🗑","Importação de "+item.dt+" removida!");
  }

  function ERow({item,fields,setter,onDel,tipo,children}){return <div className="row"><div style={{display:"contents"}}>{children}</div><button onClick={()=>setEditModal({item,fields,setter,onSave:(tmp)=>{if(setter)setter(arr=>Array.isArray(arr)?arr.map(x=>x.id===tmp.id?tmp:x):arr);setEditModal(null);}})} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",flexShrink:0,fontSize:12}}>✏️</button><button className="bdel" onClick={()=>{if(onDel)onDel(item.id);else{if(setter)setter(arr=>Array.isArray(arr)?arr.filter(x=>x.id!==item.id):arr);if(tipo)excluirRemoto(tipo,[item.id]);}}}>×</button></div>;}

  if(passwordRecovery)return <ResetPassword/>;
  if(loadAuth)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{CSS}</style><span style={{color:"#aaa"}}>Carregando...</span></div>;
  if(!session)return <Login onProvisioned={()=>setProfileTick(t=>t+1)}/>;
  if(!user)return <CompleteSignup onDone={()=>setProfileTick(t=>t+1)} onLogout={logout}/>;
  if(loadError)return <div style={{minHeight:"100vh",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><style>{CSS}</style><div style={{width:"100%",maxWidth:400}}><div className="card" style={{padding:24,textAlign:"center"}}>
    <div style={{fontSize:32,marginBottom:10}}>⚠️</div>
    <div style={{fontWeight:700,marginBottom:8}}>Não consegui carregar seus dados</div>
    <div style={{fontSize:13,color:"#666",marginBottom:4}}>Isso é proposital: por segurança, o app não salva nada até confirmar que carregou seus dados reais primeiro — assim evitamos apagar algo por engano.</div>
    <div style={{fontSize:11,color:"#aaa",marginBottom:16,fontFamily:"monospace"}}>{loadError}</div>
    <button className="btn" style={{width:"100%"}} onClick={()=>setLoadTick(t=>t+1)}>Tentar de novo</button>
  </div></div></div>;
  if(isDono&&loaded&&barbs.length===0&&!onboardingSkipped)return <OnboardingWizard orgNome={orgNome} meta={meta} txB={txB} txBar={txBar} barbs={barbs} setBarbs={setBarbs} onSaveConfig={(m,tb,tr)=>{setMeta(m);setMetaI(String(m));setTxB(tb);setTxBar(tr);}} onFinish={()=>setOnboardingSkipped(true)} onSkip={()=>setOnboardingSkipped(true)}/>;

  // ── MODO TV ────────────────────────────────────────────────────────────────
  if(tvMode&&isDono)return <div style={{position:"fixed",inset:0,background:"#0d0d1a",color:"#fff",zIndex:1000,display:"flex",flexDirection:"column"}}><style>{CSS}</style>
    <div style={{padding:"14px 28px",borderBottom:"1px solid #ffffff10",display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:20,fontWeight:800}}>{orgNome} <span style={{background:"#ff000020",border:"1px solid #ff000060",color:"#ff6b6b",padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:700,marginLeft:8}}>AO VIVO</span></div><button onClick={()=>setTvMode(false)} style={{background:"#ffffff15",border:"1px solid #ffffff30",color:"#fff",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12}}>Sair</button></div>
    <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,padding:"16px 28px",overflow:"hidden"}}>
      <div style={{background:"#ffffff0a",border:"1px solid #ffffff15",borderRadius:16,padding:16,gridRow:"span 2",overflowY:"auto"}}><div style={{fontSize:11,color:"#ffffff60",fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>🏆 Ranking</div>{calcB.map((b,i)=><div key={b.id} style={{marginBottom:12}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{fontSize:18,width:26}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</span><BAv b={getB(b.id)} size={32}/><div style={{flex:1}}><div style={{fontWeight:700,color:"#fff",fontSize:13}}>{b.nome.split(" ")[0]}</div><div style={{fontSize:11,color:"#ffffff60"}}>{b.ftot}pts · {b.atend} atend</div></div><div style={{fontSize:15,fontWeight:800,color:b.cor}}>{R(b.totCBon)}</div></div><div style={{background:"#ffffff10",borderRadius:4,height:4}}><div style={{height:4,borderRadius:4,background:b.cor,width:Math.min(100,(b.totCBon/maxC)*100)+"%"}}/></div></div>)}</div>
      <div style={{background:"#ffffff0a",border:"1px solid #ffffff15",borderRadius:16,padding:16}}><div style={{fontSize:11,color:"#ffffff60",fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>💰 Faturamento</div><div style={{fontSize:38,fontWeight:900,color:"#67e8f9"}}>{R(fat)}</div><div style={{fontSize:12,color:fat>=meta?"#4ade80":"#facc15",marginTop:6}}>{((fat/meta)*100).toFixed(1)}% da meta · {falta>0?"Falta "+R(falta):"✅ META BATIDA!"}</div></div>
      <div style={{background:"#ffffff0a",border:"1px solid #ffffff15",borderRadius:16,padding:16}}><div style={{fontSize:11,color:"#ffffff60",fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>📅 Hoje</div><div style={{fontSize:38,fontWeight:900,color:"#facc15"}}>{R(fatHjVal)}</div><div style={{fontSize:12,color:"#ffffff60",marginTop:6}}>Meta dia: {R(metaDia)}</div></div>
      <div style={{background:"#ffffff0a",border:"1px solid #ffffff15",borderRadius:16,padding:16}}><div style={{fontSize:11,color:"#ffffff60",fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>📈 Projeção</div><div style={{fontSize:38,fontWeight:900,color:proj>=meta?"#4ade80":"#facc15"}}>{R(proj)}</div></div>
      <div style={{background:"#ffffff0a",border:"1px solid #ffffff15",borderRadius:16,padding:16}}><div style={{fontSize:11,color:"#ffffff60",fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>⭐ Upsells</div>{calcB.map(b=><div key={b.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}><BAv b={getB(b.id)} size={20}/><span style={{flex:1,fontSize:12,color:"#ffffffcc"}}>{b.nome.split(" ")[0]}</span><span style={{fontSize:12,fontWeight:700,color:"#0284c7"}}>{b.qExt}ext</span><span style={{fontSize:12,fontWeight:700,color:"#d97706",marginLeft:4}}>{b.qProd}prd</span></div>)}</div>
    </div>
  </div>;

  // ── LAYOUT PRINCIPAL ───────────────────────────────────────────────────────
  return <div className="shell" style={{position:"relative"}}><style>{CSS}</style>
    {editModal&&<EditModal item={editModal.item} fields={editModal.fields} barbs={barbs} onSave={tmp=>{editModal.onSave(tmp);setEditModal(null);}} onClose={()=>setEditModal(null)}/>}
    {ss==="saving"&&<div className="toast" style={{color:"#d97706"}}>Salvando...</div>}
    {ss==="saved"&&<div className="toast">Salvo{sv?" às "+sv:""}</div>}
    {ss==="err"&&<div className="toast" style={{background:"#fef2f2",border:"1px solid #fecaca",color:"#dc2626",display:"flex",alignItems:"center",gap:10,maxWidth:340}}><span>⚠️ Não salvou: {saveErrMsg}</span><button className="btn bsm" style={{background:"#dc2626",flexShrink:0}} onClick={()=>{lancErrRef.current=false;setSs("saving");setSaveRetryTick(t=>t+1);}}>Tentar de novo</button></div>}
    {notifs.length>0&&<div style={{position:"fixed",bottom:20,right:20,zIndex:998,maxWidth:280}}>{notifs.map(n=><div key={n.id} style={{background:"linear-gradient(135deg,#1a1a2e,#2d2d4e)",border:"1px solid #0e749040",color:"#fff",borderRadius:10,padding:"9px 14px",marginTop:7,fontSize:13,fontWeight:600}}>{n.icon} {n.msg}</div>)}</div>}

    <aside className="sb">
      <div className="sblogo">{orgLogoUrl?<img src={orgLogoUrl} alt={orgNome} style={{maxHeight:38,maxWidth:"100%",display:"block",margin:"0 auto"}}/>:<div className="brand" style={{fontSize:17}}>{orgNome}</div>}</div>
      <nav className="sbnav">{abas.map(([k,v])=><div key={k} className={"ni"+(aba===k?" on":"")} onClick={()=>setAba(k)}>{aIcon(k)}<span>{v}</span></div>)}</nav>
      <div className="sbft"><div className="sfui"><div className="sfav">{isBarb&&getB(user.bId)?.foto?.length>50?<img src={getB(user.bId).foto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:user.nome.charAt(0)}</div><div><div className="sfnm">{user.nome.split(" ")[0]}</div><div className="sfrole">{isDono?"Dono":"Barbeiro"}</div></div></div><div className="ni" style={{padding:"7px 0",color:"#ff6b6b",cursor:"pointer"}} onClick={logout}>{ICO.sair}<span style={{fontSize:12}}>Sair</span></div></div>
    </aside>

    <div className="main">
      <div className="tb">
        <div className="tbt">{aTit(aba)}</div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={mes} onChange={e=>setMes(+e.target.value)}>{MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}</select>
          <select className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={ano} onChange={e=>setAno(+e.target.value)}>{[2023,2024,2025,2026,2027].map(a=><option key={a}>{a}</option>)}</select>
          <button className="bg bsm" onClick={()=>window.location.reload()}>🔄</button>
          {isDono&&<button className="btn bsm" style={{background:"#1a1a2e"}} onClick={()=>setTvMode(true)}>TV</button>}
        </div>
      </div>
      <div className="pb">

{/* ─── DASHBOARD ─── */}
{aba==="dash"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card" style={{borderLeft:"4px solid #0e7490"}}>
    <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:12}}>
      <div><div style={{fontSize:11,color:"#aaa",fontWeight:600}}>{MESES[mes].toUpperCase()+" "+ano+" · DIA "+dAt+"/"+dim}</div><DB v={cresc}/></div>
      {isDono&&<div style={{display:"flex",gap:6}}><input className="inp" type="number" style={{width:95,fontSize:12}} value={metaI} onChange={e=>setMetaI(e.target.value)}/><button className="btn bsm" onClick={()=>setMeta(parseFloat(metaI)||meta)}>OK</button></div>}
    </div>
    <div className="g4" style={{marginBottom:12}}>{[{l:"Realizado",v:R(fat),c:"#0e7490"},{l:"Meta",v:R(meta)},{l:"Falta",v:falta===0?"✓":R(falta),c:falta===0?"#059669":"#dc2626"},{l:"Projeção",v:R(proj),c:proj>=meta?"#059669":"#d97706"}].map((k,i)=><div key={i}><div style={{fontSize:10,color:"#aaa",marginBottom:2,fontWeight:600}}>{k.l}</div><div style={{fontSize:20,fontWeight:800,color:k.c||"#1a1a2e"}}>{k.v}</div></div>)}</div>
    <PB val={fat} max={meta} cor="#0e7490" pct lg/>
  </div>
  <div className="card" style={{borderLeft:"4px solid "+(ritmo>=0?"#059669":"#dc2626")}}>
    <div className="g4">
      <div style={{textAlign:"center",padding:"9px 10px",background:ritmo>=0?"#dcfce7":"#fee2e2",borderRadius:8}}><div style={{fontSize:10,color:"#888",fontWeight:600,marginBottom:2}}>RITMO</div><div style={{fontSize:20,fontWeight:800,color:ritmo>=0?"#059669":"#dc2626"}}>{(ritmo>=0?"+":"-")+Math.abs(ritmo).toFixed(1)+"%"}</div></div>
      <div style={{textAlign:"center",padding:"9px 10px",background:"#ecfeff",borderRadius:8}}><div style={{fontSize:10,color:"#aaa",fontWeight:600,marginBottom:2}}>META DIA</div><div style={{fontSize:18,fontWeight:700,color:"#0e7490"}}>{R(metaDia)}</div></div>
      <div style={{textAlign:"center",padding:"9px 10px",background:"#fffbeb",borderRadius:8}}><div style={{fontSize:10,color:"#aaa",fontWeight:600,marginBottom:2}}>HOJE</div><div style={{fontSize:18,fontWeight:700,color:"#0284c7"}}>{R(fatHjVal)}</div></div>
      <div style={{textAlign:"center",padding:"9px 10px",background:"#f0f9ff",borderRadius:8}}><div style={{fontSize:10,color:"#aaa",fontWeight:600,marginBottom:2}}>PROJEÇÃO</div><div style={{fontSize:18,fontWeight:700,color:proj>=meta?"#059669":"#d97706"}}>{R(proj)}</div></div>
    </div>
  </div>
  {(()=>{
    const metaQuinz=meta*0.6;
    const realizadoAte15=gDia.slice(0,15).reduce((a,d)=>a+d.tot,0);
    const bateu=realizadoAte15>=metaQuinz;
    const faltaQuinz=Math.max(0,metaQuinz-realizadoAte15);
    return <div className="card" style={{borderLeft:"4px solid "+(bateu?"#059669":dAt>15?"#dc2626":"#d97706")}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div className="st" style={{marginBottom:0}}>📆 Meta quinzenal (dia 15) — 60% da meta mensal</div>
        <span style={{fontSize:11,color:"#aaa"}}>{dAt<15?`Faltam ${15-dAt} dia(s) até o corte`:dAt===15?"Hoje é o corte":"Corte já passou"}</span>
      </div>
      <div className="g3" style={{marginBottom:10}}>
        <div style={{textAlign:"center",padding:"9px 10px",background:"#ecfeff",borderRadius:8}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>META (60%)</div><div style={{fontSize:18,fontWeight:800,color:"#0e7490"}}>{R(metaQuinz)}</div></div>
        <div style={{textAlign:"center",padding:"9px 10px",background:bateu?"#f0fdf4":"#fffbeb",borderRadius:8}}><div style={{fontSize:10,color:bateu?"#059669":"#d97706",fontWeight:700}}>REALIZADO ATÉ DIA 15</div><div style={{fontSize:18,fontWeight:800,color:bateu?"#059669":"#d97706"}}>{R(realizadoAte15)}</div></div>
        <div style={{textAlign:"center",padding:"9px 10px",background:bateu?"#f0fdf4":"#fef2f2",borderRadius:8}}><div style={{fontSize:10,color:bateu?"#059669":"#dc2626",fontWeight:700}}>FALTA</div><div style={{fontSize:18,fontWeight:800,color:bateu?"#059669":"#dc2626"}}>{bateu?"✓":R(faltaQuinz)}</div></div>
      </div>
      <PB val={realizadoAte15} max={metaQuinz} cor={bateu?"#059669":"#0e7490"} pct lg/>
    </div>;
  })()}
  <div className="g4">
    <KPI lbl="💳 Assinatura" val={R(tPote)} cor="#d97706" glow/>
    <KPI lbl="✂️ Avulso+Extras" val={R(tSvcU+tExt)} cor="#0e7490" glow/>
    <KPI lbl="🛍️ Produtos" val={R(tProdBruto)} cor="#059669" glow/>
    <KPI lbl="🎁 Bônus" val={R(tBon)} cor="#0284c7"/>
  </div>
  <KPI lbl="✂️🛍️ Avulso + Extras + Produtos (sem assinatura)" val={R(tSvcU+tExt+tProdBruto)} cor="#0284c7" glow/>
  <div className="g4">
    <KPI lbl="Total faturamento" val={R(fat)} cor="#0e7490"/>
    <KPI lbl="Ticket médio" val={R(ticketM)} cor="#0284c7"/>
    <KPI lbl="Atendimentos" val={aM.reduce((a,s)=>a+s.qt,0)+[...eM,...eAM].length+lM.length}/>
    <KPI lbl="vs mês ant." val={(cresc>=0?"+":"")+cresc.toFixed(1)+"%"} cor={cresc>=0?"#059669":"#dc2626"}/>
  </div>
  {isDono&&(()=>{
    const inRange=dt=>dt>=filtDe&&dt<=filtAte;
    const pP=pote.filter(e=>inRange(e.dt)).reduce((a,e)=>a+e.val,0);
    const aP=avul.filter(s=>inRange(s.dt)).reduce((a,s)=>a+s.val*s.qt,0)+lote.filter(l=>inRange(l.dt)).reduce((a,l)=>a+l.vb,0);
    const eP=[...ext,...extAv].filter(e=>inRange(e.dt)).reduce((a,e)=>a+e.val,0);
    const prP=prod.filter(p=>inRange(p.dt)).reduce((a,p)=>a+p.val*p.qt,0);
    const totP=pP+aP+eP+prP;
    return <div className="card" style={{borderLeft:"4px solid #0284c7"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
        <div className="st" style={{marginBottom:0}}>📅 Faturamento por período (livre, dia ou intervalo)</div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input type="date" className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={filtDe} onChange={e=>setFiltDe(e.target.value)}/>
          <span style={{fontSize:11,color:"#aaa"}}>até</span>
          <input type="date" className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={filtAte} onChange={e=>setFiltAte(e.target.value)}/>
        </div>
      </div>
      <div className="g4">
        <div style={{textAlign:"center",padding:"9px 10px",background:"#fffbeb",borderRadius:8}}><div style={{fontSize:10,color:"#d97706",fontWeight:700}}>💳 ASSINATURA</div><div style={{fontSize:16,fontWeight:800,color:"#d97706"}}>{R(pP)}</div></div>
        <div style={{textAlign:"center",padding:"9px 10px",background:"#ecfeff",borderRadius:8}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>✂️ AVULSO</div><div style={{fontSize:16,fontWeight:800,color:"#0e7490"}}>{R(aP)}</div></div>
        <div style={{textAlign:"center",padding:"9px 10px",background:"#f0f9ff",borderRadius:8}}><div style={{fontSize:10,color:"#0284c7",fontWeight:700}}>⭐ EXTRAS</div><div style={{fontSize:16,fontWeight:800,color:"#0284c7"}}>{R(eP)}</div></div>
        <div style={{textAlign:"center",padding:"9px 10px",background:"#f0fdf4",borderRadius:8}}><div style={{fontSize:10,color:"#059669",fontWeight:700}}>🛍️ PRODUTOS</div><div style={{fontSize:16,fontWeight:800,color:"#059669"}}>{R(prP)}</div></div>
      </div>
      <div style={{marginTop:10,padding:"9px 12px",background:"#1a1a2e",borderRadius:7,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:"#ffffffcc",fontWeight:600}}>TOTAL NO PERÍODO</span><span style={{fontSize:15,fontWeight:800,color:"#fff"}}>{R(totP)}</span></div>
    </div>;
  })()}
  {dinhPerdido.length>0&&<div className="card" style={{borderLeft:"4px solid #dc2626",background:"#fef2f2"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div className="st" style={{marginBottom:0,color:"#dc2626"}}>💸 Oportunidades perdidas</div><div style={{fontWeight:800,color:"#dc2626"}}>{R(totalPerdido)}</div></div><div className="g3">{dinhPerdido.map((m,i)=><div key={i} style={{background:"#fff",border:"1px solid #fecaca",borderRadius:8,padding:"9px 11px"}}><div style={{fontSize:11,fontWeight:700,color:"#dc2626",marginBottom:2}}>{m.nome}</div><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:17,fontWeight:700,color:"#dc2626"}}>-{m.faltam}</span><span style={{fontSize:11,color:"#888"}}>{m.realizado}/{m.meta}</span></div><PB val={m.realizado} max={m.meta} cor="#dc2626" pct={false}/><div style={{fontSize:11,color:"#dc2626",fontWeight:600,marginTop:3}}>{R(m.vPerdido)}</div></div>)}</div></div>}
  {(()=>{
    const ult=fat6[fat6.length-1]?.Total||0;const pen=fat6[fat6.length-2]?.Total||0;
    const varPct=pen>0?((ult-pen)/pen)*100:0;
    return <div className="card">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10,marginBottom:6}}>
        <div className="st" style={{marginBottom:0}}>Faturamento — últimos 6 meses</div>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <span style={{fontSize:19,fontWeight:800,color:"#101828",letterSpacing:"-.02em"}}>{R(ult)}</span>
          {pen>0&&<DB v={varPct}/>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={215}>
        <AreaChart data={fat6} margin={{top:18,right:12,left:-14,bottom:0}}>
          <defs>
            <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0e7490" stopOpacity={0.26}/><stop offset="100%" stopColor="#0e7490" stopOpacity={0}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" vertical={false}/>
          <XAxis dataKey="label" tick={{fill:"#98a2b3",fontSize:11}} tickLine={false} axisLine={false} dy={4}/>
          <YAxis tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>v>0?Math.round(v/1000)+"k":"0"}/>
          <Tooltip content={<CT/>} cursor={{stroke:"#cbd5e1",strokeDasharray:"4 4"}}/>
          <Area type="monotone" dataKey="Total" stroke="#0e7490" strokeWidth={2.6} fill="url(#gFat)" dot={{r:3.5,fill:"#0e7490",strokeWidth:2,stroke:"#fff"}} activeDot={{r:5.5,strokeWidth:2,stroke:"#fff"}} label={{position:"top",fontSize:10,fill:"#98a2b3",formatter:v=>v>0?Math.round(v/1000)+"k":""}}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>;
  })()}
  <div className="card"><div className="st">Faturamento diário</div><ResponsiveContainer width="100%" height={150}><BarChart data={gDia} margin={{top:8,right:4,left:-18,bottom:0}} barCategoryGap="22%"><CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" vertical={false}/><XAxis dataKey="dia" tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} interval={3}/><YAxis tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>v>0?Math.round(v/1000)+"k":""}/><Tooltip content={<CT/>} cursor={{fill:"#0e74900d"}}/><ReferenceLine y={metaDia} stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1.5}/><Bar dataKey="pote" name="Assinatura" stackId="a" fill="#d97706"/><Bar dataKey="svc" name="Serviços" stackId="a" fill="#0e7490"/><Bar dataKey="ext" name="Extras" stackId="a" fill="#0284c7"/><Bar dataKey="prod" name="Produtos" stackId="a" fill="#059669" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
  <div className="card"><div className="st">Ranking</div>{calcB.map((b,i)=><div key={b.id} style={{marginBottom:12}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}><span style={{width:20,height:20,borderRadius:"50%",background:i===0?"#d97706":i===1?"#888":i===2?"#b45309":"#f0f0f5",color:i<3?"#fff":"#888",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,flexShrink:0}}>{i+1}</span><BAv b={getB(b.id)} size={32} fs={13}/><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{b.nome.split(" ")[0]}</div><div style={{fontSize:11,color:"#aaa"}}>{b.ftot}pts · {b.atend} atend</div></div><div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:700,color:b.cor}}>{R(b.totCBon)}</div><DB v={b.crescB}/></div></div><PB val={b.totCBon} max={maxC} cor={b.cor} pct={false}/></div>)}</div>
  {isDono&&(()=>{
    const partic=calcB.map(b=>{const bruto=tPote*b.pct+b.fAv+b.fEx+b.fPrBruto;return{...b,bruto,pctFat:fat>0?(bruto/fat)*100:0};}).sort((a,b2)=>b2.bruto-a.bruto);
    return <div className="card"><div className="st">📊 Participação no faturamento total — {R(fat)}</div>
      {partic.map(b=><div key={b.id} style={{marginBottom:10}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}><BAv b={getB(b.id)} size={28} fs={12}/><span style={{flex:1,fontSize:13,fontWeight:600}}>{b.nome.split(" ")[0]}</span><span style={{fontSize:11,color:"#888"}}>{R(b.bruto)}</span><span style={{fontSize:15,fontWeight:800,color:b.cor,minWidth:52,textAlign:"right"}}>{b.pctFat.toFixed(1)}%</span></div><PB val={b.pctFat} max={100} cor={b.cor} pct={false}/></div>)}
    </div>;
  })()}
</div>}

{/* ─── PUMP ─── */}
{aba==="pump"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div style={{background:"linear-gradient(135deg,#1a1a2e,#2d1b4e)",borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",gap:14}}><div style={{fontSize:34}}>⚡</div><div><div style={{fontSize:17,fontWeight:800,color:"#fff"}}>PUMP <span style={{color:"#67e8f9",fontSize:12,fontWeight:500}}>— Motor de Performance</span></div><div style={{fontSize:12,color:"#ffffff60",marginTop:2}}>Análise completa por barbeiro</div></div></div>
  {isDono&&<div className="card"><div className="st">📊 Divisão do pote — {tFich} fichas · {R(tPote)}</div>
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:380}}><thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["Barbeiro","Fichas","% Pote","Bruto","Comissão ("+txB+"%)"].map(h=><th key={h} style={{textAlign:"left",padding:"5px 8px",fontSize:10,color:"#aaa",fontWeight:600}}>{h}</th>)}</tr></thead>
      <tbody>{calcB.map(b=><tr key={b.id} style={{borderBottom:"1px solid #f0f0f5"}}><td style={{padding:"7px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><BAv b={getB(b.id)} size={22} fs={10}/><span style={{fontWeight:600}}>{b.nome.split(" ")[0]}</span></div></td><td style={{padding:"7px 8px",color:"#d97706",fontWeight:700}}>{b.ftot}pts</td><td style={{padding:"7px 8px",color:"#888"}}>{(b.pct*100).toFixed(2)}%</td><td style={{padding:"7px 8px"}}>{R(tPote*b.pct)}</td><td style={{padding:"7px 8px",fontWeight:600,color:"#0e7490"}}>{R(b.cPote)}</td></tr>)}
        <tr style={{borderTop:"2px solid #e0e0f0",background:"#fafafa"}}><td style={{padding:"7px 8px",fontWeight:700}}>TOTAL</td><td style={{padding:"7px 8px",fontWeight:700,color:"#d97706"}}>{tFich}pts</td><td style={{padding:"7px 8px",fontWeight:700}}>100%</td><td style={{padding:"7px 8px",fontWeight:700}}>{R(tPote)}</td><td style={{padding:"7px 8px",fontWeight:700,color:"#0e7490"}}>{R(tCP)}</td></tr>
      </tbody></table></div>
  </div>}
  {(isBarb?[meuB].filter(Boolean):calcB).map(b=>b&&<div key={b.id} style={{background:"#fff",border:"2px solid "+(isBarb&&b.id===user.bId?"#0e7490":"#e8e8f0"),borderRadius:12,padding:18}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
      <BAv b={getB(b.id)} size={44} fs={18}/>
      <div style={{flex:1}}><div style={{fontWeight:700,fontSize:16}}>{b.nome.split(" ")[0]}</div><div style={{fontSize:11,color:"#aaa"}}>{b.nvAt?b.nvAt.icon+" "+b.nvAt.nome+" · ":""}<span style={{color:"#d97706",fontWeight:700}}>{b.ftot}pts</span>{" · 🔥"+b.streak+"d"}{b.notaMedia!=null?" · ⭐"+b.notaMedia.toFixed(1):""}</div></div>
      <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:800,color:b.cor}}>{R(b.totCBon)}</div><DB v={b.crescB}/></div>
    </div>
    <div className="g3" style={{marginBottom:10}}>
      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"9px 11px"}}><div style={{fontSize:10,color:"#d97706",fontWeight:700}}>💳 ASSINATURA</div><div style={{fontSize:18,fontWeight:800,color:"#d97706"}}>{R(b.cPote)}</div><div style={{fontSize:11,color:"#888"}}>{b.ftot}pts · {(b.pct*100).toFixed(1)}%</div></div>
      <div style={{background:"#ecfeff",border:"1px solid #a5f3fc",borderRadius:8,padding:"9px 11px"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>✂️ AVULSO+EXTRAS</div><div style={{fontSize:18,fontWeight:800,color:"#0e7490"}}>{R(b.cAv)}</div><div style={{fontSize:11,color:"#888"}}>{R(b.fAv+b.fEx)} bruto</div></div>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"9px 11px"}}><div style={{fontSize:10,color:"#059669",fontWeight:700}}>🛍️ PRODUTOS</div><div style={{fontSize:18,fontWeight:800,color:"#059669"}}>{R(b.fPr)}</div><div style={{fontSize:11,color:"#888"}}>{b.qProd} unid</div></div>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:150}}><ResponsiveContainer width="100%" height={110}><RadarChart data={[{m:"Vendas",v:Math.min(100,b.pctM)},{m:"Extras",v:Math.min(100,b.upsell)},{m:"Produtos",v:Math.min(100,(b.qProd/Math.max(metasBon.find(x=>x.id==="prod")?.meta||15,1))*100)},{m:"Streak",v:Math.min(100,b.streak*10)}]}><PolarGrid stroke="#e8e8f0"/><PolarAngleAxis dataKey="m" tick={{fill:"#98a2b3",fontSize:10.5}}/><Radar dataKey="v" stroke={b.cor} fill={b.cor} fillOpacity={0.25}/></RadarChart></ResponsiveContainer></div>
      <div style={{flex:2,minWidth:160}}><div style={{fontSize:11,fontWeight:700,color:"#888",marginBottom:6,textTransform:"uppercase"}}>Metas de bônus (todas)</div>{b.bonDet.map((m,i)=><div key={i} style={{marginBottom:4}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:1}}><span style={{fontSize:11}}>{m.nome}</span><span style={{fontSize:11,fontWeight:600,color:m.bateu?"#059669":"#888"}}>{m.qt}/{m.meta}{m.bateu&&" ✓"}</span></div><PB val={m.qt} max={m.meta} cor={m.bateu?"#059669":b.cor} pct={false}/></div>)}</div>
    </div>
  </div>)}
</div>}

{/* ─── CENTRO DE PERFORMANCE ─── */}
{aba==="perf"&&(()=>{
  const b=isBarb?meuB:calcB.find(x=>x.id===barbSel)||calcB[0];if(!b)return null;
  const _isCurMes=now.getMonth()===mes&&now.getFullYear()===ano;
  const hjFatD=_isCurMes?hjS:ano+"-"+String(mes+1).padStart(2,"0")+"-"+String(dAt).padStart(2,"0");
  const hjFat=b.avB.filter(s=>s.dt===hjFatD).reduce((a,s)=>a+s.val*s.qt,0)+b.exB.filter(e=>e.dt===hjFatD).reduce((a,e)=>a+e.val,0)+b.prB.filter(p=>p.dt===hjFatD).reduce((a,p)=>a+p.val*p.qt,0)+b.lotB.filter(l=>l.dt===hjFatD).reduce((a,l)=>a+l.vb,0)+(poM.filter(e=>e.dt===hjFatD).reduce((a,e)=>a+e.val,0)*b.pct*(txB/100));
  const metaDiaB=b.metaB/dim;const faltaHj=Math.max(0,metaDiaB-hjFat);const pctHj=metaDiaB>0?Math.min(100,(hjFat/metaDiaB)*100):0;
  const ritmoFech=dAt>0?(b.totC/dAt)*dim:0;const pctMes=b.metaB>0?Math.min(100,(b.totC/b.metaB)*100):0;
  const diasRestantes=Math.max(1,dim-dAt);const faltaMes=Math.max(0,b.metaB-b.totC);const diasParaMeta=b.totC>0&&dAt>0?Math.ceil(b.metaB/(b.totC/dAt))-dAt:diasRestantes;
  const atendHj=b.avB.filter(s=>s.dt===hjS).reduce((a,s)=>a+(s.qt||1),0)+b.ss2.filter(s=>s.dt===hjS).length+b.exB.filter(e=>e.dt===hjS).length;
  const totalAtend=b.avB.reduce((a,s)=>a+(s.qt||1),0)+b.lotB.length+b.ss2.length;
  const totalExtras=b.exB.length;const convExtra=totalAtend>0?Math.min(100,(totalExtras/totalAtend)*100):0;
  const sobQt=b.exB.filter(e=>isExtraSob(e.svc)).length;const hidQt=b.exB.filter(e=>e.svc.toLowerCase().includes("hidrat")).length;const selQt=b.exB.filter(e=>e.svc.toLowerCase().includes("selagem")).length;
  const mediaEquipe=calcB.length>0?calcB.reduce((a,x)=>a+x.totC,0)/calcB.length:0;const diffEquipe=mediaEquipe>0?((b.totC-mediaEquipe)/mediaEquipe)*100:0;
  const ticketB=b.avB.length>0?b.fAv/b.avB.length:0;
  const hoje=new Date(hjS);const d7=new Date(hoje);d7.setDate(hoje.getDate()-7);const d14=new Date(hoje);d14.setDate(hoje.getDate()-14);
  const ext7=b.exB.filter(e=>{const d=new Date(e.dt+"T12:00:00");return d>=d7&&d<=hoje;}).length;
  const ext14=b.exB.filter(e=>{const d=new Date(e.dt+"T12:00:00");return d>=d14&&d<d7;}).length;
  const quedaExtra=ext14>0?((ext7-ext14)/ext14)*100:0;
  const ratioAssin=tFich>0?(b.ftot/tFich)*100:0;const ratioProd=b.qProd>0?b.qProd:0;const ratioExt=b.qExt>0?b.qExt:0;
  const perfil=ratioAssin>40?"Especialista em Assinaturas":ratioProd>10?"Especialista em Produtos":"Especialista em Extras";
  const perfilDesc=ratioAssin>40?"Você converte "+ratioAssin.toFixed(0)+"% mais planos que a média.":ratioProd>10?"Você está entre os top vendedores de produtos.":"Você é fera nos serviços extras.";
  const conquistas=[];if(sobQt>=40)conquistas.push({icon:"👑",nome:"Mestre da Sobrancelha",desc:"40+ sobrancelhas no mês"});if(pctMes>=120)conquistas.push({icon:"🚀",nome:"Meta Explodida",desc:"120%+ da meta mensal"});if(b.streak>=7)conquistas.push({icon:"🔥",nome:"Sequência de Fogo",desc:b.streak+" dias seguidos"});if(b.qProd>=15)conquistas.push({icon:"🛍️",nome:"Vendedor Top",desc:"15+ produtos vendidos"});
  const rkExt=[...calcB].sort((a,c)=>c.qExt-a.qExt);const rkProd=[...calcB].sort((a,c)=>c.qProd-a.qProd);const rkAssin=[...calcB].sort((a,c)=>c.assinB-c.assinB);const rkAtend=[...calcB].sort((a,c)=>c.atend-a.atend);
  const posExt=rkExt.findIndex(x=>x.id===b.id)+1;const posProd=rkProd.findIndex(x=>x.id===b.id)+1;const posAssin=rkAssin.findIndex(x=>x.id===b.id)+1;const posAtend=rkAtend.findIndex(x=>x.id===b.id)+1;
  const cacaBon=b.bonDet.filter(m=>!m.bateu&&m.faltam<=5);
  const bonPotencial=cacaBon.reduce((a,m)=>a+m.bon,0);
  const clientesSemExtra=Math.max(0,totalAtend-totalExtras);
  const potPerdido=clientesSemExtra*(ticketB*0.3||20);
  const velPct=Math.min(150,b.metaB>0?(ritmoFech/b.metaB)*100:0);
  const velColor=velPct>=100?"#059669":velPct>=80?"#d97706":"#dc2626";
  const txL=txB/100;
  const comHoje=(b.avB.filter(s=>s.dt===hjFatD).reduce((a,s)=>a+s.val*s.qt,0)+b.exB.filter(e=>e.dt===hjFatD).reduce((a,e)=>a+e.val,0))*txL+b.prB.filter(p=>p.dt===hjFatD).reduce((a,p)=>{const pd=prodLst.find(x=>x.nome===p.prod);return a+p.val*p.qt*(pd?.comissao??0.2);},0)+(poM.filter(e=>e.dt===hjFatD).reduce((a,e)=>a+e.val,0)*b.pct*txL);
  const semAvExt=b.avB.filter(s=>{const d=new Date(s.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,s)=>a+s.val*s.qt,0)+b.exB.filter(e=>{const d=new Date(e.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,e)=>a+e.val,0);
  const semProd=b.prB.filter(p=>{const d=new Date(p.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,p)=>{const pd=prodLst.find(x=>x.nome===p.prod);return a+p.val*p.qt*(pd?.comissao??0.2);},0);
  const semPote=poM.filter(e=>{const d=new Date(e.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,e)=>a+e.val,0)*b.pct*txL;
  const comSemana=semAvExt*txL+semProd+semPote;

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    {/* COMISSÃO DIA / SEMANA */}
    <div className="card" style={{borderLeft:"4px solid #059669"}}>
      <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>💰 Comissão do Dia e da Semana</div>
      <div className="g2">
        <div style={{background:"#f0fdf4",borderRadius:8,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:10,color:"#059669",fontWeight:700}}>COMISSÃO HOJE</div><div style={{fontSize:22,fontWeight:800,color:"#059669"}}>{R(comHoje)}</div></div>
        <div style={{background:"#ecfeff",borderRadius:8,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>COMISSÃO SEMANA</div><div style={{fontSize:22,fontWeight:800,color:"#0e7490"}}>{R(comSemana)}</div></div>
      </div>
    </div>

    {/* META DO DIA */}
    <div className="card" style={{borderLeft:"4px solid #0e7490"}}>
      <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>📅 Meta do Dia</div>
      <div className="g3" style={{marginBottom:10}}>
        <div style={{background:"#ecfeff",borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>META</div><div style={{fontSize:20,fontWeight:800,color:"#0e7490"}}>{R(metaDiaB)}</div></div>
        <div style={{background:hjFat>=metaDiaB?"#f0fdf4":"#fffbeb",borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:10,color:hjFat>=metaDiaB?"#059669":"#d97706",fontWeight:700}}>REALIZADO</div><div style={{fontSize:20,fontWeight:800,color:hjFat>=metaDiaB?"#059669":"#d97706"}}>{R(hjFat)}</div></div>
        <div style={{background:faltaHj===0?"#f0fdf4":"#fef2f2",borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:10,color:faltaHj===0?"#059669":"#dc2626",fontWeight:700}}>FALTA</div><div style={{fontSize:20,fontWeight:800,color:faltaHj===0?"#059669":"#dc2626"}}>{faltaHj===0?"✓":R(faltaHj)}</div></div>
      </div>
      <div style={{marginBottom:4,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:"#aaa"}}>Progresso do dia</span><span style={{fontSize:11,fontWeight:700,color:pctHj>=100?"#059669":"#0e7490"}}>{pctHj.toFixed(1)}%</span></div>
      <div style={{background:"#f0f0f5",borderRadius:6,height:10}}><div style={{height:10,borderRadius:6,background:pctColor(pctHj),width:Math.min(100,pctHj)+"%",transition:"width .8s, background .5s"}}/></div>
      <div style={{marginTop:8,fontSize:12,color:"#888"}}>Atendimentos hoje: <b>{atendHj}</b> · Ticket médio: <b>{R(ticketB)}</b></div>
      {pctHj>=100&&<div className="celebrate" style={{marginTop:10,padding:"10px 14px",background:"linear-gradient(135deg,#059669,#0284c7)",borderRadius:8,textAlign:"center",color:"#fff",fontWeight:700,fontSize:13}}>🎉 Meta do dia batida! Mandou bem.</div>}
    </div>

    {/* VELOCÍMETRO */}
    <div className="card">
      <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>🏎️ Velocímetro da Meta</div>
      <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:160}}>
          <svg viewBox="0 0 200 110" style={{width:"100%",maxWidth:200}}>
            <path d="M10 100 A90 90 0 0 1 190 100" fill="none" stroke="#f0f0f5" strokeWidth="16" strokeLinecap="round"/>
            <path d="M10 100 A90 90 0 0 1 190 100" fill="none" stroke={velColor} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${Math.min(100,velPct)*2.83} 283`} style={{transition:"stroke-dasharray .8s"}}/>
            <text x="100" y="88" textAnchor="middle" fontSize="22" fontWeight="800" fill={velColor}>{velPct.toFixed(0)}%</text>
            <text x="100" y="104" textAnchor="middle" fontSize="10" fill="#aaa">do ritmo</text>
          </svg>
        </div>
        <div style={{flex:2,minWidth:160}}>
          <div style={{marginBottom:8,padding:"10px 14px",background:velPct>=100?"#f0fdf4":"#fffbeb",borderRadius:8}}><div style={{fontSize:11,color:"#888",marginBottom:2}}>Fechamento previsto</div><div style={{fontSize:22,fontWeight:800,color:velColor}}>{R(ritmoFech)}</div></div>
          <div style={{display:"flex",gap:8}}>
            <div style={{flex:1,padding:"8px 10px",background:"#ecfeff",borderRadius:7,textAlign:"center"}}><div style={{fontSize:10,color:"#0e7490"}}>META</div><div style={{fontSize:14,fontWeight:700,color:"#0e7490"}}>{R(b.metaB)}</div></div>
            <div style={{flex:1,padding:"8px 10px",background:ritmoFech>=b.metaB?"#f0fdf4":"#fef2f2",borderRadius:7,textAlign:"center"}}><div style={{fontSize:10,color:ritmoFech>=b.metaB?"#059669":"#dc2626"}}>DIFERENÇA</div><div style={{fontSize:14,fontWeight:700,color:ritmoFech>=b.metaB?"#059669":"#dc2626"}}>{ritmoFech>=b.metaB?"+":""}{(((ritmoFech-b.metaB)/b.metaB)*100).toFixed(1)}%</div></div>
          </div>
        </div>
      </div>
    </div>

    {/* TICKET MÉDIO + CONVERSÃO */}
    <div className="g2">
      <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🎫 Ticket Médio</div><div style={{fontSize:26,fontWeight:800,color:"#0e7490"}}>{R(ticketB)}</div><div style={{fontSize:11,color:"#aaa",marginTop:4}}>{b.avB.length} atendimentos no mês</div></div>
      <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🔄 Conversão de Extras</div><div style={{fontSize:26,fontWeight:800,color:"#0284c7"}}>{convExtra.toFixed(1)}%</div><div style={{fontSize:11,color:"#aaa",marginTop:4}}>{totalExtras} extras / {totalAtend} clientes</div><div style={{background:"#f0f0f5",borderRadius:4,height:6,marginTop:6}}><div style={{height:6,borderRadius:4,background:"#0284c7",width:Math.min(100,convExtra)+"%"}}/></div></div>
    </div>

    {/* CONQUISTAS */}
    {conquistas.length>0&&<div className="card" style={{borderLeft:"4px solid #d97706",background:"#fffbeb"}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>🏆 Conquistas</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>{conquistas.map((c,i)=><div key={i} style={{background:"#fff",border:"2px solid #fde68a",borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:120}}><div style={{fontSize:28}}>{c.icon}</div><div style={{fontWeight:700,fontSize:12,color:"#d97706",marginTop:4}}>{c.nome}</div><div style={{fontSize:10,color:"#888"}}>{c.desc}</div></div>)}</div>
    </div>}

    {/* ANÁLISE RÁPIDA */}
    <div className="card" style={{background:"linear-gradient(135deg,#1a1a2e,#2d1b4e)",border:"none"}}>
      <div style={{fontWeight:700,fontSize:14,color:"#67e8f9",marginBottom:12}}>📊 Análise Rápida</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{padding:"10px 14px",background:"#ffffff10",borderRadius:8,color:"#fff",fontSize:13}}>{diffEquipe>=0?`🚀 Você está ${Math.abs(diffEquipe).toFixed(0)}% acima da média da equipe em vendas.`:`⚠️ Você está ${Math.abs(diffEquipe).toFixed(0)}% abaixo da média da equipe em vendas.`}</div>
        {hidQt<5&&<div style={{padding:"10px 14px",background:"#ffffff10",borderRadius:8,color:"#facc15",fontSize:13}}>💡 Sua maior oportunidade é <b>hidratação</b>. Se converter apenas +1 por dia: <span style={{color:"#4ade80",fontWeight:700}}>+{R(30*dim)}/mês</span></div>}
        <div style={{padding:"10px 14px",background:"#ffffff10",borderRadius:8,color:"#a5f3fc",fontSize:13}}>👤 Perfil: <b>{perfil}</b> — {perfilDesc}</div>
      </div>
    </div>

    {/* RANKING POR CATEGORIA */}
    <div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>🏆 Ranking por Categoria</div>
      <div className="g4">{[{l:"Extras",pos:posExt,icon:"⭐"},{l:"Produtos",pos:posProd,icon:"🛍️"},{l:"Assinaturas",pos:posAssin,icon:"💳"},{l:"Atendimentos",pos:posAtend,icon:"✂️"}].map((r,i)=><div key={i} style={{textAlign:"center",padding:"10px 8px",background:r.pos===1?"#fffbeb":r.pos===2?"#f8f8f8":"#fafafe",border:"1px solid "+(r.pos===1?"#fde68a":"#e8e8f0"),borderRadius:8}}><div style={{fontSize:20}}>{r.icon}</div><div style={{fontSize:10,color:"#888",marginTop:4,fontWeight:600}}>{r.l.toUpperCase()}</div><div style={{fontSize:20,fontWeight:800,color:r.pos===1?"#d97706":r.pos===2?"#888":"#b45309"}}>#{r.pos}</div><div style={{fontSize:10,color:"#aaa"}}>{r.pos===1?"🥇 Líder":r.pos===2?"🥈 2º":r.pos===3?"🥉 3º":r.pos+"º"}</div></div>)}</div>
    </div>

    {/* MODO CAÇA BÔNUS */}
    {cacaBon.length>0&&<div className="card" style={{borderLeft:"4px solid #0e7490",background:"#ecfeff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontWeight:700,fontSize:14,color:"#0e7490"}}>🎯 Modo Caça Bônus</div><div style={{fontWeight:800,fontSize:16,color:"#059669"}}>+{R(bonPotencial)}</div></div>
      <div style={{fontSize:12,color:"#555",marginBottom:8}}>Faltam poucos para liberar:</div>
      {cacaBon.map((m,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 10px",background:"#fff",borderRadius:7,marginBottom:5}}><span style={{fontSize:13}}>{m.faltam} {m.nome.toLowerCase()}{m.faltam>1?"s":""}</span><span style={{fontSize:12,fontWeight:700,color:"#0e7490"}}>+{R(m.bon)}</span></div>)}
    </div>}

    {/* POTENCIAL NÃO APROVEITADO */}
    <div className="card" style={{borderLeft:"4px solid #dc2626",background:"#fef2f2"}}>
      <div style={{fontWeight:700,fontSize:14,color:"#dc2626",marginBottom:10}}>💸 Potencial Não Aproveitado</div>
      <div className="g3">
        <div style={{textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:"#1a1a2e"}}>{totalAtend}</div><div style={{fontSize:11,color:"#888"}}>Clientes atendidos</div></div>
        <div style={{textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:"#059669"}}>{totalExtras}</div><div style={{fontSize:11,color:"#888"}}>Receberam extras</div></div>
        <div style={{textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:"#dc2626"}}>{clientesSemExtra}</div><div style={{fontSize:11,color:"#888"}}>Sem extras</div></div>
      </div>
      <div style={{marginTop:10,padding:"10px 14px",background:"#fff",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:13,color:"#dc2626",fontWeight:600}}>Potencial perdido</span><span style={{fontSize:18,fontWeight:800,color:"#dc2626"}}>{R(potPerdido)}</span></div>
    </div>

    {/* OPORTUNIDADE DE RETOMADA */}
    {quedaExtra<-10&&<div className="card" style={{borderLeft:"4px solid #0284c7",background:"#f0f9ff"}}>
      <div style={{fontWeight:700,fontSize:13,color:"#0284c7",marginBottom:8}}>🔄 Oportunidade de Retomada</div>
      <div style={{fontSize:13,color:"#555"}}>Seus extras desaceleraram <b style={{color:"#0284c7"}}>{Math.abs(quedaExtra).toFixed(0)}%</b> nos últimos 7 dias. Ainda dá tempo de virar o jogo essa semana:</div>
      <div style={{display:"flex",gap:10,marginTop:8}}>
        <div style={{flex:1,padding:"8px",background:"#fff",borderRadius:7,textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>Últimos 7 dias</div><div style={{fontSize:18,fontWeight:700,color:"#0284c7"}}>{ext7}</div></div>
        <div style={{flex:1,padding:"8px",background:"#fff",borderRadius:7,textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>7 dias anteriores</div><div style={{fontSize:18,fontWeight:700,color:"#059669"}}>{ext14}</div></div>
      </div>
    </div>}
    {quedaExtra>=0&&ext7>0&&<div className="card" style={{borderLeft:"4px solid #059669",background:"#f0fdf4"}}><div style={{fontWeight:700,fontSize:13,color:"#059669"}}>🚀 Excelente performance!</div><div style={{fontSize:12,color:"#555",marginTop:4}}>{ext7} extras nos últimos 7 dias — {quedaExtra>0?"+"+quedaExtra.toFixed(0)+"% vs semana anterior":"mantendo o ritmo"}.</div></div>}

    {/* SIMULADOR DE COMISSÃO */}
    <div className="card" style={{borderLeft:"4px solid #0e7490",background:"#f8f7ff"}}>
      <div style={{fontWeight:700,fontSize:14,color:"#0e7490",marginBottom:10}}>🧮 Simulador de Comissão — "e se eu vender mais?"</div>
      {(()=>{
        const avgExtraVal=b.qExt>0?b.fEx/b.qExt:30;
        const avgProdVal=b.qProd>0?b.fPrBruto/b.qProd:(prodLst.reduce((a,p)=>a+p.v,0)/Math.max(prodLst.length,1));
        const simGanhoExtra=simExtra*avgExtraVal*(txB/100);
        const simGanhoProd=simProd*avgProdVal*0.20;
        const simTotal=simGanhoExtra+simGanhoProd;
        return <>
          <div className="g2" style={{marginBottom:10}}>
            <div><span className="lbl">+ Extras esse mês</span><input type="number" className="inp" min="0" value={simExtra} onChange={e=>setSimExtra(Math.max(0,+e.target.value||0))}/></div>
            <div><span className="lbl">+ Produtos esse mês</span><input type="number" className="inp" min="0" value={simProd} onChange={e=>setSimProd(Math.max(0,+e.target.value||0))}/></div>
          </div>
          <div style={{fontSize:11,color:"#888",marginBottom:8}}>Baseado no seu valor médio: extra ≈ {R(avgExtraVal)} · produto ≈ {R(avgProdVal)}</div>
          <div style={{padding:"10px 14px",background:"#fff",border:"1px solid #a5f3fc",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600,color:"#0e7490"}}>Comissão extra estimada</span>
            <span style={{fontSize:20,fontWeight:800,color:"#059669"}}>+{R(simTotal)}</span>
          </div>
          {(simExtra>0||simProd>0)&&<div style={{marginTop:8,fontSize:12,color:"#555",textAlign:"center"}}>Novo total estimado: <b style={{color:"#0e7490"}}>{R(b.totCBon+simTotal)}</b></div>}
        </>;
      })()}
    </div>

    {/* DESAFIO DA SEMANA (loja) */}
    <div className="card" style={{borderLeft:"4px solid #0284c7",background:"#f0f9ff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontWeight:700,fontSize:14,color:"#0284c7"}}>🏅 Desafio da Semana (loja)</div></div>
      <div style={{textAlign:"center",padding:"14px 0"}}><div style={{fontSize:13,color:"#555",marginBottom:4}}>VENDA</div><div style={{fontSize:28,fontWeight:800,color:"#0284c7"}}>{desafio.qt} {desafio.servico}</div><div style={{marginTop:8,padding:"6px 16px",background:"#0284c7",color:"#fff",borderRadius:20,display:"inline-block",fontWeight:700}}>Recompensa: +{desafio.pontos} pontos</div></div>
    </div>

    {/* MEU DESAFIO PESSOAL (só barbeiro) */}
    {isBarb&&(()=>{
      const meuDes=desafioPessoal[user.bId]||{servico:"sobrancelhas extras",qt:5,pontos:20};
      return <div className="card" style={{borderLeft:"4px solid #0e7490",background:"#f8f7ff"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontWeight:700,fontSize:14,color:"#0e7490"}}>🎯 Meu Desafio Pessoal</div>
          {desafioPesEdit?<div style={{display:"flex",gap:6}}><button className="btn bsm" onClick={()=>{setDesafioPessoal(d=>({...d,[user.bId]:{...desafioPesTmp}}));setDesafioPesEdit(false);addNotif("🎯","Desafio pessoal salvo!");}}>Salvar</button><button className="bg bsm" onClick={()=>setDesafioPesEdit(false)}>Cancelar</button></div>:<button onClick={()=>{setDesafioPesTmp({...meuDes});setDesafioPesEdit(true);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:16}} title="Editar meu desafio">✏️</button>}
        </div>
        {desafioPesEdit?<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <div style={{flex:3,minWidth:140}}><span className="lbl">Meu desafio</span><input className="inp" value={desafioPesTmp.servico} onChange={e=>setDesafioPesTmp(t=>({...t,servico:e.target.value}))}/></div>
          <div style={{flex:1,minWidth:70}}><span className="lbl">Qtd</span><input type="number" className="inp" value={desafioPesTmp.qt} onChange={e=>setDesafioPesTmp(t=>({...t,qt:+e.target.value||0}))}/></div>
          <div style={{flex:1,minWidth:70}}><span className="lbl">Pontos</span><input type="number" className="inp" value={desafioPesTmp.pontos} onChange={e=>setDesafioPesTmp(t=>({...t,pontos:+e.target.value||0}))}/></div>
        </div>:<div style={{textAlign:"center",padding:"10px 0"}}><div style={{fontSize:24,fontWeight:800,color:"#0e7490"}}>{meuDes.qt} {meuDes.servico}</div><div style={{marginTop:6,padding:"5px 14px",background:"#0e7490",color:"#fff",borderRadius:20,display:"inline-block",fontWeight:700,fontSize:12}}>+{meuDes.pontos} pontos (auto-desafio)</div></div>}
      </div>;
    })()}

    {/* RELÓGIO DE META */}
    <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:10}}>⏱️ Relógio de Meta</div>
      <div style={{position:"relative",width:90,height:90,margin:"0 auto 10px"}}>
        <svg viewBox="0 0 90 90" style={{width:90,height:90}}>
          <circle cx="45" cy="45" r="38" fill="none" stroke="#f0f0f5" strokeWidth="8"/>
          <circle cx="45" cy="45" r="38" fill="none" stroke={pctColor(pctMes)} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${pctMes*2.39} 239`} strokeDashoffset="60" style={{transition:"stroke-dasharray .8s, stroke .5s"}}/>
          <text x="45" y="42" textAnchor="middle" fontSize="14" fontWeight="800" fill={pctColor(pctMes)}>{pctMes.toFixed(0)}%</text>
          <text x="45" y="55" textAnchor="middle" fontSize="7" fill="#aaa">da meta</text>
        </svg>
      </div>
      {faltaMes>0?<><div style={{fontSize:12,color:"#888",textAlign:"center"}}>Faltam <b style={{color:"#0e7490"}}>{R(faltaMes)}</b></div><div style={{fontSize:11,color:"#059669",textAlign:"center",marginTop:4}}>Meta será batida em <b>{Math.max(0,diasParaMeta)} dias</b></div></>:<div style={{fontSize:13,fontWeight:700,color:"#059669",textAlign:"center"}}>🎉 Meta batida!</div>}
    </div>
  </div>;
})()}

{/* ─── MEU DESEMPENHO ─── */}
{aba==="meu"&&meuB&&(()=>{const b=meuB;
  const diasTrab=b.clU||0;const rDia=diasTrab>0?b.totC/diasTrab:0;
  const brutoAssin=tPote*b.pct;const brutoAvulso=b.fAv;const brutoExtras=b.fEx;const brutoProd=b.fPrBruto;
  const totalBruto=brutoAssin+brutoAvulso+brutoExtras+brutoProd;
  const mix=[{l:"Assinatura",v:brutoAssin,c:"#d97706"},{l:"Avulso",v:brutoAvulso,c:"#0e7490"},{l:"Extras",v:brutoExtras,c:"#0284c7"},{l:"Produtos",v:brutoProd,c:"#059669"}].map(x=>({...x,pct:totalBruto>0?(x.v/totalBruto)*100:0}));
  const metaProd=b.bonDet.find(x=>x.id==="prod");
  const prodGroupsMeu=b.prB.reduce((a,p)=>{if(!a[p.prod])a[p.prod]={nome:p.prod,qt:0,val:0};a[p.prod].qt+=p.qt;a[p.prod].val+=p.val*p.qt;return a;},{});
  const prodListMeu=Object.values(prodGroupsMeu).sort((a,b2)=>b2.qt-a.qt);
  const prodCampeaoMeu=prodListMeu[0]||null;
  const prodNaoVendidosMeu=prodLst.filter(p=>!prodListMeu.some(x=>x.nome===p.nome));
  const grpClubMeu=b.ss2.reduce((a,s)=>{const k=s.svc;if(!a[k])a[k]={svc:k,qt:0};a[k].qt+=(s.qt||1);return a;},{});
  const clubListMeu=Object.values(grpClubMeu).sort((a,b2)=>b2.qt-a.qt);const totalClubMeu=clubListMeu.reduce((a,g)=>a+g.qt,0);
  const grpAvMeu=b.avB.reduce((a,s)=>{const k=s.svc;if(!a[k])a[k]={svc:k,qt:0};a[k].qt+=(s.qt||1);return a;},{});
  const avListMeu=Object.values(grpAvMeu).sort((a,b2)=>b2.qt-a.qt);const totalAvMeu=avListMeu.reduce((a,g)=>a+g.qt,0);
  const evoChart=hist6.map(h=>({label:h.label,total:h.perBarber.find(x=>x.id===b.id)?.total||0}));
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card" style={{borderLeft:"4px solid "+b.cor}}>
    <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14,flexWrap:"wrap"}}>
      <BAv b={getB(b.id)} size={60} fs={22}/>
      <div style={{flex:1}}><div style={{fontWeight:700,fontSize:17}}>{b.nome}</div><div style={{fontSize:12,color:"#aaa"}}>{"#"+meuRk+" ranking · "+MESES[mes]+(b.nvAt?" · "+b.nvAt.icon+" "+b.nvAt.nome:"")}{b.notaMedia!=null?" · ⭐"+b.notaMedia.toFixed(1):""}</div></div>
      <div style={{textAlign:"right"}}><div style={{fontSize:26,fontWeight:800,color:b.cor}}>{R(b.totCBon)}</div></div>
    </div>
    <PB val={b.totC} max={b.metaB} cor={pctColor(b.pctM)} pct lbl={"Meta: "+R(b.metaB)} lg/>
    {b.pctM>=100&&<div className="celebrate" style={{marginTop:10,padding:"10px 14px",background:"linear-gradient(135deg,#059669,#0284c7)",borderRadius:8,textAlign:"center",color:"#fff",fontWeight:700,fontSize:13}}>🎉 Meta do mês batida! Parabéns.</div>}
  </div>
  {(()=>{
    const qtAv=b.avB.reduce((a,s)=>a+(s.qt||1),0)+b.lotB.length;
    const comTot=b.cAv;
    const ticketAv=qtAv>0?b.fAv/qtAv:0;
    return <div className="card" style={{borderLeft:"5px solid #0e7490",background:"linear-gradient(135deg,#ecfeff,#fff)"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><span style={{fontSize:18}}>🚀</span><span style={{fontSize:12,fontWeight:700,color:"#0e7490",textTransform:"uppercase",letterSpacing:".04em"}}>Foco de crescimento — Sua comissão em Avulso</span></div>
      <div style={{fontSize:34,fontWeight:900,color:"#0e7490",lineHeight:1.1}}>{R(comTot)}</div>
      <div style={{fontSize:12,color:"#666",marginTop:4}}>{qtAv} atendimento{qtAv!==1?"s":""} avulso{qtAv!==1?"s":""} · ticket médio {R(ticketAv)}</div>
      <div style={{fontSize:12,color:"#0e7490",marginTop:8,fontWeight:600}}>É o avulso que está puxando o crescimento da barbearia — todo atendimento avulso a mais conta em dobro.</div>
    </div>;
  })()}
  {(()=>{
    const inRange=dt=>dt>=barbFiltDe&&dt<=barbFiltAte;
    const porDia={};
    b.avB.filter(s=>inRange(s.dt)).forEach(s=>{porDia[s.dt]=(porDia[s.dt]||0)+s.val*s.qt;});
    b.exB.filter(e=>inRange(e.dt)).forEach(e=>{porDia[e.dt]=(porDia[e.dt]||0)+e.val;});
    b.prB.filter(p=>inRange(p.dt)).forEach(p=>{porDia[p.dt]=(porDia[p.dt]||0)+p.val*p.qt;});
    b.lotB.filter(l=>inRange(l.dt)).forEach(l=>{porDia[l.dt]=(porDia[l.dt]||0)+l.vb;});
    const melhores=Object.entries(porDia).map(([dt,val])=>({dt,val})).sort((a,b2)=>b2.val-a.val).slice(0,10);
    const maxDia=melhores[0]?.val||1;
    return <div className="card" style={{borderLeft:"4px solid #d97706"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:meusMelhoresDiasOpen?12:0,cursor:"pointer"}} onClick={()=>setMeusMelhoresDiasOpen(o=>!o)}>
        <div className="st" style={{marginBottom:0}}>{meusMelhoresDiasOpen?"▼":"▶"} 🏆 Meus melhores dias <span style={{fontWeight:400,color:"#ccc"}}>(avulso+extras+produtos)</span></div>
        {meusMelhoresDiasOpen&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
          <input type="date" className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={barbFiltDe} onChange={e=>setBarbFiltDe(e.target.value)}/>
          <span style={{fontSize:11,color:"#aaa"}}>até</span>
          <input type="date" className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={barbFiltAte} onChange={e=>setBarbFiltAte(e.target.value)}/>
        </div>}
      </div>
      {meusMelhoresDiasOpen&&(melhores.length===0?<div style={{color:"#ccc",fontSize:12,textAlign:"center",padding:10}}>Nenhum lançamento no período selecionado.</div>:melhores.map((d,i)=><div key={d.dt} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,fontWeight:600}}>{i+1}º · {new Date(d.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",weekday:"short"})}</span><span style={{fontSize:13,fontWeight:700,color:"#d97706"}}>{R(d.val)}</span></div><PB val={d.val} max={maxDia} cor="#d97706" pct={false}/></div>))}
    </div>;
  })()}
  <div className="card"><div className="st">💰 Breakdown</div>
    <div className="g3">
      <div style={{background:"#fffbeb",border:"2px solid #fde68a",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:"#d97706",fontWeight:700}}>💳 ASSINATURA</div><div style={{fontSize:22,fontWeight:800,color:"#d97706"}}>{R(b.cPote)}</div><div style={{fontSize:11,color:"#888"}}>{b.ftot}pts · {(b.pct*100).toFixed(1)}%</div></div>
      <div style={{background:"#ecfeff",border:"2px solid #a5f3fc",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>✂️ AVULSO+EXTRAS</div><div style={{fontSize:22,fontWeight:800,color:"#0e7490"}}>{R(b.cAv)}</div></div>
      <div style={{background:"#f0fdf4",border:"2px solid #bbf7d0",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:"#059669",fontWeight:700}}>🛍️ PRODUTOS</div><div style={{fontSize:22,fontWeight:800,color:"#059669"}}>{R(b.fPr)}</div></div>
    </div>
    {b.bonTotal>0&&<div style={{marginTop:8,padding:"7px 12px",background:"#dcfce7",borderRadius:7,display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700,color:"#059669"}}>🎁 Bônus</span><span style={{fontWeight:800,color:"#059669"}}>+{R(b.bonTotal)}</span></div>}
    <div style={{marginTop:6,padding:"8px 12px",background:"#ecfeff",borderRadius:7,display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700,color:"#0e7490"}}>TOTAL A RECEBER</span><span style={{fontWeight:800,color:"#0e7490",fontSize:15}}>{R(b.cLiq)}</span></div>
  </div>
  {metaProd&&<div className="card"><div className="st">🎯 Meta de Produtos</div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><span style={{fontSize:13,color:"#555"}}>Meta {metaProd.meta}, vendeu {metaProd.qt}</span><span style={{fontWeight:800,color:metaProd.meta>0&&(metaProd.qt/metaProd.meta)*100>=100?"#059669":"#d97706"}}>{(metaProd.meta>0?Math.min(100,(metaProd.qt/metaProd.meta)*100):0).toFixed(0)}%</span></div><PB val={metaProd.qt} max={metaProd.meta} cor={pctColor(metaProd.meta>0?(metaProd.qt/metaProd.meta)*100:0)} pct={false}/></div>}
  <div className="card"><div className="st">🎁 Metas de bônus</div>
    <div className="g3">{b.bonDet.map((m,i)=><div key={i} style={{background:"#fff",border:"2px solid "+(m.bateu?"#059669":"#e8e8f0"),borderRadius:8,padding:"9px 11px"}}><div style={{fontSize:11,fontWeight:600,color:m.bateu?"#059669":"#888",marginBottom:2}}>{m.nome}</div><div style={{fontSize:16,fontWeight:700,color:m.bateu?"#059669":m.qt>0?"#d97706":"#ccc"}}>{m.qt}<span style={{fontSize:10,color:"#aaa"}}>/{m.meta}</span></div><PB val={m.qt} max={m.meta} cor={m.bateu?"#059669":"#d97706"} pct={false}/>{m.bateu&&<div style={{fontSize:10,color:"#059669",fontWeight:700,marginTop:3}}>+R$100 ✓</div>}</div>)}</div>
  </div>
  <div className="card">
    <div className="st">📋 Serviços realizados</div>
    <div className="g2">
      <div><div style={{fontSize:11,fontWeight:700,color:"#d97706",textTransform:"uppercase",marginBottom:6}}>Club ({totalClubMeu})</div>{clubListMeu.length===0?<div style={{color:"#ccc",fontSize:12}}>Nenhum</div>:clubListMeu.map((g,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",fontSize:12}}><span>{g.svc}</span><span style={{fontWeight:700,color:"#d97706"}}>{g.qt}x</span></div>)}</div>
      <div><div style={{fontSize:11,fontWeight:700,color:"#0e7490",textTransform:"uppercase",marginBottom:6}}>Avulso ({totalAvMeu})</div>{avListMeu.length===0?<div style={{color:"#ccc",fontSize:12}}>Nenhum</div>:avListMeu.map((g,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",fontSize:12}}><span>{g.svc}</span><span style={{fontWeight:700,color:"#0e7490"}}>{g.qt}x</span></div>)}</div>
    </div>
    <div style={{marginTop:10,padding:"10px 14px",background:"#1a1a2e",borderRadius:8,textAlign:"center"}}><div style={{fontSize:10,color:"#ffffff80",fontWeight:600}}>TOTAL DE ATENDIMENTOS</div><div style={{fontSize:22,fontWeight:800,color:"#fff"}}>{totalClubMeu+totalAvMeu}</div></div>
  </div>
  <div className="card">
    <div className="st">🛍️ Produtos — Resumo</div>
    <div className="g4" style={{marginBottom:10}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>QUANTIDADE</div><div style={{fontSize:18,fontWeight:800}}>{b.qProd}</div></div>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>VALOR VENDIDO</div><div style={{fontSize:16,fontWeight:800,color:"#059669"}}>{R(b.fPrBruto)}</div></div>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>COMISSÃO</div><div style={{fontSize:16,fontWeight:800,color:"#0e7490"}}>{R(b.fPr)}</div></div>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>CAMPEÃO</div><div style={{fontSize:13,fontWeight:700,color:"#d97706"}}>{prodCampeaoMeu?prodCampeaoMeu.nome.split(" ").slice(0,2).join(" "):"—"}</div></div>
    </div>
    {prodNaoVendidosMeu.length>0&&<div><div style={{fontSize:11,fontWeight:700,color:"#dc2626",textTransform:"uppercase",marginBottom:5}}>Sem vendas esse mês</div><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{prodNaoVendidosMeu.slice(0,8).map((p,i)=><span key={i} style={{fontSize:11,background:"#fef2f2",color:"#dc2626",padding:"3px 8px",borderRadius:12}}>{p.nome}</span>)}{prodNaoVendidosMeu.length>8&&<span style={{fontSize:11,color:"#888"}}>+{prodNaoVendidosMeu.length-8} outros</span>}</div></div>}
  </div>
  <div className="card"><div className="st">🥧 Mix de Venda</div>{mix.map((m,i)=><div key={i} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,fontWeight:600,color:m.c}}>{m.l}</span><span style={{fontSize:12,fontWeight:700,color:m.c}}>{m.pct.toFixed(0)}%</span></div><div style={{background:"#f0f0f5",borderRadius:4,height:8}}><div style={{height:8,borderRadius:4,background:m.c,width:m.pct+"%",transition:"width .8s"}}/></div></div>)}</div>
  <div className="card"><div className="st">💼 Receita por dia trabalhado</div><div style={{display:"flex",gap:14,flexWrap:"wrap"}}><div style={{flex:1,minWidth:100,textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>DIAS TRABALHADOS</div><div style={{fontSize:20,fontWeight:800,color:"#1a1a2e"}}>{diasTrab}</div></div><div style={{flex:1,minWidth:100,textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>FATUROU</div><div style={{fontSize:20,fontWeight:800,color:"#059669"}}>{R(b.totC)}</div></div><div style={{flex:1,minWidth:100,textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>R$/DIA</div><div style={{fontSize:20,fontWeight:800,color:"#0e7490"}}>{R(rDia)}</div></div></div></div>
  <div className="card"><div className="st">📈 Evolução — últimos 6 meses</div><ResponsiveContainer width="100%" height={140}><BarChart data={evoChart} margin={{top:8,right:4,left:-18,bottom:0}} barCategoryGap="30%"><CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" vertical={false}/><XAxis dataKey="label" tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false}/><YAxis tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>v>0?Math.round(v/1000)+"k":""}/><Tooltip content={<CT/>} cursor={{fill:"#0e74900d"}}/><Bar dataKey="total" name="Total" fill={b.cor} radius={[6,6,0,0]} maxBarSize={46}/></BarChart></ResponsiveContainer></div>
</div>;})()}

{/* ─── BARBEIRO ─── */}
{aba==="barb"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  {(()=>{
    const CATS=[["corte","Corte"],["barba","Barba"],["cortebarba","Corte+Barba"],["acabbarba","Acab. Barba"],["pezinho","Pézinho"]];
    const linhas=barbs.map(b=>{
      const cont={corte:0,barba:0,cortebarba:0,acabbarba:0,pezinho:0,outros:0};
      const outrosNomes={};
      sM.filter(s=>s.bId===b.id).forEach(s=>{const t=getTipoFicha(s.svc);const qt=s.qt||1;if(t){cont[t]+=qt;}else{cont.outros+=qt;outrosNomes[s.svc]=(outrosNomes[s.svc]||0)+qt;}});
      const totalB=CATS.reduce((a,[k])=>a+cont[k],0)+cont.outros;
      return{b,cont,outrosNomes,totalB};
    });
    const totCat=k=>linhas.reduce((a,l)=>a+l.cont[k],0);
    const totOutros=linhas.reduce((a,l)=>a+l.cont.outros,0);
    const totGeral=linhas.reduce((a,l)=>a+l.totalB,0);
    const outrosTodos={};linhas.forEach(l=>Object.entries(l.outrosNomes).forEach(([nome,qt])=>{outrosTodos[nome]=(outrosTodos[nome]||0)+qt;}));
    return <div className="card"><div className="st">✂️ Fichas por categoria (mês) — conferência</div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:600}}>
        <thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["Barbeiro",...CATS.map(c=>c[1]),"Não classif.","Total"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:10,color:"#aaa",fontWeight:600}}>{h}</th>)}</tr></thead>
        <tbody>{linhas.map(l=><tr key={l.b.id} style={{borderBottom:"1px solid #f0f0f5"}}>
          <td style={{padding:"7px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><BAv b={getB(l.b.id)} size={20} fs={9}/><span style={{fontWeight:600}}>{l.b.nome.split(" ")[0]}</span></div></td>
          {CATS.map(c=><td key={c[0]} style={{padding:"7px 8px"}}>{l.cont[c[0]]||"—"}</td>)}
          <td style={{padding:"7px 8px",color:l.cont.outros>0?"#dc2626":"#ccc",fontWeight:l.cont.outros>0?700:400}}>{l.cont.outros||"—"}</td>
          <td style={{padding:"7px 8px",fontWeight:700}}>{l.totalB}</td>
        </tr>)}
        <tr style={{borderTop:"2px solid #e0e0f0",background:"#fafafa"}}>
          <td style={{padding:"7px 8px",fontWeight:700}}>TOTAL</td>
          {CATS.map(c=><td key={c[0]} style={{padding:"7px 8px",fontWeight:700}}>{totCat(c[0])}</td>)}
          <td style={{padding:"7px 8px",fontWeight:700,color:totOutros>0?"#dc2626":"#888"}}>{totOutros}</td>
          <td style={{padding:"7px 8px",fontWeight:700}}>{totGeral}</td>
        </tr></tbody></table></div>
      {totOutros>0&&<div style={{marginTop:10,padding:"10px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8}}>
        <div style={{fontSize:12,fontWeight:700,color:"#dc2626",marginBottom:6}}>⚠️ {totOutros} lançamento{totOutros!==1?"s":""} não entrou em nenhuma categoria — provável causa da diferença com sua planilha:</div>
        {Object.entries(outrosTodos).map(([nome,qt])=><div key={nome} style={{fontSize:12,color:"#7f1d1d",padding:"2px 0"}}>{qt}× "{nome}"</div>)}
      </div>}
    </div>;
  })()}
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{barbs.map(b=><button key={b.id} className={"bg"+(barbSel===b.id?" on":"")} style={{borderColor:barbSel===b.id?b.cor:"#e0e0e8",color:barbSel===b.id?b.cor:"#555",display:"flex",alignItems:"center",gap:6}} onClick={()=>setBarbSel(b.id)}><BAv b={b} size={22} fs={10}/>{b.nome.split(" ")[0]}</button>)}</div>
  {bAtSel&&<>
    <div className="card" style={{borderLeft:"4px solid "+bAtSel.cor}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{position:"relative",flexShrink:0}}><BAv b={getB(bAtSel.id)} size={60} fs={24}/><label style={{position:"absolute",bottom:0,right:0,background:"#0e7490",color:"#fff",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:10,border:"2px solid #fff"}}>📷<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>uploadFoto(bAtSel.id,e)}/></label></div>
        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:16}}>{bAtSel.nome}</div><div style={{fontSize:12,color:"#aaa"}}>{bAtSel.ftot}pts · 🔥{bAtSel.streak}d{bAtSel.notaMedia!=null?" · ⭐"+bAtSel.notaMedia.toFixed(1)+" nota média":""}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:700,color:bAtSel.cor}}>{R(bAtSel.totCBon)}</div></div>
      </div>
      <div className="g3" style={{marginBottom:12}}>
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"#d97706",fontWeight:700}}>💳 ASSINATURA</div><div style={{fontSize:18,fontWeight:800,color:"#d97706"}}>{R(bAtSel.cPote)}</div><div style={{fontSize:11,color:"#888"}}>{bAtSel.ftot}pts · {(bAtSel.pct*100).toFixed(1)}%</div></div>
        <div style={{background:"#ecfeff",border:"1px solid #a5f3fc",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>✂️ AVULSO+EXTRAS</div><div style={{fontSize:18,fontWeight:800,color:"#0e7490"}}>{R(bAtSel.cAv)}</div></div>
        <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"#059669",fontWeight:700}}>🛍️ PRODUTOS</div><div style={{fontSize:18,fontWeight:800,color:"#059669"}}>{R(bAtSel.fPr)}</div></div>
      </div>
      {bAtSel.bonTotal>0&&<div style={{padding:"6px 10px",background:"#dcfce7",borderRadius:6,marginBottom:8,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,fontWeight:600,color:"#059669"}}>🎁 Bônus</span><span style={{fontSize:13,fontWeight:700,color:"#059669"}}>+{R(bAtSel.bonTotal)}</span></div>}
      {bAtSel.tVale>0&&<div style={{padding:"6px 10px",background:"#fef2f2",borderRadius:6,marginBottom:8,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,fontWeight:600,color:"#dc2626"}}>💸 Vales</span><span style={{fontSize:13,fontWeight:700,color:"#dc2626"}}>-{R(bAtSel.tVale)}</span></div>}
      <div style={{padding:"8px 12px",background:"#1a1a2e",borderRadius:7,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:13,fontWeight:700,color:"#fff"}}>LÍQUIDO A RECEBER</span><span style={{fontSize:18,fontWeight:800,color:"#67e8f9"}}>{R(bAtSel.cLiq)}</span></div>
      <button className="btn bsm" style={{background:"#dc2626",marginTop:10}} onClick={()=>limparTudoBarbeiro(bAtSel.id)}>🗑 Excluir tudo de {bAtSel.nome.split(" ")[0]}</button>
    </div>
    {(()=>{
      const inRange=dt=>dt>=barbFiltDe&&dt<=barbFiltAte;
      const porDia={};
      bAtSel.avB.filter(s=>inRange(s.dt)).forEach(s=>{porDia[s.dt]=(porDia[s.dt]||0)+s.val*s.qt;});
      bAtSel.exB.filter(e=>inRange(e.dt)).forEach(e=>{porDia[e.dt]=(porDia[e.dt]||0)+e.val;});
      bAtSel.prB.filter(p=>inRange(p.dt)).forEach(p=>{porDia[p.dt]=(porDia[p.dt]||0)+p.val*p.qt;});
      bAtSel.lotB.filter(l=>inRange(l.dt)).forEach(l=>{porDia[l.dt]=(porDia[l.dt]||0)+l.vb;});
      const melhores=Object.entries(porDia).map(([dt,val])=>({dt,val})).sort((a,b2)=>b2.val-a.val).slice(0,10);
      const maxDia=melhores[0]?.val||1;
      return <div className="card" style={{borderLeft:"4px solid #d97706"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:melhoresDiasOpen?12:0,cursor:"pointer"}} onClick={()=>setMelhoresDiasOpen(o=>!o)}>
          <div className="st" style={{marginBottom:0}}>{melhoresDiasOpen?"▼":"▶"} 🏆 Melhores dias de {bAtSel.nome.split(" ")[0]} <span style={{fontWeight:400,color:"#ccc"}}>(avulso+extras+produtos)</span></div>
          {melhoresDiasOpen&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
            <input type="date" className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={barbFiltDe} onChange={e=>setBarbFiltDe(e.target.value)}/>
            <span style={{fontSize:11,color:"#aaa"}}>até</span>
            <input type="date" className="inp" style={{width:"auto",fontSize:12,padding:"5px 8px"}} value={barbFiltAte} onChange={e=>setBarbFiltAte(e.target.value)}/>
          </div>}
        </div>
        {melhoresDiasOpen&&(melhores.length===0?<div style={{color:"#ccc",fontSize:12,textAlign:"center",padding:10}}>Nenhum lançamento no período selecionado.</div>:melhores.map((d,i)=><div key={d.dt} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,fontWeight:600}}>{i+1}º · {new Date(d.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",weekday:"short"})}</span><span style={{fontSize:13,fontWeight:700,color:"#d97706"}}>{R(d.val)}</span></div><PB val={d.val} max={maxDia} cor="#d97706" pct={false}/></div>))}
      </div>;
    })()}
    {(()=>{
      const hoje=new Date(hjS);const d7=new Date(hoje);d7.setDate(hoje.getDate()-7);
      const txL=txB/100;
      const comHojeB=(bAtSel.avB.filter(s=>s.dt===hjS).reduce((a,s)=>a+s.val*s.qt,0)+bAtSel.exB.filter(e=>e.dt===hjS).reduce((a,e)=>a+e.val,0))*txL+bAtSel.prB.filter(p=>p.dt===hjS).reduce((a,p)=>{const pd=prodLst.find(x=>x.nome===p.prod);return a+p.val*p.qt*(pd?.comissao??0.2);},0)+(poM.filter(e=>e.dt===hjS).reduce((a,e)=>a+e.val,0)*bAtSel.pct*txL);
      const semAvExtB=bAtSel.avB.filter(s=>{const d=new Date(s.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,s)=>a+s.val*s.qt,0)+bAtSel.exB.filter(e=>{const d=new Date(e.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,e)=>a+e.val,0);
      const semProdB=bAtSel.prB.filter(p=>{const d=new Date(p.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,p)=>{const pd=prodLst.find(x=>x.nome===p.prod);return a+p.val*p.qt*(pd?.comissao??0.2);},0);
      const semPoteB=poM.filter(e=>{const d=new Date(e.dt+"T12:00:00");return d>=d7&&d<=hoje;}).reduce((a,e)=>a+e.val,0)*bAtSel.pct*txL;
      const comSemanaB=semAvExtB*txL+semProdB+semPoteB;
      return <div className="card"><div className="st">💰 Comissão do dia e da semana</div><div className="g2"><div style={{background:"#f0fdf4",borderRadius:8,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:10,color:"#059669",fontWeight:700}}>HOJE</div><div style={{fontSize:20,fontWeight:800,color:"#059669"}}>{R(comHojeB)}</div></div><div style={{background:"#ecfeff",borderRadius:8,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>SEMANA</div><div style={{fontSize:20,fontWeight:800,color:"#0e7490"}}>{R(comSemanaB)}</div></div></div></div>;
    })()}
    {(()=>{
      const porDia={};
      bAtSel.exB.forEach(e=>{(porDia[e.dt]=porDia[e.dt]||{extras:[],produtos:[]}).extras.push(e);});
      bAtSel.prB.forEach(p=>{(porDia[p.dt]=porDia[p.dt]||{extras:[],produtos:[]}).produtos.push(p);});
      const dias=Object.keys(porDia).sort().reverse();
      const hoje=new Date(hjS);const d7=new Date(hoje);d7.setDate(hoje.getDate()-7);const d14=new Date(hoje);d14.setDate(hoje.getDate()-14);
      const inRange=(dt,ini,fim)=>{const d=new Date(dt+"T12:00:00");return d>ini&&d<=fim;};
      const semAtualExt=bAtSel.exB.filter(e=>inRange(e.dt,d7,hoje)).length;
      const semAntExt=bAtSel.exB.filter(e=>inRange(e.dt,d14,d7)).length;
      const semAtualProd=bAtSel.prB.filter(p=>inRange(p.dt,d7,hoje)).reduce((a,p)=>a+p.qt,0);
      const semAntProd=bAtSel.prB.filter(p=>inRange(p.dt,d14,d7)).reduce((a,p)=>a+p.qt,0);
      return <div className="card">
        <div className="st">📅 Extras e produtos por dia</div>
        <div style={{maxHeight:220,overflowY:"auto",marginBottom:12}}>
          {dias.length===0?<div style={{color:"#ccc",fontSize:12,padding:8}}>Nenhum lançamento ainda.</div>:dias.map(dt=>{const info=porDia[dt];const partes=[];if(info.extras.length)partes.push(info.extras.length+"x extra ("+[...new Set(info.extras.map(e=>e.svc))].join(", ")+")");if(info.produtos.length){const qtProd=info.produtos.reduce((a,p)=>a+p.qt,0);partes.push(qtProd+"x produto ("+[...new Set(info.produtos.map(p=>p.prod))].join(", ")+")");}return <div key={dt} style={{display:"flex",gap:8,padding:"5px 6px",fontSize:12,borderBottom:"1px solid #f5f5f8"}}><b style={{minWidth:70}}>Dia {new Date(dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</b><span style={{color:"#555"}}>{partes.join(" · ")}</span></div>;})}
        </div>
        <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",marginBottom:6}}>Semana atual vs. anterior</div>
        <div className="g2">
          <div style={{background:"#f0f9ff",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"#0284c7",fontWeight:700,marginBottom:4}}>EXTRAS</div><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:"#888"}}>Anterior: {semAntExt}</span><span style={{fontSize:16,fontWeight:800,color:"#0284c7"}}>{semAtualExt}</span></div></div>
          <div style={{background:"#f0fdf4",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"#059669",fontWeight:700,marginBottom:4}}>PRODUTOS</div><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:"#888"}}>Anterior: {semAntProd}</span><span style={{fontSize:16,fontWeight:800,color:"#059669"}}>{semAtualProd}</span></div></div>
        </div>
      </div>;
    })()}
    {(()=>{
      const prodGroups=bAtSel.prB.reduce((a,p)=>{if(!a[p.prod])a[p.prod]={nome:p.prod,qt:0,val:0};a[p.prod].qt+=p.qt;a[p.prod].val+=p.val*p.qt;return a;},{});
      const prodList=Object.values(prodGroups).sort((a,b)=>b.qt-a.qt);
      const prodCampeao=prodList[0]||null;
      const prodNaoVendidos=prodLst.filter(p=>!prodList.some(x=>x.nome===p.nome));
      return <div className="card">
        <div className="st">🛍️ Produtos vendidos — Resumo</div>
        <div className="g4" style={{marginBottom:10}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>QUANTIDADE</div><div style={{fontSize:18,fontWeight:800}}>{bAtSel.qProd}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>VALOR VENDIDO</div><div style={{fontSize:16,fontWeight:800,color:"#059669"}}>{R(bAtSel.fPrBruto)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>COMISSÃO</div><div style={{fontSize:16,fontWeight:800,color:"#0e7490"}}>{R(bAtSel.fPr)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>CAMPEÃO</div><div style={{fontSize:13,fontWeight:700,color:"#d97706"}}>{prodCampeao?prodCampeao.nome.split(" ").slice(0,2).join(" "):"—"}</div></div>
        </div>
        {prodNaoVendidos.length>0&&<div><div style={{fontSize:11,fontWeight:700,color:"#dc2626",textTransform:"uppercase",marginBottom:5}}>Sem vendas esse mês</div><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{prodNaoVendidos.slice(0,10).map((p,i)=><span key={i} style={{fontSize:11,background:"#fef2f2",color:"#dc2626",padding:"3px 8px",borderRadius:12}}>{p.nome}</span>)}{prodNaoVendidos.length>10&&<span style={{fontSize:11,color:"#888"}}>+{prodNaoVendidos.length-10} outros</span>}</div></div>}
      </div>;
    })()}
    {(()=>{
      const horasKey=bAtSel.id+"-"+ano+"-"+mes;
      const horas=+horasTrab[horasKey]||0;
      const rHora=horas>0?bAtSel.totC/horas:0;
      return <div className="card"><div className="st">⏱️ Produtividade por hora</div>
        <div className="g2">
          <div><span className="lbl">Horas trabalhadas no mês</span><input type="number" className="inp" min="0" value={horasTrab[horasKey]||""} onChange={e=>setHorasTrab(h=>({...h,[horasKey]:e.target.value}))}/></div>
          <div style={{background:"#ecfeff",borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:10,color:"#0e7490",fontWeight:700}}>R$/HORA</div><div style={{fontSize:20,fontWeight:800,color:"#0e7490"}}>{horas>0?R(rHora):"—"}</div></div>
        </div>
      </div>;
    })()}
    <div className="card"><div className="st">📝 Observações / Coaching</div>
      <div className="g3" style={{marginBottom:10}}>
        <div style={{gridColumn:"1/3"}}><span className="lbl">Observação</span><input className="inp" value={coachTxt} onChange={e=>setCoachTxt(e.target.value)} placeholder="Ex: conversamos sobre pontualidade..."/></div>
        <div><span className="lbl">Data</span><input type="date" className="inp" value={coachDt} onChange={e=>setCoachDt(e.target.value)}/></div>
      </div>
      <button className="btn bsm" onClick={addCoaching}>+ Adicionar observação</button>
      <div style={{marginTop:10}}>{coaching.filter(c=>c.bId===bAtSel.id).length===0?<div style={{color:"#ccc",textAlign:"center",padding:10}}>Nenhuma observação registrada.</div>:coaching.filter(c=>c.bId===bAtSel.id).sort((a,b2)=>b2.dt.localeCompare(a.dt)).map(c=><div key={c.id} className="row"><div style={{flex:1}}><div style={{fontSize:12}}>{c.texto}</div><div style={{fontSize:10,color:"#aaa",marginTop:2}}>{new Date(c.dt+"T12:00:00").toLocaleDateString("pt-BR")}</div></div><button className="bdel" onClick={()=>{setCoaching(cs=>cs.filter(x=>x.id!==c.id));excluirRemoto("coaching",[c.id]);}}>×</button></div>)}</div>
    </div>
    {(()=>{
      const grpClub=bAtSel.ss2.reduce((a,s)=>{const k=s.svc;if(!a[k])a[k]={svc:k,qt:0};a[k].qt+=(s.qt||1);return a;},{});
      const clubList=Object.values(grpClub).sort((a,b2)=>b2.qt-a.qt);
      const totalClub=clubList.reduce((a,g)=>a+g.qt,0);
      const grpAvulso=bAtSel.avB.reduce((a,s)=>{const k=s.svc;if(!a[k])a[k]={svc:k,qt:0};a[k].qt+=(s.qt||1);return a;},{});
      const avulsoList=Object.values(grpAvulso).sort((a,b2)=>b2.qt-a.qt);
      const totalAvulso=avulsoList.reduce((a,g)=>a+g.qt,0);
      const totalProdutos=bAtSel.prB.reduce((a,p)=>a+(p.qt||1),0);
      const totalServicos=totalClub+totalAvulso;
      return <div className="card">
        <div className="st">📋 Resumo de serviços realizados</div>
        <div className="g2">
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#d97706",textTransform:"uppercase",marginBottom:6}}>Club ({totalClub})</div>
            {clubList.length===0?<div style={{color:"#ccc",fontSize:12,padding:"6px 0"}}>Nenhum</div>:clubList.map((g,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",background:i%2===0?"#fafafa":"transparent",borderRadius:5,fontSize:12}}><span>{g.svc}</span><span style={{fontWeight:700,color:"#d97706"}}>{g.qt}x</span></div>)}
            <div style={{display:"flex",justifyContent:"space-between",padding:"7px 8px",marginTop:6,borderTop:"2px solid #fde68a",fontWeight:800}}><span style={{fontSize:12,color:"#d97706"}}>TOTAL CLUB</span><span style={{color:"#d97706"}}>{totalClub}</span></div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#0e7490",textTransform:"uppercase",marginBottom:6}}>Avulso ({totalAvulso})</div>
            {avulsoList.length===0?<div style={{color:"#ccc",fontSize:12,padding:"6px 0"}}>Nenhum</div>:avulsoList.map((g,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",background:i%2===0?"#fafafa":"transparent",borderRadius:5,fontSize:12}}><span>{g.svc}</span><span style={{fontWeight:700,color:"#0e7490"}}>{g.qt}x</span></div>)}
            <div style={{display:"flex",justifyContent:"space-between",padding:"7px 8px",marginTop:6,borderTop:"2px solid #a5f3fc",fontWeight:800}}><span style={{fontSize:12,color:"#0e7490"}}>TOTAL AVULSO</span><span style={{color:"#0e7490"}}>{totalAvulso}</span></div>
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:140,padding:"10px 14px",background:"#1a1a2e",borderRadius:8,textAlign:"center"}}><div style={{fontSize:10,color:"#ffffff80",fontWeight:600}}>TOTAL DE SERVIÇOS</div><div style={{fontSize:22,fontWeight:800,color:"#fff"}}>{totalServicos}</div></div>
          <div style={{flex:1,minWidth:140,padding:"10px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,textAlign:"center"}}><div style={{fontSize:10,color:"#059669",fontWeight:600}}>PRODUTOS VENDIDOS</div><div style={{fontSize:22,fontWeight:800,color:"#059669"}}>{totalProdutos}</div></div>
        </div>
      </div>;
    })()}
    <div className="card"><div className="st">Fichas ({bAtSel.ftot}pts)</div>
      {(()=>{const grp=bAtSel.ss2.reduce((a,s)=>{const k=s.svc;if(!a[k])a[k]={svc:k,items:[],pts:0};a[k].items.push(s);a[k].pts+=getFichasPorTipo(s.svc)*(s.qt||1);return a;},{});return Object.values(grp).length===0?<div style={{color:"#ccc",textAlign:"center",padding:10}}>Nenhuma.</div>:Object.values(grp).map(g=><GrupoColapsavel key={g.svc} titulo={g.svc} cor="#d97706" qt={g.items.length} total={g.pts} isPts acoes={<button className="bdel" style={{color:"#dc2626",fontSize:12}} onClick={()=>{if(window.confirm("Excluir?")){const ids=svcs.filter(x=>x.bId===bAtSel.id&&noM(x.dt)&&x.svc===g.svc).map(x=>x.id);excluirRemoto("svcs",ids);setSvcs(v=>v.filter(x=>!ids.includes(x.id)));}}}>🗑</button>}>{g.items.map(s=><ERow key={s.id} item={s} fields={[{key:"dt",label:"Data",type:"date"}]} setter={setSvcs} tipo="svcs"><div style={{flex:2,fontSize:11}}>{new Date(s.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</div><span style={{color:"#d97706",fontWeight:600}}>{getFichasPorTipo(s.svc)}pts</span></ERow>)}</GrupoColapsavel>);})()}
    </div>
    <div className="card"><div className="st">Avulsos</div>
      {(()=>{const grp=bAtSel.avB.reduce((a,s)=>{const k=s.svc;if(!a[k])a[k]={svc:k,items:[],total:0};a[k].items.push(s);a[k].total+=s.val*(s.qt||1);return a;},{});return Object.values(grp).length===0?<div style={{color:"#ccc",textAlign:"center",padding:10}}>Nenhum.</div>:Object.values(grp).map(g=><GrupoColapsavel key={g.svc} titulo={g.svc} cor="#0e7490" qt={g.items.length} total={g.total} acoes={<button className="bdel" style={{color:"#dc2626",fontSize:12}} onClick={()=>{if(window.confirm("Excluir?")){const ids=avul.filter(x=>x.bId===bAtSel.id&&noM(x.dt)&&x.svc===g.svc).map(x=>x.id);excluirRemoto("avul",ids);setAvul(v=>v.filter(x=>!ids.includes(x.id)));}}}>🗑</button>}>{g.items.map(s=><ERow key={s.id} item={s} fields={[{key:"svc",label:"Serviço",type:"select",options:SVC_DEF.map(x=>x.nome)},{key:"val",label:"Valor",type:"number"},{key:"qt",label:"Qtd",type:"number"},{key:"dt",label:"Data",type:"date"}]} setter={setAvul} tipo="avul"><div style={{flex:1,fontSize:11}}><b>{new Date(s.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</b> ×{s.qt}{s.nota?" ⭐"+s.nota:""}</div><span style={{fontWeight:600,color:"#0e7490"}}>{R(s.val*s.qt)}</span></ERow>)}</GrupoColapsavel>);})()}
    </div>
    <div className="card"><div className="st">Extras</div>
      {(()=>{const grp=bAtSel.exB.reduce((a,e)=>{const k=e.svc;if(!a[k])a[k]={svc:k,items:[],total:0};a[k].items.push(e);a[k].total+=e.val;return a;},{});return Object.values(grp).length===0?<div style={{color:"#ccc",textAlign:"center",padding:10}}>Nenhum.</div>:Object.values(grp).map(g=><GrupoColapsavel key={g.svc} titulo={g.svc} cor="#0284c7" qt={g.items.length} total={g.total} acoes={<button className="bdel" style={{color:"#dc2626",fontSize:12}} onClick={()=>{const match=x=>x.bId===bAtSel.id&&noM(x.dt)&&x.svc===g.svc;const idsE=ext.filter(match).map(x=>x.id);const idsEA=extAv.filter(match).map(x=>x.id);excluirRemoto("ext",idsE);excluirRemoto("extAv",idsEA);setExt(v=>v.filter(x=>!match(x)));setExtAv(v=>v.filter(x=>!match(x)));}}>🗑</button>}>{g.items.map(e=><ERow key={e.id} item={e} fields={[{key:"svc",label:"Extra",type:"select",options:EXT_DEF},{key:"val",label:"Valor",type:"number"},{key:"dt",label:"Data",type:"date"}]} setter={updExtra} onDel={delExtra}><div style={{flex:1,fontSize:11}}><b>{new Date(e.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</b></div><span style={{fontWeight:600,color:"#0284c7"}}>{R(e.val)}</span></ERow>)}</GrupoColapsavel>);})()}
    </div>
    <div className="card"><div className="st">Produtos</div>
      {(()=>{const grp=bAtSel.prB.reduce((a,p)=>{const k=p.prod;if(!a[k])a[k]={prod:k,items:[],total:0};a[k].items.push(p);a[k].total+=p.val*p.qt;return a;},{});return Object.values(grp).length===0?<div style={{color:"#ccc",textAlign:"center",padding:10}}>Nenhum.</div>:Object.values(grp).map(g=><GrupoColapsavel key={g.prod} titulo={g.prod} cor="#059669" qt={g.items.reduce((a,p)=>a+p.qt,0)} total={g.total} acoes={<button className="bdel" style={{color:"#dc2626",fontSize:12}} onClick={()=>{if(window.confirm("Excluir?")){const ids=prod.filter(x=>x.bId===bAtSel.id&&noM(x.dt)&&x.prod===g.prod).map(x=>x.id);excluirRemoto("prod",ids);setProd(v=>v.filter(x=>!ids.includes(x.id)));}}}>🗑</button>}>{g.items.map(p=><ERow key={p.id} item={p} fields={[{key:"prod",label:"Produto",type:"select",options:prodLst.map(x=>x.nome)},{key:"val",label:"Valor",type:"number"},{key:"qt",label:"Qtd",type:"number"},{key:"dt",label:"Data",type:"date"}]} setter={setProd} tipo="prod"><div style={{flex:1,fontSize:11}}><b>{new Date(p.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</b> ×{p.qt}</div><span style={{fontWeight:600,color:"#059669"}}>{R(p.val*p.qt)}</span></ERow>)}</GrupoColapsavel>);})()}
    </div>
    {bAtSel.lotB.length>0&&<div className="card"><div className="st">Lotes</div>{bAtSel.lotB.map(l=><ERow key={l.id} item={l} fields={[{key:"vb",label:"Valor",type:"number"},{key:"dt",label:"Data",type:"date"}]} setter={setLote}><div style={{flex:1,fontSize:12}}>Lote <span style={{color:"#aaa",fontSize:11}}>{new Date(l.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span></div><span style={{fontWeight:600,color:"#d97706"}}>{R(l.vb)}</span></ERow>)}</div>}
  </>}
</div>}

{/* ─── LANÇAMENTO ─── */}
{aba==="lanc"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card"><div className="st">Lote</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={flt.bId} onChange={e=>setFlt(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div><span className="lbl">Valor</span><input type="number" className="inp" value={flt.vb} onChange={e=>setFlt(f=>({...f,vb:e.target.value}))}/></div><div><span className="lbl">Data</span><input type="date" className="inp" value={flt.dt} onChange={e=>setFlt(f=>({...f,dt:e.target.value}))}/></div></div><button className="btn" onClick={lanLote}>+ Lançar lote</button></div>
  <div className="card"><div className="st">Serviço avulso</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={fa.bId} onChange={e=>setFa(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div><span className="lbl">Serviço</span><select className="inp" value={fa.svc} onChange={e=>{const s2=SVC_DEF.find(x=>x.nome===e.target.value);setFa(f=>({...f,svc:e.target.value,val:s2?s2.v:f.val}));}}>{SVC_DEF.map(s=><option key={s.nome}>{s.nome}</option>)}</select></div><div><span className="lbl">Valor</span><input type="number" className="inp" value={fa.val} onChange={e=>setFa(f=>({...f,val:e.target.value}))}/></div><div style={{display:"flex",gap:6}}><div style={{flex:1}}><span className="lbl">Qtd</span><input type="number" className="inp" value={fa.qt} min="1" onChange={e=>setFa(f=>({...f,qt:e.target.value}))}/></div><div style={{flex:2}}><span className="lbl">Data</span><input type="date" className="inp" value={fa.dt} onChange={e=>setFa(f=>({...f,dt:e.target.value}))}/></div></div><div><span className="lbl">Nota do atendimento</span><select className="inp" value={fa.nota} onChange={e=>setFa(f=>({...f,nota:e.target.value}))}>{[5,4,3,2,1].map(n=><option key={n} value={n}>{"⭐".repeat(n)+" ("+n+")"}</option>)}</select></div></div><button className="btn" onClick={lanAvul}>+ Lançar</button></div>
  <div className="card"><div className="st">Fichas do clube</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={ff.bId} onChange={e=>setFf(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div><span className="lbl">Plano</span><select className="inp" value={ff.svc} onChange={e=>setFf(f=>({...f,svc:e.target.value}))}>{Object.entries(FICHAS_DEF).map(([s,pts])=><option key={s} value={s}>{s} — {pts}pts</option>)}</select></div><div style={{display:"flex",gap:6}}><div style={{flex:1}}><span className="lbl">Qtd</span><input type="number" className="inp" value={ff.qt} min="1" onChange={e=>setFf(f=>({...f,qt:e.target.value}))}/></div><div style={{flex:2}}><span className="lbl">Data</span><input type="date" className="inp" value={ff.dt} onChange={e=>setFf(f=>({...f,dt:e.target.value}))}/></div></div></div><button className="btn" onClick={lanFich}>+ Registrar</button></div>
  <div className="card"><div className="st">Extra / Upsell</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={fe.bId} onChange={e=>setFe(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div><span className="lbl">Extra</span><select className="inp" value={fe.svc} onChange={e=>setFe(f=>({...f,svc:e.target.value}))}>{EXT_DEF.map(s=><option key={s}>{s}</option>)}</select></div><div><span className="lbl">Valor</span><input type="number" className="inp" value={fe.val} onChange={e=>setFe(f=>({...f,val:e.target.value}))}/></div><div style={{display:"flex",gap:6}}><div style={{flex:1}}><span className="lbl">Qtd</span><input type="number" className="inp" value={fe.qt} min="1" onChange={e=>setFe(f=>({...f,qt:e.target.value}))}/></div><div style={{flex:2}}><span className="lbl">Data</span><input type="date" className="inp" value={fe.dt} onChange={e=>setFe(f=>({...f,dt:e.target.value}))}/></div><div style={{display:"flex",alignItems:"flex-end"}}><label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:12,paddingBottom:10}}><input type="checkbox" checked={fe.assi} onChange={e=>setFe(f=>({...f,assi:e.target.checked}))} style={{accentColor:"#0e7490"}}/><span>Assinante</span></label></div></div></div><button className="btn" onClick={lanExt}>+ Lançar extra</button></div>
  <div className="card"><div className="st">Produto</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={fp.bId} onChange={e=>setFp(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div><span className="lbl">Produto</span><select className="inp" value={fp.prod} onChange={e=>{const pd=prodLst.find(x=>x.nome===e.target.value);setFp(f=>({...f,prod:e.target.value,val:pd?pd.v:f.val}));}}>{prodLst.map(p=><option key={p.nome}>{p.nome}</option>)}</select></div><div><span className="lbl">Valor</span><input type="number" className="inp" value={fp.val} onChange={e=>setFp(f=>({...f,val:e.target.value}))}/></div><div style={{display:"flex",gap:6}}><div style={{flex:1}}><span className="lbl">Qtd</span><input type="number" className="inp" value={fp.qt} min="1" onChange={e=>setFp(f=>({...f,qt:e.target.value}))}/></div><div style={{flex:2}}><span className="lbl">Data</span><input type="date" className="inp" value={fp.dt} onChange={e=>setFp(f=>({...f,dt:e.target.value}))}/></div></div></div>{fp.prod&&estoque[fp.prod]!=null&&<div style={{fontSize:12,color:estoque[fp.prod]>0?"#059669":"#dc2626",marginBottom:8,background:estoque[fp.prod]>0?"#f0fdf4":"#fef2f2",padding:"5px 9px",borderRadius:6}}>Estoque: <b>{estoque[fp.prod]}</b></div>}<button className="btn" onClick={lanProd}>+ Lançar produto</button></div>
  <div className="card" style={{borderLeft:"3px solid #dc2626"}}><div className="st">Vale</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={fv.bId} onChange={e=>setFv(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div><span className="lbl">Valor</span><input type="number" className="inp" value={fv.val} onChange={e=>setFv(f=>({...f,val:e.target.value}))}/></div><div><span className="lbl">Data</span><input type="date" className="inp" value={fv.dt} onChange={e=>setFv(f=>({...f,dt:e.target.value}))}/></div><div style={{gridColumn:"1/-1"}}><span className="lbl">Motivo</span><input type="text" className="inp" value={fv.obs} onChange={e=>setFv(f=>({...f,obs:e.target.value}))}/></div></div><button className="btn" style={{background:"#dc2626"}} onClick={lanVale}>+ Lançar vale</button>{vales.filter(v=>noM(v.dt)).map(v=><ERow key={v.id} item={v} fields={[{key:"bId",label:"Barbeiro",type:"barbSelect"},{key:"val",label:"Valor",type:"number"},{key:"dt",label:"Data",type:"date"},{key:"obs",label:"Motivo",type:"text"}]} setter={setVales}><div style={{flex:1,fontSize:12}}>{(barbs.find(b=>b.id===v.bId)||{nome:"?"}).nome.split(" ")[0]}{v.obs?" · "+v.obs:""}</div><span style={{color:"#dc2626",fontWeight:600}}>-{R(v.val)}</span></ERow>)}</div>
</div>}

{/* ─── GALAXY PAY ─── */}
{aba==="gal"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card" style={{borderLeft:"3px solid #0284c7"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:6}}>
      <div className="st" style={{marginBottom:0}}>🔗 Integração automática com GalaxPay (Cel Cash)</div>
      {galaxStatus?.configured&&<span style={{fontSize:11,fontWeight:700,color:"#059669",background:"#dcfce7",padding:"2px 9px",borderRadius:20}}>✓ Conectado</span>}
    </div>
    <div style={{fontSize:12,color:"#888",marginBottom:14}}>Puxa automaticamente os pagamentos recebidos no GalaxPay (Pix/cartão/boleto) e lança direto no pote — sem digitar nada. As credenciais ficam guardadas com segurança e nunca aparecem de novo depois de salvas.</div>
    <div className="g2" style={{marginBottom:10}}>
      <div><span className="lbl">Galax ID</span><input className="inp" placeholder={galaxStatus?.configured?"•••• já salvo":"Ex: 5473"} value={galaxId} onChange={e=>setGalaxId(e.target.value)}/></div>
      <div><span className="lbl">Galax Hash</span><input type="password" className="inp" placeholder={galaxStatus?.configured?"•••• já salvo":"Chave de acesso"} value={galaxHash} onChange={e=>setGalaxHash(e.target.value)}/></div>
    </div>
    {galaxErr&&<div style={{marginBottom:10,padding:"7px 11px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,fontSize:12,color:"#dc2626"}}>{galaxErr}</div>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <button className="btn bsm" onClick={salvarGalaxCreds} disabled={galaxSaving}>{galaxSaving?"Salvando...":galaxStatus?.configured?"Atualizar credenciais":"Salvar credenciais"}</button>
      {galaxStatus?.configured&&<button className="btn bsm" style={{background:"#0284c7"}} onClick={sincronizarGalaxPay} disabled={galaxSyncing}>{galaxSyncing?"Sincronizando...":"🔄 Sincronizar agora"}</button>}
      {galaxStatus?.last_sync_at&&<span style={{fontSize:11,color:"#aaa"}}>Última sincronização: {new Date(galaxStatus.last_sync_at).toLocaleString("pt-BR")} · {galaxStatus.last_sync_count} novo(s)</span>}
    </div>
  </div>
  <div className="card" style={{borderLeft:"3px solid #d97706"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div className="st" style={{marginBottom:0}}>Taxas</div>{editTx?<div style={{display:"flex",gap:8}}><button className="btn bsm" onClick={()=>{setTxB(txTmp.b);setTxBar(txTmp.r);setEditTx(false);}}>Salvar</button><button className="bg bsm" onClick={()=>setEditTx(false)}>Cancelar</button></div>:<button className="bg" onClick={()=>{setTxTmp({b:txB,r:txBar});setEditTx(true);}}>Editar</button>}</div>{editTx?<div style={{display:"flex",gap:12}}><div style={{flex:1}}><span className="lbl">Barbeiro (%)</span><input type="number" className="inp" value={txTmp.b} onChange={e=>{const v=+e.target.value||0;setTxTmp({b:v,r:100-v});}}/></div><div style={{flex:1}}><span className="lbl">Barbearia (%)</span><input type="number" className="inp" value={txTmp.r} onChange={e=>{const v=+e.target.value||0;setTxTmp({r:v,b:100-v});}}/></div></div>:<div style={{display:"flex",gap:12}}><div style={{padding:"12px 18px",background:"#ecfeff",borderRadius:8,textAlign:"center",flex:1}}><div style={{fontSize:11,color:"#0e7490",fontWeight:600}}>Barbeiro</div><div style={{fontSize:24,fontWeight:700,color:"#0e7490"}}>{txB}%</div></div><div style={{padding:"12px 18px",background:"#dcfce7",borderRadius:8,textAlign:"center",flex:1}}><div style={{fontSize:11,color:"#059669",fontWeight:600}}>Barbearia</div><div style={{fontSize:24,fontWeight:700,color:"#059669"}}>{txBar}%</div></div></div>}</div>
  <div className="card"><div className="st">Entrada do pote</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Valor</span><input type="number" className="inp" value={fpo.val} onChange={e=>setFpo(f=>({...f,val:e.target.value}))}/></div><div style={{display:"flex",gap:6}}><div style={{flex:1}}><span className="lbl">Qtd</span><input type="number" className="inp" value={fpo.qt} min="1" onChange={e=>setFpo(f=>({...f,qt:e.target.value}))}/></div><div style={{flex:2}}><span className="lbl">Data</span><input type="date" className="inp" value={fpo.dt} onChange={e=>setFpo(f=>({...f,dt:e.target.value}))}/></div></div><div><span className="lbl">Obs</span><input type="text" className="inp" value={fpo.obs} onChange={e=>setFpo(f=>({...f,obs:e.target.value}))}/></div></div><button className="btn" onClick={lanPote}>+ Adicionar</button></div>
  <div className="g3"><KPI lbl="Pote" val={R(tPote)} cor="#d97706" glow/><KPI lbl="Total fichas" val={tFich+"pts"} cor="#0e7490"/><KPI lbl="Valor ponto" val={R(vPt)} cor="#059669"/></div>
  <div className="card"><div className="st">Distribuição</div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:380}}><thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["Barbeiro","Fichas","% Pote","Bruto","Comissão"].map(h=><th key={h} style={{textAlign:"left",padding:"5px 8px",fontSize:10,color:"#aaa",fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{fbMap.map(b=>{const pct2=tFich>0?b.ftot/tFich:0;return <tr key={b.id} style={{borderBottom:"1px solid #f0f0f5"}}><td style={{padding:"6px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><BAv b={getB(b.id)} size={20} fs={9}/><span style={{fontWeight:600}}>{b.nome.split(" ")[0]}</span></div></td><td style={{padding:"6px 8px",color:"#d97706",fontWeight:700}}>{b.ftot}pts</td><td style={{padding:"6px 8px"}}>{(pct2*100).toFixed(2)}%</td><td style={{padding:"6px 8px"}}>{R(tPote*pct2)}</td><td style={{padding:"6px 8px",fontWeight:600,color:"#0e7490"}}>{R(tPote*pct2*txB/100)}</td></tr>;})} <tr style={{borderTop:"2px solid #e0e0f0",background:"#fafafa"}}><td colSpan={2} style={{padding:"6px 8px",fontWeight:700}}>TOTAL</td><td style={{padding:"6px 8px",fontWeight:700}}>100%</td><td style={{padding:"6px 8px",fontWeight:700}}>{R(tPote)}</td><td style={{padding:"6px 8px",fontWeight:700,color:"#0e7490"}}>{R(tCP)}</td></tr></tbody></table></div></div>
  <div className="card"><div className="st">Histórico</div>{poM.map(e=><ERow key={e.id} item={e} fields={[{key:"val",label:"Valor",type:"number"},{key:"dt",label:"Data",type:"date"},{key:"obs",label:"Obs",type:"text"}]} setter={setPote}><div style={{flex:1,fontSize:12}}>{e.obs||"Galaxy Pay"} <span style={{fontSize:11,color:"#aaa"}}>{new Date(e.dt+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span></div><span style={{fontWeight:600,color:"#d97706"}}>{R(e.val)}</span></ERow>)}</div>
</div>}

{/* ─── ASSINATURA ─── */}
{aba==="assi"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card"><div className="st">Painel</div><div className="g4" style={{marginBottom:12}}>{[{l:"Ativos",v:assinD.ativas,c:"#0e7490"},{l:"Novas",v:assinD.novas,c:"#059669"},{l:"Canceladas",v:assinD.canceladas,c:"#dc2626"},{l:"Churn",v:assinD.novas-assinD.canceladas>=0?"+"+(assinD.novas-assinD.canceladas):String(assinD.novas-assinD.canceladas),c:assinD.novas-assinD.canceladas>=0?"#059669":"#dc2626"}].map((k,i)=><KPI key={i} lbl={k.l} val={k.v} cor={k.c}/>)}</div><div className="g3"><div><span className="lbl">Ativos</span><input type="number" className="inp" value={assinD.ativas} onChange={e=>setAssinD(d=>({...d,ativas:+e.target.value||0}))}/></div><div><span className="lbl">Novas</span><input type="number" className="inp" value={assinD.novas} onChange={e=>setAssinD(d=>({...d,novas:+e.target.value||0}))}/></div><div><span className="lbl">Canceladas</span><input type="number" className="inp" value={assinD.canceladas} onChange={e=>setAssinD(d=>({...d,canceladas:+e.target.value||0}))}/></div></div></div>
  <div className="card"><div className="st">Venda por barbeiro</div><div className="g3" style={{marginBottom:10}}><div><span className="lbl">Barbeiro</span><select className="inp" value={fav2.bId} onChange={e=>setFav2(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div><div style={{display:"flex",gap:6}}><div style={{flex:1}}><span className="lbl">Qtd</span><input type="number" className="inp" value={fav2.qt} min="1" onChange={e=>setFav2(f=>({...f,qt:e.target.value}))}/></div><div style={{flex:2}}><span className="lbl">Data</span><input type="date" className="inp" value={fav2.dt} onChange={e=>setFav2(f=>({...f,dt:e.target.value}))}/></div></div><div style={{display:"flex",alignItems:"flex-end"}}><button className="btn" style={{width:"100%"}} onClick={lanAssin}>+ Registrar</button></div></div></div>
</div>}

{/* ─── EXTRAS ─── */}
{aba==="extv"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="g4"><KPI lbl="Total" val={[...eM,...eAM].length} cor="#0284c7" glow/><KPI lbl="Receita" val={R(tExt)} cor="#0e7490"/><KPI lbl="TM" val={R([...eM,...eAM].length>0?tExt/[...eM,...eAM].length:0)} cor="#059669"/><KPI lbl="% fatur." val={fat>0?(tExt/fat*100).toFixed(1)+"%":"0%"} cor="#d97706"/></div>
  <div className="card"><div className="st">Ranking extras</div>{(()=>{const g=[...eM,...eAM].reduce((a,e)=>{if(!a[e.svc])a[e.svc]={nome:e.svc,qt:0,rec:0};a[e.svc].qt++;a[e.svc].rec+=e.val;return a;},{});return Object.values(g).sort((a,b2)=>b2.rec-a.rec).map((e,i)=><div key={i} className="row"><span style={{width:18,height:18,borderRadius:"50%",background:i===0?"#fef3c7":"#f0f0f5",color:i===0?"#d97706":"#888",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,flexShrink:0}}>{i+1}</span><div style={{flex:1,fontSize:13}}>{e.nome}</div><span style={{fontSize:11,color:"#888"}}>{e.qt}x</span><span style={{fontWeight:700,color:"#0e7490"}}>{R(e.rec)}</span></div>);})()}</div>
</div>}

{/* ─── INSTAGRAM ─── */}
{aba==="insta"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div style={{background:"linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)",borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",gap:14}}><div style={{fontSize:34}}>📸</div><div><div style={{fontSize:17,fontWeight:800,color:"#fff"}}>Instagram</div><div style={{fontSize:12,color:"#ffffffcc",marginTop:2}}>Metas de conteúdo — bônus à parte da comissão</div></div></div>
  <div className="card">
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div className="st" style={{marginBottom:0}}>🎯 Metas do mês</div>
      {isDono&&(instaEditMeta?<div style={{display:"flex",gap:8}}><button className="btn bsm" onClick={()=>{setInstaMeta({...instaMetaTmp});setInstaEditMeta(false);addNotif("📸","Metas do Instagram atualizadas");}}>Salvar</button><button className="bg bsm" onClick={()=>setInstaEditMeta(false)}>Cancelar</button></div>:<button className="bg" onClick={()=>{setInstaMetaTmp({...instaMeta});setInstaEditMeta(true);}}>Editar</button>)}
    </div>
    {instaEditMeta?<div className="g4">
      <div><span className="lbl">Stories — qtd</span><input type="number" className="inp" value={instaMetaTmp.storiesQt} onChange={e=>setInstaMetaTmp(t=>({...t,storiesQt:+e.target.value||0}))}/></div>
      <div><span className="lbl">Stories — bônus R$</span><input type="number" className="inp" value={instaMetaTmp.storiesBon} onChange={e=>setInstaMetaTmp(t=>({...t,storiesBon:+e.target.value||0}))}/></div>
      <div><span className="lbl">Reels — qtd</span><input type="number" className="inp" value={instaMetaTmp.reelsQt} onChange={e=>setInstaMetaTmp(t=>({...t,reelsQt:+e.target.value||0}))}/></div>
      <div><span className="lbl">Reels — bônus R$</span><input type="number" className="inp" value={instaMetaTmp.reelsBon} onChange={e=>setInstaMetaTmp(t=>({...t,reelsBon:+e.target.value||0}))}/></div>
    </div>:<div className="g2">
      <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:22}}>📸</div><div style={{fontWeight:800,fontSize:18,color:"#dc2626"}}>{instaMeta.storiesQt} Stories</div><div style={{fontSize:12,color:"#888",marginTop:2}}>Bônus: {R(instaMeta.storiesBon)}</div></div>
      <div style={{background:"#ecfeff",border:"1px solid #a5f3fc",borderRadius:8,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:22}}>🎬</div><div style={{fontWeight:800,fontSize:18,color:"#0e7490"}}>{instaMeta.reelsQt} Reels</div><div style={{fontSize:12,color:"#888",marginTop:2}}>Bônus: {R(instaMeta.reelsBon)}</div></div>
    </div>}
  </div>
  {isDono&&<div className="card"><div className="st">Lançar postagem</div><div className="g4" style={{marginBottom:10}}>
    <div><span className="lbl">Barbeiro</span><select className="inp" value={instaForm.bId} onChange={e=>setInstaForm(f=>({...f,bId:e.target.value}))}>{barbs.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div>
    <div><span className="lbl">Tipo</span><select className="inp" value={instaForm.tipo} onChange={e=>setInstaForm(f=>({...f,tipo:e.target.value}))}><option value="story">Story</option><option value="reel">Reel</option></select></div>
    <div><span className="lbl">Qtd</span><input type="number" className="inp" min="1" value={instaForm.qt} onChange={e=>setInstaForm(f=>({...f,qt:e.target.value}))}/></div>
    <div><span className="lbl">Data</span><input type="date" className="inp" value={instaForm.dt} onChange={e=>setInstaForm(f=>({...f,dt:e.target.value}))}/></div>
  </div><button className="btn" onClick={lanInsta}>+ Lançar</button></div>}
  {(isBarb?[getB(user.bId)].filter(Boolean):barbs).map(b=>{
    const lM2=instaLancamentos.filter(l=>l.bId===b.id&&noM(l.dt));
    const storiesQt=lM2.filter(l=>l.tipo==="story").reduce((a,l)=>a+l.qt,0);
    const reelsQt=lM2.filter(l=>l.tipo==="reel").reduce((a,l)=>a+l.qt,0);
    const bateuStories=storiesQt>=instaMeta.storiesQt;const bateuReels=reelsQt>=instaMeta.reelsQt;
    const bonusInsta=(bateuStories?instaMeta.storiesBon:0)+(bateuReels?instaMeta.reelsBon:0);
    return <div key={b.id} className="card" style={{borderLeft:"4px solid "+b.cor}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><BAv b={b} size={32}/><div style={{flex:1}}><div style={{fontWeight:700}}>{b.nome.split(" ")[0]}</div></div>{bonusInsta>0&&<div style={{padding:"4px 10px",background:"#dcfce7",color:"#059669",borderRadius:20,fontWeight:700,fontSize:12}}>+{R(bonusInsta)}</div>}</div>
      <div className="g2">
        <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,color:"#dc2626",fontWeight:600}}>📸 Stories</span><span style={{fontSize:12,fontWeight:700}}>{storiesQt}/{instaMeta.storiesQt}{bateuStories&&" ✓"}</span></div><PB val={storiesQt} max={instaMeta.storiesQt} cor="#dc2626" pct={false}/></div>
        <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,color:"#0e7490",fontWeight:600}}>🎬 Reels</span><span style={{fontSize:12,fontWeight:700}}>{reelsQt}/{instaMeta.reelsQt}{bateuReels&&" ✓"}</span></div><PB val={reelsQt} max={instaMeta.reelsQt} cor="#0e7490" pct={false}/></div>
      </div>
    </div>;
  })}
</div>}

{/* ─── RELATÓRIO ─── */}
{aba==="rel"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card"><div className="g4">{[{l:"Faturamento",v:R(fat),c:"#0e7490"},{l:"Assinatura",v:R(tPote),c:"#d97706"},{l:"Avulso+Extras",v:R(tSvcU+tExt),c:"#0e7490"},{l:"Produtos",v:R(tProdBruto),c:"#059669"},{l:"Ticket médio",v:R(ticketM),c:"#0284c7"},{l:"% Meta",v:((fat/meta)*100).toFixed(1)+"%",c:(fat/meta)>=1?"#059669":"#d97706"},{l:"Bônus",v:R(tBon),c:"#d97706"},{l:"vs mês ant.",v:(cresc>=0?"+":"")+cresc.toFixed(1)+"%",c:cresc>=0?"#059669":"#dc2626"}].map((k,i)=><KPI key={i} lbl={k.l} val={k.v} cor={k.c}/>)}</div></div>
  <div className="card"><div className="st">🏆 Serviços mais vendidos</div>{(()=>{const g={};sM.forEach(s=>{g[s.svc]=(g[s.svc]||0)+(s.qt||1);});aM.forEach(s=>{g[s.svc]=(g[s.svc]||0)+(s.qt||1);});const list=Object.entries(g).map(([nome,qt])=>({nome,qt})).sort((a,b)=>b.qt-a.qt).slice(0,10);return list.length===0?<div style={{color:"#ccc",textAlign:"center",padding:10}}>Nenhum lançamento.</div>:list.map((s,i)=><div key={i} className="row"><span style={{width:18,height:18,borderRadius:"50%",background:i===0?"#fef3c7":"#f0f0f5",color:i===0?"#d97706":"#888",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,flexShrink:0}}>{i+1}</span><div style={{flex:1,fontSize:13}}>{s.nome}</div><span style={{fontWeight:700,color:"#0e7490"}}>{s.qt}x</span></div>);})()}</div>
  <div className="card"><div className="st">Comissões</div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:540}}><thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["Barbeiro","Fichas","Assinatura","Avulso/Extra","Produtos","Bônus","Total","Vales","Líquido"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:10,color:"#aaa",fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{calcB.map(b=><tr key={b.id} style={{borderBottom:"1px solid #f0f0f5"}}><td style={{padding:"7px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><BAv b={getB(b.id)} size={20} fs={9}/><span style={{fontWeight:600}}>{b.nome.split(" ")[0]}</span></div></td><td style={{padding:"7px 8px",color:"#d97706",fontWeight:700}}>{b.ftot}pts</td><td style={{padding:"7px 8px",color:"#d97706"}}>{R(b.cPote)}</td><td style={{padding:"7px 8px",color:"#0e7490"}}>{R(b.cAv)}</td><td style={{padding:"7px 8px",color:"#059669"}}>{R(b.fPr)}</td><td style={{padding:"7px 8px",color:"#059669"}}>{b.bonTotal>0?"+"+R(b.bonTotal):"—"}</td><td style={{padding:"7px 8px",fontWeight:600,color:b.cor}}>{R(b.totCBon)}</td><td style={{padding:"7px 8px",color:b.tVale>0?"#dc2626":"#aaa"}}>{b.tVale>0?"-"+R(b.tVale):"—"}</td><td style={{padding:"7px 8px"}}><span style={{fontWeight:700,color:"#059669",background:"#dcfce7",padding:"2px 6px",borderRadius:20}}>{R(b.cLiq)}</span></td></tr>)}<tr style={{borderTop:"2px solid #e0e0f0",background:"#fafafa"}}><td style={{padding:"7px 8px",fontWeight:700}}>TOTAL</td><td style={{padding:"7px 8px",fontWeight:700,color:"#d97706"}}>{tFich}pts</td><td style={{padding:"7px 8px",fontWeight:700,color:"#d97706"}}>{R(tCP)}</td><td style={{padding:"7px 8px",fontWeight:700,color:"#0e7490"}}>{R(tCA)}</td><td style={{padding:"7px 8px",fontWeight:700,color:"#059669"}}>{R(calcB.reduce((a,b)=>a+b.fPr,0))}</td><td style={{padding:"7px 8px",fontWeight:700}}>{R(tBon)}</td><td style={{padding:"7px 8px",fontWeight:700}}>{R(calcB.reduce((a,b)=>a+b.totCBon,0))}</td><td style={{padding:"7px 8px",fontWeight:700,color:"#dc2626"}}>{tVG>0?"-"+R(tVG):"—"}</td><td style={{padding:"7px 8px"}}><span style={{fontWeight:700,color:"#059669",background:"#dcfce7",padding:"2px 6px",borderRadius:20}}>{R(tCL)}</span></td></tr></tbody></table></div></div>
</div>}

{/* ─── FECHAMENTO ─── */}
{aba==="fech"&&isDono&&(()=>{
  const bS=calcB.find(b=>b.id===barbSel)||calcB[0];if(!bS)return null;
  const rec15=bS.cPote;const rec30=Math.max(0,bS.cAv+bS.fPr+bS.bonTotal-bS.tVale);
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{calcB.map(b=><button key={b.id} className={"bg"+(barbSel===b.id?" on":"")} style={{borderColor:barbSel===b.id?b.cor:"#e0e0e8",color:barbSel===b.id?b.cor:"#555",display:"flex",alignItems:"center",gap:6}} onClick={()=>setBarbSel(b.id)}><BAv b={getB(b.id)} size={20} fs={9}/>{b.nome.split(" ")[0]}</button>)}</div>
    <div className="card" style={{padding:"22px 26px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,borderBottom:"2px solid #f0f0f5",paddingBottom:12}}><div><div style={{fontWeight:700,fontSize:18}}>{orgNome}</div><div style={{fontSize:12,color:"#aaa"}}>Fechamento · {MESES[mes]} {ano}</div></div><div style={{display:"flex",alignItems:"center",gap:10}}><BAv b={getB(bS.id)} size={42} fs={16}/><div style={{fontWeight:600,fontSize:15,color:bS.cor}}>{bS.nome}</div></div></div>
      {[{l:"Fichas",v:bS.ftot+"pts",c:"#d97706",bg:"#fffbeb"},{l:"Assinatura (bruto)",v:R(tPote*bS.pct),c:"#d97706",bg:"#fffbeb"},{l:"Avulsos",v:R(bS.fAv),c:"#0e7490",bg:"#ecfeff"},{l:"Extras",v:R(bS.fEx),c:"#0284c7",bg:"#f0f9ff"},{l:"Produtos (bruto)",v:R(bS.fPrBruto),c:"#059669",bg:"#f0fdf4"}].map((k,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:k.bg,borderRadius:6,marginBottom:3}}><span style={{fontSize:13}}>{k.l}</span><span style={{fontSize:13,fontWeight:600,color:k.c}}>{k.v}</span></div>)}
      <div style={{margin:"12px 0"}}>{[{l:"Comissão assinatura ("+txB+"%)",v:R(bS.cPote),c:"#d97706"},{l:"Comissão avulso+extras ("+txB+"%)",v:R(bS.cAv),c:"#0e7490"},{l:"Comissão produtos",v:R(bS.fPr),c:"#059669"},{l:"Bônus metas",v:R(bS.bonTotal),c:"#d97706"},{l:"Vales",v:"-"+R(bS.tVale),c:"#dc2626"}].map((k,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #f8f8f8"}}><span style={{fontSize:12,color:"#666"}}>{k.l}</span><span style={{fontSize:13,fontWeight:600,color:k.c}}>{k.v}</span></div>)}
        <div style={{display:"flex",justifyContent:"space-between",padding:"11px 12px",background:"#f0fdf4",border:"2px solid #bbf7d0",borderRadius:7,marginTop:8}}><span style={{fontSize:14,fontWeight:700,color:"#059669"}}>TOTAL A RECEBER</span><span style={{fontSize:18,fontWeight:800,color:"#059669"}}>{R(bS.cLiq)}</span></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:7,paddingTop:12,borderTop:"2px solid #f0f0f5"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:8}}><div style={{fontWeight:700,fontSize:13,color:"#d97706"}}>Dia 15 · Assinatura</div><div style={{fontSize:19,fontWeight:800,color:"#d97706"}}>{R(rec15)}</div></div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#ecfeff",border:"1px solid #a5f3fc",borderRadius:8}}><div style={{fontWeight:700,fontSize:13,color:"#0e7490"}}>Dia 30 · Avulso + Produtos + Bônus</div><div style={{fontSize:19,fontWeight:800,color:"#0e7490"}}>{R(rec30)}</div></div>
      </div>
    </div>
    <button className="btn" style={{background:"#1a1a2e",alignSelf:"flex-start",fontSize:13,padding:"10px 24px"}} onClick={()=>exportarRecibo(bS)}>🖨️ Exportar Recibo PDF</button>
  </div>;
})()}

{/* ─── COMISSÕES ─── */}
{aba==="comis"&&isDono&&(()=>{
  const calcBInc=calcB.filter(b=>!comisExcl.includes(b.id));
  const totalCLT=clt.reduce((a,c)=>a+(c.salario||0),0);
  const totalComAssin=calcBInc.reduce((a,b)=>a+b.cPote,0);
  const totalComAvulso=calcBInc.reduce((a,b)=>a+b.fAv*(txB/100),0);
  const totalComExtras=calcBInc.reduce((a,b)=>a+b.fEx*(txB/100),0);
  const totalComProd=calcBInc.reduce((a,b)=>a+b.fPr,0);
  const totalBon=calcBInc.reduce((a,b)=>a+b.bonTotal,0);
  const totalComissoes=calcBInc.reduce((a,b)=>a+b.totCBon,0);
  const totalEquipe=totalComissoes+totalCLT;
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card"><div className="st">💰 Comissões por barbeiro</div><div style={{fontSize:11,color:"#aaa",marginTop:-8,marginBottom:8}}>Clique no ✕ para excluir a comissão de um barbeiro da soma total.</div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:660}}>
      <thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["","Barbeiro","Assinatura","Avulso","Extras","Produtos","Bônus","Total"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:10,color:"#aaa",fontWeight:600}}>{h}</th>)}</tr></thead>
      <tbody>{calcB.map(b=>{
        const comAvulso=b.fAv*(txB/100);const comExtras=b.fEx*(txB/100);
        const excl=comisExcl.includes(b.id);
        return <tr key={b.id} style={{borderBottom:"1px solid #f0f0f5",opacity:excl?0.4:1}}>
          <td style={{padding:"7px 8px"}}><button title={excl?"Incluir na soma":"Excluir da soma"} onClick={()=>setComisExcl(l=>excl?l.filter(x=>x!==b.id):[...l,b.id])} style={{width:22,height:22,borderRadius:"50%",border:"1px solid "+(excl?"#dc2626":"#e0e0e8"),background:excl?"#fee2e2":"#fff",color:excl?"#dc2626":"#aaa",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>✕</button></td>
          <td style={{padding:"7px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><BAv b={getB(b.id)} size={20} fs={9}/><span style={{fontWeight:600,textDecoration:excl?"line-through":"none"}}>{b.nome.split(" ")[0]}</span></div></td>
          <td style={{padding:"7px 8px",color:"#d97706"}}>{R(b.cPote)}</td>
          <td style={{padding:"7px 8px",color:"#0e7490"}}>{R(comAvulso)}</td>
          <td style={{padding:"7px 8px",color:"#0284c7"}}>{R(comExtras)}</td>
          <td style={{padding:"7px 8px",color:"#059669"}}>{R(b.fPr)}</td>
          <td style={{padding:"7px 8px",color:"#059669"}}>{b.bonTotal>0?"+"+R(b.bonTotal):"—"}</td>
          <td style={{padding:"7px 8px",fontWeight:700,color:b.cor}}>{R(b.totCBon)}</td>
        </tr>;
      })}
      <tr style={{borderTop:"2px solid #e0e0f0",background:"#fafafa"}}>
        <td/>
        <td style={{padding:"7px 8px",fontWeight:700}}>TOTAL</td>
        <td style={{padding:"7px 8px",fontWeight:700,color:"#d97706"}}>{R(totalComAssin)}</td>
        <td style={{padding:"7px 8px",fontWeight:700,color:"#0e7490"}}>{R(totalComAvulso)}</td>
        <td style={{padding:"7px 8px",fontWeight:700,color:"#0284c7"}}>{R(totalComExtras)}</td>
        <td style={{padding:"7px 8px",fontWeight:700,color:"#059669"}}>{R(totalComProd)}</td>
        <td style={{padding:"7px 8px",fontWeight:700,color:"#059669"}}>{R(totalBon)}</td>
        <td style={{padding:"7px 8px",fontWeight:700}}>{R(totalComissoes)}</td>
      </tr></tbody></table></div>{comisExcl.length>0&&<div style={{fontSize:11,color:"#dc2626",marginTop:8}}>{comisExcl.length} barbeiro{comisExcl.length!==1?"s":""} excluído{comisExcl.length!==1?"s":""} da soma total.</div>}</div>

    {calcBInc.length>0&&<div className="card">
      <div className="st">Composição da comissão por barbeiro</div>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={calcBInc.map(b=>({nome:b.nome.split(" ")[0],Assinatura:b.cPote,Avulso:b.fAv*(txB/100),Extras:b.fEx*(txB/100),Produtos:b.fPr,Bônus:b.bonTotal}))} margin={{top:8,right:4,left:-14,bottom:0}} barCategoryGap="26%">
          <CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" vertical={false}/>
          <XAxis dataKey="nome" tick={{fill:"#98a2b3",fontSize:11}} tickLine={false} axisLine={false}/>
          <YAxis tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>v>0?Math.round(v/1000)+"k":""}/>
          <Tooltip content={<CT/>} cursor={{fill:"#0e74900d"}}/>
          <Bar dataKey="Assinatura" stackId="c" fill="#d97706"/>
          <Bar dataKey="Avulso" stackId="c" fill="#0e7490"/>
          <Bar dataKey="Extras" stackId="c" fill="#0284c7"/>
          <Bar dataKey="Produtos" stackId="c" fill="#059669"/>
          <Bar dataKey="Bônus" stackId="c" fill="#84cc16" radius={[6,6,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:6,justifyContent:"center"}}>
        {[["Assinatura","#d97706"],["Avulso","#0e7490"],["Extras","#0284c7"],["Produtos","#059669"],["Bônus","#84cc16"]].map(([l,c])=><div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#667085"}}><span style={{width:8,height:8,borderRadius:2,background:c}}/>{l}</div>)}
      </div>
    </div>}

    <div className="card"><div className="st">👔 CLT (funcionários fixos)</div>
      {clt.length===0&&<div style={{color:"#ccc",textAlign:"center",padding:10,fontSize:12}}>Nenhum funcionário CLT cadastrado.</div>}
      {clt.map(c=><div key={c.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"8px 10px",background:"#fafafa",borderRadius:8,flexWrap:"wrap"}}>
        <div style={{flex:2,minWidth:100,fontWeight:600,fontSize:13}}>{c.nome}</div>
        <div style={{fontSize:11,color:"#aaa"}}>Pagamento dia {c.dia}</div>
        <div style={{fontWeight:700,fontSize:14,color:"#0284c7"}}>{R(c.salario)}</div>
        <button className="bg bsm" onClick={()=>setClt(l=>l.filter(x=>x.id!==c.id))}>Remover</button>
      </div>)}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
        <input className="inp" placeholder="Nome" style={{flex:2,minWidth:120}} value={fClt.nome} onChange={e=>setFClt(f=>({...f,nome:e.target.value}))}/>
        <input type="number" className="inp" placeholder="Salário" style={{flex:1,minWidth:100}} value={fClt.salario||""} onChange={e=>setFClt(f=>({...f,salario:+e.target.value||0}))}/>
        <input type="number" className="inp" placeholder="Dia pgto" style={{flex:1,minWidth:80}} value={fClt.dia} onChange={e=>setFClt(f=>({...f,dia:+e.target.value||1}))}/>
        <button className="btn bsm" onClick={()=>{if(!fClt.nome)return;setClt(l=>[...l,{id:uid(),...fClt}]);setFClt({nome:"",salario:0,dia:5});}}>Adicionar</button>
      </div>
      <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid #f0f0f5",display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700,fontSize:13}}>Total CLT</span><span style={{fontWeight:800,fontSize:16,color:"#0284c7"}}>{R(totalCLT)}</span></div>
    </div>

    <div className="card" style={{borderLeft:"5px solid #dc2626",background:"linear-gradient(135deg,#fef2f2,#fff)"}}>
      <div style={{fontSize:12,fontWeight:700,color:"#dc2626",textTransform:"uppercase",letterSpacing:".04em",marginBottom:6}}>Total despesas com equipe (Comissões + CLT)</div>
      <div style={{fontSize:30,fontWeight:900,color:"#dc2626"}}>{R(totalEquipe)}</div>
      <div style={{fontSize:12,color:"#888",marginTop:4}}>{R(totalComissoes)} em comissões · {R(totalCLT)} em CLT</div>
    </div>
  </div>;
})()}

{/* ─── CUSTOS ─── */}
{aba==="custos"&&isDono&&(()=>{
  const hoje=new Date().getDate();
  const calcBInc=calcB.filter(b=>!comisExcl.includes(b.id));
  const totalCLT=clt.reduce((a,c)=>a+(c.salario||0),0);
  const totalComissoes=calcBInc.reduce((a,b)=>a+b.totCBon,0);
  const custosFixos=custos.filter(c=>c.tipo==="fixo"&&c.direcao==="saida").reduce((a,c)=>a+c.valor,0);
  const custosVar=custos.filter(c=>c.tipo==="variavel"&&c.direcao==="saida").reduce((a,c)=>a+c.valor,0);
  const totalEntradas=custos.filter(c=>c.direcao==="entrada").reduce((a,c)=>a+c.valor,0);
  const totalSaidas=custosFixos+custosVar;
  const totalGeral=totalComissoes+totalCLT+totalSaidas;
  const pendCom=(hoje<diaPagAssin?calcBInc.reduce((a,b)=>a+b.cPote,0):0)+(hoje<diaPagAvulso?calcBInc.reduce((a,b)=>a+Math.max(0,b.cAv+b.fPr+b.bonTotal-b.tVale),0):0);
  const pendCLT=clt.reduce((a,c)=>a+(hoje<(c.dia||5)?(c.salario||0):0),0);
  const pendSaida=custos.filter(c=>c.direcao==="saida"&&hoje<(c.dia||1)).reduce((a,c)=>a+c.valor,0);
  const pendEntrada=custos.filter(c=>c.direcao==="entrada"&&hoje<(c.dia||1)).reduce((a,c)=>a+c.valor,0);
  const saldoFuturo=saldoAtual-pendCom-pendCLT-pendSaida+pendEntrada;
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="g2">
      <div className="card" style={{borderLeft:"4px solid #059669"}}>
        <div className="st">Saldo atual</div>
        <input type="number" className="inp" style={{fontSize:20,fontWeight:800,color:"#059669"}} value={saldoAtual} onChange={e=>setSaldoAtual(+e.target.value||0)}/>
        <div style={{fontSize:11,color:"#aaa",marginTop:4}}>Digite o saldo da conta hoje</div>
      </div>
      <div className="card" style={{borderLeft:"4px solid "+(saldoFuturo>=0?"#0284c7":"#dc2626")}}>
        <div className="st">Saldo futuro (após pagamentos do mês)</div>
        <div style={{fontSize:26,fontWeight:900,color:saldoFuturo>=0?"#0284c7":"#dc2626"}}>{R(saldoFuturo)}</div>
        <div style={{fontSize:11,color:"#888",marginTop:4}}>Considera comissão assinatura, avulso, CLT e custos ainda não pagos este mês</div>
      </div>
    </div>

    <div className="card"><div className="st">📅 Dias de pagamento</div><div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:140}}><span className="lbl">Comissão assinatura — dia</span><input type="number" className="inp" value={diaPagAssin} onChange={e=>setDiaPagAssin(+e.target.value||1)}/></div>
      <div style={{flex:1,minWidth:140}}><span className="lbl">Comissão avulso — dia</span><input type="number" className="inp" value={diaPagAvulso} onChange={e=>setDiaPagAvulso(+e.target.value||1)}/></div>
    </div></div>

    <div className="card"><div className="st">📉 Custos fixos e variáveis</div>
      {custos.length===0&&<div style={{color:"#ccc",textAlign:"center",padding:10,fontSize:12}}>Nenhum custo cadastrado.</div>}
      <div style={{overflowX:"auto"}}>{custos.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:560}}>
        <thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["Descrição","Categoria","Tipo","Direção","Dia","Valor",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:10,color:"#aaa",fontWeight:600}}>{h}</th>)}</tr></thead>
        <tbody>{custos.map(c=><tr key={c.id} style={{borderBottom:"1px solid #f0f0f5"}}>
          <td style={{padding:"7px 8px",fontWeight:600}}>{c.desc}</td>
          <td style={{padding:"7px 8px",color:"#888"}}>{c.categoria||"—"}</td>
          <td style={{padding:"7px 8px"}}>{c.tipo==="fixo"?"Fixo":"Variável"}</td>
          <td style={{padding:"7px 8px",color:c.direcao==="entrada"?"#059669":"#dc2626"}}>{c.direcao==="entrada"?"Entrada":"Saída"}</td>
          <td style={{padding:"7px 8px",color:"#aaa"}}>{c.dia}</td>
          <td style={{padding:"7px 8px",fontWeight:700,color:c.direcao==="entrada"?"#059669":"#dc2626"}}>{c.direcao==="entrada"?"+":"-"}{R(c.valor)}</td>
          <td style={{padding:"7px 8px"}}><button className="bg bsm" onClick={()=>setCustos(l=>l.filter(x=>x.id!==c.id))}>Remover</button></td>
        </tr>)}</tbody></table>}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
        <input className="inp" placeholder="Descrição" style={{flex:2,minWidth:120}} value={fCusto.desc} onChange={e=>setFCusto(f=>({...f,desc:e.target.value}))}/>
        <input className="inp" placeholder="Categoria" style={{flex:1,minWidth:100}} value={fCusto.categoria} onChange={e=>setFCusto(f=>({...f,categoria:e.target.value}))}/>
        <select className="inp" style={{flex:1,minWidth:100}} value={fCusto.tipo} onChange={e=>setFCusto(f=>({...f,tipo:e.target.value}))}><option value="fixo">Fixo</option><option value="variavel">Variável</option></select>
        <select className="inp" style={{flex:1,minWidth:100}} value={fCusto.direcao} onChange={e=>setFCusto(f=>({...f,direcao:e.target.value}))}><option value="saida">Saída</option><option value="entrada">Entrada</option></select>
        <input type="number" className="inp" placeholder="Valor" style={{flex:1,minWidth:90}} value={fCusto.valor||""} onChange={e=>setFCusto(f=>({...f,valor:+e.target.value||0}))}/>
        <input type="number" className="inp" placeholder="Dia" style={{flex:1,minWidth:70}} value={fCusto.dia} onChange={e=>setFCusto(f=>({...f,dia:+e.target.value||1}))}/>
        <button className="btn bsm" onClick={()=>{if(!fCusto.desc||!fCusto.valor)return;setCustos(l=>[...l,{id:uid(),...fCusto}]);setFCusto({desc:"",categoria:"",tipo:"fixo",direcao:"saida",valor:0,dia:5});}}>Adicionar</button>
      </div>
    </div>

    <div className="card"><div className="st">Resumo do mês</div>
      {[{l:"Custos fixos",v:R(custosFixos),c:"#d97706"},{l:"Custos variáveis",v:R(custosVar),c:"#dc2626"},{l:"Entradas extras",v:"+"+R(totalEntradas),c:"#059669"}].map((k,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #f8f8f8"}}><span style={{fontSize:12,color:"#666"}}>{k.l}</span><span style={{fontSize:13,fontWeight:600,color:k.c}}>{k.v}</span></div>)}
      <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",marginTop:6,background:"#fef2f2",borderRadius:7}}><span style={{fontWeight:700,fontSize:13,color:"#dc2626"}}>Total custos (saídas)</span><span style={{fontWeight:800,fontSize:16,color:"#dc2626"}}>{R(totalSaidas)}</span></div>
    </div>

    {(()=>{
      const comp=[{name:"Comissões",value:totalComissoes,cor:"#0e7490"},{name:"CLT",value:totalCLT,cor:"#0284c7"},{name:"Custos fixos",value:custosFixos,cor:"#d97706"},{name:"Custos variáveis",value:custosVar,cor:"#dc2626"}].filter(x=>x.value>0);
      if(!comp.length)return null;
      const somaComp=comp.reduce((a,x)=>a+x.value,0);
      return <div className="card">
        <div className="st">Para onde vai o dinheiro</div>
        <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
          <div style={{width:190,height:190,flexShrink:0,position:"relative"}}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={comp} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2} stroke="none">
                  {comp.map(x=><Cell key={x.name} fill={x.cor}/>)}
                </Pie>
                <Tooltip content={<CT/>}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
              <div style={{fontSize:10,color:"#98a2b3",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em"}}>Total</div>
              <div style={{fontSize:17,fontWeight:800,color:"#101828"}}>{R(somaComp)}</div>
            </div>
          </div>
          <div style={{flex:1,minWidth:190}}>
            {comp.map(x=><div key={x.name} style={{marginBottom:11}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:8}}>
                <span style={{display:"flex",alignItems:"center",gap:7,fontSize:12.5,color:"#475467"}}><span style={{width:9,height:9,borderRadius:3,background:x.cor}}/>{x.name}</span>
                <span style={{fontSize:12.5,fontWeight:700,color:x.cor}}>{R(x.value)} <span style={{color:"#98a2b3",fontWeight:500}}>· {((x.value/somaComp)*100).toFixed(0)}%</span></span>
              </div>
              <div style={{background:"#f2f4f7",borderRadius:4,height:6}}><div style={{height:6,borderRadius:4,width:((x.value/somaComp)*100)+"%",background:x.cor}}/></div>
            </div>)}
          </div>
        </div>
      </div>;
    })()}

    <div className="card" style={{borderLeft:"5px solid #1a1a2e",background:"linear-gradient(135deg,#f5f5f7,#fff)"}}>
      <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e",textTransform:"uppercase",letterSpacing:".04em",marginBottom:6}}>Tudo somado — Comissões + CLT + Custos</div>
      <div style={{fontSize:32,fontWeight:900,color:"#1a1a2e"}}>{R(totalGeral)}</div>
      <div style={{fontSize:12,color:"#888",marginTop:4}}>{R(totalComissoes)} comissões + {R(totalCLT)} CLT + {R(totalSaidas)} custos</div>
    </div>
  </div>;
})()}

{/* ─── PROFIT ─── */}
{aba==="profit"&&isDono&&(()=>{
  const keyOf=(cat,nome)=>cat+"|"+nome;
  const setOv=(cat,nome,campo,val)=>setProfitItens(p=>({...p,[keyOf(cat,nome)]:{...(p[keyOf(cat,nome)]||{}),[campo]:val}}));

  // Monta os itens a partir das vendas reais do mês (nada é digitado à mão).
  const grupos={};
  const add=(cat,nome,qt,valor)=>{const k=keyOf(cat,nome);if(!grupos[k])grupos[k]={cat,nome,qtd:0,receita:0};grupos[k].qtd+=qt;grupos[k].receita+=valor;};
  aM.forEach(s=>add("Barbearia",s.svc,s.qt||1,s.val*(s.qt||1)));
  lM.forEach(l=>add("Barbearia","Lote / Pacote",1,l.vb));
  [...eM,...eAM].forEach(e=>add("Serviços Extras",e.svc,1,e.val));
  pM.forEach(p=>add("Produtos",p.prod,p.qt||1,p.val*(p.qt||1)));

  const itens=Object.values(grupos).map(g=>{
    const o=profitItens[keyOf(g.cat,g.nome)]||{};
    const preco=g.qtd>0?g.receita/g.qtd:0;
    const comPadrao=g.cat==="Produtos"?((prodLst.find(x=>x.nome===g.nome)?.comissao??0.2)*100):txB;
    const comissao=o.comissao!=null?o.comissao:comPadrao;
    const cartao=o.cartao!=null?o.cartao:profitPrem.cartao;
    const taxaFixa=o.taxaFixa!=null?o.taxaFixa:profitPrem.taxaFixa;
    const imposto=o.imposto!=null?o.imposto:profitPrem.imposto;
    const insumos=o.insumos!=null?o.insumos:0;
    const custoUnit=preco*((comissao+cartao+imposto+(profitPrem.gerente||0))/100)+taxaFixa+insumos;
    const contribUnit=preco-custoUnit;
    return{...g,preco,comissao,cartao,taxaFixa,imposto,insumos,contribUnit,mc:preco>0?(contribUnit/preco)*100:0,contribTotal:contribUnit*g.qtd};
  }).sort((a,b2)=>b2.contribTotal-a.contribTotal);

  const servicos=itens.filter(i=>i.cat!=="Produtos");
  const recServ=servicos.reduce((a,i)=>a+i.receita,0);const contServ=servicos.reduce((a,i)=>a+i.contribTotal,0);
  const qtServ=servicos.reduce((a,i)=>a+i.qtd,0);
  const mcServ=recServ>0?(contServ/recServ)*100:0;

  const cats={};
  itens.forEach(i=>{if(!cats[i.cat])cats[i.cat]={cat:i.cat,receita:0,contrib:0,qtd:0};cats[i.cat].receita+=i.receita;cats[i.cat].contrib+=i.contribTotal;cats[i.cat].qtd+=i.qtd;});
  const catList=Object.values(cats).map(c=>({...c,mc:c.receita>0?(c.contrib/c.receita)*100:0})).sort((a,b2)=>a.mc-b2.mc);
  const maxMc=Math.max(...catList.map(c=>c.mc),1);
  const itensFiltrados=profitCatSel?itens.filter(i=>i.cat===profitCatSel):itens;
  const corMc=m=>m>=50?"#059669":m>=30?"#d97706":"#dc2626";

  // Ponto de equilíbrio — assinatura entra pelo real: receita do pote menos a comissão paga sobre ela.
  const contribAssin=tPote-tCP;
  const contribMensal=itens.reduce((a,i)=>a+i.contribTotal,0)+contribAssin;
  const custoVarTotal=fat-contribMensal;
  const mcGeral=fat>0?(contribMensal/fat)*100:0;
  const custosFixosAba=custos.filter(c=>c.tipo==="fixo"&&c.direcao==="saida").reduce((a,c)=>a+c.valor,0);
  const totalCLT=clt.reduce((a,c)=>a+(c.salario||0),0);
  const fixosTotal=custosFixosAba+totalCLT;
  const resultado=contribMensal-fixosTotal;
  const pontoEquilibrio=mcGeral>0?fixosTotal/(mcGeral/100):0;
  const distPct=pontoEquilibrio>0?((fat-pontoEquilibrio)/pontoEquilibrio)*100:0;
  const inpMini={width:62,fontSize:11,padding:"3px 5px",border:"1px solid #e0e0e8",borderRadius:5};

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card" style={{borderLeft:"4px solid #0e7490"}}>
      <div style={{fontWeight:700,fontSize:15}}>Profit</div>
      <div style={{fontSize:12,color:"#555",marginTop:2}}>Descubra quanto realmente sobra em cada serviço e produto — calculado sobre as vendas de {MESES[mes]}.</div>
      <div style={{display:"flex",gap:16,marginTop:12,borderBottom:"1px solid #f0f0f5"}}>
        {[["itens","Itens (precificar)"],["equil","Ponto de equilíbrio"]].map(([k,v])=><div key={k} onClick={()=>setProfitAba(k)} style={{cursor:"pointer",paddingBottom:8,fontSize:13,fontWeight:profitAba===k?700:500,color:profitAba===k?"#0e7490":"#888",borderBottom:profitAba===k?"2px solid #0e7490":"2px solid transparent",marginBottom:-1}}>{v}</div>)}
      </div>
    </div>

    {profitAba==="itens"&&<>
      <div className="g2">
        <div className="card" style={{borderLeft:"4px solid "+corMc(mcServ)}}>
          <div style={{fontSize:11,color:"#888",fontWeight:600}}>✂️ MARGEM DE CONTRIB. · SERVIÇOS</div>
          <div style={{fontSize:30,fontWeight:900,color:corMc(mcServ)}}>{mcServ.toFixed(1)}%</div>
          <div style={{fontSize:11,color:"#aaa"}}>ponderada pela venda · {R(contServ)} de {R(recServ)}</div>
        </div>
        <div className="card" style={{borderLeft:"4px solid #0284c7"}}>
          <div style={{fontSize:11,color:"#888",fontWeight:600}}>💵 CONTRIBUIÇÃO / VENDA · SERVIÇOS</div>
          <div style={{fontSize:30,fontWeight:900,color:"#0284c7"}}>{R(qtServ>0?contServ/qtServ:0)}</div>
          <div style={{fontSize:11,color:"#aaa"}}>média por serviço · {qtServ} atendimento{qtServ!==1?"s":""}</div>
        </div>
      </div>

      <div className="card">
        <div className="st">Margem por categoria</div>
        <div style={{fontSize:11,color:"#aaa",marginTop:-8,marginBottom:10}}>Da menor margem para a maior — clique numa categoria para filtrar a tabela abaixo.</div>
        {catList.length===0?<div style={{color:"#ccc",textAlign:"center",padding:10,fontSize:12}}>Nenhuma venda lançada em {MESES[mes]}.</div>:catList.map((c,i)=><div key={c.cat} onClick={()=>setProfitCatSel(profitCatSel===c.cat?null:c.cat)} style={{cursor:"pointer",marginBottom:10,padding:"8px 10px",borderRadius:8,background:profitCatSel===c.cat?"#ecfeff":"transparent",border:"1px solid "+(profitCatSel===c.cat?"#a5f3fc":"transparent")}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:8,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontSize:13,fontWeight:600}}>{c.cat}</span>
              <span style={{fontSize:11,color:"#aaa"}}>{c.qtd}x</span>
              {i===0&&catList.length>1&&<span style={{background:"#fee2e2",color:"#dc2626",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:700}}>MENOR</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:13,fontWeight:800,color:corMc(c.mc)}}>{c.mc.toFixed(1)}%</span><span style={{fontSize:12,color:"#888"}}>{R(c.contrib)}</span></div>
          </div>
          <div style={{background:"#f0f0f5",borderRadius:4,height:7}}><div style={{height:7,borderRadius:4,width:Math.max(2,(c.mc/maxMc)*100)+"%",background:corMc(c.mc)}}/></div>
        </div>)}
      </div>

      <div className="card">
        <div className="st">Premissas do cálculo</div>
        <div style={{fontSize:11,color:"#aaa",marginTop:-8,marginBottom:10}}>Valem como padrão para todos os itens — dá pra ajustar linha a linha na tabela abaixo. A comissão já vem da taxa do barbeiro ({txB}%) e, nos produtos, da comissão cadastrada.</div>
        <div className="g4">
          {[["cartao","Cartão %"],["imposto","Imposto %"],["gerente","Comissão gerente %"],["taxaFixa","Taxa fixa R$"]].map(([k,l])=><div key={k}><span className="lbl">{l}</span><input type="number" step="0.01" className="inp" value={profitPrem[k]} onChange={e=>setProfitPrem(p=>({...p,[k]:+e.target.value||0}))}/></div>)}
        </div>
      </div>

      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:10}}>
          <div className="st" style={{marginBottom:0}}>Itens vendidos em {MESES[mes]}{profitCatSel?" · "+profitCatSel:""}</div>
          {profitCatSel&&<button className="bg bsm" onClick={()=>setProfitCatSel(null)}>Limpar filtro</button>}
        </div>
        {itensFiltrados.length===0?<div style={{color:"#ccc",textAlign:"center",padding:14,fontSize:12}}>Nenhuma venda lançada.</div>:
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
          <thead><tr style={{borderBottom:"2px solid #f0f0f5"}}>{["Item","Qtd","Preço médio","Comissão %","Cartão %","Taxa fixa R$","Insumos R$","Imposto %","MC %","Contribuição R$"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 7px",fontSize:10,color:"#aaa",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
          <tbody>{itensFiltrados.map(i=><tr key={keyOf(i.cat,i.nome)} style={{borderBottom:"1px solid #f0f0f5"}}>
            <td style={{padding:"6px 7px"}}><div style={{fontWeight:600}}>{i.nome}</div><div style={{fontSize:10,color:"#aaa"}}>{i.cat}</div></td>
            <td style={{padding:"6px 7px",color:"#888"}}>{i.qtd}</td>
            <td style={{padding:"6px 7px",fontWeight:600}}>{R(i.preco)}</td>
            {[["comissao",1],["cartao",0.1],["taxaFixa",0.01],["insumos",0.01],["imposto",0.1]].map(([campo,step])=><td key={campo} style={{padding:"6px 7px"}}><input type="number" step={step} style={inpMini} value={i[campo]} onChange={e=>setOv(i.cat,i.nome,campo,+e.target.value||0)}/></td>)}
            <td style={{padding:"6px 7px"}}><span style={{fontWeight:800,color:corMc(i.mc),background:corMc(i.mc)+"15",padding:"2px 7px",borderRadius:20}}>{i.mc.toFixed(1)}%</span></td>
            <td style={{padding:"6px 7px",fontWeight:700,color:i.contribTotal>=0?"#059669":"#dc2626"}}>{R(i.contribTotal)}</td>
          </tr>)}
          <tr style={{borderTop:"2px solid #e0e0f0",background:"#fafafa"}}>
            <td style={{padding:"7px",fontWeight:700}}>TOTAL</td>
            <td style={{padding:"7px",fontWeight:700}}>{itensFiltrados.reduce((a,i)=>a+i.qtd,0)}</td>
            <td colSpan={7}/>
            <td style={{padding:"7px",fontWeight:800}}>{R(itensFiltrados.reduce((a,i)=>a+i.contribTotal,0))}</td>
          </tr></tbody></table></div>}
        <div style={{fontSize:11,color:"#aaa",marginTop:10}}>💡 Insumos = quanto você gasta de material em cada atendimento/produto (lâmina, toalha, custo de compra). É o único campo que o app não tem como saber sozinho.</div>
      </div>

      {itensFiltrados.length>0&&<div className="card">
        <div className="st">Quem mais traz dinheiro pro caixa</div>
        <div style={{fontSize:11,color:"#aaa",marginTop:-10,marginBottom:12}}>Contribuição total no mês — a barra fica verde quando a margem passa de 50%.</div>
        <ResponsiveContainer width="100%" height={Math.max(180,Math.min(10,itensFiltrados.length)*38)}>
          <BarChart data={itensFiltrados.slice(0,10).map(i=>({nome:i.nome.length>22?i.nome.slice(0,21)+"…":i.nome,Contribuição:Math.round(i.contribTotal),mc:i.mc}))} layout="vertical" margin={{top:0,right:16,left:8,bottom:0}} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" horizontal={false}/>
            <XAxis type="number" tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?Math.round(v/1000)+"k":v}/>
            <YAxis type="category" dataKey="nome" width={130} tick={{fill:"#475467",fontSize:11}} tickLine={false} axisLine={false}/>
            <Tooltip content={<CT/>} cursor={{fill:"#0e74900d"}}/>
            <Bar dataKey="Contribuição" radius={[0,6,6,0]} maxBarSize={26}>
              {itensFiltrados.slice(0,10).map((i,idx)=><Cell key={idx} fill={corMc(i.mc)}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>}
    </>}

    {profitAba==="equil"&&<>
      <div className="card" style={{borderLeft:"5px solid "+(resultado>=0?"#059669":"#dc2626"),background:resultado>=0?"linear-gradient(135deg,#f0fdf4,#fff)":"linear-gradient(135deg,#fef2f2,#fff)"}}>
        <div style={{fontSize:11,color:"#888",fontWeight:700,textTransform:"uppercase",letterSpacing:".04em"}}>Resultado mensal · {MESES[mes]}</div>
        <div style={{fontSize:13,color:"#666",marginTop:4}}>Hoje sua contribuição mensal é <b>{R(contribMensal)}</b></div>
        <div style={{fontSize:34,fontWeight:900,color:resultado>=0?"#059669":"#dc2626",lineHeight:1.15,marginTop:4}}>{resultado>=0?"+":"−"} {R(Math.abs(resultado))}</div>
        <div style={{fontSize:12,color:"#888",marginTop:4}}>{resultado>=0?"Sobrou depois de pagar todos os custos fixos.":"Estão faltando "+R(Math.abs(resultado))+" para cobrir os custos fixos do mês."}</div>
      </div>

      <div className="card">
        <div className="st">Detalhamento dos resultados</div>
        {[{l:"+ Receita total mensal",v:R(fat),c:"#0e7490"},{l:"− Custos variáveis (comissões, cartão, imposto, insumos)",v:"-"+R(custoVarTotal),c:"#dc2626"},{l:"= Contribuição mensal",v:R(contribMensal),c:"#0284c7",forte:true},{l:"− Custos fixos (aluguel, contas, CLT…)",v:"-"+R(fixosTotal),c:"#dc2626"},{l:"= Resultado mensal",v:R(resultado),c:resultado>=0?"#059669":"#dc2626",forte:true}].map((k,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",borderBottom:"1px solid #f8f8f8",background:k.forte?"#fafafe":"transparent",borderRadius:k.forte?6:0,gap:10}}><span style={{fontSize:12,color:k.forte?"#333":"#666",fontWeight:k.forte?700:400}}>{k.l}</span><span style={{fontSize:13,fontWeight:k.forte?800:600,color:k.c,whiteSpace:"nowrap"}}>{k.v}</span></div>)}
      </div>

      <div className="card" style={{borderLeft:"5px solid #1a1a2e"}}>
        <div style={{fontSize:11,color:"#888",fontWeight:700,textTransform:"uppercase",letterSpacing:".04em"}}>Ponto de equilíbrio</div>
        <div style={{fontSize:32,fontWeight:900,color:"#1a1a2e",marginTop:4}}>{R(pontoEquilibrio)}</div>
        <div style={{fontSize:12,color:"#888",marginTop:4}}>É quanto a barbearia precisa faturar no mês só para empatar (margem de {mcGeral.toFixed(1)}%).</div>
        <div style={{fontSize:12,fontWeight:700,color:distPct>=0?"#059669":"#dc2626",marginTop:8}}>{distPct>=0?"✓ Você está "+distPct.toFixed(1)+"% acima do ponto de equilíbrio.":"Você está "+Math.abs(distPct).toFixed(1)+"% abaixo desse ponto — faltam "+R(pontoEquilibrio-fat)+" de faturamento."}</div>
        <div style={{marginTop:10}}><PB val={fat} max={pontoEquilibrio||1} cor={distPct>=0?"#059669":"#d97706"} lbl={"Faturado "+R(fat)} pct/></div>
      </div>

      <div className="card">
        <div className="st">Custos fixos considerados</div>
        <div style={{fontSize:11,color:"#aaa",marginTop:-8,marginBottom:10}}>Vêm da aba <b>Custos</b> e do <b>CLT</b> cadastrado em Comissões — edite por lá.</div>
        {custos.filter(c=>c.tipo==="fixo"&&c.direcao==="saida").map(c=><div key={c.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 10px",borderBottom:"1px solid #f8f8f8"}}><span style={{fontSize:12}}>{c.desc}{c.categoria?" · "+c.categoria:""}</span><span style={{fontSize:12,fontWeight:600,color:"#dc2626"}}>{R(c.valor)}</span></div>)}
        {totalCLT>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"7px 10px",borderBottom:"1px solid #f8f8f8"}}><span style={{fontSize:12}}>Folha CLT ({clt.length} funcionário{clt.length!==1?"s":""})</span><span style={{fontSize:12,fontWeight:600,color:"#dc2626"}}>{R(totalCLT)}</span></div>}
        {fixosTotal===0&&<div style={{color:"#ccc",textAlign:"center",padding:10,fontSize:12}}>Nenhum custo fixo cadastrado ainda — cadastre na aba Custos para o ponto de equilíbrio ficar real.</div>}
        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",marginTop:6,background:"#fef2f2",borderRadius:7}}><span style={{fontWeight:700,fontSize:13,color:"#dc2626"}}>Total de fixos / mês</span><span style={{fontWeight:800,fontSize:16,color:"#dc2626"}}>{R(fixosTotal)}</span></div>
      </div>
    </>}
  </div>;
})()}

{/* ─── GESTÃO ─── */}
{aba==="gest"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="g4">{[{l:"Faturamento",v:R(fat),c:"#0e7490"},{l:"Barbearia ("+txBar+"%)",v:R(fat*txBar/100),c:"#059669"},{l:"Ticket médio",v:R(ticketM),c:"#0284c7"},{l:"Crescimento",v:(cresc>=0?"+":"")+cresc.toFixed(1)+"%",c:cresc>=0?"#059669":"#dc2626"}].map((k,i)=><KPI key={i} lbl={k.l} val={k.v} cor={k.c}/>)}</div>
  <div className="card"><div className="st">Metas individuais</div><div style={{marginBottom:12}}><PB val={fat} max={meta} cor="#0e7490" lbl={"Barbearia — "+R(fat)+" / "+R(meta)} pct lg/></div>{calcB.map(b=><div key={b.id} style={{marginBottom:10}}><PB val={b.totC} max={b.metaB} cor={b.cor} lbl={b.nome.split(" ")[0]+" — "+R(b.totC)+" / "+R(b.metaB)} pct sub={"Falta "+R(b.faltaB)}/></div>)}</div>
  <div className="card"><div className="st">Metas de bonificação</div>{metasBon.map((m,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:7,alignItems:"center",flexWrap:"wrap"}}><span style={{flex:2,fontSize:12,color:"#555"}}>{m.nome}</span><input type="number" className="inp" style={{flex:1,fontSize:12,padding:"5px 8px"}} value={m.meta} onChange={e=>setMetasBon(l=>l.map((x,j)=>j===i?{...x,meta:+e.target.value||0}:x))}/><input type="number" className="inp" style={{flex:1,fontSize:12,padding:"5px 8px"}} value={m.bon} onChange={e=>setMetasBon(l=>l.map((x,j)=>j===i?{...x,bon:+e.target.value||0}:x))}/><input type="number" className="inp" style={{flex:1,fontSize:12,padding:"5px 8px"}} value={m.vUnit||20} placeholder="R$/unit" onChange={e=>setMetasBon(l=>l.map((x,j)=>j===i?{...x,vUnit:+e.target.value||0}:x))}/></div>)}</div>
  <div className="card" style={{borderLeft:"4px solid #0284c7"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div className="st" style={{marginBottom:0}}>🏅 Desafio da Semana (loja)</div>{desafioEdit?<div style={{display:"flex",gap:8}}><button className="btn bsm" onClick={()=>{setDesafio({...desafioTmp});setDesafioEdit(false);addNotif("🏅","Desafio salvo!");}}>Salvar</button><button className="bg bsm" onClick={()=>setDesafioEdit(false)}>Cancelar</button></div>:<button className="bg" onClick={()=>{setDesafioTmp({...desafio});setDesafioEdit(true);}}>Editar</button>}</div>
    {desafioEdit?<div style={{display:"flex",gap:10,flexWrap:"wrap"}}><div style={{flex:3,minWidth:140}}><span className="lbl">Serviço / Descrição</span><input className="inp" value={desafioTmp.servico} onChange={e=>setDesafioTmp(t=>({...t,servico:e.target.value}))}/></div><div style={{flex:1,minWidth:80}}><span className="lbl">Quantidade</span><input type="number" className="inp" value={desafioTmp.qt} onChange={e=>setDesafioTmp(t=>({...t,qt:+e.target.value||0}))}/></div><div style={{flex:1,minWidth:80}}><span className="lbl">Pontos</span><input type="number" className="inp" value={desafioTmp.pontos} onChange={e=>setDesafioTmp(t=>({...t,pontos:+e.target.value||0}))}/></div></div>
    :<div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}><div style={{flex:1}}><div style={{fontSize:11,color:"#aaa",marginBottom:2}}>Meta</div><div style={{fontWeight:700,fontSize:16,color:"#0284c7"}}>{desafio.qt}× {desafio.servico}</div></div><div style={{padding:"8px 18px",background:"#0284c7",color:"#fff",borderRadius:20,fontWeight:700,fontSize:13}}>+{desafio.pontos} pontos</div></div>}
  </div>
</div>}

{/* ─── EQUIPE ─── */}
{(aba==="equi"||aba==="equiv")&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  {isDono&&<div className="card"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div className="st" style={{marginBottom:0}}>Configurar equipe</div>{editNm?<div style={{display:"flex",gap:8}}><button className="btn bsm" onClick={salvNomes}>Salvar</button><button className="bg bsm" onClick={()=>setEditNm(false)}>Cancelar</button></div>:<button className="bg" onClick={()=>{setNmsT(barbs.map(b=>b.nome));setMetT(barbs.map(b=>b.meta));setEditNm(true);}}>Editar</button>}</div>{barbs.map((b,i)=><div key={b.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><BAv b={b} size={26}/>{editNm?<><input className="inp" style={{flex:2,fontSize:12,padding:"5px 8px"}} value={nmsT[i]} onChange={e=>{const n=[...nmsT];n[i]=e.target.value;setNmsT(n);}}/><input className="inp" style={{flex:1,fontSize:12,padding:"5px 8px"}} type="number" value={metT[i]} onChange={e=>{const n=[...metT];n[i]=e.target.value;setMetT(n);}}/></>:<><span style={{fontWeight:600,fontSize:13,flex:1}}>{b.nome}</span><span style={{fontSize:12,color:"#aaa"}}>Meta: {R(b.meta)}</span></>}</div>)}</div>}
  <div className="g3">{calcB.slice(0,3).map((b,i)=><div key={b.id} className="card" style={{borderLeft:"4px solid "+b.cor}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span style={{fontSize:18}}>{i===0?"🥇":i===1?"🥈":"🥉"}</span><BAv b={getB(b.id)} size={30}/><div><div style={{fontWeight:700,color:b.cor}}>{b.nome.split(" ")[0]}</div><div style={{fontSize:11,color:"#aaa"}}>{b.ftot}pts</div></div></div><div style={{fontSize:18,fontWeight:800,color:b.cor}}>{R(b.totCBon)}</div><PB val={b.totC} max={b.metaB} cor={b.cor} pct/></div>)}</div>
  {calcB.map(b=><div key={b.id} className="card" style={{borderLeft:"4px solid "+b.cor}}><div style={{display:"flex",alignItems:"center",gap:10}}><BAv b={getB(b.id)} size={28}/><div style={{flex:1}}><div style={{fontWeight:600}}>{b.nome}{isBarb&&b.id===user.bId&&" ← você"}</div><div style={{fontSize:11,color:"#aaa"}}>{b.ftot}pts · {b.atend} atend</div></div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:700,color:b.cor}}>{R(b.totCBon)}</div><DB v={b.crescB}/></div></div><PB val={b.totC} max={b.metaB} cor={b.cor} pct lg style={{marginTop:8}}/></div>)}
</div>}

{/* ─── GAMIFICAÇÃO ─── */}
{aba==="game"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  {isDono&&<div className="card"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div className="st" style={{marginBottom:0}}>Níveis</div>{editNv?<div style={{display:"flex",gap:8}}><button className="btn bsm" onClick={()=>{setNiveis(nvTmp);setEditNv(false);}}>Salvar</button><button className="bg bsm" onClick={()=>setEditNv(false)}>Cancelar</button></div>:<button className="bg" onClick={()=>{setNvTmp([...niveis]);setEditNv(true);}}>Editar</button>}</div>{editNv?nvTmp.map((n,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:7,alignItems:"center"}}><span style={{fontSize:18}}>{n.icon}</span><input className="inp" style={{flex:1,fontSize:12,padding:"4px 7px"}} value={n.nome} onChange={e=>setNvTmp(l=>l.map((x,j)=>j===i?{...x,nome:e.target.value}:x))}/><input type="number" className="inp" style={{flex:1,fontSize:12,padding:"4px 7px"}} value={n.valor} onChange={e=>setNvTmp(l=>l.map((x,j)=>j===i?{...x,valor:+e.target.value||0}:x))}/></div>):<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{niveis.map((n,i)=><div key={i} style={{flex:1,minWidth:80,background:n.cor+"12",border:"1px solid "+n.cor+"30",borderRadius:8,padding:10,textAlign:"center"}}><div style={{fontSize:22}}>{n.icon}</div><div style={{fontWeight:700,color:n.cor,fontSize:12}}>{n.nome}</div><div style={{fontSize:11,color:"#888"}}>{R(n.valor)}</div></div>)}</div>}</div>}
  <div className="card"><div className="st">Ranking · {MESES[mes]}</div>{calcB.map((b,i)=><div key={b.id} style={{marginBottom:12,padding:"10px 12px",background:i===0?b.cor+"08":"#fafafa",borderRadius:8,border:"1px solid "+(i===0?b.cor+"30":"#f0f0f5")}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><span style={{fontSize:20,width:26,textAlign:"center"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</span><BAv b={getB(b.id)} size={32}/><div style={{flex:1}}><div style={{fontWeight:600}}>{b.nome.split(" ")[0]+(isBarb&&b.id===user.bId?" 👈":"")+(b.nvAt?" "+b.nvAt.icon:"")}</div><div style={{fontSize:11,color:"#aaa"}}>🔥{b.streak}d · {b.ftot}pts</div></div><div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:700,color:b.cor}}>{R(b.totCBon)}</div><DB v={b.crescB}/></div></div><PB val={b.totCBon} max={maxC} cor={b.cor} pct={false}/></div>)}</div>
  <div className="card"><div className="st">🚀 Ranking por evolução (vs mês anterior)</div>{[...calcB].sort((a,b2)=>b2.crescB-a.crescB).map((b,i)=><div key={b.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"7px 8px",background:i===0?"#dcfce7":"#fafafa",borderRadius:7}}><span style={{width:22,textAlign:"center",fontSize:15}}>{i===0?"🚀":i+1}</span><BAv b={getB(b.id)} size={28}/><span style={{flex:1,fontSize:13,fontWeight:600}}>{b.nome.split(" ")[0]+(isBarb&&b.id===user.bId?" 👈":"")}</span><DB v={b.crescB}/></div>)}</div>
</div>}

{/* ─── INTELIGÊNCIA ─── */}
{aba==="intel"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card"><div className="st">Acumulado vs meta</div><ResponsiveContainer width="100%" height={150}><AreaChart data={gDia.map((d,i)=>({...d,acum:gDia.slice(0,i+1).reduce((a,x)=>a+x.tot,0),meta2:(meta/dim)*(i+1)}))} margin={{top:4,right:4,left:-20,bottom:0}}><CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" vertical={false}/><XAxis dataKey="dia" tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} interval={3}/><YAxis tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>Math.round(v/1000)+"k"}/><Tooltip content={<CT/>} cursor={{fill:"#0e74900d"}}/><defs><linearGradient id="gAcum" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0e7490" stopOpacity={0.28}/><stop offset="100%" stopColor="#0e7490" stopOpacity={0}/></linearGradient></defs><Area type="monotone" dataKey="acum" name="Realizado" stroke="#0e7490" fill="url(#gAcum)" strokeWidth={2.4} dot={false} activeDot={{r:4,strokeWidth:2,stroke:"#fff"}}/><Area type="monotone" dataKey="meta2" name="Meta" stroke="#dc2626" fill="none" strokeWidth={1.5} strokeDasharray="4 4"/></AreaChart></ResponsiveContainer></div>
  <div className="card"><div className="st">📅 Filtrar período — Evolução por Barbeiro</div><div className="g2">
    <div><span className="lbl">De</span><div style={{display:"flex",gap:6}}><select className="inp" value={histDe.m} onChange={e=>setHistDe(h=>({...h,m:+e.target.value}))}>{MESES.map((mm,i)=><option key={i} value={i}>{mm}</option>)}</select><select className="inp" value={histDe.a} onChange={e=>setHistDe(h=>({...h,a:+e.target.value}))}>{[ano-2,ano-1,ano].map(a=><option key={a} value={a}>{a}</option>)}</select></div></div>
    <div><span className="lbl">Até</span><div style={{display:"flex",gap:6}}><select className="inp" value={histAte.m} onChange={e=>setHistAte(h=>({...h,m:+e.target.value}))}>{MESES.map((mm,i)=><option key={i} value={i}>{mm}</option>)}</select><select className="inp" value={histAte.a} onChange={e=>setHistAte(h=>({...h,a:+e.target.value}))}>{[ano-2,ano-1,ano].map(a=><option key={a} value={a}>{a}</option>)}</select></div></div>
  </div></div>
  <div className="card"><div className="st">📊 Histórico — período selecionado (Total)</div><ResponsiveContainer width="100%" height={150}><BarChart data={histRange} margin={{top:8,right:4,left:-18,bottom:0}} barCategoryGap="30%"><CartesianGrid strokeDasharray="4 4" stroke="#eef1f5" vertical={false}/><XAxis dataKey="label" tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false}/><YAxis tick={{fill:"#98a2b3",fontSize:10.5}} tickLine={false} axisLine={false} tickFormatter={v=>v>0?Math.round(v/1000)+"k":""}/><Tooltip content={<CT/>} cursor={{fill:"#0e74900d"}}/><Bar dataKey="total" name="Total" fill="#0e7490" radius={[6,6,0,0]} maxBarSize={46}/></BarChart></ResponsiveContainer></div>
  <div className="card"><div className="st">Evolução por Barbeiro — início vs fim do período</div>{barbs.map(b=>{const atual=histRange[histRange.length-1]?.perBarber.find(x=>x.id===b.id)?.total||0;const antigo=histRange[0]?.perBarber.find(x=>x.id===b.id)?.total||0;const varPct=antigo>0?((atual-antigo)/antigo)*100:0;return <div key={b.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"6px 8px",background:"#fafafa",borderRadius:7}}><BAv b={b} size={26}/><span style={{flex:1,fontSize:13,fontWeight:600}}>{b.nome.split(" ")[0]}</span><span style={{fontSize:11,color:"#888"}}>{R(antigo)} → {R(atual)}</span><DB v={varPct}/></div>;})}</div>
</div>}

{/* ─── ESTOQUE ─── */}
{aba==="estoque"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="g3"><KPI lbl="Produtos" val={prodLst.length} cor="#0e7490" glow/><KPI lbl="Sem estoque" val={prodLst.filter(p=>p.comissao>0&&(estoque[p.nome]||0)===0).length} cor="#dc2626"/><KPI lbl="Estoque baixo" val={prodLst.filter(p=>p.comissao>0&&(estoque[p.nome]||0)>0&&(estoque[p.nome]||0)<=2).length} cor="#d97706"/></div>
  {[{titulo:"Pomadas",f:p=>p.comissao>0&&p.nome.toLowerCase().includes("pomada")},{titulo:"Grooming",f:p=>p.comissao>0&&p.nome.toLowerCase().includes("grooming")},{titulo:"Cuidados & Cabelo",f:p=>p.comissao>0&&!p.nome.toLowerCase().includes("pomada")&&!p.nome.toLowerCase().includes("grooming")},{titulo:"Bebidas",f:p=>p.comissao===0}].map(({titulo,f})=>{const ps=prodLst.filter(f);if(!ps.length)return null;return <div key={titulo} className="card"><div className="st">{titulo}</div>{ps.map((p,i)=><div key={i} className="row"><div style={{flex:2,fontSize:12}}>{p.nome}</div><span style={{fontSize:11,color:"#888"}}>{R(p.v)}</span><div style={{display:"flex",alignItems:"center",gap:8}}><button className="bg bsm" style={{padding:"3px 9px",fontWeight:700}} onClick={()=>setEstoque(e=>({...e,[p.nome]:Math.max(0,(e[p.nome]||0)-1)}))} disabled={(estoque[p.nome]||0)===0}>−</button><span style={{minWidth:28,textAlign:"center",fontWeight:700,color:(estoque[p.nome]||0)===0?"#dc2626":(estoque[p.nome]||0)<=2?"#d97706":"#059669",fontSize:14}}>{estoque[p.nome]||0}</span><button className="bg bsm" style={{padding:"3px 9px",fontWeight:700}} onClick={()=>setEstoque(e=>({...e,[p.nome]:(e[p.nome]||0)+1}))}>+</button></div></div>)}</div>;})}
</div>}

{/* ─── IMPORTAR EXCEL ─── */}
{aba==="pdf"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card" style={{borderLeft:"3px solid #0e7490"}}><div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Importação AppBarber</div><div style={{fontSize:12,color:"#555"}}>Relatório "Ranking Profissional x Serviço" exportado em Excel (.xlsx)</div></div>
  {hasPdfMes()&&<div className="card" style={{borderLeft:"3px solid #dc2626",background:"#fef2f2"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}><div><div style={{fontWeight:700,color:"#dc2626",fontSize:13}}>🗑 Importação de {MESES[mes]} ativa</div></div><div style={{display:"flex",gap:8}}>{lastImportIds&&(lastImportIds.svcs.length||lastImportIds.avul.length||lastImportIds.extras.length||lastImportIds.prod.length)>0&&<button className="btn bsm" style={{background:"#d97706"}} onClick={excluirUltimoImport}>↩️ Excluir só o último</button>}<button className="btn bsm" style={{background:"#dc2626"}} onClick={limparTudoPdf}>Excluir tudo</button></div></div></div>}
  {importHistory.length>0&&<div className="card"><div className="st">📋 Relatório das últimas importações</div>{importHistory.map(h=>{const totalH=h.fichas+h.avulsos+h.extras+h.produtos;return <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"9px 10px",background:"#fafafa",borderRadius:8,flexWrap:"wrap"}}>
    <div style={{flex:1,minWidth:120}}><div style={{fontWeight:600,fontSize:13}}>{h.dt}</div><div style={{fontSize:11,color:"#888"}}>{totalH} registro{totalH!==1?"s":""}</div></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:11}}>
      {h.fichas>0&&<span style={{color:"#d97706",fontWeight:600}}>{h.fichas} fichas</span>}
      {h.avulsos>0&&<span style={{color:"#0e7490",fontWeight:600}}>{h.avulsos} avulsos</span>}
      {h.extras>0&&<span style={{color:"#0284c7",fontWeight:600}}>{h.extras} extras</span>}
      {h.produtos>0&&<span style={{color:"#059669",fontWeight:600}}>{h.produtos} produtos</span>}
    </div>
    <button className="bg bsm" onClick={()=>excluirImportHist(h.id)}>🗑 Excluir</button>
  </div>;})}</div>}
  <div className="card"><div className="st">Selecionar arquivo</div>
    <div style={{border:"2px dashed #e0e0f0",borderRadius:10,padding:"22px",textAlign:"center",background:"#fafafe",cursor:"pointer",position:"relative"}} onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#0e7490";}} onDragLeave={e=>{e.currentTarget.style.borderColor="#e0e0f0";}} onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#e0e0f0";const f=e.dataTransfer.files[0];if(f){setPdfFile(f);setPdfParsed(null);setPdfApplied(false);setPdfEdit(null);setPdfErr("");setPdfProgress(0);}}}>
      <input type="file" accept=".xlsx,.xls" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}} onChange={e=>{const f=e.target.files[0];if(f){setPdfFile(f);setPdfParsed(null);setPdfApplied(false);setPdfEdit(null);setPdfErr("");setPdfProgress(0);}e.target.value="";}}/>
      {pdfFile?<div><div style={{fontSize:32}}>📊</div><div style={{fontWeight:600,color:"#059669",marginTop:4}}>{pdfFile.name}</div><div style={{fontSize:11,color:"#888"}}>{(pdfFile.size/1024).toFixed(0)} KB</div></div>:<div><div style={{fontSize:32}}>⬆️</div><div style={{fontWeight:600,color:"#0e7490",fontSize:14,marginTop:4}}>Excel (.xlsx) — clique ou arraste</div></div>}
    </div>
    {pdfLoading&&<div style={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,color:"#0e7490",fontWeight:600}}>{pdfProgress<40?"Lendo planilha...":pdfProgress<90?"Classificando registros...":"Finalizando..."}</span><span style={{fontSize:12,color:"#0e7490",fontWeight:700}}>{pdfProgress}%</span></div><div style={{background:"#f0f0f5",borderRadius:4,height:8}}><div style={{height:8,borderRadius:4,background:"linear-gradient(90deg,#0e7490,#0284c7)",width:pdfProgress+"%",transition:"width .4s"}}/></div></div>}
    {pdfErr&&<div style={{marginTop:10,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#dc2626"}}>{pdfErr}</div>}
    <div style={{marginTop:12,display:"flex",gap:8}}><button className="btn" disabled={!pdfFile||pdfLoading} onClick={runImport}>{pdfLoading?"Analisando...":"Analisar"}</button>{pdfFile&&!pdfLoading&&<button className="bg" onClick={()=>{setPdfFile(null);setPdfParsed(null);setPdfApplied(false);setPdfEdit(null);setPdfErr("");setPdfProgress(0);}}>Limpar</button>}</div>
  </div>
  {pdfParsed&&!pdfApplied&&<><div className="card" style={{border:"2px solid #bbf7d0",background:"#f0fdf4"}}><div style={{fontWeight:700,color:"#059669",marginBottom:10}}>✅ {pdfParsed.total} registros lidos</div><div className="g4">{[{l:"FICHAS",v:pdfParsed.fichas.length,c:"#d97706"},{l:"AVULSOS",v:pdfParsed.avulsos.length,c:"#0e7490"},{l:"EXTRAS",v:pdfParsed.extras.length,c:"#0284c7"},{l:"PRODUTOS",v:(pdfParsed.produtos||[]).length,c:"#059669"}].map((k,i)=><div key={i} style={{background:"#fff",border:"1px solid #e0e0f0",borderRadius:8,padding:"9px 12px",textAlign:"center"}}><div style={{fontSize:10,color:k.c,fontWeight:700,marginBottom:2}}>{k.l}</div><div style={{fontSize:22,fontWeight:800,color:k.c}}>{k.v}</div></div>)}</div></div>
  <div className="card">
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div className="st" style={{marginBottom:0}}>🔧 Ajustar quantidades antes de aplicar</div>
      <button className="bg bsm" onClick={()=>setEditQtdOpen(o=>!o)}>{editQtdOpen?"Ocultar":"Editar"}</button>
    </div>
    {editQtdOpen&&<div>
      {["fichas","avulsos","extras","produtos"].map(cat=>(pdfEdit?.[cat]||[]).length>0&&<div key={cat} style={{marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",marginBottom:4}}>{cat}</div>
        {pdfEdit[cat].map((r,idx)=><div key={idx} className="row"><div style={{flex:1,fontSize:12}}>{r.svc||r.prod}{r.prof?" · "+r.prof:""}</div><div style={{display:"flex",alignItems:"center",gap:6}}><button className="bg bsm" onClick={()=>setPdfEdit(pe=>({...pe,[cat]:pe[cat].map((x,j)=>j===idx?{...x,qtdEdit:Math.max(1,(x.qtdEdit||1)-1)}:x)}))}>−</button><span style={{minWidth:20,textAlign:"center",fontWeight:700}}>{r.qtdEdit||1}</span><button className="bg bsm" onClick={()=>setPdfEdit(pe=>({...pe,[cat]:pe[cat].map((x,j)=>j===idx?{...x,qtdEdit:(x.qtdEdit||1)+1}:x)}))}>+</button></div></div>)}
      </div>)}
    </div>}
  </div>
  <div className="card" style={{border:"2px solid #0e7490",background:"#ecfeff"}}><div style={{fontWeight:700,color:"#0e7490",marginBottom:8}}>Aplicar ao mês de {MESES[mes]} {ano}</div><button className="btn" style={{padding:"10px 28px"}} onClick={applyPdf}>✅ Aplicar todos</button></div></>}
  {pdfApplied&&<div className="card" style={{border:"2px solid #bbf7d0",background:"#f0fdf4",textAlign:"center",padding:24}}><div style={{fontSize:40,marginBottom:8}}>🎉</div><div style={{fontWeight:800,fontSize:17,color:"#059669",marginBottom:4}}>Registros aplicados!</div><div style={{display:"flex",gap:10,justifyContent:"center",marginTop:10}}><button className="btn" onClick={()=>setAba("barb")}>Ver Barbeiro</button><button className="bg" onClick={()=>{setPdfFile(null);setPdfParsed(null);setPdfApplied(false);setPdfEdit(null);setPdfProgress(0);}}>Importar outro</button></div></div>}
</div>}

{/* ─── CONFIG ─── */}
{aba==="cfg"&&isDono&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
  <div className="card" style={{borderLeft:"3px solid #0e7490"}}><div className="st">🏢 Empresa</div><div className="g2"><div><span className="lbl">CNPJ Barbearia</span><input className="inp" value={cnpj} onChange={e=>setCnpj(e.target.value)}/></div><div><span className="lbl">Meta mensal</span><div style={{display:"flex",gap:6}}><input className="inp" type="number" value={metaI} onChange={e=>setMetaI(e.target.value)}/><button className="btn bsm" onClick={()=>setMeta(parseFloat(metaI)||meta)}>OK</button></div></div></div>
  </div>
  <div className="card" style={{borderLeft:"3px solid #0e7490"}}>
    <div className="st">🖼️ Logo da barbearia</div>
    <div style={{fontSize:12,color:"#888",marginBottom:14}}>Aparece no menu lateral do app. Use uma imagem quadrada ou horizontal, de preferência com fundo transparente.</div>
    <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
      <div style={{width:160,height:160,borderRadius:14,background:"#111",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0,border:"1px solid #e0e0f0"}}>{orgLogoUrl?<img src={orgLogoUrl} alt="" style={{maxWidth:"85%",maxHeight:"85%"}}/>:<span style={{color:"#fff",fontSize:44,fontWeight:800}}>{orgNome?.charAt(0)}</span>}</div>
      <div style={{flex:1,minWidth:180}}>
        <label className="btn" style={{cursor:"pointer",display:"inline-block"}}>{logoUploading?"Enviando...":"⬆️ Enviar novo logo"}<input type="file" accept="image/*" style={{display:"none"}} onChange={uploadLogo} disabled={logoUploading}/></label>
        {logoErr&&<div style={{marginTop:8,fontSize:12,color:"#dc2626"}}>{logoErr}</div>}
        {!orgLogoUrl&&<div style={{marginTop:8,fontSize:11,color:"#aaa"}}>Sem logo ainda — mostrando a inicial do nome da barbearia.</div>}
      </div>
    </div>
  </div>
  <div className="card" style={{borderLeft:"3px solid #059669"}}><div className="st">💰 Taxas</div><div className="g2"><div><span className="lbl">Barbeiro (%)</span><input type="number" className="inp" value={txB} onChange={e=>{const v=+e.target.value||0;setTxB(v);setTxBar(100-v);}}/></div><div><span className="lbl">Barbearia (%)</span><input type="number" className="inp" value={txBar} onChange={e=>{const v=+e.target.value||0;setTxBar(v);setTxB(100-v);}}/></div></div><div style={{marginTop:8,fontSize:12,color:txB+txBar===100?"#059669":"#dc2626",fontWeight:600}}>{txB+txBar===100?"✓ Total 100%":"⚠️ "+( txB+txBar)+"%"}</div></div>
  <div className="card" style={{borderLeft:"3px solid #0284c7"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div className="st" style={{marginBottom:0}}>💈 Barbeiros, metas e CNPJ</div>{editNm?<div style={{display:"flex",gap:8}}><button className="btn bsm" onClick={salvNomes}>Salvar</button><button className="bg bsm" onClick={()=>setEditNm(false)}>Cancelar</button></div>:<button className="bg" onClick={()=>{setNmsT(barbs.map(b=>b.nome));setMetT(barbs.map(b=>b.meta));setEditNm(true);}}>Editar</button>}</div>
    {barbs.length===0&&<div style={{color:"#ccc",fontSize:12,padding:"10px 0"}}>Nenhum barbeiro cadastrado ainda.</div>}
    {barbs.map((b,i)=><div key={b.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap",padding:"8px 0",borderBottom:"1px solid #f0f0f5"}}><div style={{width:12,height:12,borderRadius:"50%",background:b.cor,flexShrink:0}}/><BAv b={b} size={24}/>{editNm?<><input className="inp" style={{flex:2,fontSize:12,padding:"5px 8px"}} value={nmsT[i]} onChange={e=>{const n=[...nmsT];n[i]=e.target.value;setNmsT(n);}}/><input className="inp" style={{flex:1,fontSize:12,padding:"5px 8px"}} type="number" value={metT[i]} onChange={e=>{const n=[...metT];n[i]=e.target.value;setMetT(n);}}/><input className="inp" style={{flex:2,fontSize:12,padding:"5px 8px"}} placeholder="CNPJ" value={b.cnpj||""} onChange={e=>setBarbs(bs=>bs.map((x,j)=>j===i?{...x,cnpj:e.target.value}:x))}/><input className="inp" style={{width:44,fontSize:16,padding:"4px 6px"}} type="color" value={b.cor} onChange={e=>setBarbs(bs=>bs.map((x,j)=>j===i?{...x,cor:e.target.value}:x))}/><button className="bdel" onClick={()=>removeBarbeiro(b.id,i)}>×</button></>:<><span style={{fontWeight:600,fontSize:13,flex:1}}>{b.nome}</span><span style={{fontSize:11,color:"#aaa"}}>Meta: {R(b.meta)}</span><span style={{fontSize:11,color:"#0e7490",fontFamily:"monospace"}}>{b.cnpj||"—"}</span></>}</div>)}
    {editNm&&<button className="bg bsm" style={{marginTop:4}} onClick={addBarbeiro}>+ Adicionar barbeiro</button>}
    <div style={{marginTop:8}}><span className="lbl">Histórico de metas (últimas alterações)</span>{metaHist.length===0?<div style={{color:"#ccc",fontSize:12}}>Nenhuma alteração registrada ainda.</div>:metaHist.slice(0,10).map(h=><div key={h.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",fontSize:12,color:"#555"}}><span>{(getB(h.bId)||{nome:"?"}).nome.split(" ")[0]}</span><span>{R(h.valor)}</span><span style={{color:"#aaa"}}>{new Date(h.dt+"T12:00:00").toLocaleDateString("pt-BR")}</span></div>)}</div>
  </div>
  <div className="card" style={{borderLeft:"3px solid #059669"}}><div className="st">🎁 Metas de bonificação</div>{metasBon.map((m,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center",flexWrap:"wrap",padding:"8px 10px",background:"#fafafe",borderRadius:7}}><span style={{flex:2,fontSize:12,fontWeight:600}}>{m.nome}</span><div style={{flex:1,minWidth:60}}><span className="lbl">Meta</span><input type="number" className="inp" style={{fontSize:12,padding:"4px 7px"}} value={m.meta} onChange={e=>setMetasBon(l=>l.map((x,j)=>j===i?{...x,meta:+e.target.value||0}:x))}/></div><div style={{flex:1,minWidth:60}}><span className="lbl">Bônus R$</span><input type="number" className="inp" style={{fontSize:12,padding:"4px 7px"}} value={m.bon} onChange={e=>setMetasBon(l=>l.map((x,j)=>j===i?{...x,bon:+e.target.value||0}:x))}/></div><div style={{flex:1,minWidth:60}}><span className="lbl">R$/unit</span><input type="number" className="inp" style={{fontSize:12,padding:"4px 7px"}} value={m.vUnit||20} onChange={e=>setMetasBon(l=>l.map((x,j)=>j===i?{...x,vUnit:+e.target.value||0}:x))}/></div></div>)}</div>
  <div className="card" style={{borderLeft:"3px solid #059669"}}><div className="st">🛍️ Produtos</div><div style={{maxHeight:300,overflowY:"auto"}}>{prodLst.map((p,i)=><div key={i} style={{display:"flex",gap:6,marginBottom:6,alignItems:"center",flexWrap:"wrap"}}><input className="inp" style={{flex:3,fontSize:11,padding:"4px 7px"}} value={p.nome} onChange={e=>setProdLst(l=>l.map((x,j)=>j===i?{...x,nome:e.target.value}:x))}/><input type="number" className="inp" style={{flex:1,fontSize:11,padding:"4px 7px"}} value={p.v} onChange={e=>setProdLst(l=>l.map((x,j)=>j===i?{...x,v:+e.target.value||0}:x))}/><span style={{fontSize:11,color:"#888"}}>Com%</span><input type="number" className="inp" style={{flex:1,fontSize:11,padding:"4px 7px"}} value={Math.round(p.comissao*100)} onChange={e=>setProdLst(l=>l.map((x,j)=>j===i?{...x,comissao:(+e.target.value||0)/100}:x))}/><button className="bdel" onClick={()=>setProdLst(l=>l.filter((_,j)=>j!==i))}>×</button></div>)}</div><button className="bg bsm" style={{marginTop:8}} onClick={()=>setProdLst(l=>[...l,{nome:"Novo Produto",v:0,comissao:0.20}])}>+ Adicionar produto</button></div>
  <div className="card" style={{borderLeft:"3px solid #6b7280"}}><div className="st">🧾 Log de auditoria (últimas ações)</div><div style={{maxHeight:260,overflowY:"auto"}}>{auditLog.length===0?<div style={{color:"#ccc",fontSize:12}}>Nenhuma ação registrada ainda.</div>:auditLog.slice(0,50).map(a=><div key={a.id} className="row"><span style={{width:20}}>{a.icon}</span><span style={{flex:1,fontSize:12}}>{a.msg}</span><span style={{fontSize:11,color:"#aaa"}}>{a.dt}</span></div>)}</div></div>
  <div className="card" style={{borderLeft:"3px solid #059669",background:"#f0fdf4"}}><div className="st" style={{color:"#059669"}}>💾 Backup & Restaurar</div><div style={{fontSize:12,color:"#555",marginBottom:10}}>Salve um arquivo JSON com todos os dados. Se perder tudo, restaure aqui.</div><div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}><button className="btn" style={{background:"#059669"}} onClick={exportarBackup}>⬇️ Exportar Backup</button><label className="btn" style={{background:"#0284c7",cursor:"pointer"}}>⬆️ Restaurar Backup<input type="file" accept=".json" style={{display:"none"}} onChange={importarBackup}/></label></div></div>
  <div className="card" style={{borderLeft:"3px solid #dc2626",background:"#fef2f2"}}><div className="st" style={{color:"#dc2626"}}>⚠️ Zona de risco</div><div className="g3"><button className="btn bsm" style={{background:"#dc2626"}} onClick={()=>{if(window.confirm("Zerar TUDO?")){
    excluirRemoto("svcs",svcs.map(x=>x.id));excluirRemoto("avul",avul.map(x=>x.id));excluirRemoto("ext",ext.map(x=>x.id));excluirRemoto("extAv",extAv.map(x=>x.id));excluirRemoto("prod",prod.map(x=>x.id));excluirRemoto("pote",pote.map(x=>x.id));excluirRemoto("lote",lote.map(x=>x.id));excluirRemoto("assinV",assinV.map(x=>x.id));excluirRemoto("vales",vales.map(x=>x.id));
    setSvcs([]);setAvul([]);setExt([]);setExtAv([]);setProd([]);setPote([]);setLote([]);setAssinV([]);setVales([]);addNotif("🗑","Dados apagados!");
  }}}>🗑 Zerar tudo</button><button className="btn bsm" style={{background:"#dc2626"}} onClick={()=>{if(window.confirm("Zerar mês de "+MESES[mes]+"?")){
    excluirRemoto("svcs",svcs.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("avul",avul.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("ext",ext.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("extAv",extAv.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("prod",prod.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("pote",pote.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("lote",lote.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("assinV",assinV.filter(s=>noM(s.dt)).map(x=>x.id));excluirRemoto("vales",vales.filter(s=>noM(s.dt)).map(x=>x.id));
    setSvcs(v=>v.filter(s=>!noM(s.dt)));setAvul(v=>v.filter(s=>!noM(s.dt)));setExt(v=>v.filter(s=>!noM(s.dt)));setExtAv(v=>v.filter(s=>!noM(s.dt)));setProd(v=>v.filter(s=>!noM(s.dt)));setPote(v=>v.filter(s=>!noM(s.dt)));setLote(v=>v.filter(s=>!noM(s.dt)));setAssinV(v=>v.filter(s=>!noM(s.dt)));setVales(v=>v.filter(s=>!noM(s.dt)));addNotif("🗑","Mês apagado!");
  }}}>🗑 Zerar {MESES[mes]}</button><button className="btn bsm" style={{background:"#d97706"}} onClick={()=>{if(window.confirm("Resetar config?")){setNiveis(niveis);setMetasBon(metasBon);setTxB(45);setTxBar(55);addNotif("🔄","Config resetada!");}}}>🔄 Reset taxas</button></div></div>
</div>}

      </div>
    </div>
  </div>;
}
