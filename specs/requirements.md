# Scopiq — Requirements (Kiro Phase 1)

> Format: EARS (Easy Approach to Requirements Syntax)
> Baseline: LeadSens TAM engine (7.0/10 audit, battle-tested)
> Repo: github.com/MartinPaviot/scopiq (standalone, NOT inside LeadSens monorepo)
> Prioritization: P0 = hackathon demo, P1 = post-demo, P2 = future

---

## 0. Context & Reuse Strategy

Scopiq is a spin-off of LeadSens' TAM engine. The codebase from LeadSens
(`apps/leads/src/server/lib/tam/`, `icp/`, `apollo/`, `enrichment/`, `connectors/`)
is **ported** into this standalone repo — not imported as dependency.

**Ported modules (copy + adapt):**
- `tam-icp-inferrer.ts` — ICP inference from website (Mistral Large, tamIcpSchema)
- `icp-inferrer.ts` — Multi-source ICP inference (CompanyDna + customer patterns + NL + ACV + win/loss)
- `icp-schema.ts` — Zod schemas (IcpProfileData, icpRoleSchema, buyingSignalSchema, employeeRangeSchema, etc.)
- `icp-converters.ts` — ICP → Apollo Org/People search filters
- `icp-confidence.ts` — Confidence scoring per dimension (0.0-1.0)
- `icp-customer-analyzer.ts` — Customer pattern analysis (getDominantPatterns)
- `icp-drift-detector.ts` — ICP drift detection
- `icp-evolve.ts` — Evolution engine
- `apollo/client.ts` — Apollo org search + people search + rate limiting (daily + per-second)
- `connectors/apollo.ts` — Apollo people enrichment (searchPeople, enrichPerson)
- `account-scorer.ts` — 5-dimension scoring (industry 0-25, size 0-25, keyword 0-20, signal 0-20, freshness 0-10)
- `detect-signals.ts` — 5 signal detectors (hiring, sales-led, funding, tech stack, new in role)
- `detect-investor.ts` — Common investor detection
- `detect-connections.ts` — LinkedIn connection proximity
- `scrape-site.ts` — Jina Reader scraping
- `enrichment/company-analyzer.ts` — CompanyDna extraction (companyDnaSchema)
- `enrichment/hiring-signal-extractor.ts` — Deterministic hiring signal extraction from career pages
- `connectors/jina.ts` — Jina Reader connector (scrapeViaJina, 20 req/min)
- `lib/encryption.ts` — AES-256-GCM encryption for API keys
- `lib/logger.ts` — Structured logging
- `llm/mistral-client.ts` — Mistral client with phantom recovery

**Stack (same as LeadSens):**
Next.js 15 App Router, TypeScript strict, Tailwind CSS 4, shadcn/ui + Radix,
Phosphor icons, Prisma 6 + PostgreSQL (Neon/Supabase), Inngest, Better Auth,
tRPC + TanStack Query, Mistral (Large + Small), Zod, Jina Reader.

**NOT reused (Scopiq doesn't need):**
LeadSens email pipeline, ESP connectors (Instantly/Smartlead/Lemlist), campaign system,
reply management, A/B testing, style learner, prompt builder, email drafting.

---

## 1. Actors

| ID | Actor | Description |
|----|-------|-------------|
| A1 | Founder | Early-stage founder, doesn't master Sales/GTM. Primary user. |
| A2 | Scopiq System | Backend: API routes, Inngest jobs, LLM calls, signal detectors. |
| A3 | Apollo API | External data provider: org search (FREE), people search (FREE partial / PAID full). |
| A4 | Jina Reader | Web scraper: `r.jina.ai/{url}`, 20 req/min, used for site analysis + career page signals. |
| A5 | Mistral LLM | Large = ICP inference, analysis. Small = scoring, classification. |

---

## 2. Feature 1 — ICP Definition

### 2.1 Ingestion (Full-Page Experience — NOT modal)

The ingestion page is the first thing the user sees after auth. It must be a
**full-page, production-quality experience** — not the modal-based onboarding
that LeadSens uses. This is the product's first impression.

---

#### REQ-ING-01: Website URL Input (P0)

**When** the Founder enters a company website URL on the ingestion page,
**the System shall** scrape via Jina Reader, extract CompanyDna (via `company-analyzer.ts`
pattern: oneLiner, targetBuyers, keyResults, differentiators, problemsSolved,
pricingModel, socialProof, toneOfVoice, ctas), and display a structured preview.

**Acceptance Criteria:**
- URL input with auto-prepend `https://` if missing
- Scrape via `scrapeViaJina(url)` — respects 20 req/min rate limit
- Extract CompanyDna via Mistral Large (port `company-analyzer.ts` companyDnaSchema)
- Preview card shows: oneLiner, targetBuyers (role + sellingAngle), pricing tier, differentiators
- Raw scraped content stored in DB (equivalent to `CompanyCache` model, TTL 7 days)
- CompanyDna stored on workspace for reuse in ICP inference
- Error handling: invalid URL, unreachable site, Jina 403/captcha (graceful fallback message), timeout 30s
- SSE progress: "Scraping website..." → "Extracting company DNA..." → "Done"

**Edge Cases:**
- URL with/without protocol, with/without www, trailing slashes → normalize
- SPA with no SSR content → Jina handles JS rendering, but may return sparse data → show "limited data" badge
- Very large pages → truncate input to 50,000 chars before LLM call
- Site in non-English → Mistral handles multilingual, CompanyDna output in English

---

#### REQ-ING-02: LinkedIn Company Page (P0)

**When** the Founder provides a LinkedIn company page URL,
**the System shall** scrape via Jina, extract structured company data,
and store as an ingestion source.

**Acceptance Criteria:**
- Input accepts `linkedin.com/company/*` URLs (validate pattern)
- Scrape via `scrapeViaJina("https://r.jina.ai/https://linkedin.com/company/X")`
- Extract: company name, industry, employee count range, description, specialties, HQ location
- Preview card with extracted fields, each editable
- Stored as ingestion source `type: "linkedin_company"` with raw + structured data
- Contributes to ICP inference: industry signal, size signal, geo signal

**Edge Cases:**
- Private/restricted company pages → partial data, show "limited" badge, no error
- URL format variations (`/company/name`, `/company/name/about`, `/company/12345`) → normalize to canonical
- Non-company LinkedIn URLs → validation error before scrape attempt

---

#### REQ-ING-03: LinkedIn Personal Profile (P0)

**When** the Founder provides their LinkedIn personal profile URL,
**the System shall** scrape public profile data and extract network/role context.

**Acceptance Criteria:**
- Input accepts `linkedin.com/in/*` URLs
- Scrape via Jina for public profile data
- Extract: name, headline, current company, current role, summary, experience history (last 3 positions)
- Store as `type: "linkedin_profile"`
- Feeds into ICP inference: founder's background → product-market intuition
- Feeds into signal detection (Feature 3): founder's company history → network proximity baseline

**Edge Cases:**
- Private profiles → extract what's publicly available, note limitations
- Non-standard URLs → normalize
- Non-English profiles → handle gracefully (Mistral multilingual)

---

#### REQ-ING-04: LinkedIn Connections Import (P1)

**When** the Founder uploads a LinkedIn connections CSV export,
**the System shall** parse, store, and use connections for network proximity signals.

**Acceptance Criteria:**
- File upload: `.csv` (LinkedIn standard export: First Name, Last Name, Email, Company, Position, Connected On)
- Parse with auto-delimiter detection (tab > semicolon > comma)
- Store in `LinkedInConnection` model: profileUrl, name, headline, companyName, companyDomain (inferred from company name), connectionDate
- Deduplicate by name+company (LinkedIn export doesn't include profile URLs)
- UI: show import count, top 10 companies by connection count, total connections
- Async processing for large files (1000+ connections) with progress
- Used in Feature 3 (`detect-connections.ts`): match connection.companyDomain against TAM account domains

**Edge Cases:**
- Old vs new LinkedIn export format → detect header row and map flexibly
- Missing company/position fields → store partial, still usable for name matching
- 5000+ connections → batch insert, progress bar
- Non-ASCII names → handle UTF-8 encoding

---

#### REQ-ING-05: Customer CSV Import (P0)

**When** the Founder uploads a CSV of existing customers,
**the System shall** parse it, analyze patterns, and store for ICP grounding.

This is the highest-value ingestion source — real customer data grounds the ICP
in reality rather than inference. Port LeadSens `customer-import-step.tsx` parser
and `icp-customer-analyzer.ts` analysis.

**Acceptance Criteria:**
- File upload: `.csv`, `.tsv`
- Auto-delimiter detection (tab > semicolon > comma) — port from LeadSens
- Header mapping with FR/EN support (port `CUSTOMER_HEADERS` from `customer-import-step.tsx`):
  company/entreprise/société → companyName, domain/website → domain, industry/secteur → industry,
  employees/effectif/taille → employeeCount, deal value/montant/ca → dealValue, country/pays → country
- Pattern analysis via `getDominantPatterns()` (port from `icp-customer-analyzer.ts`):
  - Top industries with percentages
  - Top company sizes with distribution
  - Top geographies
  - Average deal value (if available)
  - Total customer count
- Pattern preview displayed as summary cards with percentages
- Data stored in `CustomerImport` + `CustomerImportEntry` models
- Customer patterns stored and passed as `CustomerPatterns` input to ICP inference (highest priority source)

**Edge Cases:**
- CSV with no header → error with clear instructions
- Mixed encoding (UTF-8 BOM / Latin-1) → detect and handle
- Duplicate company names → deduplicate by domain if available, else by normalized name
- Empty required field (company name) → skip row, show "X rows skipped (missing company name)"
- Very large CSV (10,000+ rows) → batch processing with progress, cap analysis at 5,000 rows

---

#### REQ-ING-06: Strategic Document Upload (P1)

**When** the Founder uploads strategic documents (PDF, DOCX, TXT),
**the System shall** extract text and store for ICP analysis.

**Acceptance Criteria:**
- File upload: `.pdf` (text-based), `.docx`, `.txt`
- PDF text extraction (not OCR — text-layer PDFs only)
- DOCX extraction via docx parser
- Raw text stored as `type: "document"` with filename, preview (first 500 chars)
- Text fed into ICP inference as supplementary context (lower priority than customer data)

**Edge Cases:**
- Scanned PDFs → warning "Cannot extract text from image-based PDFs"
- Large files (>10MB) → reject with file size limit
- Password-protected → error message
- Multiple documents → accept up to 5, each stored separately

---

#### REQ-ING-07: CRM Import (P1)

**When** the Founder uploads a CRM export (CSV/JSON) or connects HubSpot via OAuth,
**the System shall** import deal history and customer attributes.

**Acceptance Criteria:**
- CSV/JSON file upload with auto-detection of structure
- HubSpot OAuth flow (port from LeadSens `hubspot/auth/` + `hubspot/callback/` pattern)
- Extract: company name, deal stage, deal value, close date, contact titles, industry
- Store as customer import with `source: "hubspot"` or `source: "csv_crm"`
- Pipeline summary shown: deal count, avg value, win rate, top industries
- Won deals weighted 3x vs lost deals in ICP pattern analysis

**Edge Cases:**
- HubSpot with empty pipeline → handle gracefully, skip pipeline analysis
- CSV from Pipedrive/Salesforce → flexible column mapping (extend CUSTOMER_HEADERS)
- JSON with nested structures → flatten to relevant deal-level fields

---

#### REQ-ING-08: Ingestion Page UX (P0)

**When** the Founder visits the ingestion page (first page after auth),
**the System shall** display a full-page, premium interface guiding through data source provision.

**Acceptance Criteria:**
- Full-page layout at `/setup` (or similar), NOT a modal, NOT a chat step
- **Minimum viable input:** Website URL only → user can proceed with just this
- Card-based layout organized by priority:
  1. Website URL (hero card, largest, primary CTA) — P0
  2. Customer CSV ("Your best signal — real customer data") — P0
  3. LinkedIn Company Page — P0
  4. LinkedIn Personal Profile — P0
  5. LinkedIn Connections CSV — P1
  6. Strategic Documents — P1
  7. CRM Import — P1
- Each card shows 4 states: empty (with placeholder + CTA), loading (with progress), success (with preview summary), error (with retry)
- Visual progress indicator: "3 of 4 sources provided" with filled dots
- "Generate ICP" button enabled when ≥1 source provided (Website URL)
- Design system: LeadSens warm intelligence palette (teal primary `oklch(0.72 0.14 180)`, warm white bg `oklch(0.985 0.005 90)`, Geist fonts)
- Responsive: desktop-first (primary), tablet (works), mobile (usable)
- State persisted server-side: page refresh restores partially completed sources
- P1 cards shown but with "Coming soon" badge if not yet implemented

**Edge Cases:**
- User provides only URL → valid, proceed with URL-only inference (lower confidence)
- User provides all sources → all feed into ICP inference (highest confidence)
- User returns to ingestion after ICP generated → show completed state with "Re-analyze" option
- Slow Jina scrape (>10s) → "Continue while analyzing" option (background process)

---

### 2.2 ICP Generation Agent

#### REQ-ICP-01: Multi-Source ICP Inference (P0)

**When** the Founder has provided ≥1 data source and triggers ICP generation,
**the System shall** analyze ALL provided sources with priority hierarchy
and produce a structured ICP.

Port LeadSens' `icp-inferrer.ts` which implements:
```
Priority hierarchy:
  1. Customer patterns (highest — real data from CSV/CRM)
  2. CompanyDna analysis (social proof, case studies, target buyers from website)
  3. NL description (if user provides free-text)
  4. LinkedIn data (company + profile context)
  5. Documents (supplementary)
  6. Defaults (lowest)
```

**Acceptance Criteria:**
- Input: all ingested sources, assembled into `IcpInferenceInput` (port from `icp-schema.ts`)
- LLM call: Mistral Large with structured prompt (port from `icp-inferrer.ts`)
- Output: `IcpProfileData` (port from `icp-schema.ts`):
  - `roles`: `[{title, variations, seniority, why}]`
  - `industries`: `string[]`
  - `employeeRange`: `{min, max, sweetSpot}`
  - `geographies`: `string[]`
  - `keywords`: `string[]`
  - `buyingSignals`: `[{name, detectionMethod, why, strength}]`
  - `disqualifiers`: `string[]`
  - `competitors`: `string[]`
  - `segments`: `[{name, titles, industries, sizes, geos}]`
  - `negativeIcp`: `{industries[], titles[], companyPatterns[], sizeExclusions[]}`
- Confidence scores per dimension (port `icp-confidence.ts`):
  - Each dimension: 0.0-1.0 based on evidence quality + source count
  - Overall confidence = weighted average
  - Computation: `computeConfidence(input: ConfidenceInput)` → `{industry, size, title, geo, overall}`
- Cross-referencing: if customer CSV shows 80% SaaS but website says "for enterprises", flag contradiction with evidence from both sources
- If user has existing ICP → CHALLENGE with data evidence, don't blindly accept

**Edge Cases:**
- Only website → inference from CompanyDna, confidence ~0.4-0.6
- Only customer CSV → inference from patterns, confidence ~0.7-0.9 on matched dimensions
- All sources → confidence ~0.8-1.0
- Contradictory data → present both interpretations with sources, let user resolve
- LLM returns invalid JSON → retry once with stricter prompt, then use Zod .safeParse with defaults

---

#### REQ-ICP-02: ICP Display with Apollo Criteria (P0)

**When** the ICP has been generated,
**the System shall** display it as an editable, structured view with confidence
indicators and Apollo-compatible criteria.

**Acceptance Criteria:**
- Section per ICP dimension, each with:
  - Values (tags for arrays, range slider for employee range)
  - Confidence bar (0-100%, color-coded: green ≥70%, yellow 40-69%, red <40%)
  - "Why?" expandable showing LLM reasoning + source references
  - Edit toggle (inline editing)
- Apollo filter mapping visible: each dimension shows the equivalent Apollo filter name
  (port `icpProfileToOrgFilters` + `icpProfileToPeopleFilters` from `icp-converters.ts`)
- Segments section: if multiple segments detected, show as tabs/cards
- Negative ICP section: disqualifiers prominently displayed
- Overall readiness indicator: "Ready to build TAM" (all confidence ≥0.5) vs "Needs review" (any <0.5)
- Action buttons: "Confirm & Build TAM", "Edit", "Regenerate" (with warning if manual edits exist)

**Edge Cases:**
- All high confidence → green state, prominent "Build TAM" CTA
- Mixed confidence → yellow state, highlight low-confidence dimensions for review
- Very low confidence → red state, suggest adding more data sources
- No segments detected → single default segment, note "Add more data for segmentation"

---

#### REQ-ICP-03: ICP Inline Editing (P0)

**When** the Founder views the generated ICP,
**the System shall** allow inline editing of every field with change tracking.

**Acceptance Criteria:**
- Array fields (industries, titles, geos, keywords): tag-based add/remove with autocomplete
- Employee range: dual-thumb slider (min/max) + sweet spot marker
- Buying signals: add/remove with strength selector (strong/moderate/weak)
- Negative ICP: add/remove disqualifiers
- Changes tracked: `source: "manual"` vs `source: "inferred"` on each field
- Validation on save: are values valid Apollo filter values?
- Confirm button to lock ICP and proceed to TAM build
- Undo: revert to AI-generated version available until TAM build starts

**Edge Cases:**
- User removes all industries → warning with impact explanation
- User adds very broad criteria (e.g., employee range 1-100,000) → warning with estimated count
- User edits then clicks "Regenerate" → confirm dialog "This will overwrite manual changes"

---

#### REQ-ICP-04: SSE Progress Streaming (P0)

**When** ICP generation or TAM build is in progress,
**the System shall** stream real-time progress via SSE.

**Acceptance Criteria:**
- SSE endpoint (`/api/tam/stream` or similar)
- Event format: `{ type: "progress" | "complete" | "error", phase: string, message: string, data?: object }`
- ICP phases: "Analyzing website..." → "Extracting company DNA..." → "Parsing customer data..." → "Cross-referencing sources..." → "Generating ICP..." → "Computing confidence..." → "Complete"
- TAM build phases (matching existing `tam-build.ts`): "analyzing" → "counting" → "loading-top" → "scoring" → "complete"
- UI: current phase with animated icon (port `PHASE_META` pattern from `tam-step.tsx`)
- Source failure is non-blocking: "LinkedIn scrape failed — continuing with other sources..."
- Auto-reconnect on SSE drop

**Edge Cases:**
- All sources fail except website → produce ICP with low confidence, stream failure notices
- LLM timeout → retry once, stream "Retrying analysis..."
- User navigates away and returns → poll for current state, catch up

---

## 3. Feature 2 — TAM Construction via Apollo

### 3.1 Real-Time TAM Build

#### REQ-TAM-01: TAM Build Pipeline (P0)

**When** the Founder confirms ICP and triggers TAM build,
**the System shall** execute the account-based TAM build pipeline via Inngest.

Port LeadSens' `tam-build.ts` which implements a 5-phase pipeline:

```
Phase 1: ANALYZE → ICP inference (3 fallback sources: IcpProfile → CompanyDna → site scrape)
Phase 2: COUNT   → Apollo org count (1 API call)
Phase 3: LOAD    → Apollo org search, 20 pages × 100 = 2,000 accounts (20 API calls)
Phase 4: SCORE   → 5-dimension scoring on all loaded accounts
Phase 5: PERSIST → Save to DB, compute quality report, mark complete
```

**Acceptance Criteria:**
- Inngest function with retries (2), concurrency limit (2)
- Phase 1: use confirmed IcpProfile, convert to Apollo filters via `icpToOrgFilters()`
- Phase 2: `apolloOrgCount(filters)` — display total before loading
- Phase 3: paginated `apolloOrgSearchWithRateLimit()`, per-second rate limit (1 req/s), daily limit tracking
  - Store each account as `TamAccount` with: name, domain, industry, employeeCount, foundedYear, city, country, keywords, websiteUrl, linkedinUrl, apolloOrgId
  - `skipDuplicates: true` on `@@unique([tamBuildId, apolloOrgId])`
  - Progressive display: UI polls via tRPC, shows accounts as they load
- Phase 4: score all accounts via `scoreAccount()` (port `account-scorer.ts`):
  - Industry Fit (0-25): exact match 25, related group 15, unrelated 0
  - Size Fit (0-25): perfect range 25, adjacent 15, way off 0
  - Keyword Fit (0-20): overlap between ICP keywords and account keywords
  - Signal Score (0-20): hiring, funded, techMatch, etc.
  - Data Freshness (0-10): how complete the account data is
  - Total 0-100 → Tier A/B/C/D, Heat Burning/Hot/Warm/Cold
- Phase 5: quality validation (port `validateTamQuality()`), mark build complete
- Cancel support: `isCancelled()` check between each phase
- Rate limit handling: if `APOLLO_DAILY_LIMIT_REACHED`, pause build, set phase to "rate-limited"
- Progress stored in `TamBuild` model: status, phase, totalCount, loadedCount, scoredCount
- Expand: separate Inngest event `tam/build.expand` to load more pages beyond initial 2,000

**Edge Cases:**
- Apollo returns 0 results → show "No companies match your ICP" with suggestion to broaden
- Apollo returns >50,000 → show count, build loads first 2,000, "Expand" button for more
- Rate limit mid-build → pause, show "Rate limited — resuming in X seconds", auto-resume
- API key invalid → clear error with link to settings
- Build cancelled → save partial results, "Resume" option
- Concurrent builds → reject second build if one is in progress

---

#### REQ-TAM-02: People Search per Account (P0)

**When** the Founder expands an account row to see contacts,
**the System shall** query Apollo People Search with ICP person-level criteria.

Port LeadSens' tRPC `tam.loadContacts` + `tam.enrichLead` pattern.

**Acceptance Criteria:**
- On-demand: triggered by expanding an account row (not pre-loaded for all accounts)
- Search params: titles from ICP, seniority from ICP, + org filter on account domain
- Convert ICP to people filters via `icpProfileToPeopleFilters()`
- Results stored as `TamLead` linked to `TamAccount`: firstName, lastName (may be obfuscated on free tier), title, seniority, linkedinUrl, city, country, companyName, companyDomain
- Availability booleans from free search: hasEmail, hasCity, hasDirectPhone, orgHasIndustry, orgHasEmployeeCount
- Contact count badge on account row (after first load)
- Max 10 contacts shown initially, "Load more" for pagination

**Edge Cases:**
- Free Apollo tier → obfuscated last names, no emails, availability booleans only → show "Apollo Free" badge
- No contacts matching ICP titles → "No matching contacts — try broadening title criteria"
- 100+ matching contacts → paginate, show first 10
- Account with no domain → skip people search, show "No domain available"

---

#### REQ-TAM-03: Market Table — Account View (P0)

**When** TAM data is loaded,
**the System shall** display accounts in a high-performance table matching
LeadSens' market page quality level.

Port from LeadSens' `market/page.tsx` (500+ lines) — this is the core UI.

**Acceptance Criteria:**
- **Virtual scrolling** via `@tanstack/react-virtual`, ROW_HEIGHT = 32px, PAGE_SIZE = 50
- **Columns:** Company icon (favicon via Google S2 with fallback colored avatar) | Company Name + Domain | Industry | Employees (formatted: "1.2K") | Location (city, country) | Tier badge (A/B/C/D color-coded) | Heat (icon + label) | Score/100 | Signals (icons) | Contact count | Actions
- **Filtering:**
  - Tier: multi-select (A, B, C, D) with counts per tier
  - Industry: multi-select from loaded data
  - Country: multi-select from loaded data
  - Size range: min/max slider
  - Hiring only: toggle
  - Funded only: toggle
  - Filter counts cached with 30s TTL (port `filterCountsCache` from `tam.ts` router)
- **Search:**
  - Text search: name, domain, industry, country, keywords, scoreReasoning
  - **Smart NL search** (port from LeadSens `tam.ts` router):
    - "hiring" → `hiringSignal: true`
    - "funded" / "raised" / "series" → `fundedSignal: true`
    - "small" / "startup" / "seed" → `employeeCount ≤ 100`
    - "enterprise" / "large" → `employeeCount ≥ 1000`
    - "tier a" / "best" / "top" → `tier: "A"`
    - "burning" / "hot" / "urgent" → `heat: { in: ["Burning", "Hot"] }`
    - Remaining text → fuzzy text search
- **Sorting:** by heatScore (default desc), tier, name, employeeCount, industry, country
- **Score tooltip** (portal-based, escapes overflow:hidden — port `ScoreTooltipFixed`):
  - Heat label ("Stellar account, take action immediately")
  - 5 breakdown bars (Industry, Size, Keywords, Signals, Data) with values
  - Fit signals (industry match, size match, keyword match)
  - Intent signals (hiring, funded)
- **Company icon:** favicon from Google S2 (`google.com/s2/favicons?domain=X&sz=64`), fallback to colored circle with initial letter (12 avatar colors)
- **Heat icon:** Fire (Burning/Hot), Thermometer (Warm), Snowflake (Cold)
- **Expand row:** click to show contacts (REQ-TAM-02) + signal details (REQ-SIG-02)

**Edge Cases:**
- 10,000+ rows → virtualized rendering, no jank
- Empty state → "Build your TAM first" with CTA
- Loading state → skeleton rows
- All filters active → show "X accounts matching" count

---

#### REQ-TAM-04: Expand Row — Contacts + Signals + Timeline (P0)

**When** the Founder expands an account row,
**the System shall** show a rich detail panel with contacts, signal details, and activity timeline.

Port LeadSens' components: `tam-lead-expand.tsx`, `signal-popover.tsx`, `account-timeline.tsx`.

**Acceptance Criteria:**
- **Contacts section** (port `tam-lead-expand.tsx`):
  - Each contact: name, title (with seniority badge), LinkedIn link, location
  - Fit bars: title fit, size fit, industry fit, geo fit (0-100% visual bars)
  - Signal badges: hiring, funded, YC, news, tech, sales-led (6 signals, color-coded)
  - Availability indicators: email (check/lock), phone (check/lock), city (check/lock)
  - "Reveal" button for enrichment (Apollo credits on paid plan)
- **Signals section** (port `signal-popover.tsx`):
  - Each signal as Popover with tabs: Reasoning | Sources
  - Signal: name, detected (yes/no), evidence text, points (+Xpts)
  - Sources: URL + title + favicon for each source
  - All 7 signals displayed: Hiring Outbound, Sales-Led Growth, Recent Funding, Tech Stack Fit, New in Role, Common Investors, Network Proximity
- **Timeline section** (port `account-timeline.tsx`):
  - Chronological feed: signal_detected, contact_added events
  - Each event: icon (color-coded by type), description, timestamp (relative: "2h ago", "Yesterday")
  - Timeline line connecting events vertically
- **Recommended action** based on top signals:
  - Network proximity → "Warm intro via [connection name]"
  - Funding → "Reference their [round] in outreach"
  - Hiring → "Mention their [department] growth"
  - No strong signals → "Cold outreach — lead with value prop"

**Edge Cases:**
- No contacts loaded yet → "Load contacts" button
- No signals detected → "No buying signals detected" with suggestion to check back later
- Empty timeline → "No activity yet"

---

#### REQ-TAM-05: TAM Build Progress UI (P0)

**When** TAM build is in progress,
**the System shall** show real-time progress matching LeadSens' `tam-step.tsx`.

**Acceptance Criteria:**
- Phase indicator with icons (port `PHASE_META`):
  - analyzing → MagnifyingGlass, "Analyzing your offer..."
  - counting → ChartBar, "Counting your market..."
  - loading-top → MagnifyingGlass, "Loading top accounts..."
  - scoring → ChartBar, "Scoring accounts..."
  - complete → CheckCircle, "Done!"
- Progress numbers: "Loading accounts (342/2,000)..." with animated counter
- Rate limit status: "Apollo API: 23/600 daily calls used"
- Cancel button
- "Expand market" button (post-build): triggers `tam/build.expand` Inngest event for more pages

**Edge Cases:**
- Rate limited → show "Paused — rate limit reached. Resuming at midnight UTC."
- Build error → show error message with retry button
- Build cancelled → show partial results with "Resume" option

---

### 3.2 Export & Sync

#### REQ-EXP-01: CSV Export (P0)

**When** the Founder clicks "Export",
**the System shall** download a CSV with all filtered TAM data including HubSpot-compatible fields.

Port LeadSens' `downloadCsv()` + tRPC `tam.exportAccounts` pattern.

**Acceptance Criteria:**
- Export respects current filters (tier, industry, country, size, search)
- CSV with UTF-8 BOM for Excel compatibility
- Filename: `scopiq-tam-{YYYY-MM-DD}.csv`
- Account columns: Name, Domain, Industry, Employees, Tier, Heat, Score, Country, City, Website URL, LinkedIn URL, Signals (comma-separated), Keywords
- Contact columns (if contact view): First Name, Last Name, Email, Phone, Title, Seniority, Company, Company Domain, LinkedIn URL
- tRPC query with same filter params as getAccounts, `enabled: exporting` pattern

**Edge Cases:**
- No data → button disabled with tooltip
- 10,000+ rows → generate in background, download when ready
- Contacts without revealed emails → include row with empty email column

---

#### REQ-EXP-02: HubSpot Sync (P0)

**When** the Founder connects HubSpot and triggers sync,
**the System shall** create/update Companies and Contacts with deduplication.

**Acceptance Criteria:**
- HubSpot OAuth flow (port from LeadSens)
- Create Company by domain (skip if existing, deduplicate)
- Create Contact by email (skip if existing, deduplicate)
- Custom property: `tam_source: "Scopiq"`, `tam_tier: "A"`, `tam_heat_score: 85`
- Progress: "Syncing 45/200 companies..."
- Summary: created X, updated Y, skipped Z

**Edge Cases:**
- Token expired → re-auth flow
- Contacts without email → skip, count skipped
- HubSpot API rate limits → queue with exponential backoff
- Partial failure → continue, report failures

---

#### REQ-EXP-03: Google Sheets Sync (P1)

**When** the Founder connects Google Sheets,
**the System shall** write TAM data to a new or existing sheet.

**Acceptance Criteria:**
- Google OAuth
- Create new sheet or select existing
- Headers match CSV columns
- Sheet name: "Scopiq TAM - {date}"

---

## 4. Feature 3 — Enrichment & Scoring

### 4.1 Signal Detection

#### REQ-SIG-01: 7-Signal Detection Engine (P0)

**When** accounts are scored during TAM build,
**the System shall** detect 7 buying signals per account using the
structured `SignalResult` format.

Port all detectors from LeadSens:

| # | Signal | Source | Points | Detector |
|---|--------|--------|--------|----------|
| 1 | Hiring Outbound | Career page via Jina + `extractJobTitles()` | 0-15 | `detectHiringOutbound()` |
| 2 | Sales-Led Growth | Homepage via Jina + Apollo technologies | 0-10 | `detectSalesLedGrowth()` |
| 3 | Recent Funding | Apollo org data (latestFundingRoundDate) | 0-10 | `detectRecentFunding()` |
| 4 | Tech Stack Fit | Apollo technologies | 0-10 | `detectTechStackFit()` |
| 5 | New in Role | Apollo person data (employmentStartDate) | 0-5 | `detectRecentJobChange()` |
| 6 | Common Investors | Web search for portfolio overlap | 0-10 | `detectCommonInvestor()` |
| 7 | Network Proximity | LinkedIn connections × account domain | 0-15 | `detectLinkedInConnections()` |

**Each detector returns `SignalResult`:**
```typescript
{
  name: string;           // "Hiring Outbound"
  detected: boolean;      // true
  evidence: string;       // "Hiring 3 sales roles: SDR, AE, Head of Sales"
  sources: SignalSource[];// [{url: "https://acme.com/careers", title: "Careers page"}]
  reasoning: string;      // "Company is actively recruiting for outbound sales roles..."
  points: number;         // 15
}
```

**Acceptance Criteria:**
- All 7 detectors ported with identical logic
- Each detector has 5s timeout (`Promise.race` with `timeoutPromise(5000)`)
- Failure = `detected: false`, never blocks other detectors
- Detectors run in parallel per account
- Results stored in `TamAccount.signals` as JSON array of `SignalResult`
- Jina rate limit respected (20 req/min) — queue across all Jina calls
- Batch processing: for 2,000 accounts, signal detection runs post-scoring on top 500 (Tier A+B)

**Edge Cases:**
- All detectors timeout → score = data freshness only
- Jina rate limit → queue with backoff, don't fail
- Career page returns 404 → `detected: false` for hiring, continue
- Signal aged >6 months → reduced weight (port `signalAge()` recency multiplier if exists)

---

#### REQ-SIG-02: Signal Detail UI (P0)

**When** the Founder views signal details for an account,
**the System shall** display each signal as an interactive popover with evidence and sources.

Port `signal-popover.tsx` from LeadSens.

**Acceptance Criteria:**
- Signal popover with two tabs: Reasoning | Sources
- Reasoning tab: text explanation of why this signal matters
- Sources tab: list of URLs with titles and favicons that evidence the signal
- Points badge: "+15pts" in green
- Non-detected signals shown but dimmed/grey
- Aggregated signal summary in row: icon badges for detected signals only

---

### 4.2 Contact Enrichment

#### REQ-ENR-01: Contact Enrichment Status (P0)

**When** contacts are displayed in the expand panel,
**the System shall** show enrichment completeness and allow reveal actions.

**Acceptance Criteria:**
- Per-contact completeness indicator: `email ✓  phone ✗  location ✓`
- Availability from Apollo free search: `hasEmail`, `hasDirectPhone`, `hasCity` booleans
- "Reveal" button per contact → calls Apollo enrichment endpoint (consumes credits on paid plan)
- Bulk "Reveal All" for an account's contacts
- Revealed data: full email, direct phone, full address
- Enrichment status tracked: `enriched: boolean`, `enrichedAt: DateTime`

**Edge Cases:**
- Free Apollo tier → "Reveal" disabled with "Upgrade to Apollo Basic" tooltip
- Catch-all domain → flag email as "unverifiable"
- Phone available but no email → still show as partial enrichment
- Enrichment fails (Apollo error) → retry once, then show error per contact

---

## 5. Feature 4 — Agent Autonomy

### 5.1 Auto-Refresh

#### REQ-AUTO-01: Scheduled TAM Refresh (P1, architecture P0)

**When** auto-refresh is configured,
**the System shall** run Inngest cron jobs to keep the TAM current.

**Acceptance Criteria:**
- Configurable frequency: daily, weekly, custom
- Inngest cron function:
  1. Re-query Apollo with CURRENT ICP filters (not build-time ICP)
  2. New accounts: add with `status: "new"`
  3. Disappeared accounts: flag `status: "drifted"` (don't delete)
  4. Re-run signal detection on Tier A+B accounts
  5. Recompute heat scores
- Changelog per run: new accounts, removed accounts, score changes, signal changes
- In-app changelog view

**Edge Cases:**
- ICP changed since last refresh → use current ICP
- Apollo daily limit → defer, log
- No changes → log "no changes"

---

#### REQ-AUTO-02: CRM Sync on Refresh (P1)

**When** refresh detects changes AND HubSpot/Sheets is connected,
**the System shall** push changes.

**Acceptance Criteria:**
- New accounts → create in HubSpot
- Score changes → update custom properties
- Drifted accounts → set `tam_status: "drifted"` in HubSpot (don't delete)

---

### 5.2 ICP Evolution

#### REQ-ICP-05: ICP Evolution Suggestions (P1, architecture P0)

**When** enough CRM feedback exists (≥10 closed deals OR ≥50 enriched accounts),
**the System shall** suggest ICP adjustments.

Port `icp-evolve.ts` + `icp-drift-detector.ts` from LeadSens.

**Acceptance Criteria:**
- Trigger: minimum data thresholds
- Analysis: compare won deals vs ICP, identify drift patterns
- Output: `IcpEvolutionProposal` with changes per dimension + evidence + confidence
- UI: notification card with "Review Suggestion"
- User approves or rejects — NO auto-apply
- Accepted proposals: update IcpProfile, optionally trigger TAM rebuild

**Edge Cases:**
- Too few data points → don't generate proposal
- Same suggestion rejected before → don't re-suggest for 30 days
- Contradictory proposals → present as options

---

## 6. Non-Functional Requirements

#### REQ-NFR-01: Performance (P0)

- Virtual scroll: 10,000 rows, no jank, 60fps
- SSE latency: <500ms from generation to client
- Page load: <2s on 4G
- Apollo rate limits: NEVER exceeded (daily counter + per-second throttle)

#### REQ-NFR-02: Security (P0)

- API keys encrypted at rest (AES-256-GCM, port `encryption.ts`)
- OAuth tokens encrypted
- No API keys in client-side code
- CSRF protection on mutations

#### REQ-NFR-03: Data Model (P0)

Port relevant Prisma models from LeadSens `packages/db/prisma/schema.prisma`:
- `User`, `Session`, `Account`, `Verification` (auth)
- `Workspace` (with TAM fields: tamResult, tamBuiltAt, tamIcp, activeIcpId)
- `Integration` (API keys storage)
- `TamBuild` (build tracking: status, phase, counts, icpRaw, siteContent)
- `TamAccount` (company: name, domain, industry, scoring, signals, embedding)
- `TamLead` (contact: name, title, company, scoring, enrichment)
- `IcpProfile` (structured ICP: roles, industries, employeeRange, etc.)
- `IcpEvolutionProposal` (suggested changes)
- `CustomerImport` + `CustomerImportEntry` (uploaded customer data)
- `LinkedInConnection` (founder's network)
- `HiringSignal`, `FundingSignal`, `AcceleratorCompany`, `NewsSignal` (signal cache)
- `CompanyCache` (scraped website content, TTL 7d)
- `AIEvent` (LLM logging)

New models for Scopiq:
- `IngestionSource` — tracks each data source provided during setup
  ```
  id, workspaceId, type ("website"|"linkedin_company"|"linkedin_profile"|"csv_customers"|"document"|"crm"),
  status ("pending"|"processing"|"complete"|"error"),
  rawContent (Text), structuredData (Json), fileName, errorMessage,
  createdAt, completedAt
  ```

#### REQ-NFR-04: Observability (P0)

- LLM calls: log model, tokens, cost, latency via `AIEvent` model
- Apollo API calls: log endpoint, params, response status, daily counter
- Structured logging via `logger.ts` pattern
- Sentry integration (optional)

#### REQ-NFR-05: Standalone Deployment (P0)

- Own Vercel project (separate from LeadSens)
- Own PostgreSQL database (Neon or Supabase)
- Own Inngest project
- Own Better Auth configuration
- Shared nothing with LeadSens at runtime — code is ported, not imported
