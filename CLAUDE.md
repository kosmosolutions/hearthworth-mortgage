# HearthWorth Mortgage — Claude Workflow Guide

## Project Overview

**HearthWorth Mortgage** is a single-page mortgage intelligence platform built with React 19 + Vite. It provides mortgage calculators, amortization schedules, refinance analysis, payoff acceleration tools, and a market rate dashboard — all in a single monolithic JSX component.

## Tech Stack

- **React 19** + **JSX** (no TypeScript)
- **Vite 8** (Rolldown bundler) — `vite.config.js`
- **Recharts 3** — LineChart, BarChart, AreaChart, ReferenceLine
- **ESLint 10** — `eslint.config.js` (flat config, react-hooks + react-refresh plugins)
- **Google Fonts** — Playfair Display (headings), Inter (body), DM Mono (data/labels)
- **No routing library** — page navigation uses React `useState`
- **No TypeScript** — pure `.jsx` / `.js`
- **No test suite**

## Scripts

```bash
npm run dev       # Vite dev server with HMR
npm run build     # Production build → dist/
npm run lint      # ESLint check
npm run preview   # Serve the built dist/ locally
```

## Branch Strategy

```
master        ← production / default branch; all PRs target this
feature/<x>   ← new functionality
fix/<x>       ← bug fixes
chore/<x>     ← tooling, config, workflow changes
```

**NEVER commit directly to `master`.** Every change goes through a feature/fix/chore branch and an approved PR.

## Full Development Workflow

### 1. Start from master
```bash
git checkout master
git pull origin master
git checkout -b feature/<short-description>
```

### 2. Make changes
- All changes on the feature branch
- Keep commits focused — one logical change per commit

### 3. Pre-PR checks (must both pass)
```bash
npm run build   # clean Vite build, no errors
npm run lint    # zero ESLint errors
```

### 4. Open PR and request approval
```bash
git push -u origin feature/<name>
```
Post in chat: what changed, why, any screenshots for UI changes. **Wait for explicit approval before merging.**

### 5. On approval → merge and clean up
```bash
git checkout master && git pull origin master
```

## Project Structure

```
src/
  main.jsx               ← entry point (StrictMode, renders <App />)
  App.jsx                ← trivial wrapper — just renders <MortgageDashboard />
  MortgageDashboard.jsx  ← ENTIRE APPLICATION (~1,400 lines, monolithic)
  index.css              ← all global styles, CSS variables, animations
  App.css                ← component-level overrides
  assets/                ← static assets (favicon, images)
public/
  favicon.svg
index.html               ← Google Fonts link tags loaded here
vite.config.js           ← minimal Vite config, @vitejs/plugin-react only
eslint.config.js         ← flat ESLint config
package.json
```

## Architecture: MortgageDashboard.jsx

The entire app lives in one file. It is organized into clearly-delimited sections marked with `// ── SECTION NAME ──` comments:

| Line | Section | Description |
|------|---------|-------------|
| ~5 | IMAGE URLS | Unsplash photo URLs for hero backgrounds |
| ~15 | MATH | Pure financial math helpers |
| ~126 | PRODUCTS | Loan product definitions (PRODUCT_GROUPS) |
| ~181 | SHARED COMPONENTS | Reusable UI primitives (buttons, badges, etc.) |
| ~216 | TREASURY CHART | 10-yr Treasury rate chart component |
| ~313 | LOAN SETUP MODAL | `LoanSetupModal` — initial loan configuration dialog |
| ~413 | NAV | `Nav` — top navigation bar |
| ~449 | HOME PAGE | `HomePage` — landing hero + feature cards |
| ~631 | MARKET PAGE | `MarketPage` — live mortgage rate context |
| ~675 | KNOWLEDGE PAGE | `KnowledgePage` — educational content |
| ~727 | CALCULATOR PAGE | `CalculatorPage` — main amortization + tabs (Refi, Payoff) |
| ~944 | REFI CONTENT | Refinance analysis logic + UI (shared by RefiPage + Calculator tab) |
| ~1126 | REFI PAGE | `RefiPage` — full-page wrapper with hero |
| ~1147 | PAYOFF CONTENT | Payoff acceleration logic + UI (shared) |
| ~1330 | PAYOFF PAGE | `PayoffPage` — full-page wrapper |
| ~1351 | FOOTER | `Footer` component |
| ~1388 | MAIN APP | `MortgageDashboard` default export — root state + page router |

### Page Navigation

Navigation is **state-driven** — no URL routing. The root `MortgageDashboard` component holds a `page` string and passes `setPage` down. Pages: `'home'`, `'market'`, `'knowledge'`, `'calculator'`, `'refi'`, `'payoff'`.

## Financial Math Engine (inline in MortgageDashboard.jsx)

| Function | Purpose |
|----------|--------|
| `mpmt(bal, rate, n)` | Monthly payment formula — handles zero-rate edge case |
| `computePMI(bal, val)` | PMI rate lookup by LTV bracket; returns 0 when LTV ≤ 80% |
| `pmiDropOff(bal, val, rate, months)` | Month at which PMI drops off the loan |
| `amortize(balance, product, permRate, monthsElapsed)` | Full amortization schedule supporting ARM phases and fixed loans |
| `computeScenario({balance, credit, noteRate, product})` | Scenario comparison — total interest, schedule, payment list |

### Loan Products (PRODUCT_GROUPS)

Products are defined in a `PRODUCT_GROUPS` array and flattened into `PRODUCTS`. Each product has:
- `term` (months), `phases` (ARM rate offsets), `armAdj` (ARM ceiling adjustment)
- Groups include conventional fixed, ARM, FHA, jumbo, etc.

## Styling Conventions

### Typography
- **Playfair Display** — headings, hero text, display titles
- **Inter** — body text, UI prose, navigation
- **DM Mono** — data numbers, labels, badges, eyebrow text

### CSS Patterns
- CSS custom properties (`--ink`, `--fg`, `--accent-gold`, etc.) defined in `index.css`
- Dark theme as default; high-contrast paper sections for alternating layout
- CSS-only reveal animations: `.reveal` / `.reveal.in` with `IntersectionObserver`
- All styles in `index.css` or inline within `MortgageDashboard.jsx` — no CSS modules

### Color System
- Background (ink): `oklch(0.18 0.018 250)` — deep navy-charcoal
- Surface cards: `oklch(0.22 0.018 250)` bg · `oklch(1 0 0 / 0.08)` border · 18px radius
- Paper sections: `oklch(0.965 0.012 80)` with `var(--ink)` text
- Accents: `--accent-gold`, `--accent-sky`, `--accent-grow`, `--accent-hearth`
- Use `oklch()` exclusively — never raw hex or rgb

## Build Rules

- `npm run build` must pass with zero errors before any PR
- `npm run lint` must pass with zero errors
- Never use `// eslint-disable` to silence lint errors — fix them properly
- No TypeScript is used — do not add `.ts`/`.tsx` files or `tsconfig.json`
- Recharts formatters: type params as `unknown`, cast return values explicitly if needed

## Monolithic File Policy

`MortgageDashboard.jsx` is intentionally a single large file. When adding features:
- Add new sections with the `// ── SECTION NAME ──` marker pattern
- Place new sections in logical order (math first, then components, then pages)
- Do not split into separate files unless the user explicitly requests it
- Keep shared math helpers near the top, pure components in the middle, page components lower

## Commit Message Convention

Follow Conventional Commits:
- `feat:` new feature
- `fix:` bug fix
- `chore:` tooling/config/workflow change
- `refactor:` code cleanup, no behavior change
- `docs:` documentation only

Always end with:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

## Key Decisions Already Made

- **Single-file architecture** — entire app in `MortgageDashboard.jsx`; splitting is a deliberate future decision, not a default
- **State routing** — no react-router-dom; page state passed as props avoids URL complexity for a tool app
- **Recharts** — all charts use Recharts; do not introduce a second charting library
- **Inline math** — financial calculations are pure functions in the same file; do not move to a separate module unless explicitly asked
- **Google Fonts** — loaded in `index.html` via `<link>` tags; do not use font packages

## Design Preferences

- Mobile-first — design for ≤820px first, expand for desktop
- Sticky bottom CTA on mobile only (`position: fixed; bottom: 0`), hidden on desktop
- Choropleth map (if added): static — no drag, no zoom
- Filter changes must update **all** derived metrics simultaneously — never leave a stale value
- Remove features entirely when cutting them — never hide with `display: none` or a CSS class
- Ghost buttons: `className="btn btn-ghost"` — never custom inline styles for nav actions

## Preferred Feedback Loop

When proposing a change, lead with:
1. Which section(s) of `MortgageDashboard.jsx` change and why
2. The specific before/after behaviour
3. Any financial calculation or state that will be affected
