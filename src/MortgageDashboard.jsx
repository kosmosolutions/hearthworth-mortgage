import { useState, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";

// Dynamic PMI: auto-computed from LTV, drops to $0 at 80% LTV
// Typical rates: 0.6%/yr for 80-85%, 0.8% for 85-90%, 1.0% for 90-95%, 1.2% for 95%+
function computePMI(loanBalance, homeValue) {
  const ltv = homeValue > 0 ? loanBalance / homeValue : 0;
  if (ltv <= 0.80) return 0;
  const annualRate = ltv <= 0.85 ? 0.006 : ltv <= 0.90 ? 0.008 : ltv <= 0.95 ? 0.010 : 0.012;
  return Math.round(loanBalance * annualRate / 12);
}

// Find month when PMI drops off (LTV crosses 80%)
function pmiDropOffMonth(loanBalance, homeValue, permRate, remainingMonths) {
  const threshold = homeValue * 0.80;
  if (loanBalance <= threshold) return 0; // already below 80%
  const pmt = mpmt(loanBalance, permRate, remainingMonths);
  let bal = loanBalance;
  for (let m = 1; m <= remainingMonths; m++) {
    const i = bal * (permRate / 100 / 12);
    bal = Math.max(bal - (pmt - i), 0);
    if (bal <= threshold) return m;
  }
  return null; // never drops off in remaining term
}
const TABS = ["Overview", "Amortization", "Refi", "Payoff Planner"];
const SC_COLORS = ["#6366f1","#10b981","#f59e0b","#f87171","#38bdf8","#a78bfa","#fb7185","#34d399","#fbbf24","#60a5fa"];

// Product categories with full industry product list
// phases: [{months, offset}] — offset from noteRate during that phase
// For ARMs: phases covers the fixed intro period at noteRate, then armAdj covers assumed rate after
const PRODUCT_GROUPS = [
  {
    group: "Conventional Fixed",
    color: "#6366f1",
    products: [
      { id:"fixed10",   label:"Fixed 10-Year",       term:120, phases:[], tag:"🏦" },
      { id:"fixed15",   label:"Fixed 15-Year",       term:180, phases:[], tag:"🏦" },
      { id:"fixed20",   label:"Fixed 20-Year",       term:240, phases:[], tag:"🏦" },
      { id:"fixed25",   label:"Fixed 25-Year",       term:300, phases:[], tag:"🏦" },
      { id:"fixed30",   label:"Fixed 30-Year",       term:360, phases:[], tag:"🏦" },
    ]
  },
  {
    group: "Buydown (Seller/Lender Credit)",
    color: "#10b981",
    products: [
      { id:"buy10_15",  label:"1-0 Buydown 15yr",    term:180, phases:[{months:12,offset:-1}], tag:"📉" },
      { id:"buy10_30",  label:"1-0 Buydown 30yr",    term:360, phases:[{months:12,offset:-1}], tag:"📉" },
      { id:"buy210_15", label:"2-1-0 Buydown 15yr",  term:180, phases:[{months:12,offset:-2},{months:12,offset:-1}], tag:"📉" },
      { id:"buy210_30", label:"2-1-0 Buydown 30yr",  term:360, phases:[{months:12,offset:-2},{months:12,offset:-1}], tag:"📉" },
      { id:"buy321_30", label:"3-2-1 Buydown 30yr",  term:360, phases:[{months:12,offset:-3},{months:12,offset:-2},{months:12,offset:-1}], tag:"📉" },
    ]
  },
  {
    group: "Adjustable Rate (ARM)",
    color: "#f59e0b",
    products: [
      { id:"arm51_30",  label:"5/1 ARM 30yr",        term:360, phases:[{months:60,offset:0}], armAdj:2.0, tag:"🔄" },
      { id:"arm71_30",  label:"7/1 ARM 30yr",        term:360, phases:[{months:84,offset:0}], armAdj:1.5, tag:"🔄" },
      { id:"arm101_30", label:"10/1 ARM 30yr",       term:360, phases:[{months:120,offset:0}], armAdj:1.0, tag:"🔄" },
      { id:"arm51_15",  label:"5/1 ARM 15yr",        term:180, phases:[{months:60,offset:0}], armAdj:2.0, tag:"🔄" },
      { id:"arm71_15",  label:"7/1 ARM 15yr",        term:180, phases:[{months:84,offset:0}], armAdj:1.5, tag:"🔄" },
    ]
  },
  {
    group: "FHA",
    color: "#38bdf8",
    products: [
      { id:"fha30",     label:"FHA 30-Year Fixed",   term:360, phases:[], mip:0.55, downMin:3.5, tag:"🏛️" },
      { id:"fha15",     label:"FHA 15-Year Fixed",   term:180, phases:[], mip:0.55, downMin:3.5, tag:"🏛️" },
      { id:"fha_arm51", label:"FHA 5/1 ARM 30yr",    term:360, phases:[{months:60,offset:0}], armAdj:2.0, mip:0.55, tag:"🏛️" },
    ]
  },
  {
    group: "VA (Veterans)",
    color: "#a78bfa",
    products: [
      { id:"va30",      label:"VA 30-Year Fixed",    term:360, phases:[], noMI:true, fundingFee:2.15, tag:"🎖️" },
      { id:"va15",      label:"VA 15-Year Fixed",    term:180, phases:[], noMI:true, fundingFee:2.15, tag:"🎖️" },
      { id:"va_arm51",  label:"VA 5/1 ARM 30yr",     term:360, phases:[{months:60,offset:0}], armAdj:2.0, noMI:true, tag:"🎖️" },
      { id:"va_irrrl",  label:"VA IRRRL Refi",       term:360, phases:[], noMI:true, fundingFee:0.5, tag:"🎖️" },
    ]
  },
  {
    group: "USDA (Rural)",
    color: "#34d399",
    products: [
      { id:"usda30",    label:"USDA 30-Year Fixed",  term:360, phases:[], mip:0.35, upfrontFee:1.0, tag:"🌾" },
    ]
  },
  {
    group: "Jumbo",
    color: "#fb7185",
    products: [
      { id:"jumbo30",   label:"Jumbo Fixed 30yr",    term:360, phases:[], tag:"💎" },
      { id:"jumbo15",   label:"Jumbo Fixed 15yr",    term:180, phases:[], tag:"💎" },
      { id:"jumbo_arm51",  label:"Jumbo 5/1 ARM",   term:360, phases:[{months:60,offset:0}], armAdj:2.0, tag:"💎" },
      { id:"jumbo_arm71",  label:"Jumbo 7/1 ARM",   term:360, phases:[{months:84,offset:0}], armAdj:1.5, tag:"💎" },
      { id:"jumbo_arm101", label:"Jumbo 10/1 ARM",  term:360, phases:[{months:120,offset:0}], armAdj:1.0, tag:"💎" },
    ]
  },
  {
    group: "Refinance",
    color: "#fbbf24",
    products: [
      { id:"refi_rr15",  label:"Rate/Term Refi 15yr", term:180, phases:[], tag:"🔁" },
      { id:"refi_rr30",  label:"Rate/Term Refi 30yr", term:360, phases:[], tag:"🔁" },
      { id:"refi_co30",  label:"Cash-Out Refi 30yr",  term:360, phases:[], tag:"🔁" },
      { id:"refi_co15",  label:"Cash-Out Refi 15yr",  term:180, phases:[], tag:"🔁" },
      { id:"refi_fha",   label:"FHA Streamline Refi", term:360, phases:[], mip:0.55, tag:"🔁" },
      { id:"refi_va",    label:"VA IRRRL Refi",       term:360, phases:[], noMI:true, fundingFee:0.5, tag:"🔁" },
    ]
  },
];

// Flat list for lookup
const PRODUCTS = PRODUCT_GROUPS.flatMap(g => g.products.map(p => ({ ...p, group: g.group, groupColor: g.color })));

function mpmt(bal, rate, n) {
  const r = rate / 100 / 12;
  if (!r || !n) return bal / (n||1);
  return bal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
}
function amortize(balance, rate, months) {
  const r = rate/100/12, pmt = mpmt(balance,rate,months);
  let bal=balance, ti=0; const sched=[];
  for (let m=0;m<months;m++){
    const i=bal*r, p=pmt-i; ti+=i; bal=Math.max(bal-p,0);
    sched.push({month:m+1,balance:bal,interest:i,principal:p,cumInterest:ti});
  }
  return {totalInterest:ti,pmt,schedule:sched};
}
function amortizeBuydown(balance, buydownMonths, buydownRate, permRate, totalMonths) {
  const pmt45 = mpmt(balance, buydownRate, totalMonths);
  const r45 = buydownRate/100/12;
  let bal=balance, ti=0; const sched=[];
  const bd = Math.min(buydownMonths, totalMonths);
  for (let m=0;m<bd&&bal>0;m++){
    const i=bal*r45,p=pmt45-i; ti+=i; bal=Math.max(bal-p,0);
    sched.push({month:m+1,balance:bal,interest:i,principal:p,cumInterest:ti,phase:"Buydown"});
  }
  const permN = totalMonths - bd;
  const pmt55 = mpmt(bal, permRate, permN);
  const r55 = permRate/100/12;
  for (let m=0;m<permN&&bal>0;m++){
    const i=bal*r55,p=pmt55-i; ti+=i; bal=Math.max(bal-p,0);
    sched.push({month:bd+m+1,balance:bal,interest:i,principal:p,cumInterest:ti,phase:"Permanent"});
  }
  return {pmt45,pmt55,totalInterest:ti,schedule:sched};
}

// Product-aware amortization that handles arbitrary phase counts (1-0, 2-1-0, 3-2-1, ARMs)
// Auto-derives all phase rates from product definition + permRate + monthsElapsed
function amortizeFromToday({originalBalance, product, permRate, monthsElapsed=0, armAdjOverride}) {
  const term = product.term;
  const isARM = product.armAdj != null;
  const armAdj = armAdjOverride != null ? armAdjOverride : product.armAdj;
  const phases = (product.phases||[]).map(p => ({months:p.months, rate:permRate+p.offset}));
  const tailMonths = term - phases.reduce((a,p)=>a+p.months,0);
  const tailRate = isARM ? permRate + armAdj : permRate;
  const allPhases = [...phases, {months: tailMonths, rate: tailRate}];

  // Determine current phase based on monthsElapsed
  let cumStart = 0, currentPhaseIdx = 0;
  for (let i=0; i<allPhases.length; i++) {
    if (monthsElapsed < cumStart + allPhases[i].months) { currentPhaseIdx = i; break; }
    cumStart += allPhases[i].months;
    currentPhaseIdx = i;
  }

  // Simulate full term to get balance at every month
  let bal = originalBalance, ti = 0, done = 0;
  const fullSchedule = [];
  for (let pi = 0; pi < allPhases.length; pi++) {
    const ph = allPhases[pi], r = ph.rate/100/12, rem = term - done;
    if (rem <= 0 || bal <= 0) break;
    const isLast = pi === allPhases.length-1;
    const n = isLast ? rem : Math.min(ph.months, rem);
    const pmt = mpmt(bal, ph.rate, rem);
    for (let m=0; m<n && done<term && bal>0; m++) {
      const i = bal*r, p = Math.min(pmt-i, bal);
      ti += i;
      bal = Math.max(bal - p, 0);
      done++;
      fullSchedule.push({month:done, balance:bal, interest:i, principal:p, cumInterest:ti, rate:ph.rate, phaseIdx:pi, pmt});
    }
  }

  // Future schedule = from today onward
  const futureSchedule = fullSchedule.slice(monthsElapsed);
  const interestPaidSoFar = monthsElapsed > 0 ? (fullSchedule[monthsElapsed - 1]?.cumInterest || 0) : 0;
  const totalInterestRemaining = ti - interestPaidSoFar;
  const currentBalance = monthsElapsed > 0 ? (fullSchedule[monthsElapsed - 1]?.balance || originalBalance) : originalBalance;

  // Build pmtList for remaining phases (from current phase onward)
  const pmtList = [];
  for (let pi = currentPhaseIdx; pi < allPhases.length; pi++) {
    const phaseEntries = futureSchedule.filter(s => s.phaseIdx === pi);
    if (phaseEntries.length === 0) continue;
    pmtList.push({
      rate: allPhases[pi].rate,
      pmt: phaseEntries[0].pmt,
      months: phaseEntries.length,
      isARM: isARM && pi === allPhases.length-1 && phases.length > 0,
      isCurrent: pi === currentPhaseIdx,
    });
  }

  // Compatibility: pmt45 = current phase pmt, pmt55 = perm phase pmt
  const pmt45 = pmtList[0]?.pmt || 0;
  const pmt55 = pmtList[pmtList.length-1]?.pmt || 0;

  // Reconstruct schedule with month numbers from 1 (so existing UI works)
  const remappedSchedule = futureSchedule.map((s, i) => ({...s, month: i+1, cumInterest: s.cumInterest - interestPaidSoFar}));

  return {
    pmt45, pmt55,
    totalInterest: totalInterestRemaining,
    schedule: remappedSchedule,
    pmtList,
    currentBalance,
    currentPhaseIdx,
    allPhases,
    monthsElapsed,
    remainingMonths: term - monthsElapsed,
    isARM,
  };
}
function computeScenario({balance,credit,noteRate,product}) {
  const bal0=Math.max(balance-credit,0), term=product.term;
  // For ARMs: after fixed phase, rate = noteRate + armAdj (assumed worst-case adjustment)
  const isARM = product.armAdj != null;
  const phases = product.phases.map(p=>({months:p.months, rate:noteRate+p.offset}));
  // Add the tail phase (permanent or ARM-adjusted)
  const tailRate = isARM ? noteRate + product.armAdj : noteRate;
  const all=[...phases,{months:term,rate:tailRate}];
  let bal=bal0,ti=0,done=0; const sched=[];
  for (let pi=0;pi<all.length;pi++){
    const {months:nm,rate}=all[pi], r=rate/100/12, rem=term-done;
    if(rem<=0||bal<=0) break;
    const isLast=pi===all.length-1, n=isLast?rem:Math.min(nm,rem);
    const pmt=mpmt(bal,rate,rem);
    for(let m=0;m<n&&done<term&&bal>0;m++){
      const i=bal*r,p=Math.min(pmt-i,bal); ti+=i; bal=Math.max(bal-p,0); done++;
      sched.push({month:done,balance:bal,interest:i,principal:p,cumInterest:ti});
    }
    if(isLast) break;
  }
  let b2=bal0; const pmtList=[];
  for(let pi=0;pi<all.length;pi++){
    const {months:nm,rate}=all[pi], rem=term-pmtList.reduce((a,p)=>a+p.months,0);
    const pmt=mpmt(b2,rate,rem), r=rate/100/12, n=Math.min(nm,rem);
    pmtList.push({rate,pmt,months:n,isARM:isARM&&pi===all.length-1&&phases.length>0});
    for(let m=0;m<n&&b2>0;m++){const i=b2*r; b2=Math.max(b2-(pmt-i),0);}
    if(pi===all.length-1) break;
  }
  return {totalInterest:ti,schedule:sched,pmtList,balance:bal0,termMonths:term,noteRate,isARM};
}

const fmt = (n,d=0) => "$"+Number(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g,",");
const fmtK = n => n>=1000?"$"+(n/1000).toFixed(0)+"K":fmt(n);

const Card = ({children,style={}}) => (
  <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:14,padding:20,...style}}>{children}</div>
);
const SL = ({children,color="#6366f1"}) => (
  <div style={{fontSize:11,color,textTransform:"uppercase",letterSpacing:"0.12em",fontFamily:"DM Mono,monospace",marginBottom:12,fontWeight:500}}>{children}</div>
);
const StatBox = ({label,value,sub,color="#f1f5f9"}) => (
  <div style={{background:"#1e293b",borderRadius:10,padding:"14px 16px"}}>
    <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:5,fontFamily:"DM Mono,monospace"}}>{label}</div>
    <div style={{fontSize:20,fontWeight:700,color,fontFamily:"Fraunces,Georgia,serif"}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:"#475569",marginTop:3}}>{sub}</div>}
  </div>
);
const TT = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"10px 14px"}}>
      <div style={{fontSize:11,color:"#64748b",marginBottom:5,fontFamily:"DM Mono,monospace"}}>Yr {label}</div>
      {payload.map((p,i)=><div key={i} style={{fontSize:12,color:p.color,fontFamily:"DM Mono,monospace"}}>{p.name}: {fmtK(p.value)}</div>)}
    </div>
  );
};

function SVGLineChart({series,height=240}) {
  const [tip,setTip]=useState(null);
  const W=600,H=height,PL=60,PR=16,PT=10,PB=32;
  const cW=W-PL-PR,cH=H-PT-PB;
  if(!series.length||!series[0].data.length) return null;

  // ── Derive range from ALL series, not just series[0] ──────────
  const allY=series.flatMap(s=>s.data.map(d=>d.y)).filter(v=>v!=null);
  const allXVals=series.flatMap(s=>s.data.map(d=>d.x));
  const minX=Math.min(...allXVals);
  const maxX=Math.max(...allXVals);
  const maxY=Math.max(...allY)*1.05;

  const sx=x=>PL+((x-minX)/(maxX-minX||1))*cW;
  const sy=y=>PT+cH-(y/(maxY||1))*cH;
  const yTicks=Array.from({length:6},(_,i)=>maxY*i/5);

  // Evenly-spaced x ticks — aim for ~8 ticks across full range
  const xRange = maxX - minX;
  const tickStep = xRange <= 10 ? 1 : xRange <= 20 ? 2 : xRange <= 30 ? 5 : 5;
  const xTicks = Array.from({length:Math.floor(xRange/tickStep)+1},(_,i)=>minX+i*tickStep).filter(x=>x<=maxX);
  // Always include the final year if not already present
  if(xTicks[xTicks.length-1] !== maxX) xTicks.push(maxX);

  // All unique x values across all series — for tooltip snapping
  const allXUniq=[...new Set(allXVals)].sort((a,b)=>a-b);

  const onMove=e=>{
    const rect=e.currentTarget.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width);
    const xVal=minX+((mx-PL)/cW)*(maxX-minX);
    if(xVal<minX||xVal>maxX){setTip(null);return;}
    const nx=allXUniq.reduce((a,b)=>Math.abs(b-xVal)<Math.abs(a-xVal)?b:a);
    setTip({x:sx(nx),xv:nx,pts:series.map(s=>({label:s.label,color:s.color,value:s.data.find(d=>d.x===nx)?.y}))});
  };
  return (
    <div style={{position:"relative"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}} onMouseMove={onMove} onMouseLeave={()=>setTip(null)}>
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line x1={PL} y1={sy(v)} x2={W-PR} y2={sy(v)} stroke="#1e293b" strokeWidth="1"/>
            <text x={PL-5} y={sy(v)+4} textAnchor="end" fill="#475569" fontSize="9" fontFamily="DM Mono,monospace">${(v/1000).toFixed(0)}K</text>
          </g>
        ))}
        {xTicks.map((x,i)=><text key={i} x={sx(x)} y={H-4} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="DM Mono,monospace">Yr {x}</text>)}
        {series.map((s,si)=>{
          const pts=s.data.filter(d=>d.y!=null);
          if(!pts.length) return null;
          const d=pts.map((p,i)=>`${i===0?"M":"L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
          return <path key={si} d={d} fill="none" stroke={s.color} strokeWidth={s.dashed?1.5:2} strokeDasharray={s.dashed?"5 3":"0"}/>;
        })}
        {tip&&<line x1={tip.x} y1={PT} x2={tip.x} y2={H-PB} stroke="#334155" strokeWidth="1" strokeDasharray="3 2"/>}
      </svg>
      {tip&&(
        <div style={{position:"absolute",top:10,left:Math.min(tip.x+10,W*0.6),pointerEvents:"none",background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"8px 12px",minWidth:170}}>
          <div style={{fontSize:10,color:"#64748b",fontFamily:"DM Mono,monospace",marginBottom:5}}>Yr {tip.xv}</div>
          {tip.pts.filter(p=>p.value!=null).map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:11,color:p.color,fontFamily:"DM Mono,monospace",marginBottom:2}}>
              <span style={{maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.label}</span>
              <span style={{fontWeight:600}}>${(p.value/1000).toFixed(0)}K</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenariosTab({baseline,loanBalance,permRate,remainingMonths,monthlyTaxes,monthlyPMI,monthlyInsurance,appliedProductId,buydownRate}) {
  const [scenarios,setScenarios]=useState([]);
  const [chartMode,setChartMode]=useState("balance");
  const add=()=>setScenarios(s=>[...s,{id:Date.now(),name:"",productId:"fixed30",noteRate:5.5,credit:0,closingCosts:8000,cashCredit:0,armAdj:2.0,filterGroup:"All",enabled:true}]);
  const remove=id=>setScenarios(s=>s.filter(x=>x.id!==id));
  const upd=(id,f,v)=>setScenarios(s=>s.map(x=>x.id===id?{...x,[f]:v}:x));
  const tog=id=>setScenarios(s=>s.map(x=>x.id===id?{...x,enabled:!x.enabled}:x));

  const computed=scenarios.map(sc=>{
    const baseProduct=PRODUCTS.find(p=>p.id===sc.productId)||PRODUCTS[0];
    const product=baseProduct.armAdj!=null?{...baseProduct,armAdj:sc.armAdj??baseProduct.armAdj}:baseProduct;
    const result=computeScenario({balance:loanBalance,credit:sc.credit||0,noteRate:sc.noteRate,product});

    // ── Closing cost metrics ──────────────────────────────────────────
    // netClosing can be negative when cashCredit > closingCosts (surplus credit adds to savings)
    const netClosing=(sc.closingCosts||0)-(sc.cashCredit||0);

    // Current loan: full remaining interest (pays off in remainingMonths)
    const currentTotalInterest=(()=>{
      const pmt=baseline.pmt55, r=permRate/100/12;
      let bal=loanBalance, ti=0;
      for(let m=0;m<remainingMonths&&bal>0;m++){const i=bal*r;ti+=i;bal=Math.max(bal-(pmt-i),0);}
      return ti;
    })();

    // New loan: FULL TERM total interest (what you'll pay over the entire product term)
    // This is already computed in result.totalInterest from computeScenario
    const newTotalInterest = result.totalInterest;

    // For the verdict/worthIt, still compare same horizon (fair apples-to-apples)
    const horizonMonths=Math.min(remainingMonths, product.term);
    const newInterestOverHorizon=(()=>{
      const phases=(product.phases||[]).map(p=>({months:p.months,rate:sc.noteRate+p.offset}));
      const tailRate=product.armAdj!=null?sc.noteRate+(sc.armAdj??product.armAdj):sc.noteRate;
      const allPhases=[...phases,{months:product.term,rate:tailRate}];
      let bal=Math.max(loanBalance-(sc.credit||0),0),ti=0,done=0;
      for(let pi=0;pi<allPhases.length;pi++){
        const {months:nm,rate}=allPhases[pi],r=rate/100/12,rem=product.term-done;
        if(rem<=0||bal<=0||done>=horizonMonths) break;
        const isLast=pi===allPhases.length-1,n=Math.min(isLast?rem:nm,horizonMonths-done);
        const pmt=mpmt(bal,rate,rem);
        for(let m=0;m<n&&done<horizonMonths&&bal>0;m++){
          const i=bal*r;ti+=i;bal=Math.max(bal-(pmt-i),0);done++;
        }
        if(isLast) break;
      }
      return ti;
    })();

    // Display: interest saved = current remaining vs new full term
    const interestSaved=currentTotalInterest-newTotalInterest;
    const trueSavings=interestSaved-netClosing;

    // Verdict: use same-horizon comparison to be fair
    const interestSavedHorizon=currentTotalInterest-newInterestOverHorizon;
    const trueSavingsHorizon=interestSavedHorizon-netClosing;

    // Monthly payment comparison
    const currentPermPmt=baseline.pmt55;
    const newPermPmt=result.pmtList[result.pmtList.length-1]?.pmt??0;
    const monthlySavings=currentPermPmt-newPermPmt;

    // Break-even: months to recoup closing costs via monthly savings
    // If netClosing <= 0 (credit covers/exceeds costs), break-even is instant
    const breakEvenMonths=(netClosing>0&&monthlySavings>0)?Math.ceil(netClosing/monthlySavings):0;

    // Loan extension flag: new term meaningfully longer than what you have left (>24mo)
    const extendsLoan=product.term-remainingMonths>24;

    // Worth it based on same-horizon true savings and break-even
    const worthIt=trueSavingsHorizon>0&&(breakEvenMonths===0||breakEvenMonths<remainingMonths)&&!extendsLoan;
    const marginal=!worthIt&&trueSavingsHorizon>0;

    return{...sc,product,result,netClosing,monthlySavings,breakEvenMonths,
      interestSaved,trueSavings,worthIt,marginal,extendsLoan,
      currentPermPmt,newPermPmt,horizonMonths,
      currentTotalInterest,newTotalInterest};
  });
  const active=computed.filter(s=>s.enabled!==false);
  const lbl=s=>s.name.trim()||`${s.product?.label} ${s.noteRate}%`;
  const step=12;
  const basePts=baseline.schedule.filter((_,i)=>i%step===0).map(p=>({x:Math.round(p.month/12),y:chartMode==="interest"?p.cumInterest:p.balance}));
  const series=[
    {id:"base",label:"Current (Baseline)",color:"#94a3b8",dashed:true,data:basePts},
    ...active.map((s,i)=>({id:`sc${s.id}`,label:lbl(s),color:SC_COLORS[i%SC_COLORS.length],dashed:false,
      data:s.result.schedule.filter((_,idx)=>idx%step===0).map(p=>({x:Math.round(p.month/12),y:chartMode==="interest"?p.cumInterest:p.balance}))}))
  ];
  const bars=[
    {lbl:"Current",val:baseline.totalInterest,col:"#64748b"},
    ...active.map((s,i)=>({lbl:lbl(s),val:s.result.totalInterest,col:SC_COLORS[i%SC_COLORS.length]}))
  ];
  const maxBar=Math.max(...bars.map(b=>b.val));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        <StatBox label="Current Total Interest" value={fmtK(baseline.totalInterest)} sub={`${(remainingMonths/12).toFixed(1)} yrs at ${permRate}% perm`} color="#f59e0b"/>
        <StatBox label="Your Rate Floor" value={`${permRate}%`} sub="Any refi note rate must beat this" color="#818cf8"/>
        <StatBox label="Active Scenarios" value={`${active.length}`} sub="Closing costs factored in" color="#34d399"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"420px 1fr",gap:16,alignItems:"start"}}>

        {/* LEFT: scenario cards */}
        <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:14,padding:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <SL>Scenarios</SL>
            <button onClick={add} style={{background:"#6366f1",border:"none",borderRadius:7,padding:"5px 14px",color:"#fff",fontSize:12,cursor:"pointer",fontFamily:"DM Mono,monospace"}}>+ Add</button>
          </div>
          <div style={{background:"#1e293b",borderRadius:10,padding:"12px 14px",border:"1px solid #334155",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:600,color:"#94a3b8",fontFamily:"DM Mono,monospace",marginBottom:6}}>📍 Current Loan (Baseline)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:11,fontFamily:"DM Mono,monospace"}}>
              <span style={{color:"#64748b"}}>Balance: <span style={{color:"#94a3b8"}}>{fmt(loanBalance)}</span></span>
              <span style={{color:"#64748b"}}>Perm rate: <span style={{color:"#94a3b8"}}>{permRate}%</span></span>
              <span style={{color:"#64748b"}}>Remaining: <span style={{color:"#94a3b8"}}>{(remainingMonths/12).toFixed(1)} yrs</span></span>
              <span style={{color:"#64748b"}}>Total int: <span style={{color:"#f59e0b"}}>{fmtK(baseline.totalInterest)}</span></span>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {computed.map((sc,idx)=>{
              const col=SC_COLORS[idx%SC_COLORS.length];
              const r=sc.result;
              const saving=baseline.totalInterest-r.totalInterest;
              const isARM=sc.product?.armAdj!=null;
              const isFHA=sc.product?.mip!=null;
              const isVA=sc.product?.noMI===true;
              const isBuydown=sc.product?.phases?.length>0&&!isARM;
              const fg=sc.filterGroup||"All";
              const vGroups=fg==="All"?PRODUCT_GROUPS:PRODUCT_GROUPS.filter(g=>g.group===fg);
              const ratePath=isBuydown
                ?[...sc.product.phases.map((p,i)=>`Yr${i+1}: ${(Number(sc.noteRate)+p.offset).toFixed(2)}%`),
                   `Yr${sc.product.phases.length+1}+: ${Number(sc.noteRate).toFixed(2)}% (perm)`].join(' → ')
                :null;
              return (
                <div key={sc.id} style={{background:"#1e293b",borderRadius:10,padding:14,border:`1px solid ${sc.enabled!==false?col+"50":"#1e293b"}`,opacity:sc.enabled!==false?1:0.55}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0}}/>
                    <input value={sc.name} onChange={e=>upd(sc.id,"name",e.target.value)}
                      placeholder={`${sc.product?.label} @ ${sc.noteRate}%`}
                      style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#e2e8f0",fontSize:12,fontFamily:"DM Mono,monospace"}}/>
                    {isARM&&<span style={{fontSize:9,padding:"2px 5px",background:"#f59e0b20",color:"#f59e0b",borderRadius:4,fontFamily:"DM Mono,monospace",flexShrink:0}}>ARM</span>}
                    {isFHA&&<span style={{fontSize:9,padding:"2px 5px",background:"#38bdf820",color:"#38bdf8",borderRadius:4,fontFamily:"DM Mono,monospace",flexShrink:0}}>FHA</span>}
                    {isVA&&<span style={{fontSize:9,padding:"2px 5px",background:"#a78bfa20",color:"#a78bfa",borderRadius:4,fontFamily:"DM Mono,monospace",flexShrink:0}}>VA</span>}
                    <button onClick={()=>tog(sc.id)} style={{background:"#334155",border:"none",borderRadius:5,padding:"3px 8px",color:"#94a3b8",fontSize:10,cursor:"pointer"}}>{sc.enabled!==false?"Hide":"Show"}</button>
                    <button onClick={()=>remove(sc.id)} style={{background:"transparent",border:"1px solid #ef444440",borderRadius:5,padding:"3px 7px",color:"#f87171",fontSize:10,cursor:"pointer"}}>✕</button>
                  </div>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4,fontFamily:"DM Mono,monospace"}}>Product</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:5}}>
                      {["All",...PRODUCT_GROUPS.map(g=>g.group)].map(g=>(
                        <button key={g} onClick={()=>upd(sc.id,"filterGroup",g)}
                          style={{padding:"2px 7px",fontSize:9,fontFamily:"DM Mono,monospace",borderRadius:4,border:"none",cursor:"pointer",
                            background:fg===g?"#6366f1":"#0f172a",color:fg===g?"#fff":"#475569"}}>
                          {g==="All"?"All":PRODUCT_GROUPS.find(x=>x.group===g)?.products[0]?.tag+" "+g.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                    <select value={sc.productId} onChange={e=>upd(sc.id,"productId",e.target.value)}
                      style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:6,color:"#e2e8f0",padding:"6px 8px",fontSize:12,fontFamily:"DM Mono,monospace",outline:"none"}}>
                      {vGroups.map(g=>(
                        <optgroup key={g.group} label={`── ${g.group} ──`} style={{color:g.color}}>
                          {g.products.map(p=>(
                            <option key={p.id} value={p.id}>{p.tag} {p.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:isARM?"1fr 1fr":"1fr",gap:8,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3,fontFamily:"DM Mono,monospace"}}>Note Rate</div>
                      <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #334155",borderRadius:6}}>
                        <input type="number" value={sc.noteRate} step={0.125} min={0}
                          onChange={e=>upd(sc.id,"noteRate",parseFloat(e.target.value)||0)}
                          style={{background:"transparent",border:"none",outline:"none",color:"#e2e8f0",padding:"6px 8px",fontSize:12,width:"100%",fontFamily:"DM Mono,monospace"}}/>
                        <span style={{padding:"0 8px",color:"#475569",fontSize:11}}>%</span>
                      </div>
                    </div>
                    {isARM&&(
                      <div>
                        <div style={{fontSize:10,color:"#f59e0b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3,fontFamily:"DM Mono,monospace"}}>Adj Rate +</div>
                        <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #f59e0b40",borderRadius:6}}>
                          <input type="number" value={sc.armAdj??2} step={0.25} min={0}
                            onChange={e=>upd(sc.id,"armAdj",parseFloat(e.target.value)||0)}
                            style={{background:"transparent",border:"none",outline:"none",color:"#f59e0b",padding:"6px 8px",fontSize:12,width:"100%",fontFamily:"DM Mono,monospace"}}/>
                          <span style={{padding:"0 8px",color:"#475569",fontSize:11}}>%</span>
                        </div>
                      </div>
                    )}
                  </div>
                  {isFHA&&<div style={{fontSize:10,color:"#38bdf8",fontFamily:"DM Mono,monospace",marginBottom:6,padding:"5px 8px",background:"#38bdf810",borderRadius:6}}>ℹ️ FHA · MIP {sc.product.mip}%/yr · Min 3.5% down · 1.75% upfront MIP</div>}
                  {isVA&&<div style={{fontSize:10,color:"#a78bfa",fontFamily:"DM Mono,monospace",marginBottom:6,padding:"5px 8px",background:"#a78bfa10",borderRadius:6}}>ℹ️ VA · No PMI · {sc.product.fundingFee}% funding fee · 0% down eligible</div>}
                  {isARM&&<div style={{fontSize:10,color:"#f59e0b",fontFamily:"DM Mono,monospace",marginBottom:6,padding:"5px 8px",background:"#f59e0b10",borderRadius:6}}>
                    🔄 ARM · Fixed {sc.product.phases[0]?.months/12} yrs @ <strong style={{color:"#fbbf24"}}>{Number(sc.noteRate).toFixed(2)}%</strong> → then <strong style={{color:"#f87171"}}>{(Number(sc.noteRate)+(sc.armAdj??2)).toFixed(2)}%</strong> (adjusted)
                  </div>}
                  {isBuydown&&ratePath&&<div style={{fontSize:10,color:"#10b981",fontFamily:"DM Mono,monospace",marginBottom:6,padding:"5px 8px",background:"#10b98110",borderRadius:6}}>
                    📉 Rate path: <strong style={{color:"#34d399"}}>{ratePath}</strong>
                  </div>}

                  {/* Closing Costs */}
                  <div style={{borderTop:"1px solid #1e293b",paddingTop:10,marginBottom:8}}>
                    <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,fontFamily:"DM Mono,monospace"}}>Transaction Costs</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div>
                        <div style={{fontSize:10,color:"#f87171",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3,fontFamily:"DM Mono,monospace"}}>Closing Costs</div>
                        <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #f8717130",borderRadius:6}}>
                          <span style={{padding:"0 8px",color:"#f87171",fontSize:11}}>$</span>
                          <input type="number" value={sc.closingCosts??8000} step={500} min={0}
                            onChange={e=>upd(sc.id,"closingCosts",parseFloat(e.target.value)||0)}
                            style={{background:"transparent",border:"none",outline:"none",color:"#e2e8f0",padding:"6px 8px",fontSize:12,width:"100%",fontFamily:"DM Mono,monospace"}}/>
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"#34d399",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3,fontFamily:"DM Mono,monospace"}}>Lender Credit</div>
                        <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #34d39930",borderRadius:6}}>
                          <span style={{padding:"0 8px",color:"#34d399",fontSize:11}}>$</span>
                          <input type="number" value={sc.cashCredit??0} step={500} min={0}
                            onChange={e=>upd(sc.id,"cashCredit",parseFloat(e.target.value)||0)}
                            style={{background:"transparent",border:"none",outline:"none",color:"#e2e8f0",padding:"6px 8px",fontSize:12,width:"100%",fontFamily:"DM Mono,monospace"}}/>
                        </div>
                      </div>
                    </div>
                    {/* Net closing cost badge */}
                    <div style={{marginTop:6,display:"flex",alignItems:"center",gap:8,fontSize:11,fontFamily:"DM Mono,monospace"}}>
                      <span style={{color:"#475569"}}>Net out-of-pocket:</span>
                      <span style={{color:sc.netClosing===0?"#34d399":"#f87171",fontWeight:700}}>{fmt(sc.netClosing??0)}</span>
                      {(sc.netClosing??0)===0&&<span style={{color:"#34d399",fontSize:10}}>(lender covers costs)</span>}
                    </div>
                  </div>
                  {sc.enabled!==false&&(
                    <div style={{background:"#0f172a",borderRadius:7,overflow:"hidden",fontSize:11,fontFamily:"DM Mono,monospace"}}>
                      {r.pmtList.map((phase,pi)=>{
                        const isLast=pi===r.pmtList.length-1;
                        const isARMAdj=phase.isARM;
                        const isARMFixed=r.isARM&&!phase.isARM&&!isLast;
                        const isBuydownPhase=!r.isARM&&!isLast&&r.pmtList.length>1;
                        const permYearStart=(sc.product.phases?.length||0)+1;
                        const phaseLabel=r.pmtList.length===1
                          ?"Fixed Rate"
                          :isARMAdj
                            ?`Yr ${sc.product.phases[0]?.months/12}+ — ARM Adjusted`
                            :isARMFixed
                              ?`Fixed Period — Yr 1 to ${sc.product.phases[0]?.months/12}`
                              :isBuydownPhase
                                ?`Year ${pi+1} — Buydown`
                                :`Year ${permYearStart}+ — Permanent`;
                        const phaseColor=isARMAdj?"#f59e0b":isLast?"#818cf8":isARMFixed?"#38bdf8":"#94a3b8";
                        const piti=phase.pmt+monthlyTaxes+monthlyPMI+monthlyInsurance;
                        return (
                          <div key={pi} style={{padding:"9px 10px",borderBottom:isLast?"none":"1px solid #1e293b",background:isLast?"#0d1a2e":"transparent"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                              <span style={{color:phaseColor,fontWeight:600}}>{phaseLabel}</span>
                              <span style={{color:"#475569",fontSize:10}}>{phase.months} mo</span>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}>
                              <div><div style={{color:"#64748b",fontSize:10}}>Rate</div><div style={{color:phaseColor,fontWeight:700,marginTop:2}}>{phase.rate.toFixed(2)}%</div></div>
                              <div><div style={{color:"#64748b",fontSize:10}}>P&I</div><div style={{color:"#e2e8f0",fontWeight:600,marginTop:2}}>{fmt(phase.pmt)}</div></div>
                              <div><div style={{color:"#64748b",fontSize:10}}>PITI</div><div style={{color:"#94a3b8",marginTop:2}}>{fmt(piti)}</div></div>
                            </div>
                          </div>
                        );
                      })}
                      <div style={{padding:"10px 10px",background:"#111827",borderTop:"1px solid #1e293b"}}>

                        {/* ── Verdict banner ── */}
                        <div style={{marginBottom:10,padding:"8px 10px",borderRadius:8,
                          background:sc.worthIt?"#10b98115":sc.marginal?"#f59e0b15":"#f8717115",
                          border:`1px solid ${sc.worthIt?"#10b98130":sc.marginal?"#f59e0b30":"#f8717130"}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={{color:sc.worthIt?"#34d399":sc.marginal?"#f59e0b":"#f87171",fontWeight:700,fontSize:12,fontFamily:"DM Mono,monospace"}}>
                              {sc.worthIt?"✅ Worth it":sc.marginal?"⚠️ Marginal":"❌ Not worth it"}
                            </span>
                            {sc.breakEvenMonths>0
                              ?<span style={{color:"#94a3b8",fontSize:10,fontFamily:"DM Mono,monospace"}}>Break-even: {sc.breakEvenMonths}mo ({(sc.breakEvenMonths/12).toFixed(1)} yrs)</span>
                              :sc.netClosing===0
                                ?<span style={{color:"#34d399",fontSize:10,fontFamily:"DM Mono,monospace"}}>No upfront cost</span>
                                :<span style={{color:"#f87171",fontSize:10,fontFamily:"DM Mono,monospace"}}>Monthly cost goes up</span>}
                          </div>
                          {sc.extendsLoan&&<div style={{marginTop:4,fontSize:10,color:"#f59e0b",fontFamily:"DM Mono,monospace"}}>
                            ⚠️ Extends loan by {Math.round((sc.product.term-remainingMonths)/12)} yrs — interest compared over {Math.round(remainingMonths/12)} yr horizon
                          </div>}
                          {sc.monthlySavings<0&&<div style={{marginTop:4,fontSize:10,color:"#f87171",fontFamily:"DM Mono,monospace"}}>
                            ↑ Payment increases {fmt(Math.abs(sc.monthlySavings))}/mo vs current
                          </div>}
                        </div>

                        {/* ── Total Interest Comparison ── */}
                        <div style={{marginBottom:10,background:"#0d1525",borderRadius:8,overflow:"hidden",fontFamily:"DM Mono,monospace",fontSize:11}}>
                          <div style={{padding:"6px 10px",borderBottom:"1px solid #1e293b",fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em"}}>Total Interest — Full Term</div>
                          <div style={{padding:"8px 10px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{color:"#94a3b8"}}>Current loan</div>
                              <div style={{color:"#475569",fontSize:9,marginTop:1}}>{Math.round(remainingMonths/12)} yrs remaining @ {permRate}%</div>
                            </div>
                            <span style={{color:"#f87171",fontWeight:700,fontSize:13}}>{fmt(Math.round(sc.currentTotalInterest))}</span>
                          </div>
                          <div style={{padding:"8px 10px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{color:col}}>This scenario</div>
                              <div style={{color:"#475569",fontSize:9,marginTop:1}}>{sc.product.term/12} yr term @ {sc.noteRate}%</div>
                            </div>
                            <span style={{color:col,fontWeight:700,fontSize:13}}>{fmt(Math.round(sc.newTotalInterest))}</span>
                          </div>
                          <div style={{padding:"8px 10px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{color:"#64748b"}}>Interest difference</div>
                              <div style={{color:"#475569",fontSize:9,marginTop:1}}>Current − scenario</div>
                            </div>
                            <span style={{color:sc.interestSaved>0?"#34d399":"#f87171",fontWeight:700,fontSize:13}}>{sc.interestSaved>0?"+":""}{fmt(Math.round(sc.interestSaved))}</span>
                          </div>
                          <div style={{padding:"8px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{color:"#64748b"}}>True savings</div>
                              <div style={{color:"#475569",fontSize:9,marginTop:1}}>
                                {sc.netClosing>0?`After ${fmt(sc.netClosing)} closing costs`:sc.netClosing<0?`Incl. ${fmt(Math.abs(sc.netClosing))} surplus credit`:"No closing costs"}
                              </div>
                            </div>
                            <span style={{color:sc.trueSavings>0?"#34d399":"#f87171",fontWeight:700,fontSize:13}}>{sc.trueSavings>0?"+":""}{fmt(Math.round(sc.trueSavings))}</span>
                          </div>
                        </div>

                        {/* ── Key metrics grid ── */}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10,fontSize:11,fontFamily:"DM Mono,monospace"}}>
                          {[
                            ["Monthly P&I (new)",fmt(r.pmtList[r.pmtList.length-1]?.pmt??0),"#e2e8f0"],
                            ["Monthly Δ",`${sc.monthlySavings>=0?"−":"+"}${fmt(Math.abs(sc.monthlySavings))}/mo`,sc.monthlySavings>0?"#34d399":"#f87171"],
                            ["PITI (new)",fmt((r.pmtList[r.pmtList.length-1]?.pmt??0)+monthlyTaxes+monthlyPMI+monthlyInsurance),"#818cf8"],
                            ["Net closing cost",sc.netClosing>0?fmt(sc.netClosing):sc.netClosing<0?`+${fmt(Math.abs(sc.netClosing))} credit`:"$0 — covered",sc.netClosing<=0?"#34d399":"#94a3b8"],
                          ].map(([k,v,c])=>(
                            <div key={k} style={{background:"#0d1525",borderRadius:6,padding:"7px 9px"}}>
                              <div style={{color:"#475569",fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{k}</div>
                              <div style={{color:c,fontWeight:700}}>{v}</div>
                            </div>
                          ))}
                        </div>

                        {/* ── Investment Opportunity ── */}
                        {sc.monthlySavings>0&&(()=>{
                          const mo=sc.monthlySavings, n=sc.product.term;
                          const r7=0.07/12, r10=0.10/12, r6=0.06/12, r4=0.04/12;
                          const fv=(r,months)=>mo*((Math.pow(1+r,months)-1)/r);
                          return(
                            <div style={{background:"#0d1525",borderRadius:8,overflow:"hidden",fontFamily:"DM Mono,monospace"}}>
                              <div style={{padding:"7px 10px",borderBottom:"1px solid #1e293b",fontSize:10,color:"#38bdf8",textTransform:"uppercase",letterSpacing:"0.08em"}}>
                                📈 If you invest the {fmt(mo)}/mo savings instead…
                              </div>
                              <div style={{padding:"6px 10px",borderBottom:"1px solid #1e293b",fontSize:10,color:"#475569",lineHeight:1.6}}>
                                Over <strong style={{color:"#94a3b8"}}>{(n/12).toFixed(0)} years</strong> (full {sc.product.label} term) your {fmt(mo)}/mo could grow to:
                              </div>
                              {[
                                ["S&P 500 @ 10%","Historical nominal avg","#818cf8",fv(r10,n)],
                                ["S&P 500 @ 7%","Historical real (inflation-adj)","#38bdf8",fv(r7,n)],
                                ["Real Estate @ 6%","Conservative appreciation","#10b981",fv(r6,n)],
                                ["Conservative @ 4%","Bonds / HYSA / CDs","#94a3b8",fv(r4,n)],
                              ].map(([label,sub,color,val])=>(
                                <div key={label} style={{padding:"8px 10px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                  <div>
                                    <div style={{color,fontSize:11,fontWeight:600}}>{label}</div>
                                    <div style={{color:"#475569",fontSize:9,marginTop:1}}>{sub}</div>
                                  </div>
                                  <span style={{color,fontWeight:700,fontSize:13}}>{fmt(Math.round(val))}</span>
                                </div>
                              ))}
                              <div style={{padding:"8px 10px",fontSize:10,color:"#475569",lineHeight:1.7}}>
                                ⚖️ Refi saves <strong style={{color:"#34d399"}}>{fmtK(sc.trueSavings)} guaranteed</strong>. Investing the savings could yield more, but returns are <strong style={{color:"#f87171"}}>not guaranteed</strong>. Both beat doing nothing.
                              </div>
                            </div>
                          );
                        })()}
                        {sc.monthlySavings<=0&&(
                          <div style={{background:"#0d1525",borderRadius:8,padding:"9px 10px",fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace",lineHeight:1.7}}>
                            💡 No monthly savings to invest — this option saves interest over time but costs more each month. The interest savings of <strong style={{color:sc.interestSaved>0?"#34d399":"#f87171"}}>{fmtK(sc.interestSaved)}</strong> over {Math.round(sc.horizonMonths/12)} yrs is the key benefit.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: charts + table */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:14,padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <SL>{chartMode==="balance"?"Loan Balance Over Time":"Cumulative Interest Paid"}</SL>
              <div style={{display:"flex",gap:6}}>
                {[["balance","Balance"],["interest","Cum. Interest"]].map(([m,l])=>(
                  <button key={m} onClick={()=>setChartMode(m)} style={{padding:"4px 12px",fontSize:11,fontFamily:"DM Mono,monospace",background:chartMode===m?"#6366f1":"#1e293b",color:chartMode===m?"#fff":"#64748b",border:"1px solid #334155",borderRadius:6,cursor:"pointer"}}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px 16px",marginBottom:10}}>
              {series.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:6}}>
                  <svg width="20" height="4" style={{flexShrink:0}}><line x1="0" y1="2" x2="20" y2="2" stroke={s.color} strokeWidth={s.dashed?1.5:2} strokeDasharray={s.dashed?"5 3":"0"}/></svg>
                  <span style={{fontSize:11,color:s.color,fontFamily:"DM Mono,monospace"}}>{s.label}</span>
                </div>
              ))}
            </div>
            <SVGLineChart series={series} height={240}/>
          </div>
          <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:14,padding:18}}>
            <SL>Payment Schedule by Phase</SL>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"DM Mono,monospace",fontSize:12}}>
                <thead>
                  <tr style={{borderBottom:"1px solid #334155"}}>
                    {["Scenario","Product","Phase 1","Phase 2","Final Phase","PITI/mo","Int Saved","Net Closing","True Savings","Break-Even"].map(h=>(
                      <th key={h} style={{padding:"7px 12px",color:"#475569",fontWeight:500,textAlign:h==="Scenario"?"left":"right",fontSize:10,textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderBottom:"1px solid #1e293b",background:"#0d1525"}}>
                    <td style={{padding:"8px 12px",color:"#94a3b8"}}>📍 Current</td>
                    <td style={{padding:"8px 12px",color:"#64748b",textAlign:"right",fontSize:11}}>{PRODUCTS.find(p=>p.id===appliedProductId)?.label??'—'}</td>
                    <td style={{padding:"8px 12px",textAlign:"right"}}><div style={{color:"#94a3b8"}}>{fmt(baseline.pmt45)}</div><div style={{fontSize:9,color:"#475569"}}>{Number(buydownRate).toFixed(2)}%</div></td>
                    <td style={{padding:"8px 12px",color:"#475569",textAlign:"right"}}>—</td>
                    <td style={{padding:"8px 12px",textAlign:"right"}}><div style={{color:"#94a3b8"}}>{fmt(baseline.pmt55)}</div><div style={{fontSize:9,color:"#475569"}}>{Number(permRate).toFixed(2)}%</div></td>
                    <td style={{padding:"8px 12px",color:"#94a3b8",textAlign:"right"}}>{fmt(baseline.pmt55+monthlyTaxes+monthlyPMI+monthlyInsurance)}</td>
                    <td style={{padding:"8px 12px",color:"#f59e0b",textAlign:"right"}}>{fmt(baseline.totalInterest)}</td>
                    <td style={{padding:"8px 12px",color:"#475569",textAlign:"right"}}>—</td>
                  </tr>
                  {active.map((sc,idx)=>{
                    const r=sc.result,pmts=r.pmtList;
                    const ph1=pmts[0];
                    const ph2=pmts.length>=3?pmts[1]:null;
                    const phFinal=pmts[pmts.length-1];
                    const saving=baseline.totalInterest-r.totalInterest;
                    const col=SC_COLORS[idx%SC_COLORS.length];
                    return (
                      <tr key={sc.id} style={{borderBottom:"1px solid #1e293b"}}>
                        <td style={{padding:"8px 12px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:"50%",background:col,flexShrink:0}}/><span style={{color:"#e2e8f0",fontSize:11}}>{lbl(sc)}</span></div></td>
                        <td style={{padding:"8px 12px",color:"#64748b",textAlign:"right",fontSize:11}}>{sc.product.label}</td>
                        <td style={{padding:"8px 12px",textAlign:"right"}}><div style={{color:"#e2e8f0"}}>{fmt(ph1?.pmt??0)}</div><div style={{fontSize:9,color:"#475569"}}>{ph1?.rate?.toFixed(2)}% · {ph1?.months}mo</div></td>
                        <td style={{padding:"8px 12px",textAlign:"right"}}>{ph2?<><div style={{color:"#e2e8f0"}}>{fmt(ph2.pmt)}</div><div style={{fontSize:9,color:"#475569"}}>{ph2.rate?.toFixed(2)}% · {ph2.months}mo</div></>:<span style={{color:"#475569"}}>—</span>}</td>
                        <td style={{padding:"8px 12px",textAlign:"right"}}><div style={{color:r.isARM?"#f59e0b":"#e2e8f0",fontWeight:600}}>{fmt(phFinal?.pmt??0)}</div><div style={{fontSize:9,color:r.isARM?"#f59e0b80":"#475569"}}>{phFinal?.rate?.toFixed(2)}%{r.isARM?" (adj)":""} · {phFinal?.months}mo</div></td>
                        <td style={{padding:"8px 12px",color:"#818cf8",textAlign:"right"}}>{fmt((phFinal?.pmt??0)+monthlyTaxes+monthlyPMI+monthlyInsurance)}</td>
                        <td style={{padding:"8px 12px",textAlign:"right",color:"#34d399"}}>{fmtK(sc.interestSaved)}</td>
                        <td style={{padding:"8px 12px",textAlign:"right",color:sc.netClosing===0?"#34d399":"#f87171"}}>{fmt(sc.netClosing)}</td>
                        <td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:sc.trueSavings>0?"#34d399":"#f87171"}}>{fmtK(sc.trueSavings)}</td>
                        <td style={{padding:"8px 12px",textAlign:"right",color:sc.breakEvenMonths===0?"#34d399":sc.breakEvenMonths<36?"#10b981":"#f59e0b"}}>
                          {sc.breakEvenMonths===0?"Instant":`${sc.breakEvenMonths}mo`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {active.length>0&&(
            <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:14,padding:18}}>
              <SL>True Savings Comparison (after closing costs)</SL>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[{lbl:"Current (baseline)",val:0,col:"#64748b"},...active.map((s,i)=>({lbl:lbl(s),val:s.trueSavings,col:SC_COLORS[i%SC_COLORS.length]}))].map((b,i)=>{
                  const maxVal=Math.max(...active.map(s=>Math.abs(s.trueSavings)),1);
                  return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:130,fontSize:11,color:b.col,fontFamily:"DM Mono,monospace",textAlign:"right",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.lbl}</div>
                    <div style={{flex:1,height:22,background:"#1e293b",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${i===0?2:(Math.abs(b.val)/maxVal)*100}%`,background:b.val>0?b.col:"#f87171",borderRadius:4,transition:"width 0.3s"}}/></div>
                    <div style={{width:70,fontSize:11,color:b.val>0?"#34d399":b.val<0?"#f87171":"#64748b",fontFamily:"DM Mono,monospace",flexShrink:0,fontWeight:600}}>{i===0?"—":fmtK(b.val)}</div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftInput({label, field, pre="", suf="", draft, isDirty, setField}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.09em",fontFamily:"DM Mono,monospace"}}>{label}</label>
      <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:`1px solid ${isDirty?"#6366f170":"#334155"}`,borderRadius:8}}>
        {pre&&<span style={{padding:"0 10px",color:"#475569",fontSize:13,fontFamily:"DM Mono,monospace"}}>{pre}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={draft[field]}
          onChange={e=>setField(field,e.target.value)}
          onBlur={e=>{const n=parseFloat(e.target.value);if(!isNaN(n))setField(field,n);}}
          style={{background:"transparent",border:"none",outline:"none",color:"#f1f5f9",padding:"9px 10px",fontSize:13,width:"100%",fontFamily:"DM Mono,monospace"}}
        />
        {suf&&<span style={{padding:"0 10px",color:"#475569",fontSize:13,fontFamily:"DM Mono,monospace"}}>{suf}</span>}
      </div>
    </div>
  );
}

export default function MortgageDashboard() {
  const [applied, setApplied] = useState({
    loanBalance: 701784, homeValue: 900000, permRate: 5.5,
    monthlyTaxes: 698, monthlyInsurance: 150,
    monthlyPMI: 0, pmiOverride: false,
    loanStartDate: "2024-09", productId: "buy10_15",
  });
  const [draft, setDraft] = useState({ ...applied });
  const [isDirty, setIsDirty] = useState(false);
  const [extraPayment, setExtraPayment] = useState(0);
  const [plannerMode, setPlannerMode] = useState("extra");
  const [payoffGoalYear, setPayoffGoalYear] = useState("");
  const [lumpSum, setLumpSum] = useState(10000);
  const [activeTab, setActiveTab] = useState("Overview");

  const { loanBalance, homeValue, permRate, monthlyTaxes, monthlyInsurance, loanStartDate, productId: appliedProductId } = applied;
  const appliedProduct = PRODUCTS.find(p => p.id === appliedProductId) || PRODUCTS[2];
  const monthsElapsed = (() => {
    if (!loanStartDate) return 0;
    const [yr, mo] = loanStartDate.split("-").map(Number);
    const now = new Date();
    return Math.max((now.getFullYear() - yr) * 12 + (now.getMonth() + 1 - mo), 0);
  })();
  const remainingMonths = Math.max(appliedProduct.term - monthsElapsed, 1);
  const startYear = loanStartDate ? parseInt(loanStartDate.split("-")[0]) : new Date().getFullYear();
  const startMonth = loanStartDate ? parseInt(loanStartDate.split("-")[1]) - 1 : 0;

  // Default payoff goal = 5 years early, or halfway through if loan is short
  const defaultPayoffYearVal = loanStartDate
    ? parseInt(loanStartDate.split("-")[0]) + Math.floor(remainingMonths / 12)
    : new Date().getFullYear() + Math.floor(remainingMonths / 12);
  const initGoalYear = String(Math.max(defaultPayoffYearVal - 5, new Date().getFullYear() + 1));
  const effectiveGoalYear = payoffGoalYear || initGoalYear;

  const setField = (field, val) => { setDraft(d => ({ ...d, [field]: val })); setIsDirty(true); };
  const applyDraft = () => { setApplied({ ...draft }); setIsDirty(false); };
  const resetDraft = () => { setDraft({ ...applied }); setIsDirty(false); };

  // Use product-aware amortization that handles multi-phase buydowns + ARMs correctly
  const baseline = useMemo(() =>
    amortizeFromToday({originalBalance: loanBalance, product: appliedProduct, permRate, monthsElapsed}),
    [loanBalance, appliedProduct, permRate, monthsElapsed]
  );

  // Derive buydownRate/buydownMonthsLeft from baseline for downstream functions (extras, lump, goal)
  // For multi-phase products, this represents the CURRENT phase only
  const currentPhase = baseline.pmtList[0];
  const buydownRate = currentPhase?.rate ?? permRate;
  const buydownMonthsLeft = (currentPhase && currentPhase.rate !== permRate) ? currentPhase.months : 0;

  const withExtra = useMemo(() => {
    if (!extraPayment) return null;
    const pmt45=mpmt(loanBalance,buydownRate,remainingMonths), r55=permRate/100/12;
    let bal=loanBalance,ti=0,months=0; const sched=[];
    for(let m=0;m<buydownMonthsLeft&&bal>0;m++){const i=bal*(buydownRate/100/12),p=Math.min(pmt45+extraPayment,bal+i);ti+=i;bal=Math.max(bal-(p-i),0);months++;sched.push({month:months,balance:bal,cumInterest:ti});}
    if(bal>0){const p55=mpmt(bal,permRate,remainingMonths-buydownMonthsLeft);while(bal>0){const i=bal*r55,p=Math.min(p55+extraPayment,bal+i);ti+=i;bal=Math.max(bal-(p-i),0);months++;sched.push({month:months,balance:bal,cumInterest:ti});}}
    return {totalInterest:ti,months,schedule:sched};
  }, [loanBalance,buydownRate,permRate,remainingMonths,buydownMonthsLeft,extraPayment]);

  const withLump = useMemo(() => {
    if (!lumpSum || lumpSum <= 0) return null;
    const newBal = Math.max(loanBalance - lumpSum, 0);
    if (newBal === 0) return { totalInterest: 0, months: 0, schedule: [], newBal: 0, newPermPmt: 0 };
    const r45 = buydownRate / 100 / 12;
    const r55 = permRate / 100 / 12;

    // Original buydown payment (based on full original balance)
    const origPmt45 = mpmt(loanBalance, buydownRate, remainingMonths);

    // First compute baseline perm payment by simulating buydown phase on original balance
    let bbal = loanBalance;
    for (let m = 0; m < buydownMonthsLeft && bbal > 0; m++) {
      const i = bbal * r45;
      bbal = Math.max(bbal - (origPmt45 - i), 0);
    }
    // Original perm payment — keeping this CONSTANT is what shortens the term
    const origPermPmt = mpmt(bbal, permRate, remainingMonths - buydownMonthsLeft);

    // Now simulate lump sum scenario
    let bal = newBal, ti = 0, months = 0;
    const sched = [];

    // Buydown phase: keep original buydown payment, interest on reduced balance
    for (let m = 0; m < buydownMonthsLeft && bal > 0; m++) {
      const i = bal * r45;
      const principal = Math.min(origPmt45 - i, bal);
      ti += i; bal = Math.max(bal - principal, 0); months++;
      sched.push({ month: months, balance: bal, cumInterest: ti });
    }

    // Permanent phase: keep ORIGINAL perm payment → loan pays off faster
    while (bal > 0.005 && months < remainingMonths + 6) {
      const i = bal * r55;
      const principal = Math.min(origPermPmt - i, bal);
      ti += i; bal = Math.max(bal - principal, 0); months++;
      sched.push({ month: months, balance: bal, cumInterest: ti });
    }

    return { totalInterest: ti, months, schedule: sched, newBal, newPermPmt: origPermPmt };
  }, [loanBalance, lumpSum, buydownRate, permRate, remainingMonths, buydownMonthsLeft]);

  const yearlyAmort = useMemo(() => {
    let cumInt=0; const rows=[];
    for(let yr=1;yr<=Math.ceil(remainingMonths/12);yr++){
      const start=(yr-1)*12,end=Math.min(yr*12,baseline.schedule.length);
      if(start>=baseline.schedule.length) break;
      const sl=baseline.schedule.slice(start,end);
      const interest=sl.reduce((a,s)=>a+s.interest,0), principal=sl.reduce((a,s)=>a+s.principal,0);
      cumInt+=interest;
      rows.push({year:yr,interest:Math.round(interest),principal:Math.round(principal),balance:Math.round(sl[sl.length-1]?.balance??0),cumInt:Math.round(cumInt)});
    }
    return rows;
  }, [baseline.schedule,remainingMonths]);

  const balanceChartData = useMemo(() => {
    const len = appliedProduct.term;
    const data=[];
    for(let i=0;i<len;i+=12){
      const yr = Math.round((i+1)/12);
      const calYear = startYear + yr;
      const obj={ yr, calYear };
      if(i<baseline.schedule.length) obj.current=Math.round(baseline.schedule[i].balance);
      if(withExtra&&i<withExtra.schedule.length) obj.extra=Math.round(withExtra.schedule[i].balance);
      data.push(obj);
    }
    return data;
  }, [baseline.schedule, withExtra, startYear, startMonth, appliedProduct.term]);

  // Dynamic PMI — auto-computed from LTV, user can override
  // Use draft values so PMI display updates live as user types before hitting Apply
  const draftLTV = (draft.homeValue||homeValue) > 0 ? (draft.loanBalance||loanBalance) / (draft.homeValue||homeValue) : 0;
  const currentLTV = homeValue > 0 ? loanBalance / homeValue : 0;
  const autoPMI = computePMI(loanBalance, homeValue);
  const pmiDropMonth = pmiDropOffMonth(loanBalance, homeValue, permRate, remainingMonths);
  const monthlyPMI = applied.pmiOverride ? applied.monthlyPMI : autoPMI;
  const totalMonthly = baseline.pmt55 + monthlyTaxes + monthlyPMI + monthlyInsurance;

  const extraSensitivity = [0,300,500,1000,1500,2000].map(extra=>{
    let bal=loanBalance,ti=0,months=0;
    const pmt45=mpmt(bal,buydownRate,remainingMonths),r55=permRate/100/12;
    for(let m=0;m<buydownMonthsLeft&&bal>0;m++){const i=bal*(buydownRate/100/12);bal=Math.max(bal-(pmt45+extra-i),0);ti+=i;months++;}
    if(bal>0){const p55=mpmt(bal,permRate,remainingMonths-buydownMonthsLeft);while(bal>0){const i=bal*r55,p=Math.min(p55+extra,bal+i);bal=Math.max(bal-(p-i),0);ti+=i;months++;}}
    return{extra,savings:Math.round(baseline.totalInterest-ti),years:+(months/12).toFixed(1)};
  });

  const NumInput = ({label,value,onChange,pre="",suf="",step=1,min=0,max=9999999})=>(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.09em",fontFamily:"DM Mono,monospace"}}>{label}</label>
      <div style={{display:"flex",alignItems:"center",background:"#1e293b",border:"1px solid #334155",borderRadius:8}}>
        {pre&&<span style={{padding:"0 10px",color:"#475569",fontSize:13,fontFamily:"DM Mono,monospace"}}>{pre}</span>}
        <input type="number" value={value} step={step} min={min} max={max} onChange={e=>onChange(parseFloat(e.target.value)||0)}
          style={{background:"transparent",border:"none",outline:"none",color:"#e2e8f0",padding:"9px 10px",fontSize:13,width:"100%",fontFamily:"DM Mono,monospace"}}/>
        {suf&&<span style={{padding:"0 10px",color:"#475569",fontSize:13,fontFamily:"DM Mono,monospace"}}>{suf}</span>}
      </div>
    </div>
  );

  const StatBoxC = ({label,value,sub,color="#f1f5f9"})=>(
    <div style={{background:"#1e293b",borderRadius:10,padding:"14px 16px"}}>
      <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:5,fontFamily:"DM Mono,monospace"}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color,fontFamily:"Fraunces,Georgia,serif"}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:"#475569",marginTop:3}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#070d1a",color:"#f1f5f9",fontFamily:"DM Sans,sans-serif",padding:"24px 16px"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,700;9..144,900&family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#1e293b;}
        ::-webkit-scrollbar-thumb{background:#475569;border-radius:3px;}
        select option{background:#0f172a;}
      `}</style>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12,marginBottom:24}}>
          <h1 style={{fontSize:32,fontWeight:900,fontFamily:"Fraunces,Georgia,serif",color:"#f8fafc",lineHeight:1}}>Mortgage Dashboard</h1>
          <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:10,padding:"10px 18px",display:"flex",gap:24,flexWrap:"wrap"}}>
            {(()=>{
              const isBuydown = appliedProduct.phases?.length>0 && !appliedProduct.armAdj;
              const isARM = appliedProduct.armAdj != null;
              const isFixed = !isBuydown && !isARM;
              if(isFixed){
                return [["P&I",fmt(baseline.pmt55)],["Total PITI",fmt(totalMonthly)],["Rate",`${permRate}%`]];
              } else if(isARM){
                return [
                  [`P&I Fixed (${baseline.pmtList[0]?.rate?.toFixed(2)}%)`,fmt(baseline.pmtList[0]?.pmt||0)],
                  [`P&I Adjusted (${baseline.pmtList[baseline.pmtList.length-1]?.rate?.toFixed(2)}%)`,fmt(baseline.pmtList[baseline.pmtList.length-1]?.pmt||0)],
                  ["Total PITI",fmt(totalMonthly)],
                ];
              } else {
                // Buydown — show each phase
                return [
                  ...baseline.pmtList.map((p,i)=>{
                    const isLast=i===baseline.pmtList.length-1;
                    const label = isLast?`P&I Perm (${p.rate.toFixed(2)}%)`:`P&I Yr${i+1} (${p.rate.toFixed(2)}%)`;
                    return [label, fmt(p.pmt)];
                  }),
                  ["Total PITI",fmt(totalMonthly)],
                ];
              }
            })().map(([k,v])=>(
              <div key={k}><div style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace",textTransform:"uppercase"}}>{k}</div><div style={{fontSize:16,fontWeight:700,color:"#818cf8",fontFamily:"DM Mono,monospace"}}>{v}</div></div>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:2,marginBottom:20,borderBottom:"1px solid #1e293b"}}>
          {TABS.map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)} style={{background:"transparent",border:"none",borderBottom:activeTab===tab?"2px solid #6366f1":"2px solid transparent",color:activeTab===tab?"#e2e8f0":"#475569",padding:"9px 16px",cursor:"pointer",fontSize:13,fontFamily:"DM Sans,sans-serif",fontWeight:activeTab===tab?600:400,borderRadius:"6px 6px 0 0",transition:"all 0.15s"}}>{tab}</button>
          ))}
        </div>

        {activeTab==="Overview"&&(
          <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16}}>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <Card>
                <SL>Loan Details</SL>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.09em",fontFamily:"DM Mono,monospace"}}>Loan Product</label>
                    <select value={draft.productId||"buy10_15"} onChange={e=>{
                      setField("productId",e.target.value);
                    }} style={{background:"#0f172a",border:`1px solid ${isDirty?"#6366f170":"#334155"}`,borderRadius:8,color:"#f1f5f9",padding:"9px 10px",fontSize:13,fontFamily:"DM Mono,monospace",outline:"none",width:"100%"}}>
                      {PRODUCT_GROUPS.map(g=>(
                        <optgroup key={g.group} label={`── ${g.group} ──`}>
                          {g.products.map(p=><option key={p.id} value={p.id}>{p.tag} {p.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.09em",fontFamily:"DM Mono,monospace"}}>Loan Start Date</label>
                    <input type="month" value={draft.loanStartDate||""} onChange={e=>setField("loanStartDate",e.target.value)}
                      style={{background:"#0f172a",border:`1px solid ${isDirty?"#6366f170":"#334155"}`,borderRadius:8,color:"#f1f5f9",padding:"9px 10px",fontSize:13,fontFamily:"DM Mono,monospace",outline:"none",width:"100%",colorScheme:"dark"}}/>
                  </div>
                  <DraftInput label="Original Loan Balance" field="loanBalance" pre="$" draft={draft} isDirty={isDirty} setField={setField}/>
                  <DraftInput label="Home Value" field="homeValue" pre="$" draft={draft} isDirty={isDirty} setField={setField}/>
                  <DraftInput label={draft.productId?.includes("buy") ? "Permanent (Note) Rate" : "Interest Rate"} field="permRate" suf="%" draft={draft} isDirty={isDirty} setField={setField}/>
                  {/* Auto-computed phase preview for buydown products */}
                  {(() => {
                    const prod = PRODUCTS.find(p=>p.id===(draft.productId||"buy10_15"));
                    if (!prod || !prod.phases || prod.phases.length === 0) return null;
                    const isARMP = prod.armAdj != null;
                    if (isARMP) {
                      return (
                        <div style={{background:"#0d1525",borderRadius:8,padding:"10px 12px",fontSize:11,fontFamily:"DM Mono,monospace",color:"#f59e0b",lineHeight:1.7}}>
                          🔄 ARM auto-derived rates: Fixed {prod.phases[0].months/12}yr @ <strong style={{color:"#fbbf24"}}>{Number(draft.permRate||5.5).toFixed(2)}%</strong> → adjusts to <strong style={{color:"#f87171"}}>{(Number(draft.permRate||5.5)+(prod.armAdj||2)).toFixed(2)}%</strong>
                        </div>
                      );
                    }
                    const noteR = Number(draft.permRate||5.5);
                    const ratePath = [
                      ...prod.phases.map((p,i)=>`Yr${i+1}: ${(noteR+p.offset).toFixed(2)}%`),
                      `Yr${prod.phases.length+1}+: ${noteR.toFixed(2)}% (perm)`
                    ].join(' → ');
                    return (
                      <div style={{background:"#0d1525",borderRadius:8,padding:"10px 12px",fontSize:11,fontFamily:"DM Mono,monospace",color:"#10b981",lineHeight:1.7}}>
                        📉 Auto-derived rate path: <strong style={{color:"#34d399"}}>{ratePath}</strong>
                      </div>
                    );
                  })()}
                </div>
                <div style={{marginTop:12,padding:"10px 12px",background:"#0d1525",borderRadius:8,fontSize:11,fontFamily:"DM Mono,monospace",color:"#64748b",lineHeight:1.8}}>
                  {PRODUCTS.find(p=>p.id===(draft.productId||"buy10_15"))?.label} ·{" "}
                  {(() => {
                    const prod = PRODUCTS.find(p=>p.id===(draft.productId||"buy10_15"));
                    const noteR = Number(draft.permRate||5.5);
                    if (prod?.armAdj!=null) return `${noteR}% fixed → ${(noteR+prod.armAdj).toFixed(2)}% adj · `;
                    if (prod?.phases?.length>0) {
                      const firstRate = (noteR+prod.phases[0].offset).toFixed(2);
                      return `${firstRate}% → ${noteR}% perm · `;
                    }
                    return `${noteR}% · `;
                  })()}
                  {draft.loanStartDate ? `Started ${new Date(draft.loanStartDate+"-01").toLocaleString("default",{month:"short",year:"numeric"})}` : "No start date"} ·{" "}
                  {(() => { const prod=PRODUCTS.find(p=>p.id===(draft.productId||"buy10_15"))||PRODUCTS[2]; if(!draft.loanStartDate) return null; const [yr,mo]=draft.loanStartDate.split("-").map(Number); const elapsed=(new Date().getFullYear()-yr)*12+(new Date().getMonth()+1-mo); const rem=Math.max(prod.term-elapsed,1); return <span style={{color:"#94a3b8"}}>{rem} mo remaining · Payoff {(() => { const d=new Date(draft.loanStartDate+"-01"); d.setMonth(d.getMonth()+prod.term); return d.toLocaleString("default",{month:"short",year:"numeric"}); })()}</span>; })()}
                </div>
              </Card>
              <Card>
                <SL>Monthly Costs (PITI)</SL>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <DraftInput label="Property Tax /mo" field="monthlyTaxes" pre="$" draft={draft} isDirty={isDirty} setField={setField}/>

                  {/* Dynamic PMI */}
                  <div>
                    <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5,fontFamily:"DM Mono,monospace",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>PMI /mo <span style={{color:draftLTV<=0.80?"#34d399":"#f87171"}}>(LTV {(draftLTV*100).toFixed(1)}%)</span></span>
                      <button onClick={()=>{
                        setField("pmiOverride",!draft.pmiOverride);
                        if(!draft.pmiOverride) setField("monthlyPMI",autoPMI);
                      }} style={{fontSize:9,padding:"2px 7px",background:"#1e293b",border:"1px solid #334155",borderRadius:4,color:"#64748b",cursor:"pointer",fontFamily:"DM Mono,monospace"}}>
                        {draft.pmiOverride?"Use Auto":"Override"}
                      </button>
                    </div>
                    {draft.pmiOverride ? (
                      <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #6366f170",borderRadius:8}}>
                        <span style={{padding:"0 10px",color:"#475569",fontFamily:"DM Mono,monospace",fontSize:13}}>$</span>
                        <input type="number" value={draft.monthlyPMI||0} step={10} min={0}
                          onChange={e=>setField("monthlyPMI",parseFloat(e.target.value)||0)}
                          style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#e2e8f0",padding:"10px 8px",fontSize:15,fontFamily:"DM Mono,monospace"}}/>
                        <span style={{padding:"0 10px",color:"#64748b",fontSize:10,fontFamily:"DM Mono,monospace"}}>manual</span>
                      </div>
                    ) : (
                      <div style={{background:"#0f172a",borderRadius:8,padding:"10px 12px",border:`1px solid ${draftLTV<=0.80?"#10b98130":"#f59e0b30"}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:draftLTV<=0.80?0:4}}>
                          <span style={{fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:700,color:draftLTV<=0.80?"#34d399":"#f59e0b"}}>
                            {computePMI(draft.loanBalance||loanBalance,draft.homeValue||homeValue)===0?"$0 / mo — PMI waived":fmt(computePMI(draft.loanBalance||loanBalance,draft.homeValue||homeValue))+"/mo"}
                          </span>
                          <span style={{fontSize:10,fontFamily:"DM Mono,monospace",color:"#475569"}}>auto</span>
                        </div>
                        {draftLTV<=0.80 ? (
                          <div style={{fontSize:10,color:"#34d399",fontFamily:"DM Mono,monospace",marginTop:3}}>
                            ✓ LTV ≤ 80% — no PMI required
                          </div>
                        ) : pmiDropMonth!=null ? (
                          <div style={{fontSize:10,color:"#f59e0b",fontFamily:"DM Mono,monospace",marginTop:3}}>
                            Drops to $0 in {pmiDropMonth}mo ({(pmiDropMonth/12).toFixed(1)} yrs) when LTV reaches 80%
                          </div>
                        ) : (
                          <div style={{fontSize:10,color:"#f87171",fontFamily:"DM Mono,monospace",marginTop:3}}>
                            LTV won't reach 80% within remaining term
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <DraftInput label="Insurance /mo" field="monthlyInsurance" pre="$" draft={draft} isDirty={isDirty} setField={setField}/>
                </div>
                <div style={{marginTop:14,background:"#1e293b",borderRadius:10,padding:12}}>
                  {(()=>{
                    const isBuydown=appliedProduct.phases?.length>0&&!appliedProduct.armAdj;
                    const isARM=appliedProduct.armAdj!=null;
                    const rows=[];
                    if(isARM){
                      rows.push([`P&I Fixed (${baseline.pmtList[0]?.rate?.toFixed(2)}%)`,fmt(baseline.pmtList[0]?.pmt||0)]);
                      rows.push([`P&I Adjusted (${baseline.pmtList[baseline.pmtList.length-1]?.rate?.toFixed(2)}%)`,fmt(baseline.pmtList[baseline.pmtList.length-1]?.pmt||0)]);
                    } else if(isBuydown){
                      baseline.pmtList.forEach((p,i)=>{
                        const isLast=i===baseline.pmtList.length-1;
                        rows.push([isLast?`P&I Perm (${p.rate.toFixed(2)}%)  ${p.months}mo`:`P&I Yr${i+1} (${p.rate.toFixed(2)}%)  ${p.months}mo left`,fmt(p.pmt)]);
                      });
                    } else {
                      rows.push([`P&I (${permRate}%)`,fmt(baseline.pmt55)]);
                    }
                    rows.push(["Property Tax",fmt(monthlyTaxes)]);
                    rows.push(["PMI",fmt(monthlyPMI)]);
                    rows.push(["Insurance",fmt(monthlyInsurance)]);
                    return rows.map(([k,v])=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #334155",fontSize:12}}>
                        <span style={{color:"#94a3b8"}}>{k}</span><span style={{fontFamily:"DM Mono,monospace",color:"#e2e8f0"}}>{v}</span>
                      </div>
                    ));
                  })()}
                  <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,fontSize:14,fontWeight:700}}>
                    <span style={{color:"#818cf8"}}>Total PITI</span><span style={{fontFamily:"DM Mono,monospace",color:"#818cf8"}}>{fmt(totalMonthly)}</span>
                  </div>
                </div>
                <div style={{marginTop:14,display:"flex",gap:8}}>
                  <button onClick={applyDraft} style={{flex:1,padding:"11px 0",borderRadius:8,border:"none",cursor:"pointer",background:isDirty?"#6366f1":"#1e293b",color:isDirty?"#fff":"#475569",fontSize:13,fontWeight:700,fontFamily:"DM Mono,monospace",transition:"all 0.2s",boxShadow:isDirty?"0 0 16px #6366f160":"none"}}>
                    {isDirty?"⚡ Update Dashboard":"✓ Up to Date"}
                  </button>
                  {isDirty&&(
                    <button onClick={resetDraft} style={{padding:"11px 14px",borderRadius:8,border:"1px solid #334155",cursor:"pointer",background:"transparent",color:"#94a3b8",fontSize:13,fontFamily:"DM Mono,monospace"}}>Reset</button>
                  )}
                </div>
                {isDirty&&<div style={{marginTop:8,fontSize:11,color:"#f59e0b",fontFamily:"DM Mono,monospace",textAlign:"center"}}>● Changes pending — click Update to apply</div>}
              </Card>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                <StatBoxC label="Loan Balance" value={fmt(loanBalance)} sub={`${((loanBalance/homeValue)*100).toFixed(1)}% LTV`} color="#818cf8"/>
                <StatBoxC label="Total Interest Remaining" value={fmtK(baseline.totalInterest)} sub={`${(baseline.totalInterest/loanBalance*100).toFixed(0)}% of balance`} color="#f59e0b"/>
                <StatBoxC label="Payoff Date" value={(() => { if(loanStartDate){ const d=new Date(loanStartDate+"-01"); d.setMonth(d.getMonth()+remainingMonths); return d.toLocaleString("default",{month:"short",year:"numeric"}); } return String(new Date().getFullYear()+Math.round(remainingMonths/12)); })()} sub={`${(remainingMonths/12).toFixed(1)} yrs remaining`} color="#94a3b8"/>
                <StatBoxC
                  label={`Current P&I (${currentPhase?.rate?.toFixed(2)}%)`}
                  value={fmt(currentPhase?.pmt||0)}
                  sub={(() => {
                    if (baseline.pmtList.length === 1) return "Fixed for term";
                    if (baseline.isARM && currentPhase && !currentPhase.isARM) return `Fixed period — ${currentPhase.months}mo left`;
                    if (currentPhase?.rate !== permRate) return `${currentPhase?.months}mo left in this phase`;
                    return "Permanent rate";
                  })()}
                  color="#e2e8f0"
                />
                <StatBoxC label="Total PITI" value={fmt(totalMonthly)} sub="Inc. tax, PMI, insurance" color="#818cf8"/>
                <StatBoxC label="Equity" value={fmtK(homeValue-loanBalance)} sub={`${(((homeValue-loanBalance)/homeValue)*100).toFixed(1)}% of home value`} color="#10b981"/>
              </div>

              {/* Phase Schedule card - shows all phases with current marker */}
              {baseline.pmtList.length > 1 && (
                <Card>
                  <SL>Payment Schedule by Phase</SL>
                  <div style={{background:"#0d1525",borderRadius:8,overflow:"hidden",fontFamily:"DM Mono,monospace",fontSize:12}}>
                    {baseline.pmtList.map((phase, pi) => {
                      const isCurrent = phase.isCurrent;
                      const isPerm = pi === baseline.pmtList.length - 1 && !phase.isARM;
                      const isARMAdj = phase.isARM;
                      const isARMFixed = baseline.isARM && !phase.isARM;
                      const phaseColor = isARMAdj ? "#f59e0b" : isPerm ? "#818cf8" : isARMFixed ? "#38bdf8" : "#10b981";
                      // Compute phase year label based on full term position
                      const fullPhaseStartMonth = baseline.allPhases.slice(0, baseline.currentPhaseIdx + pi).reduce((a,p)=>a+p.months,0);
                      const yrLabel = `Yr ${Math.floor(fullPhaseStartMonth/12)+1}`;
                      const piti = phase.pmt + monthlyTaxes + monthlyPMI + monthlyInsurance;
                      return (
                        <div key={pi} style={{padding:"10px 12px",borderBottom:pi<baseline.pmtList.length-1?"1px solid #1e293b":"none",background:isCurrent?"#1e293b":"transparent",position:"relative"}}>
                          {isCurrent && <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:phaseColor}}/>}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <span style={{color:phaseColor,fontWeight:isCurrent?700:500}}>
                              {isCurrent ? "▶ " : ""}
                              {isARMAdj ? `${yrLabel}+ — ARM Adjusted` :
                               isARMFixed ? `Fixed Period (${yrLabel})` :
                               isPerm ? `${yrLabel}+ — Permanent Rate` :
                               `${yrLabel} — Buydown`}
                              {isCurrent && <span style={{color:"#475569",marginLeft:6,fontSize:10,fontWeight:400}}>(current)</span>}
                            </span>
                            <span style={{color:"#475569",fontSize:10}}>{phase.months} mo</span>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                            <div><div style={{color:"#64748b",fontSize:10}}>Rate</div><div style={{color:phaseColor,fontWeight:700,marginTop:2}}>{phase.rate.toFixed(2)}%</div></div>
                            <div><div style={{color:"#64748b",fontSize:10}}>P&I</div><div style={{color:"#e2e8f0",fontWeight:600,marginTop:2}}>{fmt(phase.pmt)}</div></div>
                            <div><div style={{color:"#64748b",fontSize:10}}>PITI</div><div style={{color:"#94a3b8",marginTop:2}}>{fmt(piti)}</div></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
              <Card>
                <SL>Loan Balance Over Time</SL>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={balanceChartData}>
                    <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.35}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                    <XAxis dataKey="calYear" type="number" domain={["dataMin","dataMax"]} stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>String(v)} allowDuplicatedCategory={false}/>
                    <YAxis stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`}/>
                    <Tooltip formatter={(v,n)=>[`$${(v/1000).toFixed(0)}K`,n]} labelFormatter={v=>`Year ${v}`} contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}}/>
                    <Area type="monotone" dataKey="current" name="Balance" stroke="#6366f1" fill="url(#g1)" strokeWidth={2} dot={false}/>
                    {withExtra&&<Area type="monotone" dataKey="extra" name={`+$${extraPayment}/mo`} stroke="#10b981" fill="none" strokeWidth={2} strokeDasharray="5 3" dot={false}/>}
                  </AreaChart>
                </ResponsiveContainer>
              </Card>


            </div>
          </div>
        )}

        {activeTab==="Amortization"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <Card>
                <SL>Principal vs Interest Per Year</SL>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={yearlyAmort}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                    <XAxis dataKey="year" stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`Yr ${Math.round(v)}`}/>
                    <YAxis stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`}/>
                    <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="interest" name="Interest" fill="#ef4444" radius={[3,3,0,0]} stackId="a"/>
                    <Bar dataKey="principal" name="Principal" fill="#10b981" radius={[3,3,0,0]} stackId="a"/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <SL>Remaining Balance by Year</SL>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={yearlyAmort}>
                    <defs><linearGradient id="balg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/><stop offset="95%" stopColor="#818cf8" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                    <XAxis dataKey="year" stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`Yr ${v}`}/>
                    <YAxis stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`}/>
                    <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}}/>
                    <Area type="monotone" dataKey="balance" name="Balance" stroke="#818cf8" fill="url(#balg)" strokeWidth={2} dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </div>
            <Card>
              <SL>Yearly Amortization Table</SL>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"DM Mono,monospace",fontSize:12}}>
                  <thead><tr style={{borderBottom:"1px solid #334155"}}>
                    {["Year","Interest Paid","Principal Paid","Remaining Balance","Cumulative Interest"].map(h=>(
                      <th key={h} style={{padding:"8px 14px",color:"#475569",fontWeight:500,textAlign:"right",fontSize:10,textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {yearlyAmort.map((row,i)=>(
                      <tr key={i} style={{borderBottom:"1px solid #1e293b",background:i%2===0?"transparent":"#0d1525"}}>
                        <td style={{padding:"7px 14px",color:"#94a3b8",textAlign:"right"}}>Year {row.year}</td>
                        <td style={{padding:"7px 14px",color:"#f87171",textAlign:"right"}}>{fmt(row.interest)}</td>
                        <td style={{padding:"7px 14px",color:"#34d399",textAlign:"right"}}>{fmt(row.principal)}</td>
                        <td style={{padding:"7px 14px",color:"#818cf8",textAlign:"right"}}>{fmt(row.balance)}</td>
                        <td style={{padding:"7px 14px",color:"#64748b",textAlign:"right"}}>{fmt(row.cumInt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {activeTab==="Refi"&&(
          <ScenariosTab baseline={baseline} loanBalance={loanBalance} permRate={permRate} remainingMonths={remainingMonths} monthlyTaxes={monthlyTaxes} monthlyPMI={monthlyPMI} monthlyInsurance={monthlyInsurance} appliedProductId={appliedProductId} buydownRate={buydownRate}/>
        )}

        {activeTab==="Payoff Planner"&&(()=>{
          // ── Payoff Goal back-calculator ─────────────────────────
          // Binary search: find extra payment needed to pay off in targetMonths
          const targetMonths = (() => {
            if (!loanStartDate) return remainingMonths;
            const [yr, mo] = loanStartDate.split("-").map(Number);
            const payoffYear = parseInt(effectiveGoalYear);
            if (isNaN(payoffYear)) return remainingMonths;
            const loanStartMs = new Date(yr, mo - 1, 1);
            const goalMs = new Date(payoffYear, 0, 1);
            const monthsDiff = Math.round((goalMs - loanStartMs) / (1000 * 60 * 60 * 24 * 30.44));
            return Math.max(monthsDiff, 1);
          })();
          const remainingToGoal = targetMonths - (() => {
            if (!loanStartDate) return 0;
            const [yr, mo] = loanStartDate.split("-").map(Number);
            const now = new Date();
            return (now.getFullYear() - yr) * 12 + (now.getMonth() + 1 - mo);
          })();
          const goalFeasible = remainingToGoal > 0 && remainingToGoal < remainingMonths;

          // Binary search for required extra payment to hit goal
          const requiredExtra = (() => {
            if (!goalFeasible) return null;
            let lo = 0, hi = 50000;
            for (let iter = 0; iter < 60; iter++) {
              const mid = (lo + hi) / 2;
              let bal = loanBalance, months = 0;
              const pmt45 = mpmt(bal, buydownRate, remainingMonths), r55 = permRate / 100 / 12;
              for (let m = 0; m < buydownMonthsLeft && bal > 0; m++) {
                const i = bal * (buydownRate / 100 / 12);
                bal = Math.max(bal - (pmt45 + mid - i), 0); months++;
              }
              if (bal > 0) {
                const p55 = mpmt(bal, permRate, remainingMonths - buydownMonthsLeft);
                while (bal > 0) { const i = bal * r55, p = Math.min(p55 + mid, bal + i); bal = Math.max(bal - (p - i), 0); months++; }
              }
              if (months <= remainingToGoal) hi = mid; else lo = mid;
            }
            return Math.ceil((lo + hi) / 2);
          })();

          // Simulate with requiredExtra
          const goalSim = (() => {
            if (!requiredExtra) return null;
            let bal = loanBalance, ti = 0, months = 0; const sched = [];
            const pmt45 = mpmt(bal, buydownRate, remainingMonths), r55 = permRate / 100 / 12;
            for (let m = 0; m < buydownMonthsLeft && bal > 0; m++) {
              const i = bal * (buydownRate / 100 / 12), p = Math.min(pmt45 + requiredExtra, bal + i);
              ti += i; bal = Math.max(bal - (p - i), 0); months++;
              sched.push({ month: months, balance: bal, cumInterest: ti });
            }
            if (bal > 0) {
              const p55 = mpmt(bal, permRate, remainingMonths - buydownMonthsLeft);
              while (bal > 0) { const i = bal * r55, p = Math.min(p55 + requiredExtra, bal + i); ti += i; bal = Math.max(bal - (p - i), 0); months++; sched.push({ month: months, balance: bal, cumInterest: ti }); }
            }
            return { totalInterest: ti, months, schedule: sched };
          })();

          // Chart data merging baseline + withExtra + goalSim + withLump
          const plannerChartData = (() => {
            const len = appliedProduct.term;
            const data = [];
            for (let i = 0; i < len; i += 12) {
              const yr = Math.round((i + 1) / 12);
              const calYear = startYear + yr;
              const obj = { yr, calYear };
              if (i < baseline.schedule.length) obj.current = Math.round(baseline.schedule[i].balance);
              if (withExtra && i < withExtra.schedule.length) obj.extra = Math.round(withExtra.schedule[i].balance);
              if (goalSim && i < goalSim.schedule.length) obj.goal = Math.round(goalSim.schedule[i].balance);
              if (withLump && i < withLump.schedule.length) obj.lump = Math.round(withLump.schedule[i].balance);
              data.push(obj);
            }
            return data;
          })();

          const defaultPayoffYear = defaultPayoffYearVal;

          return (
          <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:16}}>
            {/* LEFT PANEL */}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>

              {/* ── Mode toggle ── */}
              <Card>
                <SL>Planner Mode</SL>
                <div style={{display:"flex",gap:6,marginBottom:16}}>
                  {[["extra","Extra /mo"],["goal","Payoff Goal"],["lump","Lump Sum"]].map(([m,l])=>(
                    <button key={m} onClick={()=>setPlannerMode(m)} style={{flex:1,padding:"9px 0",borderRadius:8,border:`1px solid ${plannerMode===m?"#6366f1":"#334155"}`,background:plannerMode===m?"#6366f120":"transparent",color:plannerMode===m?"#818cf8":"#64748b",fontSize:11,fontFamily:"DM Mono,monospace",cursor:"pointer",fontWeight:plannerMode===m?600:400}}>{l}</button>
                  ))}
                </div>

                {plannerMode==="extra" ? (
                  <>
                    <SL>Extra Monthly Principal</SL>
                    <NumInput label="Extra amount /month" value={extraPayment} onChange={setExtraPayment} pre="$" step={100}/>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
                      {[0,300,500,1000,1500,2000].map(v=>(
                        <button key={v} onClick={()=>setExtraPayment(v)} style={{padding:"5px 11px",fontSize:11,fontFamily:"DM Mono,monospace",background:extraPayment===v?"#6366f1":"#1e293b",color:extraPayment===v?"#fff":"#64748b",border:"1px solid #334155",borderRadius:6,cursor:"pointer"}}>{v===0?"None":`+$${v}`}</button>
                      ))}
                    </div>
                  </>
                ) : plannerMode==="goal" ? (
                  <>
                    <SL>Payoff Goal Year</SL>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <label style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.09em",fontFamily:"DM Mono,monospace"}}>Target payoff year</label>
                      <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #6366f170",borderRadius:8}}>
                        <input type="number" value={effectiveGoalYear} min={new Date().getFullYear()+1} max={defaultPayoffYear}
                          onChange={e=>setPayoffGoalYear(e.target.value)}
                          style={{background:"transparent",border:"none",outline:"none",color:"#f1f5f9",padding:"9px 10px",fontSize:16,width:"100%",fontFamily:"DM Mono,monospace",fontWeight:700}}/>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                        {[2,3,5,7,10].map(yrsEarly=>{
                          const yr = defaultPayoffYear - yrsEarly;
                          if (yr <= new Date().getFullYear()) return null;
                          return <button key={yrsEarly} onClick={()=>setPayoffGoalYear(String(yr))} style={{padding:"4px 9px",fontSize:11,fontFamily:"DM Mono,monospace",background:"#1e293b",color:"#64748b",border:"1px solid #334155",borderRadius:6,cursor:"pointer"}}>{yr} (-{yrsEarly}yr)</button>;
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <SL>One-Time Lump Sum Payment</SL>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",background:"#0f172a",border:"1px solid #f59e0b70",borderRadius:8}}>
                        <span style={{padding:"0 10px",color:"#f59e0b",fontSize:13,fontFamily:"DM Mono,monospace"}}>$</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={lumpSum}
                          onChange={e => { const n = parseInt(e.target.value); setLumpSum(isNaN(n) ? 0 : Math.max(0, n)); }}
                          style={{background:"transparent",border:"none",outline:"none",color:"#f1f5f9",padding:"9px 10px",fontSize:16,width:"100%",fontFamily:"DM Mono,monospace",fontWeight:700}}
                        />
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {[5000,10000,20000,30000,50000,100000].map(v=>(
                          <button key={v} onClick={()=>setLumpSum(v)} style={{padding:"4px 9px",fontSize:11,fontFamily:"DM Mono,monospace",background:lumpSum===v?"#f59e0b20":"#1e293b",color:lumpSum===v?"#f59e0b":"#64748b",border:`1px solid ${lumpSum===v?"#f59e0b50":"#334155"}`,borderRadius:6,cursor:"pointer"}}>${(v/1000).toFixed(0)}K</button>
                        ))}
                      </div>
                      {lumpSum > loanBalance && (
                        <div style={{fontSize:11,color:"#f87171",fontFamily:"DM Mono,monospace",padding:"6px 8px",background:"#1e293b",borderRadius:6}}>⚠️ Exceeds loan balance of {fmt(loanBalance)}</div>
                      )}
                      {withLump && lumpSum <= loanBalance && (
                        <div style={{fontSize:11,color:"#64748b",fontFamily:"DM Mono,monospace",padding:"8px 10px",background:"#0d1525",borderRadius:6,lineHeight:1.8}}>
                          New balance after payment: <strong style={{color:"#f59e0b"}}>{fmt(withLump.newBal)}</strong><br/>
                          New perm P&I: <strong style={{color:"#e2e8f0"}}>{fmt(withLump.newPermPmt)}/mo</strong>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </Card>

              {/* ── Results card ── */}
              {plannerMode==="extra" && withExtra && (()=>{
                const mthsSaved = remainingMonths - withExtra.months;
                const intSaved = baseline.totalInterest - withExtra.totalInterest;
                // S&P 500: invest extra payment for same duration instead
                const r7  = 0.07 / 12, r10 = 0.10 / 12;
                const sp7  = extraPayment * ((Math.pow(1+r7,  withExtra.months)-1) / r7);
                const sp10 = extraPayment * ((Math.pow(1+r10, withExtra.months)-1) / r10);
                const mortgageReturn = (intSaved / (extraPayment * withExtra.months) * 100).toFixed(1);
                return (
                  <Card>
                    <SL color="#10b981">With +${extraPayment}/mo</SL>
                    {[
                      ["Payoff",          `${(withExtra.months/12).toFixed(1)} yrs`,                   "#34d399"],
                      ["Time Saved",      `${(mthsSaved/12).toFixed(1)} yrs (${mthsSaved} mo)`,        "#34d399"],
                      ["Total Interest",  fmt(withExtra.totalInterest),                                 "#e2e8f0"],
                      ["Interest Saved",  fmt(intSaved),                                               "#34d399"],
                    ].map(([k,v,c])=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #1e293b",fontSize:12}}>
                        <span style={{color:"#64748b"}}>{k}</span>
                        <span style={{fontFamily:"DM Mono,monospace",color:c,fontWeight:600}}>{v}</span>
                      </div>
                    ))}

                    {/* S&P comparison block */}
                    <div style={{marginTop:12,background:"#0d1525",borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:10,color:"#38bdf8",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:"0.08em"}}>📈 vs Investing in S&P 500 Instead</span>
                        <span style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>{(withExtra.months/12).toFixed(1)} yr horizon</span>
                      </div>
                      {[
                        ["Mortgage (guaranteed)",  `${mortgageReturn}% return`,   fmt(intSaved),      "#10b981"],
                        ["S&P 500 @ 7% real",      "historical avg (real)",       fmt(Math.round(sp7)),  "#38bdf8"],
                        ["S&P 500 @ 10% nominal",  "historical avg (nominal)",    fmt(Math.round(sp10)), "#818cf8"],
                      ].map(([label, sub, val, color])=>(
                        <div key={label} style={{padding:"8px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                          <div>
                            <div style={{fontSize:11,color,fontFamily:"DM Mono,monospace",fontWeight:600}}>{label}</div>
                            <div style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>{sub}</div>
                          </div>
                          <span style={{fontSize:13,fontFamily:"DM Mono,monospace",color,fontWeight:700,flexShrink:0}}>{val}</span>
                        </div>
                      ))}
                      <div style={{padding:"8px 12px",fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace",lineHeight:1.7}}>
                        ⚖️ Mortgage savings are <strong style={{color:"#10b981"}}>guaranteed</strong>. S&P returns are <strong style={{color:"#f87171"}}>not</strong> — but historically higher over long horizons. Your mortgage rate is <strong style={{color:"#e2e8f0"}}>{permRate}%</strong>.
                      </div>
                    </div>
                  </Card>
                );
              })()}

              {plannerMode==="lump" && withLump && lumpSum <= loanBalance && (()=>{
                const intSaved = baseline.totalInterest - withLump.totalInterest;
                const mthsSaved = remainingMonths - withLump.months;
                const yearsRemaining = remainingMonths / 12;
                // S&P: invest lump sum for same horizon as loan remaining
                const sp7  = lumpSum * Math.pow(1.07, yearsRemaining);
                const sp10 = lumpSum * Math.pow(1.10, yearsRemaining);
                // Guaranteed return: interest saved as % of lump
                const mortgageReturn = lumpSum > 0 ? (intSaved / lumpSum * 100).toFixed(1) : "0.0";
                return (
                  <Card style={{border:"1px solid #f59e0b40"}}>
                    <SL color="#f59e0b">Lump Sum: {fmt(lumpSum)}</SL>
                    {[
                      ["New Balance",   fmt(withLump.newBal),                                     "#f59e0b"],
                      ["New Perm P&I",  fmt(withLump.newPermPmt)+"/mo",                           "#e2e8f0"],
                      ["Payoff",        `${(withLump.months/12).toFixed(1)} years`,               "#34d399"],
                      ["Months Saved",  `${mthsSaved} mo (${(mthsSaved/12).toFixed(1)} yrs)`,    "#34d399"],
                      ["Total Interest",fmt(withLump.totalInterest),                              "#e2e8f0"],
                      ["Interest Saved",fmt(intSaved),                                            "#34d399"],
                    ].map(([k,v,c])=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #1e293b",fontSize:12}}>
                        <span style={{color:"#64748b"}}>{k}</span>
                        <span style={{fontFamily:"DM Mono,monospace",color:c,fontWeight:600}}>{v}</span>
                      </div>
                    ))}

                    {/* S&P comparison block */}
                    <div style={{marginTop:12,background:"#0d1525",borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:10,color:"#38bdf8",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:"0.08em"}}>📈 vs Investing {fmt(lumpSum)} in S&P 500</span>
                        <span style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>{yearsRemaining.toFixed(1)} yr horizon</span>
                      </div>
                      {[
                        ["Mortgage (guaranteed)",  `${mortgageReturn}% return on lump`,  fmt(Math.round(intSaved)),    "#10b981"],
                        ["S&P 500 @ 7% real",      "historical avg (inflation adj)",      fmt(Math.round(sp7)),         "#38bdf8"],
                        ["S&P 500 @ 10% nominal",  "historical avg (before inflation)",   fmt(Math.round(sp10)),        "#818cf8"],
                      ].map(([label, sub, val, color])=>(
                        <div key={label} style={{padding:"8px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                          <div>
                            <div style={{fontSize:11,color,fontFamily:"DM Mono,monospace",fontWeight:600}}>{label}</div>
                            <div style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>{sub}</div>
                          </div>
                          <span style={{fontSize:13,fontFamily:"DM Mono,monospace",color,fontWeight:700,flexShrink:0}}>{val}</span>
                        </div>
                      ))}
                      <div style={{padding:"8px 12px",fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace",lineHeight:1.7}}>
                        ⚖️ Paying down mortgage gives <strong style={{color:"#10b981"}}>guaranteed {permRate}% savings</strong>. S&P returns are historically higher but <strong style={{color:"#f87171"}}>not guaranteed</strong> and don't reduce your debt.
                      </div>
                    </div>
                  </Card>
                );
              })()}

              {plannerMode==="goal" && (
                <Card style={{border: goalFeasible ? "1px solid #6366f150" : "1px solid #ef444450"}}>
                  {!goalFeasible ? (
                    <>
                      <SL color="#f87171">Invalid Goal</SL>
                      <div style={{fontSize:12,color:"#f87171",lineHeight:1.7}}>
                        {remainingToGoal <= 0
                          ? "That date has already passed."
                          : "Goal must be earlier than your current payoff date."}
                        <br/>
                        <span style={{color:"#64748b"}}>Current payoff: <strong style={{color:"#94a3b8"}}>{defaultPayoffYear}</strong></span>
                      </div>
                    </>
                  ) : (
                    <>
                      <SL color="#a78bfa">Payoff Goal: {effectiveGoalYear}</SL>
                      {goalSim && (()=>{
                        const intSaved = baseline.totalInterest - goalSim.totalInterest;
                        const r7  = 0.07 / 12, r10 = 0.10 / 12;
                        const sp7  = requiredExtra * ((Math.pow(1+r7,  goalSim.months)-1) / r7);
                        const sp10 = requiredExtra * ((Math.pow(1+r10, goalSim.months)-1) / r10);
                        const mortgageReturn = (intSaved / (requiredExtra * goalSim.months) * 100).toFixed(1);
                        return (
                          <>
                            {[
                              ["Required Extra /mo", fmt(requiredExtra),                                        "#a78bfa"],
                              ["New P&I (perm)",     fmt(baseline.pmt55 + requiredExtra),                      "#e2e8f0"],
                              ["Payoff in",          `${(goalSim.months/12).toFixed(1)} yrs`,                  "#34d399"],
                              ["Time Saved",         `${((remainingMonths-goalSim.months)/12).toFixed(1)} yrs`,"#34d399"],
                              ["Total Interest",     fmt(goalSim.totalInterest),                               "#f59e0b"],
                              ["Interest Saved",     fmt(intSaved),                                            "#34d399"],
                            ].map(([k,v,c])=>(
                              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #1e293b",fontSize:12}}>
                                <span style={{color:"#64748b"}}>{k}</span>
                                <span style={{fontFamily:"DM Mono,monospace",color:c,fontWeight:600}}>{v}</span>
                              </div>
                            ))}
                            {/* S&P comparison */}
                            <div style={{marginTop:12,background:"#0d1525",borderRadius:8,overflow:"hidden"}}>
                              <div style={{padding:"8px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                <span style={{fontSize:10,color:"#38bdf8",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:"0.08em"}}>📈 vs Investing {fmt(requiredExtra)}/mo in S&P 500</span>
                                <span style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>{(goalSim.months/12).toFixed(1)} yr</span>
                              </div>
                              {[
                                ["Mortgage (guaranteed)", `${mortgageReturn}% return`,              fmt(Math.round(intSaved)), "#10b981"],
                                ["S&P 500 @ 7% real",    "historical avg (inflation adj)",          fmt(Math.round(sp7)),      "#38bdf8"],
                                ["S&P 500 @ 10% nominal","historical avg (before inflation)",        fmt(Math.round(sp10)),     "#818cf8"],
                              ].map(([label,sub,val,color])=>(
                                <div key={label} style={{padding:"8px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                                  <div>
                                    <div style={{fontSize:11,color,fontFamily:"DM Mono,monospace",fontWeight:600}}>{label}</div>
                                    <div style={{fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>{sub}</div>
                                  </div>
                                  <span style={{fontSize:13,fontFamily:"DM Mono,monospace",color,fontWeight:700,flexShrink:0}}>{val}</span>
                                </div>
                              ))}
                              <div style={{padding:"8px 12px",fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace",lineHeight:1.7}}>
                                ⚖️ Mortgage savings are <strong style={{color:"#10b981"}}>guaranteed at {permRate}%</strong>. S&P returns are historically higher but <strong style={{color:"#f87171"}}>not guaranteed</strong>.
                              </div>
                            </div>
                            <div style={{marginTop:10,padding:"8px 12px",background:"#1e293b",borderRadius:8,fontSize:11,fontFamily:"DM Mono,monospace",color:"#64748b",lineHeight:1.8}}>
                              💡 Add <strong style={{color:"#a78bfa"}}>{fmt(requiredExtra)}/mo</strong> to principal to be mortgage-free by <strong style={{color:"#a78bfa"}}>Jan {effectiveGoalYear}</strong>.
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
                </Card>
              )}

              {/* ── Quick lookup table ── */}
              <Card>
                <SL>Quick Reference</SL>
                <div style={{fontFamily:"DM Mono,monospace"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:6}}>
                    {["Extra /mo","Payoff","Saves"].map(h=><div key={h} style={{fontSize:10,color:"#475569",textTransform:"uppercase"}}>{h}</div>)}
                  </div>
                  {extraSensitivity.map(({extra,savings,years})=>(
                    <div key={extra} onClick={()=>{setPlannerMode("extra");setExtraPayment(extra);}}
                      style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,padding:"5px 4px",borderBottom:"1px solid #1e293b",fontSize:11,
                        background:extra===extraPayment&&plannerMode==="extra"?"#1e293b":"transparent",borderRadius:4,cursor:"pointer"}}>
                      <span style={{color:extra===extraPayment&&plannerMode==="extra"?"#818cf8":"#64748b"}}>+${extra}</span>
                      <span style={{color:"#94a3b8"}}>{years} yrs</span>
                      <span style={{color:savings>0?"#34d399":"#475569"}}>{savings>0?`$${(savings/1000).toFixed(0)}K`:"—"}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* RIGHT PANEL */}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>

              {/* Balance chart */}
              <Card>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <SL>Loan Balance Over Time</SL>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                    {[["current","#6366f1","Baseline"],
                      withExtra&&plannerMode==="extra"?["extra","#10b981",`+$${extraPayment}/mo`]:null,
                      goalSim&&plannerMode==="goal"?["goal","#a78bfa",`Goal ${effectiveGoalYear}`]:null,
                      withLump&&plannerMode==="lump"?["lump","#f59e0b",`Lump ${fmt(lumpSum)}`]:null,
                    ].filter(Boolean).map(([key,color,label])=>(
                      <div key={key} style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:20,height:3,borderRadius:2,background:color}}/>
                        <span style={{fontSize:11,color,fontFamily:"DM Mono,monospace"}}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={plannerChartData}>
                    <defs>
                      <linearGradient id="pp1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient>
                      <linearGradient id="pp2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                      <linearGradient id="pp3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2}/><stop offset="95%" stopColor="#a78bfa" stopOpacity={0}/></linearGradient>
                      <linearGradient id="pp4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                    <XAxis dataKey="calYear" type="number" domain={["dataMin","dataMax"]} stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>String(v)} allowDuplicatedCategory={false}/>
                    <YAxis stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`}/>
                    <Tooltip formatter={(v,n)=>[`$${(v/1000).toFixed(0)}K`,n]} labelFormatter={v=>`${v}`} contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}}/>
                    <Area type="monotone" dataKey="current" name="Baseline" stroke="#6366f1" fill="url(#pp1)" strokeWidth={2} dot={false}/>
                    {withExtra&&plannerMode==="extra"&&<Area type="monotone" dataKey="extra" name={`+$${extraPayment}/mo`} stroke="#10b981" fill="url(#pp2)" strokeWidth={2} dot={false}/>}
                    {goalSim&&plannerMode==="goal"&&<Area type="monotone" dataKey="goal" name={`Goal ${effectiveGoalYear}`} stroke="#a78bfa" fill="url(#pp3)" strokeWidth={2} dot={false}/>}
                    {withLump&&plannerMode==="lump"&&<Area type="monotone" dataKey="lump" name={`Lump ${fmt(lumpSum)}`} stroke="#f59e0b" fill="url(#pp4)" strokeWidth={2} dot={false}/>}
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* Interest saved curve */}
              <Card>
                <SL>Interest Saved vs Extra Monthly Payment</SL>
                {(()=>{
                  const sens=Array.from({length:21},(_,i)=>i*100).map(extra=>{
                    let bal=loanBalance,ti=0,months=0;
                    const pmt45=mpmt(bal,buydownRate,remainingMonths),r55=permRate/100/12;
                    for(let m=0;m<buydownMonthsLeft&&bal>0;m++){const i=bal*(buydownRate/100/12);bal=Math.max(bal-(pmt45+extra-i),0);ti+=i;months++;}
                    if(bal>0){const p55=mpmt(bal,permRate,remainingMonths-buydownMonthsLeft);while(bal>0){const i=bal*r55,p=Math.min(p55+extra,bal+i);bal=Math.max(bal-(p-i),0);ti+=i;months++;}}
                    return{extra,savings:Math.round(baseline.totalInterest-ti)};
                  });
                  const activeExtra = plannerMode==="goal" && requiredExtra ? requiredExtra : extraPayment;
                  return(
                    <div style={{position:"relative"}}>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={sens}>
                          <defs><linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                          <XAxis dataKey="extra" stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`$${v}`}/>
                          <YAxis stroke="#1e293b" tick={{fill:"#475569",fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`}/>
                          <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontFamily:"DM Mono,monospace",fontSize:12}} labelFormatter={v=>`+$${v}/mo extra`}/>
                          <Area type="monotone" dataKey="savings" name="Interest Saved" stroke="#f59e0b" fill="url(#sg2)" strokeWidth={2} dot={false}/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
              </Card>

              {/* Milestone timeline */}
              <Card>
                <SL color="#38bdf8">Payoff Milestones</SL>
                {(()=>{
                  const scenarios = [
                    {label:"No extra",extra:0,lump:0,color:"#64748b"},
                    {label:"+$300/mo",extra:300,lump:0,color:"#6366f1"},
                    {label:"+$500/mo",extra:500,lump:0,color:"#10b981"},
                    {label:"+$1,000/mo",extra:1000,lump:0,color:"#f59e0b"},
                    ...(plannerMode==="goal"&&requiredExtra?[{label:`Goal ${effectiveGoalYear}`,extra:requiredExtra,lump:0,color:"#a78bfa"}]:[]),
                    ...(plannerMode==="lump"&&withLump&&lumpSum>0&&lumpSum<=loanBalance?[{label:`Lump ${fmt(lumpSum)}`,extra:0,lump:lumpSum,color:"#f59e0b"}]:[]),
                  ];
                  const MAX_MONTHS = remainingMonths + 12;
                  // Pre-compute baseline perm payment (needed for lump scenario)
                  const origPmt45ms = mpmt(loanBalance, buydownRate, remainingMonths);
                  let bbalMs = loanBalance;
                  for (let m = 0; m < buydownMonthsLeft && bbalMs > 0; m++) {
                    const i = bbalMs * (buydownRate/100/12);
                    bbalMs = Math.max(bbalMs - (origPmt45ms - i), 0);
                  }
                  const origPermPmtMs = mpmt(bbalMs, permRate, remainingMonths - buydownMonthsLeft);

                  const milestones = scenarios.map(sc => {
                    // Apply lump sum upfront
                    let bal = Math.max(loanBalance - sc.lump, 0);
                    let ti = 0, months = 0, m25 = null, m50 = null, m75 = null;
                    const origBal = loanBalance; // markers based on original balance
                    const r45 = buydownRate / 100 / 12;
                    const r55 = permRate / 100 / 12;
                    // Buydown phase
                    for (let m = 0; m < buydownMonthsLeft && bal > 0 && months < MAX_MONTHS; m++) {
                      const i = bal * r45;
                      bal = Math.max(bal - Math.min(origPmt45ms + sc.extra - i, bal), 0);
                      ti += i; months++;
                      if (!m25 && bal <= origBal * 0.75) m25 = months;
                      if (!m50 && bal <= origBal * 0.50) m50 = months;
                      if (!m75 && bal <= origBal * 0.25) m75 = months;
                    }
                    // Permanent phase — use original perm payment for lump scenarios (shortens term)
                    // For extra payment scenarios, use origPermPmt + extra
                    const p55 = origPermPmtMs;
                    while (bal > 0.005 && months < MAX_MONTHS) {
                      const i = bal * r55;
                      bal = Math.max(bal - Math.min(p55 + sc.extra - i, bal), 0);
                      ti += i; months++;
                      if (!m25 && bal <= origBal * 0.75) m25 = months;
                      if (!m50 && bal <= origBal * 0.50) m50 = months;
                      if (!m75 && bal <= origBal * 0.25) m75 = months;
                    }
                    return { ...sc, payoff: months, m25, m50, m75, totalInterest: Math.round(ti) };
                  });
                  const maxMonths = milestones[0].payoff || 1;
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {milestones.map((ms,i)=>(
                        <div key={i}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                            <span style={{fontSize:11,color:ms.color,fontFamily:"DM Mono,monospace",fontWeight:600}}>{ms.label}</span>
                            <span style={{fontSize:11,color:"#94a3b8",fontFamily:"DM Mono,monospace"}}>
                              {(ms.payoff/12).toFixed(1)} yrs · {fmt(ms.totalInterest)} total int
                            </span>
                          </div>
                          <div style={{position:"relative",height:10,background:"#1e293b",borderRadius:5,overflow:"visible"}}>
                            {/* 25%, 50%, 75% markers */}
                            {[ms.m25,ms.m50,ms.m75].map((m,mi)=>m&&(
                              <div key={mi} style={{position:"absolute",left:`${(m/maxMonths)*100}%`,top:-2,width:2,height:14,background:ms.color,opacity:0.5,borderRadius:1}}/>
                            ))}
                            <div style={{height:"100%",width:`${(ms.payoff/maxMonths)*100}%`,background:ms.color,borderRadius:5,opacity:0.85}}/>
                          </div>
                          <div style={{display:"flex",gap:10,marginTop:3,fontSize:10,color:"#475569",fontFamily:"DM Mono,monospace"}}>
                            {ms.m25&&<span>25% paid: yr {(ms.m25/12).toFixed(1)}</span>}
                            {ms.m50&&<span>50% paid: yr {(ms.m50/12).toFixed(1)}</span>}
                            {ms.m75&&<span>75% paid: yr {(ms.m75/12).toFixed(1)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </Card>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
