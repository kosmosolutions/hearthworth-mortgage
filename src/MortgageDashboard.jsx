import { useState, useEffect, useMemo, useCallback } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
         ResponsiveContainer, AreaChart, Area, ReferenceLine } from 'recharts'

// ── IMAGE URLS ──
const IMGS = {
  hero:      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1800&q=80",
  calc:      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=900&q=80",
  refi:      "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1400&q=80",
  payoff:    "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=900&q=80",
  market:    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=900&q=80",
  knowledge: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1400&q=80",
}

// ── MATH ──
function mpmt(bal, rate, n) {
  const r = rate / 100 / 12
  if (!r || !n) return bal / (n || 1)
  return bal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
}

function computePMI(bal, val) {
  const ltv = val > 0 ? bal / val : 0
  if (ltv <= 0.80) return 0
  const r = ltv <= 0.85 ? 0.006 : ltv <= 0.90 ? 0.008 : ltv <= 0.95 ? 0.010 : 0.012
  return Math.round(bal * r / 12)
}

function pmiDropOff(bal, val, rate, months) {
  const threshold = val * 0.80
  if (bal <= threshold) return 0
  const pmt = mpmt(bal, rate, months)
  let b = bal
  for (let m = 1; m <= months; m++) {
    const i = b * (rate / 100 / 12)
    b = Math.max(b - (pmt - i), 0)
    if (b <= threshold) return m
  }
  return null
}

function amortize(balance, product, permRate, monthsElapsed = 0) {
  const term = product.term
  const isARM = product.armAdj != null
  const phases = (product.phases || []).map(p => ({ months: p.months, rate: permRate + p.offset }))
  const tailRate = isARM ? permRate + (product.armAdj || 2) : permRate
  const allPhases = [...phases, { months: term - phases.reduce((a, p) => a + p.months, 0), rate: tailRate }]
  let cumStart = 0, curIdx = 0
  for (let i = 0; i < allPhases.length; i++) {
    if (monthsElapsed < cumStart + allPhases[i].months) { curIdx = i; break }
    cumStart += allPhases[i].months; curIdx = i
  }
  let bal = balance, ti = 0, done = 0
  const full = []
  for (let pi = 0; pi < allPhases.length; pi++) {
    const ph = allPhases[pi], r = ph.rate / 100 / 12, rem = term - done
    if (rem <= 0 || bal <= 0) break
    const isLast = pi === allPhases.length - 1
    const n = isLast ? rem : Math.min(ph.months, rem)
    const pmt = mpmt(bal, ph.rate, rem)
    for (let m = 0; m < n && done < term && bal > 0; m++) {
      const i = bal * r, p = Math.min(pmt - i, bal)
      ti += i; bal = Math.max(bal - p, 0); done++
      full.push({ month: done, balance: bal, interest: i, principal: p, cumInterest: ti, rate: ph.rate, phaseIdx: pi, pmt })
    }
  }
  const future = full.slice(monthsElapsed)
  const iSoFar = monthsElapsed > 0 ? (full[monthsElapsed - 1]?.cumInterest || 0) : 0
  const pmtList = []
  for (let pi = curIdx; pi < allPhases.length; pi++) {
    const entries = future.filter(s => s.phaseIdx === pi)
    if (!entries.length) continue
    pmtList.push({
      rate: allPhases[pi].rate, pmt: entries[0].pmt, months: entries.length,
      isARM: isARM && pi === allPhases.length - 1 && phases.length > 0,
      isCurrent: pi === curIdx,
    })
  }
  const remap = future.map((s, i) => ({ ...s, month: i + 1, cumInterest: s.cumInterest - iSoFar }))
  return {
    pmt55: pmtList[pmtList.length - 1]?.pmt || 0,
    pmt45: pmtList[0]?.pmt || 0,
    totalInterest: ti - iSoFar,
    schedule: remap, pmtList, allPhases,
    currentPhaseIdx: curIdx,
    remainingMonths: term - monthsElapsed,
    isARM,
  }
}

function computeScenario({ balance, credit = 0, noteRate, product }) {
  const bal0 = Math.max(balance - credit, 0), term = product.term
  const isARM = product.armAdj != null
  const phases = (product.phases || []).map(p => ({ months: p.months, rate: noteRate + p.offset }))
  const tailRate = isARM ? noteRate + (product.armAdj || 2) : noteRate
  const all = [...phases, { months: term, rate: tailRate }]
  let bal = bal0, ti = 0, done = 0
  const sched = []
  for (let pi = 0; pi < all.length; pi++) {
    const { months: nm, rate } = all[pi], r = rate / 100 / 12, rem = term - done
    if (rem <= 0 || bal <= 0) break
    const isLast = pi === all.length - 1, n = isLast ? rem : Math.min(nm, rem)
    const pmt = mpmt(bal, rate, rem)
    for (let m = 0; m < n && done < term && bal > 0; m++) {
      const i = bal * r, p = Math.min(pmt - i, bal)
      ti += i; bal = Math.max(bal - p, 0); done++
      sched.push({ month: done, balance: bal, interest: i, principal: p, cumInterest: ti })
    }
    if (isLast) break
  }
  let b2 = bal0
  const pmtList = []
  for (let pi = 0; pi < all.length; pi++) {
    const { months: nm, rate } = all[pi], rem = term - pmtList.reduce((a, p) => a + p.months, 0)
    const pmt = mpmt(b2, rate, rem), r = rate / 100 / 12, n = Math.min(nm, rem)
    pmtList.push({ rate, pmt, months: n, isARM: isARM && pi === all.length - 1 && phases.length > 0 })
    for (let m = 0; m < n && b2 > 0; m++) { const i = b2 * r; b2 = Math.max(b2 - (pmt - i), 0) }
    if (pi === all.length - 1) break
  }
  return { totalInterest: ti, schedule: sched, pmtList, balance: bal0 }
}

const fmt = (n, d = 0) => '$' + Number(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const fmtK = n => n >= 1000 ? '$' + (n / 1000).toFixed(0) + 'K' : fmt(n)

// ── PRODUCTS ──
const PRODUCT_GROUPS = [
  { group: "Conventional Fixed", products: [
    { id: "fixed10", label: "Fixed 10-Year",  term: 120, phases: [] },
    { id: "fixed15", label: "Fixed 15-Year",  term: 180, phases: [] },
    { id: "fixed20", label: "Fixed 20-Year",  term: 240, phases: [] },
    { id: "fixed25", label: "Fixed 25-Year",  term: 300, phases: [] },
    { id: "fixed30", label: "Fixed 30-Year",  term: 360, phases: [] },
  ]},
  { group: "Buydown", products: [
    { id: "buy10_30",  label: "1-0 Buydown 30yr",   term: 360, phases: [{ months: 12, offset: -1 }] },
    { id: "buy210_30", label: "2-1-0 Buydown 30yr",  term: 360, phases: [{ months: 12, offset: -2 }, { months: 12, offset: -1 }] },
    { id: "buy321_30", label: "3-2-1 Buydown 30yr",  term: 360, phases: [{ months: 12, offset: -3 }, { months: 12, offset: -2 }, { months: 12, offset: -1 }] },
    { id: "buy10_15",  label: "1-0 Buydown 15yr",   term: 180, phases: [{ months: 12, offset: -1 }] },
    { id: "buy210_15", label: "2-1-0 Buydown 15yr",  term: 180, phases: [{ months: 12, offset: -2 }, { months: 12, offset: -1 }] },
  ]},
  { group: "Adjustable Rate (ARM)", products: [
    { id: "arm51_30",  label: "5/1 ARM 30yr",  term: 360, phases: [{ months: 60,  offset: 0 }], armAdj: 2.0 },
    { id: "arm71_30",  label: "7/1 ARM 30yr",  term: 360, phases: [{ months: 84,  offset: 0 }], armAdj: 1.5 },
    { id: "arm101_30", label: "10/1 ARM 30yr", term: 360, phases: [{ months: 120, offset: 0 }], armAdj: 1.0 },
  ]},
  { group: "FHA", products: [
    { id: "fha30", label: "FHA 30-Year Fixed", term: 360, phases: [], mip: 0.55, downMin: 3.5 },
    { id: "fha15", label: "FHA 15-Year Fixed", term: 180, phases: [], mip: 0.55 },
  ]},
  { group: "VA (Veterans)", products: [
    { id: "va30",    label: "VA 30-Year Fixed", term: 360, phases: [], noMI: true, fundingFee: 2.15 },
    { id: "va15",    label: "VA 15-Year Fixed", term: 180, phases: [], noMI: true, fundingFee: 2.15 },
    { id: "va_irrrl",label: "VA IRRRL Refi",    term: 360, phases: [], noMI: true, fundingFee: 0.5  },
  ]},
  { group: "USDA", products: [
    { id: "usda30", label: "USDA 30-Year Fixed", term: 360, phases: [], mip: 0.35, upfrontFee: 1.0 },
  ]},
  { group: "Jumbo", products: [
    { id: "jumbo30",    label: "Jumbo Fixed 30yr", term: 360, phases: [] },
    { id: "jumbo15",    label: "Jumbo Fixed 15yr", term: 180, phases: [] },
    { id: "jumbo_arm51",label: "Jumbo 5/1 ARM",   term: 360, phases: [{ months: 60, offset: 0 }], armAdj: 2.0 },
  ]},
  { group: "Refinance", products: [
    { id: "refi_rr30", label: "Rate/Term Refi 30yr",  term: 360, phases: [] },
    { id: "refi_rr15", label: "Rate/Term Refi 15yr",  term: 180, phases: [] },
    { id: "refi_co30", label: "Cash-Out Refi 30yr",   term: 360, phases: [] },
    { id: "refi_fha",  label: "FHA Streamline Refi",  term: 360, phases: [], mip: 0.55 },
    { id: "refi_va",   label: "VA IRRRL Refi",        term: 360, phases: [], noMI: true, fundingFee: 0.5 },
  ]},
]
const PRODUCTS = PRODUCT_GROUPS.flatMap(g => g.products.map(p => ({ ...p, group: g.group })))
const SC_COLORS = ["#1a5c2a", "#c9a84c", "#1a3c5c", "#8b2a2a", "#3c5c1a", "#5c1a5c", "#c97c1a", "#1a5c5c"]

const defaultLoan = {
  productId: "buy10_15", loanBalance: 701784, homeValue: 900000,
  permRate: 5.5, monthlyTaxes: 698, monthlyInsurance: 150,
  loanStartDate: "2024-09", pmiOverride: false, monthlyPMI: 0,
}

// ── SHARED COMPONENTS ──
function StatBox({ label, value, sub, color }) {
  return (
    <div className="statbox">
      <div className="statbox-label">{label}</div>
      <div className="statbox-val" style={{ color: color || 'var(--forest)' }}>{value}</div>
      {sub && <div className="statbox-sub">{sub}</div>}
    </div>
  )
}

function DcInput({ label, value, onChange, pre, suf, step = 1, min = 0, type = 'number' }) {
  return (
    <div className="input-wrap">
      <label className="input-label">{label}</label>
      <div className="input-inner">
        {pre && <span className="input-pre">{pre}</span>}
        <input type={type} value={value} step={step} min={min}
          onChange={e => onChange(type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)} />
        {suf && <span className="input-pre" style={{ borderLeft: '1px solid var(--border)', borderRight: 'none' }}>{suf}</span>}
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ fontSize: 10, color: 'var(--stone-light)', fontFamily: 'var(--fm)', marginBottom: 5 }}>Yr {label}</div>
      {payload.map((p, i) => <div key={i} style={{ fontSize: 11, color: p.color, fontFamily: 'var(--fm)', fontWeight: 600 }}>{p.name}: {fmtK(p.value)}</div>)}
    </div>
  )
}

// ── TREASURY CHART ──
const FRED_SERIES_ID = 'DGS10'
function TreasuryChartEmbed({ compact = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentYield, setCurrentYield] = useState(null)

  useEffect(() => {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.json?id=${FRED_SERIES_ID}&limit=520&sort_order=asc&observation_start=2015-01-01`
    fetch(url)
      .then(r => r.json())
      .then(json => {
        const pts = (json || []).filter(d => d.value !== '.' && !isNaN(parseFloat(d.value)))
        const sampled = pts.filter((_, i) => i % 5 === 0).map(d => ({
          date: d.date,
          t: parseFloat(parseFloat(d.value).toFixed(2)),
          m: parseFloat((parseFloat(d.value) + 1.75).toFixed(2)),
          label: d.date.slice(0, 7),
        }))
        if (sampled.length > 0) { setData(sampled); setCurrentYield(sampled[sampled.length - 1].t) }
        setLoading(false)
      })
      .catch(() => {
        const fallback = [
          { date: '2015-01', t: 1.88, m: 3.63 }, { date: '2015-07', t: 2.35, m: 4.10 },
          { date: '2016-01', t: 2.09, m: 3.84 }, { date: '2016-07', t: 1.46, m: 3.21 },
          { date: '2017-01', t: 2.45, m: 4.20 }, { date: '2017-07', t: 2.32, m: 4.07 },
          { date: '2018-01', t: 2.55, m: 4.30 }, { date: '2018-07', t: 2.89, m: 4.64 },
          { date: '2019-01', t: 2.63, m: 4.38 }, { date: '2019-07', t: 2.01, m: 3.76 },
          { date: '2020-01', t: 1.76, m: 3.51 }, { date: '2020-04', t: 0.60, m: 3.35 },
          { date: '2020-07', t: 0.58, m: 3.00 }, { date: '2021-01', t: 1.11, m: 2.86 },
          { date: '2021-07', t: 1.30, m: 2.99 }, { date: '2022-01', t: 1.79, m: 3.54 },
          { date: '2022-05', t: 2.96, m: 4.71 }, { date: '2022-10', t: 4.01, m: 6.90 },
          { date: '2023-01', t: 3.54, m: 6.29 }, { date: '2023-07', t: 3.97, m: 6.81 },
          { date: '2023-10', t: 4.93, m: 7.79 }, { date: '2024-01', t: 3.97, m: 6.72 },
          { date: '2024-04', t: 4.62, m: 7.02 }, { date: '2024-07', t: 4.19, m: 6.78 },
          { date: '2024-10', t: 4.28, m: 6.72 }, { date: '2025-01', t: 4.57, m: 6.95 },
          { date: '2025-05', t: 4.38, m: 6.87 },
        ]
        setData(fallback); setCurrentYield(4.38); setLoading(false); setError("Using indicative data")
      })
  }, [])

  const h = compact ? 260 : 340
  if (loading) return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--stone)', fontFamily: 'var(--fm)', fontSize: 13 }}>Loading treasury data…</div>

  return (
    <div style={{ marginTop: compact ? 0 : 40 }}>
      <div className="treasury-card">
        <div className="treasury-chart-header">
          <div>
            <div style={{ fontFamily: 'var(--fp)', fontSize: 17, fontWeight: 700, color: 'var(--forest)', marginBottom: 4 }}>
              10-Year U.S. Treasury Yield
              {currentYield && <span style={{ marginLeft: 12, fontSize: 22, color: 'var(--gold)' }}>{currentYield.toFixed(2)}%</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--stone-light)' }}>
              2015 – Present · with approx. 30-yr mortgage rate overlay
              {error && <span style={{ color: 'var(--gold)' }}> ({error})</span>}
            </div>
          </div>
          <div className="live-badge"><span className="live-dot"></span>{error ? 'Indicative' : 'Live FRED Data'}</div>
        </div>
        <ResponsiveContainer width="100%" height={h}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--stone-light)', fontSize: 10, fontFamily: 'var(--fm)' }} stroke="var(--border)" interval={Math.floor((data?.length || 1) / 8)} />
            <YAxis tick={{ fill: 'var(--stone-light)', fontSize: 10, fontFamily: 'var(--fm)' }} stroke="var(--border)" tickFormatter={v => `${v}%`} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10, fontFamily: 'var(--fm)', fontSize: 11, boxShadow: 'var(--shadow-md)' }} formatter={(v, n) => [`${v}%`, n]} />
            <ReferenceLine y={6.5} stroke="var(--gold)" strokeDasharray="6 3" label={{ value: 'Refi Zone', position: 'insideTopRight', fill: 'var(--gold)', fontSize: 10, fontFamily: 'var(--fm)' }} />
            <Line type="monotone" dataKey="t" name="10-Yr Treasury" stroke="var(--forest)" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="m" name="~30-Yr Mortgage" stroke="var(--gold)" strokeWidth={2} dot={false} strokeOpacity={0.85} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
          {[["var(--forest)", "10-Yr Treasury Yield"], ["var(--gold)", "~30-Yr Mortgage Rate (est.)"], ["var(--gold)", "Refi Opportunity Zone (<6.5%)", true]].map(([c, l, dashed]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg width="20" height="3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke={c} strokeWidth="2" strokeDasharray={dashed ? "5 3" : "0"} /></svg>
              <span style={{ fontSize: 11, color: 'var(--stone)', fontFamily: 'var(--fm)' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── LOAN SETUP MODAL ──
function LoanSetupModal({ loan, onClose, onSubmit }) {
  const [draft, setDraft] = useState({ ...loan })
  const setF = useCallback((f, v) => setDraft(d => ({ ...d, [f]: v })), [])
  const draftLTV = draft.homeValue > 0 ? draft.loanBalance / draft.homeValue : 0
  const draftLtvOk = draftLTV <= 0.8
  const autoPMI = computePMI(draft.loanBalance, draft.homeValue)
  const prod = PRODUCTS.find(p => p.id === draft.productId) || PRODUCTS[4]
  const pmt = mpmt(draft.loanBalance, draft.permRate, prod.term)
  const pmi = draft.pmiOverride ? draft.monthlyPMI : autoPMI
  const total = pmt + draft.monthlyTaxes + pmi + draft.monthlyInsurance

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="showcase-badge" style={{ marginBottom: 8 }}>Set Up Your Loan</div>
            <h2 className="modal-title">Enter Your Mortgage Details</h2>
            <p className="modal-sub">Used across all tools — Calculator, Refi Analyzer, and Payoff Planner.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-grid">
            <div>
              <div className="card-label" style={{ marginBottom: 12 }}>Loan Details</div>
              <div className="input-wrap">
                <label className="input-label">Loan Product</label>
                <div className="input-inner">
                  <select value={draft.productId} onChange={e => setF("productId", e.target.value)}>
                    {PRODUCT_GROUPS.map(g => <optgroup key={g.group} label={g.group}>{g.products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>)}
                  </select>
                </div>
              </div>
              <div className="input-wrap">
                <label className="input-label">Loan Start Date</label>
                <div className="input-inner"><input type="month" value={draft.loanStartDate || ""} onChange={e => setF("loanStartDate", e.target.value)} style={{ colorScheme: 'light' }} /></div>
              </div>
              <DcInput label="Loan Balance" value={draft.loanBalance} onChange={v => setF("loanBalance", v)} pre="$" step={1000} />
              <DcInput label="Home Value" value={draft.homeValue} onChange={v => setF("homeValue", v)} pre="$" step={1000} />
              <DcInput label="Interest Rate" value={draft.permRate} onChange={v => setF("permRate", v)} suf="%" step={0.125} />
              {(() => {
                const p = PRODUCTS.find(x => x.id === draft.productId)
                if (!p || !p.phases?.length) return null
                const nr = Number(draft.permRate || 5.5)
                const isArm = p.armAdj != null
                const path = isArm
                  ? `Fixed ${p.phases[0].months / 12}yr @ ${nr.toFixed(2)}% → ${(nr + (p.armAdj || 2)).toFixed(2)}%`
                  : [...p.phases.map((ph, i) => `Yr${i + 1}: ${(nr + ph.offset).toFixed(2)}%`), `Yr${p.phases.length + 1}+: ${nr.toFixed(2)}%`].join(' → ')
                return <div style={{ background: isArm ? '#fef9e8' : '#e8f5e8', border: `1px solid ${isArm ? '#f0e090' : '#b8ddb8'}`, borderRadius: 8, padding: '10px 12px', fontSize: 11, fontFamily: 'var(--fm)', color: isArm ? '#7a6010' : '#1a5c2a', lineHeight: 1.7, marginBottom: 8 }}>{path}</div>
              })()}
            </div>
            <div>
              <div className="card-label" style={{ marginBottom: 12 }}>Monthly PITI</div>
              <DcInput label="Property Tax /mo" value={draft.monthlyTaxes} onChange={v => setF("monthlyTaxes", v)} pre="$" step={10} />
              <div className="input-wrap">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label className="input-label" style={{ margin: 0 }}>PMI <span style={{ color: draftLtvOk ? '#1a5c2a' : '#8b1a1a' }}>(LTV {(draftLTV * 100).toFixed(1)}%)</span></label>
                  <button onClick={() => setF("pmiOverride", !draft.pmiOverride)} style={{ fontSize: 9, padding: '2px 7px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--stone)', cursor: 'pointer', fontFamily: 'var(--fm)' }}>{draft.pmiOverride ? "Auto" : "Override"}</button>
                </div>
                {draft.pmiOverride
                  ? <div className="input-inner"><span className="input-pre">$</span><input type="number" value={draft.monthlyPMI || 0} step={10} min={0} onChange={e => setF("monthlyPMI", parseFloat(e.target.value) || 0)} /></div>
                  : (
                    <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '9px 12px', border: `1px solid ${draftLtvOk ? '#b8ddb8' : '#f0e090'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--fm)', fontSize: 13, fontWeight: 700, color: draftLtvOk ? '#1a5c2a' : '#7a6010' }}>{autoPMI === 0 ? "$0 — PMI Waived" : fmt(autoPMI) + "/mo"}</span>
                        <span style={{ fontSize: 10, color: 'var(--stone-light)', fontFamily: 'var(--fm)' }}>auto</span>
                      </div>
                    </div>
                  )}
              </div>
              <DcInput label="Insurance /mo" value={draft.monthlyInsurance} onChange={v => setF("monthlyInsurance", v)} pre="$" step={10} />
              <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 14, marginTop: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--stone)', fontFamily: 'var(--fm)', marginBottom: 10 }}>Estimated Monthly PITI</div>
                {[["P&I", fmt(pmt)], ["Taxes", fmt(draft.monthlyTaxes)], ["PMI", fmt(pmi)], ["Insurance", fmt(draft.monthlyInsurance)]].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--fm)' }}>
                    <span style={{ color: 'var(--stone)' }}>{k}</span><span style={{ color: 'var(--charcoal)' }}>{v}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, fontSize: 14, fontWeight: 700, fontFamily: 'var(--fm)' }}>
                  <span style={{ color: 'var(--forest)' }}>Total PITI</span><span style={{ color: 'var(--forest)' }}>{fmt(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-forest" onClick={() => { onSubmit(draft); onClose() }}>Save & Open Calculator →</button>
        </div>
      </div>
    </div>
  )
}

// ── NAV ──
function Nav({ page, setPage, onGetStarted }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const h = () => { setScrolled(window.scrollY > 60); if (window.scrollY > 60) setMenuOpen(false) }
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])
  const isHome = page === 'home'
  const cls = `nav${isHome && !scrolled ? ' hero' : scrolled ? ' scrolled' : ''}${menuOpen ? ' menu-open' : ''}`
  const go = p => { setPage(p); window.scrollTo(0, 0); setMenuOpen(false) }
  return (
    <nav className={cls}>
      <button className="nav-brand" onClick={() => go('home')}>
        <div className="nav-logo">⌂</div>
        <span className="nav-brand-text">HearthWorth</span>
      </button>
      <div className={`nav-links${menuOpen ? ' open' : ''}`}>
        <button className="nav-link" onClick={() => go('calculator')}>Calculator</button>
        <button className="nav-link" onClick={() => go('market')}>Market Data</button>
        <button className="nav-link" onClick={() => go('knowledge')}>Knowledge</button>
        <button className="nav-cta" onClick={() => { onGetStarted(); setMenuOpen(false) }}>Get Started →</button>
      </div>
      <button className="nav-hamburger" onClick={() => setMenuOpen(m => !m)} aria-label="Toggle menu">
        <span className={menuOpen ? 'open' : ''}></span>
        <span className={menuOpen ? 'open' : ''}></span>
        <span className={menuOpen ? 'open' : ''}></span>
      </button>
    </nav>
  )
}

// ── HOME PAGE ──
function HomePage({ onGetStarted, setPage }) {
  const [openFaq, setOpenFaq] = useState(null)
  const faqs = [
    { q: "How does HearthWorth calculate my mortgage payment?", a: "HearthWorth uses the standard amortization formula M = P × [r(1+r)ⁿ] / [(1+r)ⁿ − 1] where P is principal, r is monthly rate, and n is term in months. All calculations run entirely in your browser — no data is sent to any server." },
    { q: "What loan products does HearthWorth support?", a: "Over 30 products including all conventional fixed terms (10, 15, 20, 25, 30 year), buydown structures (1-0, 2-1-0, 3-2-1), adjustable rate mortgages (5/1, 7/1, 10/1 ARMs), FHA, VA, USDA, Jumbo, and multiple refinance types." },
    { q: "How do I know if refinancing is worth it?", a: "The Refi Analyzer computes your break-even point (net closing costs ÷ monthly savings), total interest saved over the new loan term, and flags whether the scenario is 'Worth It', 'Marginal', or 'Not Worth It' based on your planned stay duration." },
    { q: "What is the 10-Year Treasury yield and why does it matter?", a: "The 10-Year U.S. Treasury Note yield is the benchmark that mortgage lenders use to price 30-year fixed loans. Lenders add a spread of roughly 1.5–2.5% on top. When the 10-year falls, mortgage rates typically follow within weeks — making it the best leading indicator for refinance timing." },
    { q: "Is my financial data private?", a: "100% private. HearthWorth runs entirely in your browser using JavaScript. Nothing is stored on any server, no account is required, and no data ever leaves your device." },
    { q: "Can I compare extra payments vs. investing?", a: "Yes. The Payoff Planner shows your interest savings from extra principal payments alongside the projected future value of investing that same amount in an S&P 500 index fund at both 7% (real) and 10% (nominal) historical return rates." },
  ]
  return (
    <div>
      {/* HERO */}
      <section className="hero">
        <div className="hero-bg"><img src={IMGS.hero} alt="Beautiful home" /></div>
        <div className="hero-overlay"></div>
        <div className="hero-inner">
          <div>
            <div className="hero-eyebrow"><span className="hero-dot"></span>Professional Mortgage Intelligence</div>
            <h1 className="hero-title">Make Smarter<br /><span>Home Financing</span><br />Decisions</h1>
            <p className="hero-sub">Institutional-grade mortgage analysis — compare loan products, model refinance scenarios, optimize payoff strategies, and track market rates. Built for homeowners who think like investors.</p>
            <div className="hero-actions">
              <button className="btn-gold" onClick={onGetStarted}>Get Started →</button>
              <button className="btn-outline-white" onClick={() => { setPage('market'); window.scrollTo(0, 0) }}>View Market Data</button>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="stats-section">
        <div className="stats-inner">
          {[["30+", "loan products", "analyzed"], ["$0", "cost", "always free"], ["100%", "private", "browser only"], ["4", "tools", "in one place"]].map(([n, t, s]) => (
            <div className="stat-item fadein" key={t}>
              <div className="stat-num"><span>{n}</span></div>
              <div className="stat-desc">{t} — {s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES STRIP */}
      <section className="features-strip">
        <div className="features-strip-inner">
          <div className="section-eyebrow fadein">What's Inside</div>
          <h2 className="section-title fadein fadein-d1">Everything You Need to Own<br />Your Mortgage Decision</h2>
          <p className="section-sub fadein fadein-d2">From initial purchase to refinance planning — HearthWorth covers every scenario with precision math and clear visualizations.</p>
          <div className="features-3grid">
            <div className="feature-tile fadein fadein-d1">
              <div className="feature-tile-img green">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="#c9a84c" strokeWidth="1.5" /><path d="M7 8h10M7 12h6M7 16h4" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" /><circle cx="17" cy="15" r="2" stroke="#c9a84c" strokeWidth="1.5" /></svg>
              </div>
              <div className="feature-tile-title">Mortgage Calculator</div>
              <div className="feature-tile-desc">Enter your loan details and instantly see payment breakdowns, amortization schedules, and equity projections across 30+ loan products including ARM, FHA, VA, USDA and Jumbo.</div>
            </div>
            <div className="feature-tile fadein fadein-d2">
              <div className="feature-tile-img gold">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 18l4-9 4 5 3-4 5 8" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 5h4M18 3v4" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </div>
              <div className="feature-tile-title">Refi Scenario Analyzer</div>
              <div className="feature-tile-desc">Model unlimited refinance scenarios with real closing costs, lender credits, break-even analysis, and true lifetime savings calculations. Instantly see "Worth It" verdicts.</div>
            </div>
            <div className="feature-tile fadein fadein-d3">
              <div className="feature-tile-img blue">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="#c9a84c" strokeWidth="1.5" opacity="0.25" /><circle cx="12" cy="12" r="8" stroke="#c9a84c" strokeWidth="1.5" strokeDasharray="30 50" strokeLinecap="round" transform="rotate(-90 12 12)" /><path d="M12 8v4l2.5 2.5" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="feature-tile-title">Payoff Planner</div>
              <div className="feature-tile-desc">Set a target payoff date or explore the impact of extra monthly payments and lump-sum contributions. Compare paying off your mortgage against investing in equities.</div>
            </div>
          </div>
        </div>
      </section>

      {/* SHOWCASE ROWS */}
      <section className="showcase">
        <div className="showcase-inner">
          <div className="showcase-row fadein">
            <div className="showcase-img">
              <img src={IMGS.calc} alt="Mortgage calculator" />
              <div className="showcase-img-overlay"></div>
            </div>
            <div>
              <div className="showcase-badge">Mortgage Calculator</div>
              <h3 className="showcase-title">Model Any Loan Product With Precision</h3>
              <p className="showcase-body">Choose from 30+ loan products and see complete payment schedules, phase-by-phase breakdowns for buydowns and ARMs, and dynamic PMI tracking that shows exactly when it drops off.</p>
              <ul className="showcase-list">
                <li>Full amortization table with yearly summaries</li>
                <li>Auto-computed PMI from LTV with drop-off prediction</li>
                <li>Support for buydown rate paths (1-0, 2-1-0, 3-2-1)</li>
                <li>ARM fixed vs. adjusted phase comparison</li>
              </ul>
            </div>
          </div>
          <div className="showcase-row reverse fadein">
            <div className="showcase-img">
              <img src={IMGS.refi} alt="Refinance analysis" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }} />
              <div className="showcase-img-overlay"></div>
            </div>
            <div>
              <div className="showcase-badge">Refi Analyzer</div>
              <h3 className="showcase-title">Know Exactly When to Refinance</h3>
              <p className="showcase-body">Add unlimited refinance scenarios and instantly see break-even timelines, true lifetime savings after closing costs, and side-by-side balance comparisons. Never wonder if it's worth it again.</p>
              <ul className="showcase-list">
                <li>Break-even analysis with net closing cost factored in</li>
                <li>True savings vs. current loan over full term</li>
                <li>Lender credit and cash-out modeling</li>
                <li>Investment opportunity: what if you invested the savings instead?</li>
              </ul>
            </div>
          </div>
          <div className="showcase-row fadein">
            <div className="showcase-img chart" style={{ background: 'var(--white)', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <TreasuryChartEmbed compact={true} />
            </div>
            <div>
              <div className="showcase-badge">Market Intelligence</div>
              <h3 className="showcase-title">Track the 10-Year Treasury for Refi Signals</h3>
              <p className="showcase-body">The 10-Year U.S. Treasury yield is the primary driver of 30-year mortgage rates. Our Market Data page shows live FRED data with mortgage rate overlay so you always know where rates are headed.</p>
              <ul className="showcase-list">
                <li>Live 10-Year Treasury data via FRED API</li>
                <li>Approximate 30-year mortgage rate overlay</li>
                <li>Refi opportunity zone indicator</li>
                <li>Rate spread analysis and timing guidance</li>
              </ul>
              <button className="btn-forest" onClick={() => { setPage('market'); window.scrollTo(0, 0) }}>View Market Data →</button>
            </div>
          </div>
        </div>
      </section>

      {/* GET STARTED CTA */}
      <section className="mid-cta-section">
        <div className="mid-cta-inner">
          <h2 className="mid-cta-title">Ready to Run the Numbers on Your Loan?</h2>
          <p className="mid-cta-sub">Enter your mortgage details once and get instant access to the Calculator, Refi Analyzer, and Payoff Planner.</p>
          <button className="btn-gold" onClick={onGetStarted} style={{ fontSize: 16, padding: '16px 36px' }}>Get Started — It's Free →</button>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq-section">
        <div className="faq-inner">
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div className="section-eyebrow" style={{ textAlign: 'center' }}>FAQ</div>
            <h2 className="section-title" style={{ textAlign: 'center' }}>Frequently Asked Questions</h2>
            <p className="section-sub" style={{ margin: '0 auto', textAlign: 'center' }}>Everything you need to know about HearthWorth.</p>
          </div>
          <div className="faq-list">
            {faqs.map((f, i) => (
              <div className={`faq-item${openFaq === i ? ' open' : ''}`} key={i}>
                <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{f.q}</span>
                  <span className="faq-icon">+</span>
                </button>
                <div className={`faq-a${openFaq === i ? ' open' : ''}`}>
                  <div className="faq-a-inner">{f.a}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <button className="btn-forest" onClick={() => { setPage('knowledge'); window.scrollTo(0, 0) }}>Visit the Knowledge Center →</button>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-title">Professional Mortgage Intelligence — Free</h2>
          <p className="cta-sub">Runs entirely in your browser. No account, no data shared, no cost. Built for homeowners who think like investors.</p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn-gold" onClick={onGetStarted}>Get Started →</button>
            <button className="btn-outline-white" onClick={() => { setPage('knowledge'); window.scrollTo(0,0) }}>Learn the Concepts</button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── MARKET PAGE ──
function MarketPage() {
  return (
    <div>
      <div className="page-hero">
        <img src={IMGS.market} alt="Market data" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }} />
        <div className="page-hero-overlay"></div>
        <div className="page-hero-content">
          <div className="showcase-badge fadein">Market Intelligence</div>
          <h1 className="page-hero-title fadein fadein-d1">10-Year Treasury & Mortgage Rates</h1>
          <p className="page-hero-sub fadein fadein-d2">The real-time signal that tells you when to refinance.</p>
        </div>
      </div>
      <div className="page-body">
        <div className="market-layout">
          <div><TreasuryChartEmbed compact={false} /></div>
          <div className="market-sidebar" style={{ marginTop: 40 }}>
            {[
              { title: "📡 Why the 10-Year Matters", body: "Mortgage lenders price 30-year fixed loans at a spread of ~1.5–2.5% above the 10-year Treasury yield. When the 10-year falls, mortgage rates typically follow within weeks." },
              { title: "🎯 The Refinance Rule", body: "Watch for the 10-year to drop below 3.8–4.2% — this typically corresponds to 30-year mortgage rates in the 5.5–6.0% range where refinancing becomes broadly compelling for those who purchased at 6.5%+." },
              { title: "📊 Spread History", body: "The spread between 10-yr Treasuries and 30-yr mortgages widened to near 3% in 2022–2023 (volatile market). A narrowing spread with a stable 10-yr means mortgage rates can fall even without Treasury moves." },
              { title: "⚡ Buying Strategy", body: "'Marry the house, date the rate.' Buying at a higher rate and refinancing when the 10-year retreats is a proven strategy. Every 1% drop in rate on a $400K loan saves ~$240/mo." },
            ].map(({ title, body }) => (
              <div className="treasury-insight-card" key={title}>
                <div className="insight-title">{title}</div>
                <div className="insight-body">{body}</div>
              </div>
            ))}
            <div className="rate-ref-table">
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold)', fontFamily: 'var(--fm)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Quick Rate Reference</div>
              {[["10-Yr at 3.5%", "~5.0–5.5% mortgage", "var(--forest)"], ["10-Yr at 4.0%", "~5.5–6.0% mortgage", "var(--forest)"], ["10-Yr at 4.5%", "~6.0–6.75% mortgage", "var(--gold)"], ["10-Yr at 5.0%+", "~7.0–7.5%+ mortgage", "#8b2a2a"]].map(([k, v, c]) => (
                <div className="rate-ref-row" key={k}>
                  <span style={{ color: 'var(--stone)' }}>{k}</span>
                  <span style={{ color: c, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── KNOWLEDGE PAGE ──
function KnowledgePage() {
  return (
    <div>
      <div className="page-hero">
        <img src={IMGS.knowledge} alt="Knowledge" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }} />
        <div className="page-hero-overlay"></div>
        <div className="page-hero-content">
          <div className="showcase-badge fadein">Knowledge Center</div>
          <h1 className="page-hero-title fadein fadein-d1">Master the Mechanics of Your Mortgage</h1>
          <p className="page-hero-sub fadein fadein-d2">The concepts that drive every smart home financing decision.</p>
        </div>
      </div>
      <div className="page-body">
        <div className="knowledge-grid">
          {[
            { tag: "Fundamentals", tagColor: "#1a5c2a", tagBg: "#e8f5e8", title: "How Mortgage Amortization Works", wide: false, content: (<><div className="k-body"><p>Every fixed mortgage payment splits between <strong>interest</strong> and <strong>principal</strong>. Early payments are mostly interest — this front-loading means you pay the lender first.</p></div><div className="k-formula">M = P × [r(1+r)ⁿ] / [(1+r)ⁿ − 1]<br />P = principal · r = monthly rate (annual ÷ 12) · n = payments</div><div className="k-body"><p>A $400K loan at 7% over 30 years carries <strong>$558,036 in total interest</strong> — 140% of the balance. Every 1% rate reduction saves ~$70,000.</p></div></>) },
            { tag: "Loan Types", tagColor: "#1a3c5c", tagBg: "#e0edf8", title: "Fixed vs. Adjustable Rate (ARM)", wide: false, content: (<><div className="k-body"><p><strong>Fixed-rate mortgages</strong> lock your rate for the full term. Your P&amp;I never changes, providing budget certainty regardless of market moves.</p><p><strong>ARMs</strong> offer a lower fixed intro rate (5, 7, or 10 years), then adjust periodically. A 5/1 ARM is fixed 5 years, then adjusts annually.</p></div><ul className="k-list"><li>ARMs ideal if you sell or refi before adjustment period</li><li>Fixed rates protect if rates rise after closing</li><li>Lifetime rate caps (typically 5%) limit ARM exposure</li></ul></>) },
            { tag: "Strategy", tagColor: "#7a6010", tagBg: "#fef9e8", title: "Rate Buydowns: 1-0, 2-1-0, 3-2-1", wide: false, content: (<><div className="k-body"><p>A <strong>buydown</strong> is a seller or lender credit that temporarily reduces your interest rate for the first 1–3 years.</p></div><ul className="k-list"><li><strong>1-0:</strong> Year 1 is 1% below note rate; Year 2+ is full rate</li><li><strong>2-1-0:</strong> Year 1 is −2%, Year 2 is −1%, Year 3+ is note rate</li><li><strong>3-2-1:</strong> −3%, −2%, −1%, then full rate from Year 4+</li></ul><div className="k-body" style={{ marginTop: 12 }}><p>Best when you expect income to grow — you absorb the rate increase naturally over time.</p></div></>) },
            { tag: "Government Loans", tagColor: "#5c1a5c", tagBg: "#f5e8f8", title: "FHA, VA & USDA Loans", wide: false, content: (<><div className="k-body"><p><strong>FHA loans</strong> require only 3.5% down with lower credit score minimums, but require upfront MIP (1.75%) and annual MIP (~0.55%). Ideal for first-time buyers.</p><p><strong>VA loans</strong> offer no down payment, no PMI, and competitive rates for veterans. One-time funding fee of 2.15% for first use.</p><p><strong>USDA loans</strong> are for rural/suburban properties with 0% down. 1% upfront guarantee fee and 0.35% annual fee.</p></div></>) },
            { tag: "Refinancing", tagColor: "#1a5c2a", tagBg: "#e8f5e8", title: "When Does Refinancing Make Sense?", wide: false, content: (<><div className="k-body"><p>Refinance when you can lower your rate by at least 0.75–1%. But the real math is break-even:</p></div><div className="k-formula">Break-Even = Net Closing Costs ÷ Monthly Savings<br />True Savings = Interest Saved − Net Closing Costs</div><div className="k-body"><p>If break-even is 18 months and you plan to stay 10+ years, it's almost certainly worth it. Watch out for term extension — refinancing into a new 30-year when you have 22 years left adds interest.</p></div></>) },
            { tag: "Equity", tagColor: "#1a3c5c", tagBg: "#e0edf8", title: "PMI, LTV & Building Equity Faster", wide: false, content: (<><div className="k-body"><p><strong>PMI</strong> is required when LTV exceeds 80%. It costs 0.6–1.2% annually and adds nothing to your equity. LTV = Loan Balance ÷ Home Value.</p><p>Once LTV drops below 80% (through payments or appreciation), request PMI cancellation. It drops automatically at 78%.</p></div><ul className="k-list"><li>Extra principal payments accelerate LTV reduction</li><li>Rising home value reduces LTV without payments</li><li>Lump-sum payment can cross the 80% threshold instantly</li></ul></>) },
            {
              tag: "Payoff Strategy", tagColor: "#7a6010", tagBg: "#fef9e8", title: "Extra Payments vs. Investing: The Real Trade-Off", wide: true, content: (<>
                <div className="k-body"><p>Paying extra principal is a <strong>guaranteed return equal to your mortgage rate</strong>. If your rate is 7%, every extra dollar earns a guaranteed 7% annual return. The S&amp;P 500 returns ~10% nominal historically.</p></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, margin: '16px 0' }}>
                  {[["Rate > 7%", "Paying down likely beats investing on risk-adjusted basis. Guaranteed return is close to or exceeds expected market return.", "#1a5c2a", "#e8f5e8", "#b8ddb8"],
                    ["Rate 4–7%", "A toss-up. Consider risk tolerance, mortgage interest deduction, emergency fund needs, and time horizon.", "#7a6010", "#fef9e8", "#f0e090"],
                    ["Rate < 4%", "Investing almost certainly wins long-term. Keep cheap debt and put extra cash into diversified equities.", "#1a3c5c", "#e0edf8", "#b0c8e8"]].map(([t, d, c, bg, br]) => (
                    <div key={t} style={{ background: bg, border: `1px solid ${br}`, borderRadius: 10, padding: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: 'var(--fm)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{t}</div>
                      <div style={{ fontSize: 13, color: 'var(--stone)', lineHeight: 1.6 }}>{d}</div>
                    </div>
                  ))}
                </div>
                <div className="k-body"><p>HearthWorth's Payoff Planner shows both scenarios side by side — the guaranteed interest savings vs. projected S&amp;P 500 investment value — so you can make the call with full information.</p></div>
              </>)
            },
          ].map(({ tag, tagColor, tagBg, title, wide, content }) => (
            <div className={`knowledge-card fadein${wide ? ' wide' : ''}`} key={title}>
              <div className="k-tag" style={{ color: tagColor, background: tagBg }}>{tag}</div>
              <div className="k-title">{title}</div>
              {content}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── CALCULATOR PAGE ──
function CalculatorPage({ loan, setLoan, setPage }) {
  const [draft, setDraft] = useState({ ...loan })
  const [activeTab, setActiveTab] = useState("Overview")
  const [toolTab, setToolTab] = useState('calculator')
  const isDirty = JSON.stringify(draft) !== JSON.stringify(loan)
  const setF = useCallback((f, v) => setDraft(d => ({ ...d, [f]: v })), [])
  const apply = () => setLoan({ ...draft })
  const reset = () => setDraft({ ...loan })

  const prod = useMemo(() => PRODUCTS.find(p => p.id === loan.productId) || PRODUCTS[4], [loan.productId])
  const monthsElapsed = useMemo(() => {
    if (!loan.loanStartDate) return 0
    const [yr, mo] = loan.loanStartDate.split("-").map(Number)
    const now = new Date()
    return Math.max(0, (now.getFullYear() - yr) * 12 + (now.getMonth() + 1 - mo))
  }, [loan.loanStartDate])
  const remainingMonths = useMemo(() => Math.max(prod.term - monthsElapsed, 1), [prod.term, monthsElapsed])
  const autoPMI = useMemo(() => computePMI(loan.loanBalance, loan.homeValue), [loan.loanBalance, loan.homeValue])
  const monthlyPMI = loan.pmiOverride ? loan.monthlyPMI : autoPMI
  const baseline = useMemo(() => amortize(loan.loanBalance, prod, loan.permRate, monthsElapsed), [loan.loanBalance, prod, loan.permRate, monthsElapsed])
  const totalMonthly = baseline.pmt55 + loan.monthlyTaxes + monthlyPMI + loan.monthlyInsurance
  const draftLTV = draft.homeValue > 0 ? draft.loanBalance / draft.homeValue : 0
  const draftLtvOk = draftLTV <= 0.8
  const pmiDrop = useMemo(() => pmiDropOff(loan.loanBalance, loan.homeValue, loan.permRate, remainingMonths), [loan.loanBalance, loan.homeValue, loan.permRate, remainingMonths])
  const curPhase = baseline.pmtList.find(p => p.isCurrent) || baseline.pmtList[0]

  const yearlyAmort = useMemo(() => {
    const rows = []; let yi = 0, yp = 0
    baseline.schedule.forEach((s, i) => {
      yi += s.interest; yp += s.principal
      if ((i + 1) % 12 === 0 || i === baseline.schedule.length - 1) {
        rows.push({ year: Math.ceil((i + 1) / 12), interest: Math.round(yi), principal: Math.round(yp), balance: Math.round(s.balance), cumInt: Math.round(s.cumInterest) })
        yi = 0; yp = 0
      }
    })
    return rows
  }, [baseline])

  const sy = loan.loanStartDate ? parseInt(loan.loanStartDate.split("-")[0]) : new Date().getFullYear()
  const balChart = baseline.schedule.filter((_, i) => i % 12 === 0).map((s, i) => ({ calYear: sy + i + 1, balance: Math.round(s.balance) }))

  return (
    <div>
      <div className="page-hero">
        <img src={IMGS.calc} alt="Calculator" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div className="page-hero-overlay"></div>
        <div className="page-hero-content">
          <div className="showcase-badge fadein">Mortgage Calculator</div>
          <h1 className="page-hero-title fadein fadein-d1">Analyze Your Loan in Detail</h1>
          <p className="page-hero-sub fadein fadein-d2">Enter your loan details and get a complete financial picture.</p>
        </div>
      </div>
      <div className="page-body" style={{ position: 'relative', backgroundImage: `url(https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1600&q=70)`, backgroundSize: 'cover', backgroundPosition: 'center 60%', backgroundAttachment: 'fixed' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(253,248,240,0.93)', backdropFilter: 'blur(1px)', zIndex: 0 }}></div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="tool-tabs">
            {[['calculator', 'Mortgage Calculator'], ['refi', 'Refi Analyzer'], ['payoff', 'Payoff Planner']].map(([t, l]) => (
              <button key={t} className={`tool-tab${toolTab === t ? ' active' : ''}`} onClick={() => setToolTab(t)}>{l}</button>
            ))}
          </div>
          {toolTab === 'refi' && <RefiContent loan={loan} />}
          {toolTab === 'payoff' && <PayoffContent loan={loan} />}
          {toolTab === 'calculator' && <div className="app-wrap">
            <div className="app-topbar">
              <div className="app-topbar-title">Mortgage Intelligence</div>
              <div className="topbar-metrics">
                {[["P&I", fmt(curPhase?.pmt || 0)], ["PITI", fmt(totalMonthly)], ["Rate", `${loan.permRate}%`], ["Balance", fmt(loan.loanBalance)]].map(([k, v]) => (
                  <div key={k}><div className="topbar-metric-label">{k}</div><div className="topbar-metric-val">{v}</div></div>
                ))}
              </div>
            </div>
            <div className="app-tabs">
              {["Overview", "Amortization"].map(t => <button key={t} className={`app-tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>)}
            </div>
            <div className="app-body">
              {activeTab === "Overview" && (
                <div style={{ display: 'grid', gridTemplateColumns: '268px 1fr', gap: 20 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="card">
                      <div className="card-label">Loan Details</div>
                      <div className="input-wrap">
                        <label className="input-label">Loan Product</label>
                        <div className="input-inner">
                          <select value={draft.productId} onChange={e => setF("productId", e.target.value)}>
                            {PRODUCT_GROUPS.map(g => <optgroup key={g.group} label={g.group}>{g.products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>)}
                          </select>
                        </div>
                      </div>
                      <div className="input-wrap">
                        <label className="input-label">Loan Start Date</label>
                        <div className="input-inner"><input type="month" value={draft.loanStartDate || ""} onChange={e => setF("loanStartDate", e.target.value)} style={{ colorScheme: 'light' }} /></div>
                      </div>
                      <DcInput label="Loan Balance" value={draft.loanBalance} onChange={v => setF("loanBalance", v)} pre="$" step={1000} />
                      <DcInput label="Home Value" value={draft.homeValue} onChange={v => setF("homeValue", v)} pre="$" step={1000} />
                      <DcInput label="Interest Rate" value={draft.permRate} onChange={v => setF("permRate", v)} suf="%" step={0.125} />
                      {(() => {
                        const p = PRODUCTS.find(x => x.id === draft.productId)
                        if (!p || !p.phases?.length) return null
                        const nr = Number(draft.permRate || 5.5)
                        const isArm = p.armAdj != null
                        const path = isArm
                          ? `Fixed ${p.phases[0].months / 12}yr @ ${nr.toFixed(2)}% → ${(nr + (p.armAdj || 2)).toFixed(2)}%`
                          : [...p.phases.map((ph, i) => `Yr${i + 1}: ${(nr + ph.offset).toFixed(2)}%`), `Yr${p.phases.length + 1}+: ${nr.toFixed(2)}%`].join(' → ')
                        return <div style={{ background: isArm ? '#fef9e8' : '#e8f5e8', border: `1px solid ${isArm ? '#f0e090' : '#b8ddb8'}`, borderRadius: 8, padding: '10px 12px', fontSize: 11, fontFamily: 'var(--fm)', color: isArm ? '#7a6010' : '#1a5c2a', lineHeight: 1.7, marginBottom: 8 }}>{path}</div>
                      })()}
                    </div>
                    <div className="card">
                      <div className="card-label">Monthly PITI</div>
                      <DcInput label="Property Tax /mo" value={draft.monthlyTaxes} onChange={v => setF("monthlyTaxes", v)} pre="$" step={10} />
                      <div className="input-wrap">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <label className="input-label" style={{ margin: 0 }}>PMI <span style={{ color: draftLtvOk ? '#1a5c2a' : '#8b1a1a' }}>(LTV {(draftLTV * 100).toFixed(1)}%)</span></label>
                          <button onClick={() => setF("pmiOverride", !draft.pmiOverride)} style={{ fontSize: 9, padding: '2px 7px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--stone)', cursor: 'pointer', fontFamily: 'var(--fm)' }}>{draft.pmiOverride ? "Auto" : "Override"}</button>
                        </div>
                        {draft.pmiOverride
                          ? <div className="input-inner"><span className="input-pre">$</span><input type="number" value={draft.monthlyPMI || 0} step={10} min={0} onChange={e => setF("monthlyPMI", parseFloat(e.target.value) || 0)} /></div>
                          : (
                            <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '9px 12px', border: `1px solid ${draftLtvOk ? '#b8ddb8' : '#f0e090'}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontFamily: 'var(--fm)', fontSize: 13, fontWeight: 700, color: draftLtvOk ? '#1a5c2a' : '#7a6010' }}>{computePMI(draft.loanBalance, draft.homeValue) === 0 ? "$0 — PMI Waived" : fmt(computePMI(draft.loanBalance, draft.homeValue)) + "/mo"}</span>
                                <span style={{ fontSize: 10, color: 'var(--stone-light)', fontFamily: 'var(--fm)' }}>auto</span>
                              </div>
                              {pmiDrop > 0 && <div style={{ fontSize: 10, color: '#7a6010', fontFamily: 'var(--fm)', marginTop: 3 }}>Drops in {pmiDrop}mo ({(pmiDrop / 12).toFixed(1)} yrs)</div>}
                            </div>
                          )}
                      </div>
                      <DcInput label="Insurance /mo" value={draft.monthlyInsurance} onChange={v => setF("monthlyInsurance", v)} pre="$" step={10} />
                      <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 14, marginTop: 4, border: '1px solid var(--border)' }}>
                        {[[`P&I (${loan.permRate}%)`, fmt(baseline.pmt55)], ["Taxes", fmt(loan.monthlyTaxes)], ["PMI", fmt(monthlyPMI)], ["Insurance", fmt(loan.monthlyInsurance)]].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--fm)' }}>
                            <span style={{ color: 'var(--stone)' }}>{k}</span><span style={{ color: 'var(--charcoal)' }}>{v}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, fontSize: 14, fontWeight: 700, fontFamily: 'var(--fm)' }}>
                          <span style={{ color: 'var(--forest)' }}>Total PITI</span><span style={{ color: 'var(--forest)' }}>{fmt(totalMonthly)}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button className="dc-btn dc-btn-primary" onClick={apply} style={{ flex: 1, opacity: isDirty ? 1 : 0.5 }}>{isDirty ? "Update Dashboard" : "Up to Date"}</button>
                        {isDirty && <button className="dc-btn dc-btn-ghost" onClick={reset}>Reset</button>}
                      </div>
                      {isDirty && <div style={{ marginTop: 8, fontSize: 11, color: '#7a6010', fontFamily: 'var(--fm)', textAlign: 'center' }}>Pending changes — click Update</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                      <StatBox label="Loan Balance" value={fmt(loan.loanBalance)} sub={`${((loan.loanBalance / loan.homeValue) * 100).toFixed(1)}% LTV`} color="var(--forest)" />
                      <StatBox label="Total Interest Left" value={fmtK(baseline.totalInterest)} sub={`${(baseline.totalInterest / loan.loanBalance * 100).toFixed(0)}% of balance`} color="#8b1a1a" />
                      <StatBox label="Home Equity" value={fmtK(loan.homeValue - loan.loanBalance)} sub={`${(((loan.homeValue - loan.loanBalance) / loan.homeValue) * 100).toFixed(1)}% of value`} color="#1a5c2a" />
                      <StatBox label={`P&I — ${curPhase?.rate?.toFixed(2)}%`} value={fmt(curPhase?.pmt || 0)} sub="Current phase" color="var(--charcoal)" />
                      <StatBox label="Total PITI" value={fmt(totalMonthly)} sub="Tax + PMI + Insurance" color="var(--forest)" />
                      <StatBox label="Years Remaining" value={`${(remainingMonths / 12).toFixed(1)}`} sub={`of ${prod.term / 12} yr term`} color="var(--stone)" />
                    </div>
                    <div className="card">
                      <div className="card-label">Balance Over Time</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={balChart}>
                          <defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--forest)" stopOpacity={0.15} /><stop offset="95%" stopColor="var(--forest)" stopOpacity={0} /></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="calYear" tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} stroke="var(--border)" />
                          <YAxis tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} stroke="var(--border)" />
                          <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--fm)', fontSize: 11 }} />
                          <Area type="monotone" dataKey="balance" name="Balance" stroke="var(--forest)" fill="url(#bg1)" strokeWidth={2.5} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === "Amortization" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="card">
                      <div className="card-label">Principal vs Interest Per Year</div>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={yearlyAmort}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="year" tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `Yr${v}`} stroke="var(--border)" />
                          <YAxis tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} stroke="var(--border)" />
                          <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--fm)', fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--fm)' }} />
                          <Bar dataKey="interest" name="Interest" fill="#8b2a2a" radius={[3, 3, 0, 0]} stackId="a" />
                          <Bar dataKey="principal" name="Principal" fill="var(--forest)" radius={[3, 3, 0, 0]} stackId="a" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="card">
                      <div className="card-label">Remaining Balance By Year</div>
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={yearlyAmort}>
                          <defs><linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--gold)" stopOpacity={0.2} /><stop offset="95%" stopColor="var(--gold)" stopOpacity={0} /></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="year" tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `Yr${v}`} stroke="var(--border)" />
                          <YAxis tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} stroke="var(--border)" />
                          <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--fm)', fontSize: 11 }} />
                          <Area type="monotone" dataKey="balance" name="Balance" stroke="var(--gold)" fill="url(#bg2)" strokeWidth={2.5} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="card-label">Yearly Amortization Table</div>
                    <table className="dc-table">
                      <thead><tr><th style={{ textAlign: 'left' }}>Year</th><th>Interest Paid</th><th>Principal Paid</th><th>Remaining Balance</th><th>Cumulative Interest</th></tr></thead>
                      <tbody>{yearlyAmort.map((r, i) => <tr key={i}><td>Year {r.year}</td><td style={{ color: '#8b2a2a' }}>{fmt(r.interest)}</td><td style={{ color: '#1a5c2a' }}>{fmt(r.principal)}</td><td style={{ color: 'var(--forest)' }}>{fmt(r.balance)}</td><td style={{ color: 'var(--stone)' }}>{fmt(r.cumInt)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>}
        </div>
      </div>
    </div>
  )
}

// ── REFI CONTENT (shared by RefiPage full-page and Calculator tab) ──
function RefiContent({ loan }) {
  const [scenarios, setScenarios] = useState([])
  const [chartMode, setChartMode] = useState("balance")
  const prod = useMemo(() => PRODUCTS.find(p => p.id === loan.productId) || PRODUCTS[4], [loan.productId])
  const monthsElapsed = useMemo(() => {
    if (!loan.loanStartDate) return 0
    const [yr, mo] = loan.loanStartDate.split("-").map(Number)
    const now = new Date()
    return Math.max(0, (now.getFullYear() - yr) * 12 + (now.getMonth() + 1 - mo))
  }, [loan.loanStartDate])
  const remainingMonths = useMemo(() => Math.max(prod.term - monthsElapsed, 1), [prod.term, monthsElapsed])
  const baseline = useMemo(() => amortize(loan.loanBalance, prod, loan.permRate, monthsElapsed), [loan.loanBalance, prod, loan.permRate, monthsElapsed])

  const add = () => setScenarios(s => [...s, { id: Date.now(), name: "", productId: "refi_rr30", noteRate: 6.0, closingCosts: 8000, cashCredit: 0, enabled: true }])
  const remove = id => setScenarios(s => s.filter(x => x.id !== id))
  const upd = (id, f, v) => setScenarios(s => s.map(x => x.id === id ? { ...x, [f]: v } : x))
  const tog = id => setScenarios(s => s.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x))

  const computed = scenarios.map(sc => {
    const product = PRODUCTS.find(p => p.id === sc.productId) || PRODUCTS[0]
    const result = computeScenario({ balance: loan.loanBalance, credit: 0, noteRate: sc.noteRate, product })
    const netClosing = (sc.closingCosts || 0) - (sc.cashCredit || 0)
    const currentTotalInterest = (() => {
      const pmt = baseline.pmt55, r = loan.permRate / 100 / 12
      let bal = loan.loanBalance, ti = 0
      for (let m = 0; m < remainingMonths && bal > 0; m++) { const i = bal * r; ti += i; bal = Math.max(bal - (pmt - i), 0) }
      return ti
    })()
    const interestSaved = currentTotalInterest - result.totalInterest
    const trueSavings = interestSaved - netClosing
    const monthlySavings = baseline.pmt55 - (result.pmtList[result.pmtList.length - 1]?.pmt ?? 0)
    const breakEven = (netClosing > 0 && monthlySavings > 0) ? Math.ceil(netClosing / monthlySavings) : 0
    const extendsLoan = product.term - remainingMonths > 24
    const worthIt = trueSavings > 0 && (breakEven === 0 || breakEven < remainingMonths) && !extendsLoan
    const marginal = !worthIt && trueSavings > 0
    return { ...sc, product, result, netClosing, monthlySavings, breakEven, interestSaved, trueSavings, worthIt, marginal, extendsLoan, currentTotalInterest }
  })
  const active = computed.filter(s => s.enabled !== false)
  const lbl = s => s.name.trim() || `${s.product?.label} ${s.noteRate}%`
  const step = 12
  const series = [
    { id: "base", label: "Current", color: "var(--stone)", dashed: true, data: baseline.schedule.filter((_, i) => i % step === 0).map(p => ({ x: Math.round(p.month / 12), y: chartMode === "interest" ? p.cumInterest : p.balance })) },
    ...active.map((s, i) => ({ id: `sc${s.id}`, label: lbl(s), color: SC_COLORS[i % SC_COLORS.length], dashed: false, data: s.result.schedule.filter((_, idx) => idx % step === 0).map(p => ({ x: Math.round(p.month / 12), y: chartMode === "interest" ? p.cumInterest : p.balance })) }))
  ]

  return (
          <div className="app-wrap">
            <div className="app-topbar">
              <div className="app-topbar-title">Refi Scenario Analyzer</div>
              <div className="topbar-metrics">
                {[["Current Rate", `${loan.permRate}%`], ["Balance", fmt(loan.loanBalance)], ["Remaining", `${(remainingMonths / 12).toFixed(1)} yrs`], ["Total Interest", fmtK(baseline.totalInterest)]].map(([k, v]) => (
                  <div key={k}><div className="topbar-metric-label">{k}</div><div className="topbar-metric-val">{v}</div></div>
                ))}
              </div>
            </div>
            <div className="app-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
                <StatBox label="Current Total Interest" value={fmtK(baseline.totalInterest)} sub={`${(remainingMonths / 12).toFixed(1)} yrs at ${loan.permRate}%`} color="#8b1a1a" />
                <StatBox label="Your Rate Floor" value={`${loan.permRate}%`} sub="Refi must beat this rate" color="var(--forest)" />
                <StatBox label="Active Scenarios" value={`${active.length}`} sub="Closing costs factored in" color="#1a3c5c" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div className="card-label" style={{ margin: 0 }}>Scenarios</div>
                      <button className="dc-btn dc-btn-primary" onClick={add} style={{ padding: '6px 14px', fontSize: 12 }}>+ Add Scenario</button>
                    </div>
                    <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--stone)', fontFamily: 'var(--fm)', marginBottom: 6 }}>Current Loan (Baseline)</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, fontFamily: 'var(--fm)', color: 'var(--stone-light)' }}>
                        <span>Balance: <span style={{ color: 'var(--charcoal)' }}>{fmt(loan.loanBalance)}</span></span>
                        <span>Rate: <span style={{ color: 'var(--charcoal)' }}>{loan.permRate}%</span></span>
                        <span>Remaining: <span style={{ color: 'var(--charcoal)' }}>{(remainingMonths / 12).toFixed(1)} yrs</span></span>
                        <span>Total int: <span style={{ color: '#8b1a1a' }}>{fmtK(baseline.totalInterest)}</span></span>
                      </div>
                    </div>
                    {computed.length === 0 && <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--stone-light)', fontSize: 13, fontFamily: 'var(--fm)', border: '1.5px dashed var(--border)', borderRadius: 10 }}>Add a scenario to compare refi options</div>}
                    {computed.map((sc, idx) => {
                      const col = SC_COLORS[idx % SC_COLORS.length]
                      return (
                        <div key={sc.id} style={{ background: 'var(--white)', border: `1.5px solid ${sc.enabled ? col + '40' : 'var(--border)'}`, borderRadius: 10, padding: 16, marginBottom: 10, opacity: sc.enabled ? 1 : 0.55 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }}></div>
                            <input value={sc.name} onChange={e => upd(sc.id, "name", e.target.value)} placeholder={`${sc.product?.label} @ ${sc.noteRate}%`} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--charcoal)', fontSize: 12, fontFamily: 'var(--fm)' }} />
                            <button onClick={() => tog(sc.id)} style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', color: 'var(--stone)', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--fm)' }}>{sc.enabled ? "Hide" : "Show"}</button>
                            <button onClick={() => remove(sc.id)} className="dc-btn dc-btn-danger" style={{ padding: '3px 8px', fontSize: 10 }}>✕</button>
                          </div>
                          <div className="input-wrap" style={{ marginBottom: 8 }}>
                            <label className="input-label">Product</label>
                            <div className="input-inner">
                              <select value={sc.productId} onChange={e => upd(sc.id, "productId", e.target.value)}>
                                {PRODUCT_GROUPS.map(g => <optgroup key={g.group} label={g.group}>{g.products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>)}
                              </select>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                            <DcInput label="Note Rate" value={sc.noteRate} onChange={v => upd(sc.id, "noteRate", v)} suf="%" step={0.125} />
                            <DcInput label="Closing Costs" value={sc.closingCosts || 8000} onChange={v => upd(sc.id, "closingCosts", v)} pre="$" step={500} />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <DcInput label="Lender Credit" value={sc.cashCredit || 0} onChange={v => upd(sc.id, "cashCredit", v)} pre="$" step={500} />
                            <div className="statbox" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              <div className="statbox-label">Net Cost</div>
                              <div className="statbox-val" style={{ fontSize: 14, color: sc.netClosing > 0 ? '#8b1a1a' : '#1a5c2a' }}>{fmt(sc.netClosing)}</div>
                            </div>
                          </div>
                          {sc.enabled && (
                            <div style={{ marginTop: 10, background: 'var(--cream)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                              <div style={{ padding: '10px 14px', background: sc.worthIt ? '#e8f5e8' : sc.marginal ? '#fef9e8' : '#fdeaea', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, fontSize: 13, color: sc.worthIt ? '#1a5c2a' : sc.marginal ? '#7a6010' : '#8b1a1a', fontFamily: 'var(--fm)' }}>{sc.worthIt ? "✓ Worth It" : sc.marginal ? "~ Marginal" : "✗ Not Worth It"}</span>
                                <span style={{ fontSize: 11, color: 'var(--stone)', fontFamily: 'var(--fm)' }}>{sc.breakEven > 0 ? `Break-even: ${sc.breakEven}mo` : "Instant"}</span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                                {[["New P&I", fmt(sc.result.pmtList[sc.result.pmtList.length - 1]?.pmt ?? 0), "var(--charcoal)"],
                                  ["Mo. Delta", `${sc.monthlySavings >= 0 ? "−" : "+"}${fmt(Math.abs(sc.monthlySavings))}`, sc.monthlySavings > 0 ? '#1a5c2a' : '#8b1a1a'],
                                  ["True Savings", fmt(Math.round(sc.trueSavings)), sc.trueSavings > 0 ? '#1a5c2a' : '#8b1a1a']
                                ].map(([k, v, c]) => (
                                  <div key={k} style={{ padding: '10px 12px', borderRight: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: 9, color: 'var(--stone-light)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--fm)', marginBottom: 4 }}>{k}</div>
                                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--fm)', color: c }}>{v}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div className="card-label" style={{ margin: 0 }}>{chartMode === "balance" ? "Balance Over Time" : "Cumulative Interest"}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[["balance", "Balance"], ["interest", "Interest"]].map(([m, l]) => (
                          <button key={m} onClick={() => setChartMode(m)} className="dc-btn" style={{ padding: '4px 12px', fontSize: 11, background: chartMode === m ? 'var(--forest)' : 'var(--cream)', color: chartMode === m ? 'var(--white)' : 'var(--stone)', border: '1px solid var(--border)' }}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px', marginBottom: 12 }}>
                      {series.map(s => <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="20" height="3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 3" : "0"} /></svg><span style={{ fontSize: 11, color: s.color, fontFamily: 'var(--fm)' }}>{s.label}</span></div>)}
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis type="number" dataKey="x" allowDuplicatedCategory={false} domain={['auto', 'auto']} tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `Yr${v}`} stroke="var(--border)" />
                        <YAxis tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} stroke="var(--border)" />
                        <Tooltip content={<ChartTooltip />} />
                        {series.map(s => <Line key={s.id} data={s.data} dataKey="y" name={s.label} stroke={s.color} strokeWidth={2} dot={false} strokeDasharray={s.dashed ? "5 3" : "0"} />)}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="card-label">Scenario Comparison</div>
                    <table className="dc-table">
                      <thead><tr><th style={{ textAlign: 'left' }}>Scenario</th><th>New P&amp;I</th><th>Mo. Savings</th><th>Int. Saved</th><th>Net Closing</th><th>Break-Even</th><th>Verdict</th></tr></thead>
                      <tbody>
                        <tr><td>Current Loan</td><td>{fmt(baseline.pmt55)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td><span style={{ fontSize: 10, padding: '3px 8px', background: 'var(--cream)', borderRadius: 4, color: 'var(--stone)', fontFamily: 'var(--fm)' }}>Baseline</span></td></tr>
                        {computed.map((sc, i) => (
                          <tr key={sc.id}>
                            <td style={{ color: SC_COLORS[i % SC_COLORS.length] }}>{lbl(sc)}</td>
                            <td>{fmt(sc.result.pmtList[sc.result.pmtList.length - 1]?.pmt ?? 0)}</td>
                            <td style={{ color: sc.monthlySavings > 0 ? '#1a5c2a' : '#8b1a1a' }}>{sc.monthlySavings >= 0 ? "−" : "+"}{fmt(Math.abs(sc.monthlySavings))}</td>
                            <td style={{ color: sc.interestSaved > 0 ? '#1a5c2a' : '#8b1a1a' }}>{fmt(Math.round(sc.interestSaved))}</td>
                            <td style={{ color: sc.netClosing > 0 ? 'var(--charcoal)' : '#1a5c2a' }}>{fmt(sc.netClosing)}</td>
                            <td>{sc.breakEven > 0 ? `${sc.breakEven}mo` : "Instant"}</td>
                            <td><span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, fontFamily: 'var(--fm)', background: sc.worthIt ? '#e8f5e8' : sc.marginal ? '#fef9e8' : '#fdeaea', color: sc.worthIt ? '#1a5c2a' : sc.marginal ? '#7a6010' : '#8b1a1a' }}>{sc.worthIt ? "Worth It" : sc.marginal ? "Marginal" : "No"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
  )
}

// ── REFI PAGE (full page with hero) ──
function RefiPage({ loan }) {
  return (
    <div>
      <div className="page-hero">
        <img src={IMGS.refi} alt="Refi documents" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 25%' }} />
        <div className="page-hero-overlay"></div>
        <div className="page-hero-content">
          <div className="showcase-badge fadein">Refi Scenario Analyzer</div>
          <h1 className="page-hero-title fadein fadein-d1">Know Exactly When to Refinance</h1>
          <p className="page-hero-sub fadein fadein-d2">Model any refinance scenario and see the true break-even and lifetime savings.</p>
        </div>
      </div>
      <div className="page-body" style={{ position: 'relative', backgroundImage: `url(https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1600&q=70)`, backgroundSize: 'cover', backgroundPosition: 'center 50%', backgroundAttachment: 'fixed' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(253,248,240,0.92)', backdropFilter: 'blur(2px)', zIndex: 0 }}></div>
        <div style={{ position: 'relative', zIndex: 1 }}><RefiContent loan={loan} /></div>
      </div>
    </div>
  )
}

// ── PAYOFF CONTENT (shared by PayoffPage and Calculator tab) ──
function PayoffContent({ loan }) {
  const [mode, setMode] = useState("extra")
  const [extra, setExtra] = useState(300)
  const [lump, setLump] = useState(10000)
  const lumpOk = lump <= loan.loanBalance
  const prod = useMemo(() => PRODUCTS.find(p => p.id === loan.productId) || PRODUCTS[4], [loan.productId])
  const monthsElapsed = useMemo(() => {
    if (!loan.loanStartDate) return 0
    const [yr, mo] = loan.loanStartDate.split("-").map(Number)
    const now = new Date()
    return Math.max(0, (now.getFullYear() - yr) * 12 + (now.getMonth() + 1 - mo))
  }, [loan.loanStartDate])
  const remainingMonths = useMemo(() => Math.max(prod.term - monthsElapsed, 1), [prod.term, monthsElapsed])
  const baseline = useMemo(() => amortize(loan.loanBalance, prod, loan.permRate, monthsElapsed), [loan.loanBalance, prod, loan.permRate, monthsElapsed])
  const sy = loan.loanStartDate ? parseInt(loan.loanStartDate.split("-")[0]) : new Date().getFullYear()

  const withExtra = useMemo(() => {
    if (!extra) return null
    const r = loan.permRate / 100 / 12, pmt = mpmt(loan.loanBalance, loan.permRate, remainingMonths)
    let bal = loan.loanBalance, ti = 0, months = 0
    const sched = []
    while (bal > 0 && months < remainingMonths * 3) {
      const i = bal * r, p = Math.min(pmt + extra - i, bal)
      ti += i; bal = Math.max(bal - p, 0); months++
      sched.push({ month: months, balance: bal, cumInterest: ti })
    }
    return { totalInterest: ti, months, schedule: sched }
  }, [extra, loan.loanBalance, loan.permRate, remainingMonths])

  const withLump = useMemo(() => {
    if (!lump || lump > loan.loanBalance) return null
    const newBal = loan.loanBalance - lump, r = loan.permRate / 100 / 12
    const pmt = mpmt(newBal, loan.permRate, remainingMonths)
    let bal = newBal, ti = 0, months = 0
    const sched = []
    while (bal > 0 && months < remainingMonths) {
      const i = bal * r, p = Math.min(pmt - i, bal)
      ti += i; bal = Math.max(bal - p, 0); months++
      sched.push({ month: months, balance: bal, cumInterest: ti })
    }
    return { totalInterest: ti, months, newBal, newPermPmt: pmt, schedule: sched }
  }, [lump, loan.loanBalance, loan.permRate, remainingMonths])

  const chartData = useMemo(() => {
    const len = Math.max(baseline.schedule.length, (withExtra?.schedule.length || 0), (withLump?.schedule.length || 0))
    const out = []
    for (let i = 0; i < len; i += 12) {
      const yr = Math.round((i + 1) / 12), obj = { yr, calYear: sy + yr }
      if (i < baseline.schedule.length) obj.current = Math.round(baseline.schedule[i].balance)
      if (withExtra && i < withExtra.schedule.length) obj.extra = Math.round(withExtra.schedule[i].balance)
      if (withLump && i < withLump.schedule.length) obj.lump = Math.round(withLump.schedule[i].balance)
      out.push(obj)
    }
    return out
  }, [baseline, withExtra, withLump, sy])

  const mthsSaved = withExtra ? remainingMonths - withExtra.months : 0
  const intSaved = withExtra ? baseline.totalInterest - withExtra.totalInterest : 0
  const sp7 = extra ? Math.round(extra * ((Math.pow(1 + 0.07 / 12, (withExtra?.months || remainingMonths)) - 1) / (0.07 / 12))) : 0

  return (
    <div className="app-wrap">
            <div className="app-topbar">
              <div className="app-topbar-title">Payoff Planner</div>
              <div className="topbar-metrics">
                {[["Balance", fmt(loan.loanBalance)], ["Rate", `${loan.permRate}%`], ["Remaining", `${(remainingMonths / 12).toFixed(1)} yrs`], ["Total Interest", fmtK(baseline.totalInterest)]].map(([k, v]) => (
                  <div key={k}><div className="topbar-metric-label">{k}</div><div className="topbar-metric-val">{v}</div></div>
                ))}
              </div>
            </div>
            <div className="app-body">
              <div style={{ display: 'grid', gridTemplateColumns: '268px 1fr', gap: 20, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="card">
                    <div className="card-label">Planner Mode</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                      {[["extra", "Extra /mo"], ["lump", "Lump Sum"]].map(([m, l]) => (
                        <button key={m} onClick={() => setMode(m)} className="dc-btn" style={{ flex: 1, padding: '9px 0', fontSize: 12, background: mode === m ? 'var(--forest)' : 'var(--cream)', color: mode === m ? 'var(--white)' : 'var(--stone)', border: `1.5px solid ${mode === m ? 'var(--forest)' : 'var(--border)'}` }}>{l}</button>
                      ))}
                    </div>
                    {mode === "extra" ? (
                      <>
                        <DcInput label="Extra Monthly Principal" value={extra} onChange={setExtra} pre="$" step={100} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {[100, 300, 500, 1000, 2000].map(v => (
                            <button key={v} onClick={() => setExtra(v)} className="dc-btn" style={{ padding: '4px 10px', fontSize: 11, background: extra === v ? 'var(--forest)' : 'var(--cream)', color: extra === v ? 'var(--white)' : 'var(--stone)', border: '1px solid var(--border)' }}>+${v}</button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <DcInput label="Lump Sum Payment" value={lump} onChange={setLump} pre="$" step={1000} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {[5000, 10000, 25000, 50000].map(v => (
                            <button key={v} onClick={() => setLump(v)} className="dc-btn" style={{ padding: '4px 10px', fontSize: 11, background: lump === v ? 'var(--forest)' : 'var(--cream)', color: lump === v ? 'var(--white)' : 'var(--stone)', border: '1px solid var(--border)' }}>${(v / 1000).toFixed(0)}K</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {mode === "extra" && withExtra && (
                    <div className="card" style={{ border: '1.5px solid #b8ddb8' }}>
                      <div className="card-label" style={{ color: '#1a5c2a' }}>Results: +${extra}/mo</div>
                      {[["Payoff in", `${(withExtra.months / 12).toFixed(1)} yrs`, "#1a5c2a"], ["Time Saved", `${(mthsSaved / 12).toFixed(1)} yrs`, "#1a5c2a"], ["Interest Saved", fmt(Math.round(intSaved)), "#1a5c2a"], ["Total Interest", fmt(Math.round(withExtra.totalInterest)), "var(--charcoal)"]].map(([k, v, c]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--fm)' }}>
                          <span style={{ color: 'var(--stone)' }}>{k}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 12, padding: '12px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--fm)', lineHeight: 1.6 }}>
                        <div style={{ color: '#1a3c5c', fontWeight: 600, marginBottom: 4 }}>vs. Investing ${extra}/mo at 7% real:</div>
                        <div style={{ color: 'var(--charcoal)', fontSize: 14, fontWeight: 700 }}>{fmt(sp7)}</div>
                        <div style={{ color: 'var(--stone)', fontSize: 11, marginTop: 3 }}>Mortgage savings: <strong style={{ color: '#1a5c2a' }}>{fmt(Math.round(intSaved))}</strong> (guaranteed)</div>
                      </div>
                    </div>
                  )}
                  {mode === "lump" && withLump && lumpOk && (
                    <div className="card" style={{ border: '1.5px solid #f0e090' }}>
                      <div className="card-label" style={{ color: '#7a6010' }}>Lump Sum: {fmt(lump)}</div>
                      {[["New Balance", fmt(withLump.newBal), "#7a6010"], ["New P&I", fmt(withLump.newPermPmt) + "/mo", "var(--charcoal)"], ["Time Saved", `${Math.round((remainingMonths - withLump.months) / 12)} yrs`, "#1a5c2a"], ["Interest Saved", fmt(Math.round(baseline.totalInterest - withLump.totalInterest)), "#1a5c2a"]].map(([k, v, c]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--fm)' }}>
                          <span style={{ color: 'var(--stone)' }}>{k}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div className="card-label" style={{ margin: 0 }}>Balance Paydown Over Time</div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                      {[{ l: "No Extra", c: "var(--stone)" }, { l: `+$${extra}/mo`, c: "#1a5c2a" }, { l: `$${(lump / 1000).toFixed(0)}K Lump`, c: "var(--gold)" }].map(s => (
                        <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 20, height: 2, background: s.c }}></div>
                          <span style={{ fontSize: 11, color: s.c, fontFamily: 'var(--fm)' }}>{s.l}</span>
                        </div>
                      ))}
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="cg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--stone)" stopOpacity={0.12} /><stop offset="95%" stopColor="var(--stone)" stopOpacity={0} /></linearGradient>
                          <linearGradient id="cg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1a5c2a" stopOpacity={0.15} /><stop offset="95%" stopColor="#1a5c2a" stopOpacity={0} /></linearGradient>
                          <linearGradient id="cg3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--gold)" stopOpacity={0.15} /><stop offset="95%" stopColor="var(--gold)" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="calYear" tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} stroke="var(--border)" />
                        <YAxis tick={{ fill: 'var(--stone-light)', fontSize: 9, fontFamily: 'var(--fm)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} stroke="var(--border)" />
                        <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--fm)', fontSize: 11 }} />
                        <Area type="monotone" dataKey="current" name="No Extra" stroke="var(--stone)" fill="url(#cg1)" strokeWidth={2} dot={false} />
                        {withExtra && <Area type="monotone" dataKey="extra" name={`+$${extra}/mo`} stroke="#1a5c2a" fill="url(#cg2)" strokeWidth={2} dot={false} />}
                        {withLump && lumpOk && <Area type="monotone" dataKey="lump" name={`$${(lump / 1000).toFixed(0)}K Lump`} stroke="var(--gold)" fill="url(#cg3)" strokeWidth={2} dot={false} />}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="card-label">Yearly Balance Comparison</div>
                    <table className="dc-table">
                      <thead><tr>
                        <th style={{ textAlign: 'left' }}>Year</th>
                        <th>Base Balance</th>
                        {withExtra && <th>+${extra}/mo</th>}
                        {withLump && lumpOk && <th>+${(lump / 1000).toFixed(0)}K Lump</th>}
                      </tr></thead>
                      <tbody>{chartData.map((r, i) => (
                        <tr key={i}>
                          <td>{r.calYear}</td>
                          <td style={{ color: 'var(--stone)' }}>{r.current != null ? fmt(r.current) : "—"}</td>
                          {withExtra && <td style={{ color: '#1a5c2a' }}>{r.extra != null ? fmt(r.extra) : "Paid off ✓"}</td>}
                          {withLump && lumpOk && <td style={{ color: '#7a6010' }}>{r.lump != null ? fmt(r.lump) : "Paid off ✓"}</td>}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
    </div>
  )
}

// ── PAYOFF PAGE (full page wrapper) ──
function PayoffPage({ loan }) {
  return (
    <div>
      <div className="page-hero">
        <img src={IMGS.payoff} alt="Payoff planner" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div className="page-hero-overlay"></div>
        <div className="page-hero-content">
          <div className="showcase-badge fadein">Payoff Planner</div>
          <h1 className="page-hero-title fadein fadein-d1">Accelerate Your Path to Ownership</h1>
          <p className="page-hero-sub fadein fadein-d2">Explore extra payments, lump sums, and see how they compare to investing.</p>
        </div>
      </div>
      <div className="page-body" style={{ position: 'relative', backgroundImage: `url(https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1600&q=70)`, backgroundSize: 'cover', backgroundPosition: 'center 50%', backgroundAttachment: 'fixed' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(253,248,240,0.93)', backdropFilter: 'blur(1px)', zIndex: 0 }}></div>
        <div style={{ position: 'relative', zIndex: 1 }}><PayoffContent loan={loan} /></div>
      </div>
    </div>
  )
}

// ── FOOTER ──
function Footer({ setPage }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="nav-logo">⌂</div>
              <div className="footer-brand-text">HearthWorth</div>
            </div>
            <div className="footer-tagline">Professional mortgage intelligence for homeowners who think like investors. Free, private, runs entirely in your browser.</div>
          </div>
          <div>
            <div className="footer-col-title">Platform</div>
            {[["calculator", "Mortgage Calculator"], ["refi", "Refi Analyzer"], ["payoff", "Payoff Planner"], ["market", "Market Data"]].map(([p, l]) => <button key={p} className="footer-link" onClick={() => { setPage(p); window.scrollTo(0, 0) }}>{l}</button>)}
          </div>
          <div>
            <div className="footer-col-title">Resources</div>
            {[["knowledge", "Knowledge Center"], ["home", "FAQ"], ["home", "About"]].map(([p, l], i) => <button key={i} className="footer-link" onClick={() => { setPage(p); window.scrollTo(0, 0) }}>{l}</button>)}
          </div>
          <div>
            <div className="footer-col-title">Legal</div>
            <div className="footer-link">Terms of Use</div>
            <div className="footer-link">Privacy Policy</div>
            <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6 }}>HearthWorth is for informational purposes only. Not financial advice.</div>
          </div>
        </div>
        <div className="footer-bottom">
          <div>© 2026 HearthWorth. All rights reserved.</div>
          <div>Built for homeowners.</div>
        </div>
      </div>
    </footer>
  )
}

// ── MAIN APP ──
export default function MortgageDashboard() {
  const [page, setPage] = useState('home')
  const [loan, setLoan] = useState(defaultLoan)
  const [showModal, setShowModal] = useState(false)

  const openModal = useCallback(() => setShowModal(true), [])
  const closeModal = useCallback(() => setShowModal(false), [])
  const handleModalSubmit = useCallback(draft => {
    setLoan(draft)
    setPage('calculator')
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll('.fadein')
    els.forEach(el => {
      el.style.animation = 'none'
      void el.offsetHeight
      el.style.animation = ''
    })
  }, [page])

  return (
    <div className="page-transition">
      {showModal && <LoanSetupModal loan={loan} onClose={closeModal} onSubmit={handleModalSubmit} />}
      <Nav page={page} setPage={setPage} onGetStarted={openModal} />
      <div style={{ paddingTop: page === 'home' ? '0' : '68px' }}>
        {page === 'home'       && <HomePage onGetStarted={openModal} setPage={setPage} />}
        {page === 'calculator' && <CalculatorPage loan={loan} setLoan={setLoan} setPage={setPage} />}
        {page === 'refi'       && <RefiPage loan={loan} />}
        {page === 'payoff'     && <PayoffPage loan={loan} />}
        {page === 'market'     && <MarketPage />}
        {page === 'knowledge'  && <KnowledgePage />}
      </div>
      <Footer setPage={setPage} />
    </div>
  )
}
