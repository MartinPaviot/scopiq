# Scopiq — Tasks (Kiro Phase 3)

> Backlog ordonne. Chaque tache: max 30 min, liee a un REQ, criteres "done" clairs.
> Execution sequentielle sauf mention "parallelisable".
> Estimations: S = <10min, M = 10-20min, L = 20-30min

---

## Phase A — Repo Bootstrap (must be first)

### T-A01: Init Next.js + package.json + tsconfig (L)
**REQ:** REQ-NFR-05
**Do:**
- `pnpm create next-app` in scopiq/ with TypeScript, Tailwind, App Router, src/ directory
- Configure `package.json` name: `@scopiq/app`, scripts: dev (port 3002), build, typecheck, test
- `tsconfig.json` with strict mode, `@/` path alias to `src/`
- `next.config.ts` minimal (no special config yet)
- `.gitignore` (node_modules, .next, .env, prisma generated)
- Delete boilerplate files (page.tsx default content, favicon.ico, etc.)

**Done:** `pnpm dev` starts on port 3002 with blank page, `pnpm typecheck` passes.

---

### T-A02: Prisma schema + DB setup (L)
**REQ:** REQ-NFR-03
**Do:**
- Create `prisma/schema.prisma` with full schema from design.md section 2
- `pnpm add prisma @prisma/client`
- Create `src/lib/prisma.ts` (singleton pattern)
- `.env.example` with all env vars from design.md section 8
- `.env` with local DATABASE_URL (user creates their own Neon/Supabase DB)
- `npx prisma db push` to sync schema

**Done:** `npx prisma studio` opens and shows all models. `prisma.workspace.findMany()` works.

---

### T-A03: shadcn/ui + design tokens (M)
**REQ:** REQ-NFR-04, REQ-ING-08
**Do:**
- `npx shadcn@latest init` with New York style
- Install core components: Button, Input, Badge, Card, Tabs, Popover, Select, Slider, Dialog, Separator, Label, Tooltip, ScrollArea, DropdownMenu, Sonner (toast)
- Port `globals.css` from LeadSens: all design tokens (oklch palette, typography scale, semantic colors, shadow tokens, animations: fade-in-up, card-hover, row-hover, scrollbar-thin, glass-card)
- Remove LeadSens-specific CSS (chat/assistant-ui styles, landing page animations, bg-leadsens-mesh)
- Create `src/lib/utils.ts` with `cn()` helper
- `pnpm add @phosphor-icons/react` (icon library)

**Done:** `cn()` works, `<Button>` renders with teal primary, design tokens match LeadSens palette.

---

### T-A04: Root layout + fonts (S)
**REQ:** REQ-NFR-04
**Do:**
- Port `src/app/layout.tsx` from LeadSens: Geist, Geist Mono, Plus Jakarta Sans fonts
- Create `src/components/theme-provider.tsx` (next-themes)
- Add Toaster (sonner)
- Set metadata: title "Scopiq", description
- Create `public/favicon.svg` (placeholder)

**Done:** App renders with correct fonts, dark mode toggle works, toast works.

---

### T-A05: Better Auth setup (M)
**REQ:** REQ-NFR-02
**Do:**
- `pnpm add better-auth`
- Create `src/lib/auth.ts` — server-side Better Auth config (Prisma adapter, Google OAuth provider)
- Create `src/lib/auth-client.ts` — client-side auth hooks
- Create `src/app/api/auth/[...all]/route.ts` — catch-all auth route
- Create `src/middleware.ts` — redirect unauthenticated users to /login

**Done:** Auth routes respond, Google OAuth flow works (or email/password if no Google creds).

---

### T-A06: Auth pages (login + signup) (M)
**REQ:** REQ-NFR-02
**Do:**
- Create `src/app/(auth)/login/page.tsx` — email + password + Google OAuth button
- Create `src/app/(auth)/signup/page.tsx` — registration form
- Create `src/app/(auth)/layout.tsx` — centered card layout
- Auto-create workspace on signup (name from email domain)
- Redirect to `/setup` after login if no ICP exists

**Done:** User can sign up, log in, and gets redirected to `/setup`.

---

### T-A07: tRPC setup (M)
**REQ:** REQ-NFR-04
**Do:**
- `pnpm add @trpc/server @trpc/client @trpc/react-query @tanstack/react-query`
- Create `src/server/trpc/trpc.ts` — init tRPC with context (session → workspaceId)
- Create `src/server/trpc/router.ts` — root router (empty routers for now)
- Create `src/app/api/trpc/[trpc]/route.ts` — HTTP handler
- Create `src/lib/trpc-client.ts` — React Query client
- Wrap app in TRPCProvider (in layout or dedicated provider)

**Done:** `trpc.workspace.ping.useQuery()` returns "pong" from server.

---

### T-A08: Inngest setup (M)
**REQ:** REQ-NFR-04
**Do:**
- `pnpm add inngest`
- Create `src/inngest/client.ts` — Inngest client with app ID "scopiq"
- Create `src/inngest/events.ts` — typed event schemas (tam/build.requested, tam/build.expand, tam/signals.enrich, icp/evolve)
- Create `src/app/api/inngest/route.ts` — Inngest serve handler (empty functions array for now)

**Done:** Inngest dev server connects, events page shows registered event types.

---

### T-A09: Core lib ports (encryption, logger) (S)
**REQ:** REQ-NFR-02, REQ-NFR-04
**Do:**
- Port `lib/encryption.ts` from LeadSens → `src/lib/encryption.ts`
- Port `lib/logger.ts` from LeadSens → `src/lib/logger.ts`
- Fix import paths (`@/lib/...` → `@/lib/...` — should be same)

**Done:** `encrypt("test")` returns encrypted string, `decrypt()` returns original. `logger.info()` outputs structured log.

---

## Phase B — Port Server-Side Libs

### T-B01: Port LLM client (S)
**REQ:** REQ-ICP-01
**Do:**
- Port `server/lib/llm/mistral-client.ts` → `src/server/lib/llm/mistral-client.ts`
- `pnpm add @mistralai/mistralai`
- Fix import paths

**Done:** `mistralClient.chat()` callable, typecheck passes.

---

### T-B02: Port Jina connector (S)
**REQ:** REQ-ING-01
**Do:**
- Port `server/lib/connectors/jina.ts` → `src/server/lib/connectors/jina.ts`
- Fix import paths (logger, rate-limit if any)

**Done:** `scrapeViaJina("https://example.com")` returns markdown content.

---

### T-B03: Port Apollo client (M)
**REQ:** REQ-TAM-01
**Do:**
- Port `server/lib/apollo/client.ts` → `src/server/lib/apollo/client.ts`
- Port `server/lib/connectors/apollo.ts` → `src/server/lib/connectors/apollo.ts`
- Fix import paths (logger, sleep/fetch-retry)
- Port `fetch-retry.ts` or `sleep()` helper if needed

**Done:** `apolloOrgCount()` and `apolloOrgSearchWithRateLimit()` callable, typecheck passes.

---

### T-B04: Port enrichment modules (M)
**REQ:** REQ-ING-01, REQ-SIG-01
**Do:**
- Port `server/lib/enrichment/company-analyzer.ts` → `src/server/lib/enrichment/company-analyzer.ts`
- Port `server/lib/enrichment/hiring-signal-extractor.ts` → `src/server/lib/enrichment/hiring-signal-extractor.ts`
- Fix import paths

**Done:** `analyzeCompany()` returns CompanyDna, `extractJobTitles()` returns titles array. Typecheck passes.

---

### T-B05: Port ICP modules (M)
**REQ:** REQ-ICP-01
**Do:**
- Port all 7 files from `server/lib/icp/` → `src/server/lib/icp/`
  - icp-schema.ts, icp-inferrer.ts, icp-converters.ts, icp-confidence.ts,
    icp-customer-analyzer.ts, icp-drift-detector.ts, icp-evolve.ts
- Fix import paths (mistral-client, logger, company-analyzer types)

**Done:** `inferICP()` callable, all Zod schemas parse correctly, typecheck passes.

---

### T-B06: Port TAM modules (M)
**REQ:** REQ-TAM-01, REQ-SIG-01
**Do:**
- Port all 9 files from `server/lib/tam/` → `src/server/lib/tam/`
  - tam-icp-inferrer.ts, account-scorer.ts, detect-signals.ts, detect-investor.ts,
    detect-connections.ts, scrape-site.ts, partitioner.ts, score-leads.ts, semantic-search.ts
- Fix import paths

**Done:** `scoreAccount()`, `detectAllSignals()`, `inferTamICP()` all callable. Typecheck passes.

---

### T-B07: Port Inngest TAM functions (L)
**REQ:** REQ-TAM-01, REQ-SIG-01, REQ-AUTO-01
**Do:**
- Port `inngest/tam-build.ts` → `src/inngest/tam-build.ts`
  - buildTam (6-phase pipeline)
  - expandTam (load more pages)
  - enrichSignals (signal detection background job)
- Port cron functions → `src/inngest/tam-crons.ts`
  - weeklySignalRefresh
  - resumeRateLimitedBuilds
- Port `inngest/icp-evolution.ts` → `src/inngest/icp-evolution.ts`
- Remove LeadSens-specific imports (campaign, lead models, ESP connectors)
- Register all functions in `api/inngest/route.ts`

**Done:** Inngest dev server shows all 6 functions registered. Typecheck passes.

---

## Phase C — tRPC Routers

### T-C01: Workspace router (M)
**REQ:** REQ-ING-01
**Do:**
- Create `src/server/trpc/routers/workspace.ts`
- Procedures: `getSettings`, `updateSettings`, `analyzeUrl` (triggers Jina scrape + CompanyDna extraction)
- Wire into root router

**Done:** `trpc.workspace.analyzeUrl.mutate({ url })` scrapes and returns CompanyDna.

---

### T-C02: Ingestion router (L)
**REQ:** REQ-ING-01 through REQ-ING-07
**Do:**
- Create `src/server/trpc/routers/ingestion.ts`
- Procedures:
  - `getSources` — list all IngestionSource for workspace
  - `processUrl` — create source, trigger async scrape + extraction
  - `processUpload` — create source from uploaded file content, trigger parse
  - `deleteSource` — remove a source
  - `getStatus` — get processing status of a source
- Business logic:
  - Website: scrapeViaJina → analyzeCompany → store CompanyDna
  - LinkedIn company: scrapeViaJina (r.jina.ai prefix) → extract structured fields
  - LinkedIn profile: scrapeViaJina → extract profile fields
  - CSV customers: parse (port CUSTOMER_HEADERS) → getDominantPatterns → store CustomerImport
  - Document: text extraction (basic for now, PDF/DOCX parsers added in P1)

**Done:** All 4 P0 source types processable via tRPC. Sources stored in DB with status.

---

### T-C03: ICP router (L)
**REQ:** REQ-ICP-01, REQ-ICP-02, REQ-ICP-03
**Do:**
- Create `src/server/trpc/routers/icp.ts`
- Procedures:
  - `infer` — gather all IngestionSources, build IcpInferenceInput, call inferICP(), store IcpProfile
  - `getActive` — return active IcpProfile with confidence scores
  - `update` — apply manual edits, recompute Apollo filter preview
  - `getApolloPreview` — convert current ICP to Apollo filters, return preview
  - `getProposals` — list IcpEvolutionProposals
  - `respondToProposal` — accept/reject

**Done:** Full ICP lifecycle works: infer → display → edit → save.

---

### T-C04: TAM router (L)
**REQ:** REQ-TAM-01 through REQ-TAM-05, REQ-EXP-01, REQ-EXP-02
**Do:**
- Port `server/trpc/routers/tam.ts` from LeadSens → `src/server/trpc/routers/tam.ts`
- Keep: startBuild, getLatestBuild, getBuildStatus, getAccounts (with smart NL search), getLeads, getFilterCounts (with 30s cache), getSummary, loadMore, enrichLead, exportAccounts
- Remove: pipeline cross-reference (Lead model doesn't exist in Scopiq)
- Add: `syncToHubspot` mutation (P1 — stub for now)

**Done:** All TAM tRPC procedures work. Smart search parses "hiring tier a" correctly.

---

### T-C05: Integration router (M)
**REQ:** REQ-NFR-02, REQ-EXP-02
**Do:**
- Create `src/server/trpc/routers/integration.ts`
- Procedures: `list`, `connect` (encrypt API key, store), `disconnect`, `testConnection`
- Create `src/app/api/integrations/[tool]/route.ts` — generic API key handler
- Support types: "apollo", "hubspot", "google_sheets"

**Done:** Apollo API key can be saved encrypted and retrieved for use.

---

### T-C06: Wire all routers (S)
**REQ:** all
**Do:**
- Update `src/server/trpc/router.ts` to compose all 5 routers
- Verify `AppRouter` type exports correctly for client

**Done:** `pnpm typecheck` passes. All router procedures accessible from client.

---

## Phase D — Setup Page (Ingestion UI)

### T-D01: Source card component (M)
**REQ:** REQ-ING-08
**Do:**
- Create `src/components/setup/source-card.tsx`
- Generic card with 4 states: empty (icon + title + description + CTA), loading (progress), success (preview), error (message + retry)
- Props: type, status, title, description, icon, children (for input area), preview (for success state)
- Consistent with LeadSens card style (rounded-xl, border, shadow-sm, card-hover animation)

**Done:** Component renders all 4 states correctly.

---

### T-D02: Website source component (M)
**REQ:** REQ-ING-01
**Do:**
- Create `src/components/setup/website-source.tsx`
- URL input with validation + auto-prepend https://
- Calls `trpc.ingestion.processUrl.mutate({ type: "website", url })`
- Shows CompanyDna preview on success: oneLiner, targetBuyers, pricing tier, differentiators
- Loading state with "Analyzing website..." message

**Done:** Enter URL → scrapes → shows CompanyDna preview card.

---

### T-D03: CSV customer source component (M)
**REQ:** REQ-ING-05
**Do:**
- Create `src/components/setup/csv-source.tsx`
- File input (drag & drop + click) accepting .csv, .tsv
- Client-side parse with CUSTOMER_HEADERS mapping (port from LeadSens customer-import-step.tsx)
- Show pattern summary: top industries, top sizes, top geos, avg deal value, total count
- Calls `trpc.ingestion.processUpload.mutate()` to store

**Done:** Upload CSV → patterns displayed → data stored in DB.

---

### T-D04: LinkedIn company + profile sources (M)
**REQ:** REQ-ING-02, REQ-ING-03
**Do:**
- Create `src/components/setup/linkedin-company-source.tsx`
- Create `src/components/setup/linkedin-profile-source.tsx`
- Both: URL input with LinkedIn pattern validation
- Call `trpc.ingestion.processUrl.mutate({ type: "linkedin_company" | "linkedin_profile", url })`
- Show extracted fields preview on success

**Done:** LinkedIn URLs accepted, scraped via Jina, preview shown.

---

### T-D05: Setup page orchestrator (L)
**REQ:** REQ-ING-08
**Do:**
- Create `src/app/(app)/setup/page.tsx`
- Full-page layout with header ("Tell us about your business")
- Card grid: Website URL (hero), Customer CSV, LinkedIn Company, LinkedIn Profile
- P1 cards (LinkedIn Connections, Documents, CRM) shown with "Coming soon" badge
- Progress indicator: "X of Y sources provided"
- "Generate ICP" button — enabled when ≥1 source complete
- State persisted server-side: load existing sources on mount via `trpc.ingestion.getSources`

**Done:** Full setup page renders, all P0 sources functional, "Generate ICP" triggers inference.

---

### T-D06: SSE stream endpoint (M)
**REQ:** REQ-ICP-04
**Do:**
- Create `src/app/api/tam/stream/route.ts` — SSE endpoint
- Streams progress events during ICP inference and TAM build
- Format: `{ type: "progress" | "complete" | "error", phase, message, data? }`
- Client-side: EventSource connection with auto-reconnect

**Done:** SSE events stream to client during ICP inference and TAM build.

---

## Phase E — ICP Page

### T-E01: ICP overview page (L)
**REQ:** REQ-ICP-02
**Do:**
- Create `src/app/(app)/icp/page.tsx`
- Create `src/components/icp/icp-overview.tsx` — full ICP view
- Sections: Roles, Industries, Company Size, Geographies, Keywords, Buying Signals, Competitors, Disqualifiers, Segments
- Each section: values as tags, confidence bar, "Why?" expandable
- Overall readiness indicator ("Ready to build TAM" vs "Needs review")
- Action buttons: "Build TAM", "Edit", "Regenerate"
- Load data via `trpc.icp.getActive`

**Done:** ICP page displays all dimensions with confidence scores and reasoning.

---

### T-E02: Confidence bar component (S)
**REQ:** REQ-ICP-02
**Do:**
- Create `src/components/icp/confidence-bar.tsx`
- Visual bar 0-100%, color-coded: green (≥70%), yellow (40-69%), red (<40%)
- Label text: "High confidence", "Medium confidence", "Low confidence"

**Done:** Component renders correctly for all confidence levels.

---

### T-E03: ICP editor mode (L)
**REQ:** REQ-ICP-03
**Do:**
- Create `src/components/icp/icp-editor.tsx`
- Tag-based editing for arrays (industries, titles, geos, keywords) with add/remove
- Dual-thumb slider for employee range (min/max) + sweet spot
- Buying signals: add/remove with strength dropdown
- Negative ICP: add/remove disqualifiers
- "Save" calls `trpc.icp.update`, "Cancel" reverts to stored version
- Change tracking: items marked as "manual" vs "inferred"

**Done:** All ICP fields editable inline. Changes save to DB and reflect on page.

---

### T-E04: Apollo filter preview (S)
**REQ:** REQ-ICP-02
**Do:**
- Create `src/components/icp/apollo-filter-preview.tsx`
- Shows Apollo filter mapping for current ICP (using `icpProfileToOrgFilters` + `icpProfileToPeopleFilters`)
- Collapsible panel at bottom of ICP page

**Done:** User sees exactly what Apollo query will be made.

---

## Phase F — Market Table

### T-F01: Port market table core (L)
**REQ:** REQ-TAM-03
**Do:**
- Create `src/components/market/market-table.tsx`
- Port core table structure from LeadSens `market/page.tsx`:
  - Virtual scrolling with `@tanstack/react-virtual` (ROW_HEIGHT=32, PAGE_SIZE=50)
  - `pnpm add @tanstack/react-virtual`
  - Column layout: company icon | name + domain | industry | employees | location | tier | heat | score | signals | contacts | actions
  - Sorted by heatScore desc (default)
  - Infinite scroll: load more pages when scrolling near bottom

**Done:** Table renders 2,000 rows with virtual scrolling, no jank.

---

### T-F02: Company icon + heat icon (S)
**REQ:** REQ-TAM-03
**Do:**
- Create `src/components/market/company-icon.tsx` — port CompanyIcon from LeadSens (Google S2 favicon, fallback colored avatar with 12 colors)
- Create `src/components/market/heat-icon.tsx` — port HeatIcon (Fire/Thermometer/Snowflake)

**Done:** Icons render correctly for all states.

---

### T-F03: Score tooltip (M)
**REQ:** REQ-TAM-03
**Do:**
- Create `src/components/market/score-tooltip.tsx` — port ScoreTooltipFixed (portal-based)
- BreakdownBar component: 5 bars (Industry, Size, Keywords, Signals, Data) with values and color
- Heat label, tier badge, fit signals, intent signals

**Done:** Hover on score cell → portal-based tooltip appears with full breakdown.

---

### T-F04: Filter bar + smart search (L)
**REQ:** REQ-TAM-03
**Do:**
- Create `src/components/market/filter-bar.tsx`
  - Tier multi-select with counts (port filter logic)
  - Industry multi-select
  - Country multi-select
  - Size range slider
  - Hiring only toggle
  - Funded only toggle
- Create `src/components/market/smart-search.tsx`
  - Text input with hint chips ("Try: hiring tier A, funded startups")
  - NL parsing happens server-side in tam router (already ported in T-C04)

**Done:** All filters work, counts update, smart search parses NL queries.

---

### T-F05: Account expand panel (L)
**REQ:** REQ-TAM-04
**Do:**
- Create `src/components/market/account-expand.tsx` — expand panel below row
- Three sections: Contacts | Signals | Timeline
- Contacts: port `tam-lead-expand.tsx` → `contact-list.tsx` (fit bars, signal badges, availability icons)
- Signals: port `signal-popover.tsx` (Reasoning/Sources tabs)
- Timeline: port `account-timeline.tsx` (chronological event feed)
- Recommended action badge based on top signal

**Done:** Click row → expand shows contacts, signals with popovers, timeline.

---

### T-F06: Export button (M)
**REQ:** REQ-EXP-01
**Do:**
- Create `src/components/market/export-button.tsx`
- Port `ExportAllButton` from LeadSens: uses `trpc.tam.exportAccounts` with current filters
- CSV generation with UTF-8 BOM, all HubSpot-compatible columns
- Filename: `scopiq-tam-{date}.csv`

**Done:** Click Export → CSV downloads with filtered data.

---

### T-F07: Market page assembly (M)
**REQ:** REQ-TAM-03
**Do:**
- Create `src/app/(app)/market/page.tsx`
- Compose: ICP banner (top) + filter bar + smart search + market table + export button
- ICP banner: port IcpBanner from LeadSens (expandable, tag pills by category)
- Load data via `trpc.tam.getLatestBuild` + `trpc.tam.getAccounts`
- Polling: if build in progress, poll `trpc.tam.getBuildStatus` every 3s

**Done:** Full market page functional with all features.

---

### T-F08: Build progress overlay (M)
**REQ:** REQ-TAM-05
**Do:**
- Create `src/components/build/build-progress.tsx`
- Phase indicators with icons (port PHASE_META: analyzing, counting, loading-top, scoring, complete)
- Progress counters: "Loading accounts (342/2,000)..."
- Rate limit badge: "Apollo: 23/600"
- Cancel button
- "Expand market" button (post-build)
- Shown on market page when build is in progress or just completed

**Done:** Build progress displays correctly during TAM build.

---

## Phase G — App Shell

### T-G01: App layout + sidebar (M)
**REQ:** REQ-NFR-04
**Do:**
- Create `src/app/(app)/layout.tsx` — app shell with sidebar + main content
- Create `src/components/app-sidebar.tsx`
  - Logo
  - Nav links: Market, ICP, Settings
  - User avatar + dropdown (settings, logout)
- Auth guard: redirect to /login if not authenticated
- Conditional: redirect to /setup if no ICP exists

**Done:** Authenticated layout with sidebar navigation works.

---

### T-G02: Settings page + integrations (M)
**REQ:** REQ-NFR-02
**Do:**
- Create `src/app/(app)/settings/page.tsx` — workspace name, company URL
- Create `src/app/(app)/settings/integrations/page.tsx` — API key cards for Apollo, HubSpot, Google
- Each integration card: connect/disconnect, test connection, status badge

**Done:** Apollo API key can be saved and tested from settings.

---

### T-G03: Landing / redirect page (S)
**REQ:** REQ-NFR-05
**Do:**
- Create `src/app/page.tsx`
- If authenticated: redirect to /market (or /setup if no ICP)
- If not authenticated: redirect to /login (or simple landing page)

**Done:** Root URL correctly routes based on auth state.

---

## Phase H — Integration & Polish

### T-H01: End-to-end flow test (L)
**REQ:** all P0
**Do:**
- Manual test: signup → setup (enter URL + upload CSV) → generate ICP → review ICP → build TAM → view market table → filter → search → expand account → export CSV
- Fix any runtime errors
- Verify SSE streaming works
- Verify Inngest functions trigger correctly

**Done:** Full flow works end-to-end without errors.

---

### T-H02: HubSpot sync stub (M)
**REQ:** REQ-EXP-02
**Do:**
- Create `src/app/api/integrations/hubspot/auth/route.ts` + `callback/route.ts`
- Implement `trpc.tam.syncToHubspot`:
  - Create Company objects by domain (deduplicate)
  - Create Contact objects by email (deduplicate)
  - Custom properties: tam_source, tam_tier, tam_heat_score
  - Progress tracking, summary counts

**Done:** HubSpot OAuth works, accounts sync with dedup and custom properties.

---

### T-H03: Error handling + edge cases (M)
**REQ:** REQ-NFR-01
**Do:**
- Loading states: skeleton components for market table, ICP page, setup cards
- Error boundaries: graceful error display on tRPC failures
- Empty states: "No TAM built yet", "No ICP defined"
- Rate limit UI: Apollo daily limit display + "rate limited" state handling
- Toast notifications for success/error actions

**Done:** No unhandled errors, all states have appropriate UI.

---

### T-H04: Responsive + accessibility pass (M)
**REQ:** REQ-NFR-01
**Do:**
- Setup page: responsive card grid (1 col mobile, 2 col tablet, 3 col desktop)
- Market table: horizontal scroll on small screens
- Keyboard navigation: tab through filters, enter to expand row
- Focus states: visible focus rings on all interactive elements
- aria-labels on icon-only buttons

**Done:** Usable on tablet, keyboard navigable, no accessibility violations.

---

### T-H05: Deploy to Vercel (M)
**REQ:** REQ-NFR-05
**Do:**
- Create Vercel project linked to github.com/MartinPaviot/scopiq
- Set environment variables
- `pnpm build` passes
- Deploy preview + production
- Verify Inngest connection in production

**Done:** App live on Vercel, full flow works in production.

---

## Execution Order Summary

```
Phase A: Bootstrap (7 tasks, ~2h)
  A01 → A02 → A03 → A04 → A05 → A06 → A07 → A08 → A09

Phase B: Port Server Libs (7 tasks, ~1.5h)
  B01 → B02 → B03 → B04 → B05 → B06 → B07
  (B01-B06 parallelisable, B07 depends on all)

Phase C: tRPC Routers (6 tasks, ~1.5h)
  C01 → C02 → C03 → C04 → C05 → C06
  (C01-C05 parallelisable, C06 wires them)

Phase D: Setup Page (6 tasks, ~2h)
  D01 → D02, D03, D04 (parallelisable) → D05 → D06

Phase E: ICP Page (4 tasks, ~1h)
  E01 → E02 → E03 → E04

Phase F: Market Table (8 tasks, ~2.5h)
  F01 → F02, F03 (parallelisable) → F04 → F05 → F06 → F07 → F08

Phase G: App Shell (3 tasks, ~1h)
  G01 → G02 → G03

Phase H: Polish (5 tasks, ~2h)
  H01 → H02 → H03 → H04 → H05

Total: 46 tasks, ~13.5h estimated
```

---

## P1 Tasks (post-hackathon)

| ID | Task | REQ |
|----|------|-----|
| T-P1-01 | LinkedIn connections CSV import | REQ-ING-04 |
| T-P1-02 | Document upload (PDF/DOCX parsing) | REQ-ING-06 |
| T-P1-03 | CRM import (HubSpot OAuth pull) | REQ-ING-07 |
| T-P1-04 | Google Sheets export | REQ-EXP-03 |
| T-P1-05 | Auto-refresh TAM (Inngest cron config UI) | REQ-AUTO-01 |
| T-P1-06 | CRM sync on refresh | REQ-AUTO-02 |
| T-P1-07 | ICP evolution proposals UI | REQ-ICP-05 |
| T-P1-08 | Changelog page | REQ-AUTO-01 |
| T-P1-09 | Contact dual-view (flat contact table) | REQ-TAM-03 |
