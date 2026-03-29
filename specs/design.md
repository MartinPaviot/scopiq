# Scopiq — Design (Kiro Phase 2)

> Architecture technique detaillee.
> Chaque section reference les requirements (REQ-*) et les fichiers source LeadSens a porter.

---

## 1. Repo Structure

```
scopiq/
├── prisma/
│   └── schema.prisma                    ← Prisma schema (ported + adapted from LeadSens)
├── public/
│   ├── favicon.svg
│   └── logos/                           ← Integration logos (apollo, hubspot, linkedin, google)
├── src/
│   ├── app/
│   │   ├── layout.tsx                   ← Root layout (Geist + Plus Jakarta Sans, ThemeProvider)
│   │   ├── globals.css                  ← Design tokens (ported from LeadSens globals.css)
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── (app)/                       ← Authenticated routes
│   │   │   ├── layout.tsx               ← App shell (sidebar + main)
│   │   │   ├── setup/page.tsx           ← REQ-ING-08: Full-page ingestion
│   │   │   ├── icp/page.tsx             ← REQ-ICP-02/03: ICP display + editing
│   │   │   ├── market/page.tsx          ← REQ-TAM-03: Market table (main view)
│   │   │   ├── settings/
│   │   │   │   ├── page.tsx             ← General settings
│   │   │   │   └── integrations/page.tsx← API keys, OAuth connections
│   │   │   └── changelog/page.tsx       ← REQ-AUTO-01: Refresh changelog
│   │   ├── api/
│   │   │   ├── trpc/[trpc]/route.ts     ← tRPC HTTP handler
│   │   │   ├── auth/[...all]/route.ts   ← Better Auth catch-all
│   │   │   ├── inngest/route.ts         ← Inngest serve handler
│   │   │   ├── tam/
│   │   │   │   └── stream/route.ts      ← REQ-ICP-04: SSE endpoint for build progress
│   │   │   ├── ingestion/
│   │   │   │   └── upload/route.ts      ← File upload handler (CSV, PDF, DOCX)
│   │   │   └── integrations/
│   │   │       ├── [tool]/route.ts      ← Generic API key connect/disconnect
│   │   │       ├── hubspot/
│   │   │       │   ├── auth/route.ts    ← HubSpot OAuth initiation
│   │   │       │   └── callback/route.ts← HubSpot OAuth callback
│   │   │       └── google/
│   │   │           ├── auth/route.ts    ← Google Sheets OAuth
│   │   │           └── callback/route.ts
│   │   └── page.tsx                     ← Landing / redirect to /setup or /market
│   ├── components/
│   │   ├── ui/                          ← shadcn/ui components (Button, Input, Badge, etc.)
│   │   ├── setup/                       ← REQ-ING-*: Ingestion page components
│   │   │   ├── setup-page.tsx           ← Main setup page orchestrator
│   │   │   ├── source-card.tsx          ← Generic source card (4 states: empty/loading/success/error)
│   │   │   ├── website-source.tsx       ← REQ-ING-01: URL input + CompanyDna preview
│   │   │   ├── csv-source.tsx           ← REQ-ING-05: CSV upload + pattern preview
│   │   │   ├── linkedin-company-source.tsx ← REQ-ING-02
│   │   │   ├── linkedin-profile-source.tsx ← REQ-ING-03
│   │   │   ├── linkedin-connections-source.tsx ← REQ-ING-04
│   │   │   ├── document-source.tsx      ← REQ-ING-06
│   │   │   └── crm-source.tsx           ← REQ-ING-07
│   │   ├── icp/                         ← REQ-ICP-*: ICP display & editing
│   │   │   ├── icp-overview.tsx         ← Full ICP view with sections
│   │   │   ├── icp-dimension.tsx        ← Single dimension (tags + confidence + why)
│   │   │   ├── icp-editor.tsx           ← Inline editing mode
│   │   │   ├── confidence-bar.tsx       ← Visual confidence indicator
│   │   │   └── apollo-filter-preview.tsx← Shows Apollo filter mapping
│   │   ├── market/                      ← REQ-TAM-03/04: Market table
│   │   │   ├── market-table.tsx         ← Main virtualized table (port market/page.tsx)
│   │   │   ├── account-row.tsx          ← Single account row
│   │   │   ├── account-expand.tsx       ← Expanded detail panel
│   │   │   ├── contact-list.tsx         ← Contacts under account (port tam-lead-expand)
│   │   │   ├── signal-popover.tsx       ← Signal detail popover (port)
│   │   │   ├── score-tooltip.tsx        ← Score breakdown tooltip (port)
│   │   │   ├── account-timeline.tsx     ← Activity timeline (port)
│   │   │   ├── company-icon.tsx         ← Favicon + fallback avatar (port)
│   │   │   ├── heat-icon.tsx            ← Fire/Thermometer/Snowflake
│   │   │   ├── filter-bar.tsx           ← Tier/industry/country/size filters
│   │   │   ├── smart-search.tsx         ← NL search input with hint chips
│   │   │   └── export-button.tsx        ← CSV export + HubSpot sync
│   │   ├── build/                       ← REQ-TAM-05: Build progress
│   │   │   ├── build-progress.tsx       ← Phase indicators + counters
│   │   │   └── rate-limit-badge.tsx     ← Apollo API usage display
│   │   ├── app-sidebar.tsx              ← Navigation sidebar
│   │   └── theme-provider.tsx           ← next-themes provider
│   ├── server/
│   │   ├── trpc/
│   │   │   ├── trpc.ts                  ← tRPC init + protectedProcedure
│   │   │   ├── router.ts               ← Root router (tam + icp + workspace + integration)
│   │   │   └── routers/
│   │   │       ├── tam.ts              ← Port from LeadSens tam.ts (full router)
│   │   │       ├── icp.ts             ← ICP CRUD + inference trigger
│   │   │       ├── workspace.ts       ← Workspace settings + analyzeUrl
│   │   │       ├── integration.ts     ← API key management
│   │   │       └── ingestion.ts       ← Source management + processing
│   │   └── lib/
│   │       ├── tam/                    ← Port from LeadSens src/server/lib/tam/
│   │       │   ├── tam-icp-inferrer.ts ← ICP from website (Mistral Large)
│   │       │   ├── account-scorer.ts   ← 5D scoring engine
│   │       │   ├── detect-signals.ts   ← 5 signal detectors
│   │       │   ├── detect-investor.ts  ← Common investor detection
│   │       │   ├── detect-connections.ts← LinkedIn connection proximity
│   │       │   ├── scrape-site.ts      ← Jina site scraper
│   │       │   ├── partitioner.ts      ← TAM partitioning
│   │       │   ├── score-leads.ts      ← Lead-level scoring
│   │       │   └── semantic-search.ts  ← Embedding-based search
│   │       ├── icp/                    ← Port from LeadSens src/server/lib/icp/
│   │       │   ├── icp-schema.ts       ← Zod schemas (IcpProfileData, etc.)
│   │       │   ├── icp-inferrer.ts     ← Multi-source ICP inference
│   │       │   ├── icp-converters.ts   ← ICP → Apollo filters
│   │       │   ├── icp-confidence.ts   ← Confidence scoring
│   │       │   ├── icp-customer-analyzer.ts ← Customer pattern analysis
│   │       │   ├── icp-drift-detector.ts    ← Drift detection
│   │       │   └── icp-evolve.ts       ← Evolution engine
│   │       ├── apollo/                 ← Port from LeadSens src/server/lib/apollo/
│   │       │   └── client.ts           ← Org search + People search + rate limiting
│   │       ├── connectors/             ← Port from LeadSens src/server/lib/connectors/
│   │       │   ├── apollo.ts           ← People enrichment (searchPeople, enrichPerson)
│   │       │   └── jina.ts             ← Jina Reader (scrapeViaJina, 20 req/min)
│   │       ├── enrichment/             ← Port from LeadSens src/server/lib/enrichment/
│   │       │   ├── company-analyzer.ts ← CompanyDna extraction
│   │       │   └── hiring-signal-extractor.ts ← Career page parsing
│   │       ├── llm/                    ← Port from LeadSens src/server/lib/llm/
│   │       │   └── mistral-client.ts   ← Mistral API client
│   │       └── integrations/           ← Port from LeadSens (simplified)
│   │           └── registry.ts         ← Integration registry (Apollo, HubSpot, Google)
│   ├── inngest/
│   │   ├── client.ts                   ← Inngest client init
│   │   ├── events.ts                   ← Typed event schemas
│   │   ├── tam-build.ts               ← Port: buildTam + expandTam + enrichSignals
│   │   ├── tam-crons.ts              ← Port: weeklySignalRefresh + resumeRateLimited
│   │   └── icp-evolution.ts          ← Port: ICP evolution cron
│   ├── lib/
│   │   ├── prisma.ts                   ← Prisma client singleton
│   │   ├── auth.ts                     ← Better Auth config
│   │   ├── auth-client.ts              ← Client-side auth hooks
│   │   ├── trpc-client.ts              ← tRPC React client
│   │   ├── encryption.ts               ← AES-256-GCM (port)
│   │   ├── logger.ts                   ← Structured logger (port)
│   │   └── utils.ts                    ← cn() and misc utils
│   └── middleware.ts                    ← Auth middleware (redirect unauthenticated)
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts                   ← (if needed, else postcss only)
├── postcss.config.mjs
├── components.json                      ← shadcn/ui config
├── .env.example
├── .gitignore
└── README.md
```

**Total: ~75 files.** Of which ~30 are ported from LeadSens (server/lib/*), ~15 are UI components,
~10 are config/infra, ~20 are new (setup page, ingestion, ICP editor).

---

## 2. Data Model (Prisma Schema)

Port from LeadSens `packages/db/prisma/schema.prisma` with these changes:
- Remove all LeadSens-specific models (Campaign, Lead, DraftedEmail, EmailPerformance, StepAnalytics, ReplyThread, Reply, AgentMemory, AgentFeedback)
- Keep all TAM/ICP/Signal models intact
- Add `IngestionSource` model

```prisma
// ═══════════════════════════════════════════════
// SCOPIQ — Prisma Schema
// Ported from LeadSens, stripped of email pipeline
// ═══════════════════════════════════════════════

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─── Auth (Better Auth) ────────────────────────

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  emailVerified Boolean   @default(false)
  image         String?
  workspaceId   String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
  sessions      Session[]
  workspace     Workspace? @relation(fields: [workspaceId], references: [id])
  @@map("user")
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("session")
}

model Account {
  id                    String    @id @default(cuid())
  userId                String
  accountId             String
  providerId            String
  accessToken           String?
  refreshToken          String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  idToken               String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("account")
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@map("verification")
}

// ─── Workspace ─────────────────────────────────

model Workspace {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  companyUrl  String?
  companyDna  Json?    // CompanyDna extracted from website
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // TAM Engine
  tamResult  Json?     // Full TAM result cache
  tamBuiltAt DateTime?
  tamIcp     Json?     // Inferred ICP (separate for editing)

  // ICP Engine
  activeIcpId String?

  // Relations
  users               User[]
  integrations        Integration[]
  icpProfiles         IcpProfile[]
  icpEvolutionProposals IcpEvolutionProposal[]
  tamAccounts         TamAccount[]
  tamBuilds           TamBuild[]
  tamLeads            TamLead[]
  companyCaches       CompanyCache[]
  customerImports     CustomerImport[]
  linkedInConnections LinkedInConnection[]
  aiEvents            AIEvent[]
  ingestionSources    IngestionSource[]

  @@map("workspace")
}

// ─── Integration (API keys) ────────────────────

model Integration {
  id           String            @id @default(cuid())
  workspaceId  String
  type         String            // "apollo" | "hubspot" | "google_sheets"
  apiKey       String?           // Encrypted AES-256-GCM
  accessToken  String?
  refreshToken String?
  expiresAt    DateTime?
  accountEmail String?
  accountName  String?
  metadata     Json?
  status       IntegrationStatus @default(ACTIVE)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  workspace    Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, type])
  @@map("integration")
}

// ─── Ingestion Sources (NEW for Scopiq) ────────

model IngestionSource {
  id            String   @id @default(cuid())
  workspaceId   String
  type          String   // "website" | "linkedin_company" | "linkedin_profile" | "csv_customers" | "document" | "crm"
  status        String   @default("pending") // "pending" | "processing" | "complete" | "error"
  inputUrl      String?  // URL input (for website, linkedin)
  fileName      String?  // Uploaded file name
  rawContent    String?  @db.Text // Raw scraped/parsed content
  structuredData Json?   // Extracted structured data (CompanyDna, LinkedInCompany, etc.)
  errorMessage  String?
  createdAt     DateTime @default(now())
  completedAt   DateTime?
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, type])
  @@map("ingestion_source")
}

// ─── TAM Engine ────────────────────────────────
// Ported IDENTICAL from LeadSens

model TamBuild {
  id              String       @id @default(cuid())
  workspaceId     String
  workspace       Workspace    @relation(fields: [workspaceId], references: [id])
  status          String       @default("pending")
  phase           String       @default("pending")
  totalCount      Int?
  loadedCount     Int          @default(0)
  scoredCount     Int          @default(0)
  topLeadsLoaded  Int          @default(0)
  dailyApiCalls   Int          @default(0)
  dailyApiResetAt DateTime?
  segments        Json?
  icpRaw          Json?
  siteContent     String?      @db.Text
  siteUrl         String?
  errorMessage    String?
  qualityReport   Json?
  startedAt       DateTime     @default(now())
  completedAt     DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  accounts        TamAccount[]
  leads           TamLead[]
  @@map("tam_build")
}

model TamAccount {
  id          String @id @default(cuid())
  workspaceId String
  tamBuildId  String

  name          String
  domain        String?
  industry      String?
  employeeCount Int?
  foundedYear   Int?
  city          String?
  country       String?
  keywords      String[]
  websiteUrl    String?
  linkedinUrl   String?
  apolloOrgId   String?

  tier           String?
  heat           String?
  heatScore      Int     @default(0)
  scoreBreakdown Json?
  scoreReasoning String?
  scoreSignals   Json?

  commonInvestors String[]  @default([])
  investorSources Json?
  connectionNames String[]  @default([])

  industryMatch Boolean @default(false)
  sizeMatch     Boolean @default(false)
  keywordMatch  Boolean @default(false)
  hiringSignal  Boolean @default(false)
  fundedSignal  Boolean @default(false)
  signals       Json?

  embedding      Json?
  contactsLoaded Boolean @default(false)
  contactCount   Int     @default(0)

  createdAt DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id])
  tamBuild  TamBuild  @relation(fields: [tamBuildId], references: [id])
  contacts  TamLead[]

  @@unique([tamBuildId, apolloOrgId])
  @@index([workspaceId, tier, heatScore])
  @@index([tamBuildId, tier])
  @@map("tam_account")
}

model TamLead {
  id              String  @id @default(cuid())
  workspaceId     String
  tamBuildId      String
  tamAccountId    String?
  firstName       String
  lastName        String  @default("")
  title           String
  seniority       String?
  linkedinUrl     String?
  city            String?
  state           String?
  country         String?
  companyName     String
  companyDomain   String?
  companyIndustry String?
  companySize     Int?
  companyCity     String?
  companyCountry  String?
  apolloOrgId     String?
  segmentId       String?
  segmentName     String?
  tier            String?
  heat            String?
  heatScore       Int     @default(0)
  industryFit     Float   @default(0)
  sizeFit         Float   @default(0)
  titleFit        Float   @default(0)
  geoFit          Float   @default(0)
  hiringSignal    Boolean @default(false)
  fundedSignal    Boolean @default(false)
  techSignal      Boolean @default(false)
  ycSignal        Boolean @default(false)
  newsSignal      Boolean @default(false)
  salesLedSignal  Boolean @default(false)
  emailRevealed   Boolean @default(false)
  email           String?
  status          String  @default("new")
  apolloPersonId  String?
  dedupKey        String?

  lastNameObfuscated  String?
  hasEmail            Boolean @default(false)
  hasCity             Boolean @default(false)
  hasState            Boolean @default(false)
  hasCountry          Boolean @default(false)
  hasDirectPhone      Boolean @default(false)
  orgHasIndustry      Boolean @default(false)
  orgHasEmployeeCount Boolean @default(false)
  orgHasRevenue       Boolean @default(false)

  enriched          Boolean   @default(false)
  enrichedAt        DateTime?
  apolloRefreshedAt DateTime?

  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt
  workspace  Workspace   @relation(fields: [workspaceId], references: [id])
  tamBuild   TamBuild    @relation(fields: [tamBuildId], references: [id])
  tamAccount TamAccount? @relation(fields: [tamAccountId], references: [id])

  @@unique([workspaceId, dedupKey])
  @@index([workspaceId, tier, heatScore])
  @@index([tamBuildId, tier])
  @@index([tamBuildId, enriched])
  @@map("tam_lead")
}

// ─── ICP Engine ────────────────────────────────
// Ported IDENTICAL from LeadSens

model IcpProfile {
  id          String  @id @default(cuid())
  workspaceId String
  version     Int     @default(1)
  source      String  // "onboarding" | "evolution" | "manual"
  isActive    Boolean @default(true)

  nlDescription    String? @db.Text
  acv              Float?
  salesCycleLength String?
  winReasons       String? @db.Text
  lossReasons      String? @db.Text

  roles         Json // [{title, variations, seniority, why}]
  industries    Json // string[]
  employeeRange Json // {min, max, sweetSpot}
  geographies   Json // string[]
  keywords      Json // string[]
  buyingSignals Json // [{name, detectionMethod, why, strength}]
  disqualifiers Json // string[]
  competitors   Json // string[]
  segments      Json // [{name, titles, industries, sizes, geos}]
  negativeIcp   Json?
  confidence    Json // {industry, size, title, geo, overall}
  customerPatterns Json?

  createdAt DateTime @default(now())

  workspace Workspace              @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  proposals IcpEvolutionProposal[]

  @@unique([workspaceId, version])
  @@index([workspaceId, isActive])
  @@map("icp_profile")
}

model IcpEvolutionProposal {
  id           String @id @default(cuid())
  workspaceId  String
  icpProfileId String
  changes      Json
  sampleSize   Int
  periodStart  DateTime
  periodEnd    DateTime
  status       String    @default("pending")
  appliedAt    DateTime?
  createdAt    DateTime  @default(now())

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  icpProfile IcpProfile @relation(fields: [icpProfileId], references: [id])

  @@index([workspaceId, status])
  @@map("icp_evolution_proposal")
}

// ─── Signal Cache ──────────────────────────────

model HiringSignal {
  id          String   @id @default(cuid())
  domain      String   @unique
  openRoles   Int
  departments Json?
  source      String
  lastChecked DateTime
  createdAt   DateTime @default(now())
  @@map("hiring_signal")
}

model FundingSignal {
  id          String   @id @default(cuid())
  domain      String
  companyName String
  amount      Float?
  round       String?
  date        DateTime
  investors   Json?
  source      String
  createdAt   DateTime @default(now())
  @@index([domain])
  @@map("funding_signal")
}

model AcceleratorCompany {
  id          String   @id @default(cuid())
  domain      String   @unique
  name        String
  accelerator String
  batch       String?
  createdAt   DateTime @default(now())
  @@map("accelerator_company")
}

model NewsSignal {
  id            String   @id @default(cuid())
  companyDomain String
  companyName   String
  title         String
  url           String
  source        String
  date          DateTime
  createdAt     DateTime @default(now())
  @@index([companyDomain])
  @@map("news_signal")
}

// ─── Customer Import ───────────────────────────

model CustomerImport {
  id          String   @id @default(cuid())
  workspaceId String
  source      String   // "csv" | "hubspot" | "salesforce"
  fileName    String?
  rowCount    Int      @default(0)
  processedAt DateTime?
  createdAt   DateTime @default(now())
  workspace   Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  entries     CustomerImportEntry[]
  @@index([workspaceId])
  @@map("customer_import")
}

model CustomerImportEntry {
  id            String  @id @default(cuid())
  importId      String
  companyName   String
  domain        String?
  industry      String?
  employeeCount Int?
  dealValue     Float?
  country       String?
  import        CustomerImport @relation(fields: [importId], references: [id], onDelete: Cascade)
  @@index([importId])
  @@map("customer_import_entry")
}

// ─── LinkedIn Connections ──────────────────────

model LinkedInConnection {
  id             String    @id @default(cuid())
  workspaceId    String
  profileUrl     String
  name           String
  headline       String?
  companyName    String?
  companyDomain  String?
  connectionDate DateTime?
  syncedAt       DateTime  @default(now())
  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, profileUrl])
  @@index([workspaceId, companyDomain])
  @@map("linkedin_connection")
}

// ─── Scrape Cache ──────────────────────────────

model CompanyCache {
  id          String     @id @default(cuid())
  domain      String     @unique
  workspaceId String?
  markdown    String?    @db.Text
  scrapedAt   DateTime   @default(now())
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)
  @@index([domain, workspaceId])
  @@map("company_cache")
}

// ─── LLM Logging ───────────────────────────────

model AIEvent {
  id          String    @id @default(cuid())
  workspaceId String
  provider    String    @default("mistral")
  model       String
  action      String
  tokensIn    Int
  tokensOut   Int
  cost        Float
  latencyMs   Int
  metadata    Json?
  createdAt   DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, createdAt])
  @@map("ai_event")
}

// ─── Enums ─────────────────────────────────────

enum IntegrationStatus {
  ACTIVE
  ERROR
  EXPIRED
  DISCONNECTED
}
```

---

## 3. Data Flow — Sequence Diagrams

### 3.1 Ingestion → ICP → TAM Build (Main Flow)

```
Founder          Setup Page         tRPC                Jina          Mistral        Inngest         Apollo          DB
  │                 │                 │                   │              │              │               │              │
  ├─ Enter URL ────►│                 │                   │              │              │               │              │
  │                 ├─ ingestion.     │                   │              │              │               │              │
  │                 │  processSource ─►├── scrapeViaJina ─►│              │              │               │              │
  │                 │  (SSE stream)   │◄── rawContent ────┤              │              │               │              │
  │                 │                 │                   │              │              │               │              │
  │                 │                 ├── analyzeCompany ─────────────►│              │               │              │
  │◄─ SSE progress ┤                 │◄── CompanyDna ──────────────────┤              │               │              │
  │                 │                 ├── store IngestionSource ────────────────────────────────────────────────────►│
  │◄─ Preview card ─┤                 │                   │              │              │               │              │
  │                 │                 │                   │              │              │               │              │
  ├─ Upload CSV ───►│                 │                   │              │              │               │              │
  │                 ├─ parseCSV ──────│                   │              │              │               │              │
  │                 ├─ analyzePatterns│                   │              │              │               │              │
  │                 │  (getDominant   │                   │              │              │               │              │
  │                 │   Patterns)     │                   │              │              │               │              │
  │◄─ Pattern cards ┤                 ├── store CustomerImport ─────────────────────────────────────────────────────►│
  │                 │                 │                   │              │              │               │              │
  ├─ "Generate ICP"►│                 │                   │              │              │               │              │
  │                 ├─ icp.infer ────►│                   │              │              │               │              │
  │                 │  (SSE stream)   ├── inferICP ────────────────────►│              │               │              │
  │                 │                 │  (CompanyDna +     │              │              │               │              │
  │                 │                 │   CustomerPatterns  │              │              │               │              │
  │                 │                 │   + LinkedIn data)  │              │              │               │              │
  │                 │                 │◄── IcpProfileData ──┤              │              │               │              │
  │                 │                 ├── computeConfidence │              │              │               │              │
  │                 │                 ├── store IcpProfile ──────────────────────────────────────────────────────────►│
  │◄─ ICP display ──┤                 │                   │              │              │               │              │
  │                 │                 │                   │              │              │               │              │
  ├─ Edit ICP ─────►│                 │                   │              │              │               │              │
  ├─ "Build TAM" ──►│                 │                   │              │              │               │              │
  │                 ├─ tam.startBuild►├── create TamBuild ──────────────────────────────────────────────────────────►│
  │                 │                 ├── inngest.send ───────────────────────────────►│               │              │
  │                 │                 │  ("tam/build.     │              │              │               │              │
  │                 │                 │   requested")     │              │              │               │              │
  │                 │                 │                   │              │              │               │              │
  │                 │                 │                   │              │  ┌─ buildTam │               │              │
  │                 │                 │                   │              │  │           │               │              │
  │                 │                 │                   │              │  │ Phase 1: ─┤               │              │
  │                 │                 │                   │              │  │ analyze   │               │              │
  │                 │                 │                   │              │  │           │               │              │
  │                 │                 │                   │              │  │ Phase 2: ─────────────────►│ orgCount    │
  │                 │                 │                   │              │  │ count     │◄──────────────┤              │
  │                 │                 │                   │              │  │           │               │              │
  │  (polls via     │                 │                   │              │  │ Phase 3: ─────────────────►│ orgSearch   │
  │   tRPC every    │                 │                   │              │  │ load      │  (20 pages)   │  ×20        │
  │   3s)           │                 │                   │              │  │           │◄──────────────┤              ├──►│
  │◄─ rows appear ──┤                 │                   │              │  │           │               │              │
  │                 │                 │                   │              │  │ Phase 4: ─┤               │              │
  │                 │                 │                   │              │  │ score     │  scoreAccount  │              ├──►│
  │                 │                 │                   │              │  │ (batch    │  ×2000        │              │
  │                 │                 │                   │              │  │  200)     │               │              │
  │                 │                 │                   │              │  │           │               │              │
  │                 │                 │                   │              │  │ Phase 5: ─┤               │              │
  │                 │                 │                   │              │  │ validate  │               │              │
  │                 │                 │                   │              │  │           │               │              │
  │                 │                 │                   │              │  │ Phase 5b: ────────────────►│ searchPeople│
  │                 │                 │                   │              │  │ contacts  │  (top 50 A/B) │  ×50        │
  │                 │                 │                   │              │  │           │               │              │
  │                 │                 │                   │              │  │ Phase 6: ─┤ complete      │              │
  │◄─ "TAM Ready" ──┤                 │                   │              │  └───────────┤               │              │
  │                 │                 │                   │              │              │               │              │
  ├─ Navigate ─────►│ /market         │                   │              │              │               │              │
```

### 3.2 Signal Enrichment (Background)

```
Inngest Cron          detect-signals      Jina           Apollo          DB
     │                      │               │               │              │
     ├─ enrichSignals ─────►│               │               │              │
     │  (Tier A+B, max 50)  │               │               │              │
     │                      │               │               │              │
     │   for each account:  │               │               │              │
     │                      ├─ hiring ──────►│ /careers     │              │
     │                      │◄──────────────┤               │              │
     │                      ├─ sales-led ───►│ /homepage    │              │
     │                      │◄──────────────┤               │              │
     │                      ├─ funding ─────────────────────►│ orgData     │
     │                      │◄──────────────────────────────┤              │
     │                      ├─ tech stack ──────────────────►│ technologies│
     │                      │◄──────────────────────────────┤              │
     │                      ├─ job change ──────────────────►│ personData  │
     │                      │◄──────────────────────────────┤              │
     │                      │                               │              │
     │                      ├─ store signals ──────────────────────────────►│
     │                      │                               │              │
     │   rescore ──────────►│  scoreAccount(withSignals)    │              │
     │                      ├─ update tier/heat ───────────────────────────►│
```

---

## 4. tRPC Router Contracts

```typescript
// ═══════════════════════════════════════════════
// src/server/trpc/router.ts
// ═══════════════════════════════════════════════

export const appRouter = router({
  tam: tamRouter,         // TAM build, accounts, leads, export
  icp: icpRouter,         // ICP inference, CRUD, evolution
  workspace: workspaceRouter, // Settings, analyzeUrl, companyDna
  integration: integrationRouter, // API keys, OAuth
  ingestion: ingestionRouter,     // Source management (NEW)
});
```

### 4.1 Ingestion Router (NEW)

```typescript
ingestionRouter = {
  // Get all sources for workspace
  getSources: query(() => IngestionSource[]),

  // Process a URL source (website, linkedin)
  processUrl: mutation({ type, url } => { sourceId, status }),

  // Process an uploaded file (CSV, PDF, DOCX)
  processUpload: mutation({ type, fileName, content } => { sourceId, status }),

  // Delete a source
  deleteSource: mutation({ sourceId } => void),

  // Get source processing status
  getStatus: query({ sourceId } => { status, structuredData, error }),
}
```

### 4.2 ICP Router

```typescript
icpRouter = {
  // Trigger ICP inference from all available sources
  infer: mutation(() => { icpProfileId }),

  // Get active ICP profile
  getActive: query(() => IcpProfile | null),

  // Update ICP (manual edits)
  update: mutation({ profileId, changes } => IcpProfile),

  // Get evolution proposals
  getProposals: query(() => IcpEvolutionProposal[]),

  // Accept/reject proposal
  respondToProposal: mutation({ proposalId, action } => void),
}
```

### 4.3 TAM Router (ported from LeadSens)

```typescript
tamRouter = {
  startBuild: mutation({ siteUrl } => { tamBuildId }),
  getLatestBuild: query(() => TamBuild | null),
  getBuildStatus: query({ tamBuildId } => BuildStatus | null),
  getAccounts: query({
    tamBuildId, offset, limit,
    tier?, heat?, industry?, country?,
    sizeMin?, sizeMax?, hiringOnly?, fundedOnly?,
    search?, sortBy, sortOrder
  } => { accounts, totalFiltered }),
  getLeads: query({ tamBuildId, tamAccountId?, ... } => { leads, totalFiltered }),
  getFilterCounts: query({ tamBuildId } => FilterCounts), // cached 30s
  getSummary: query({ tamBuildId } => Summary),
  loadMore: mutation({ tamBuildId, pages } => { status }),
  enrichLead: mutation({ leadId } => { status, lead }),
  exportAccounts: query({ tamBuildId, filters... } => { accounts }),

  // NEW: HubSpot sync
  syncToHubspot: mutation({ tamBuildId, filters? } => { created, updated, skipped }),
}
```

---

## 5. Inngest Events & Functions

```typescript
// src/inngest/events.ts
type Events = {
  "tam/build.requested": { workspaceId, tamBuildId, siteUrl },
  "tam/build.expand":    { workspaceId, tamBuildId, pages },
  "tam/signals.enrich":  { workspaceId, tamBuildId },
  "icp/evolve":          { workspaceId, trigger: "cron" | "event" },
};

// src/inngest/tam-build.ts — 3 functions ported from LeadSens
//   buildTam       — 6-phase pipeline (analyze → count → load → score → validate → contacts)
//   expandTam      — Load more pages + score new accounts
//   enrichSignals  — Detect signals for Tier A+B (background)

// src/inngest/tam-crons.ts — 3 cron functions ported
//   weeklySignalRefresh     — Monday 06:00 UTC
//   resumeRateLimitedBuilds — Daily 00:30 UTC
//   linkedInConnectionSync  — Sunday 05:00 UTC (if LinkedIn integration active)

// src/inngest/icp-evolution.ts — 1 function ported
//   icpEvolution — Analyze closed deals, suggest ICP changes
```

---

## 6. Key TypeScript Interfaces

```typescript
// ─── ICP (ported from icp-schema.ts) ──────────
interface IcpRole { title: string; variations: string[]; seniority: string; why: string }
interface BuyingSignal { name: string; detectionMethod: string; why: string; strength: "strong"|"moderate"|"weak" }
interface EmployeeRange { min: number; max: number; sweetSpot: number }
interface IcpSegment { name: string; titles: string[]; industries: string[]; sizes: string[]; geos: string[] }
interface NegativeIcp { industries: string[]; titles: string[]; companyPatterns: string[]; sizeExclusions: string[] }
interface ConfidenceScores { industry: number; size: number; title: number; geo: number; overall: number }

interface IcpProfileData {
  roles: IcpRole[];
  industries: string[];
  employeeRange: EmployeeRange;
  geographies: string[];
  keywords: string[];
  buyingSignals: BuyingSignal[];
  disqualifiers: string[];
  competitors: string[];
  segments: IcpSegment[];
  negativeIcp?: NegativeIcp;
  confidence: ConfidenceScores;
  customerPatterns?: CustomerPatterns;
}

// ─── Signals (ported from detect-signals.ts) ──
interface SignalSource { url: string; title: string; favicon?: string }
interface SignalResult { name: string; detected: boolean; evidence: string; sources: SignalSource[]; reasoning: string; points: number }

// ─── Scoring (ported from account-scorer.ts) ──
interface ScoreBreakdown { industryFit: number; sizeFit: number; keywordFit: number; signalScore: number; freshness: number }
interface ScoreSignal { signal: string; value: string; source: string; weight: number; category: "fit"|"signal"|"data" }
interface ScoringResult { tier: "A"|"B"|"C"|"D"; heat: "Burning"|"Hot"|"Warm"|"Cold"; heatScore: number; breakdown: ScoreBreakdown; reasoning: string; scoreSignals: ScoreSignal[] }

// ─── CompanyDna (ported from company-analyzer.ts) ──
interface CompanyDna {
  oneLiner: string;
  targetBuyers: Array<{ role: string; sellingAngle: string }>;
  keyResults: string[];
  differentiators: string[];
  problemsSolved: string[];
  pricingModel: string | null;
  socialProof: Array<{ industry: string; clients: string[]; keyMetric?: string }>;
  toneOfVoice: { register: "formal"|"conversational"|"casual"; traits: string[]; avoidWords: string[] };
  ctas: Array<{ label: string; commitment: "low"|"medium"|"high"; url?: string }>;
}

// ─── Ingestion (NEW) ──────────────────────────
interface IngestionSourceData {
  type: "website" | "linkedin_company" | "linkedin_profile" | "csv_customers" | "document" | "crm";
  status: "pending" | "processing" | "complete" | "error";
  preview: {
    title: string;
    summary: string;
    fields: Array<{ label: string; value: string }>;
  } | null;
}
```

---

## 7. Page Routing & Navigation

```
/                    → Redirect: authenticated ? /market : /login
/login               → Login page (Better Auth)
/signup              → Signup page
/setup               → REQ-ING-08: Full-page ingestion (post-auth, pre-TAM)
/icp                 → REQ-ICP-02/03: ICP display + editing
/market              → REQ-TAM-03: Market table (main view, daily driver)
/settings            → General workspace settings
/settings/integrations → API keys (Apollo, HubSpot, Google)
/changelog           → REQ-AUTO-01: TAM refresh changelog
```

**Sidebar navigation (post-setup):**
```
[Scopiq logo]
├── Market          → /market (main)
├── ICP             → /icp
├── Settings        → /settings
│   └── Integrations
└── [user avatar]   → account menu
```

**Conditional routing:**
- No ICP exists → redirect to `/setup`
- ICP exists, no TAM → redirect to `/market` with build prompt
- ICP exists, TAM exists → `/market` (default)

---

## 8. Environment Variables

```env
# Database (Neon/Supabase)
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3002
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# LLM
MISTRAL_API_KEY=

# Encryption
ENCRYPTION_KEY=  # 64 hex chars

# Apollo
APOLLO_API_KEY=
APOLLO_DAILY_LIMIT=600  # Free tier

# Jina
JINA_RATE_LIMIT_PER_MIN=18

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# HubSpot OAuth (P1)
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=

# Google Sheets OAuth (P1)
GOOGLE_SHEETS_CLIENT_ID=
GOOGLE_SHEETS_CLIENT_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3002
PORT=3002
```

---

## 9. Porting Checklist

Files to copy from `LeadSens/apps/leads/src/` → `scopiq/src/`:

| Source (LeadSens) | Target (Scopiq) | Changes |
|-------------------|-----------------|---------|
| `server/lib/tam/tam-icp-inferrer.ts` | `server/lib/tam/tam-icp-inferrer.ts` | None |
| `server/lib/tam/account-scorer.ts` | `server/lib/tam/account-scorer.ts` | None |
| `server/lib/tam/detect-signals.ts` | `server/lib/tam/detect-signals.ts` | None |
| `server/lib/tam/detect-investor.ts` | `server/lib/tam/detect-investor.ts` | None |
| `server/lib/tam/detect-connections.ts` | `server/lib/tam/detect-connections.ts` | None |
| `server/lib/tam/scrape-site.ts` | `server/lib/tam/scrape-site.ts` | None |
| `server/lib/tam/partitioner.ts` | `server/lib/tam/partitioner.ts` | None |
| `server/lib/tam/score-leads.ts` | `server/lib/tam/score-leads.ts` | None |
| `server/lib/tam/semantic-search.ts` | `server/lib/tam/semantic-search.ts` | None |
| `server/lib/icp/icp-schema.ts` | `server/lib/icp/icp-schema.ts` | None |
| `server/lib/icp/icp-inferrer.ts` | `server/lib/icp/icp-inferrer.ts` | None |
| `server/lib/icp/icp-converters.ts` | `server/lib/icp/icp-converters.ts` | None |
| `server/lib/icp/icp-confidence.ts` | `server/lib/icp/icp-confidence.ts` | None |
| `server/lib/icp/icp-customer-analyzer.ts` | `server/lib/icp/icp-customer-analyzer.ts` | None |
| `server/lib/icp/icp-drift-detector.ts` | `server/lib/icp/icp-drift-detector.ts` | None |
| `server/lib/icp/icp-evolve.ts` | `server/lib/icp/icp-evolve.ts` | None |
| `server/lib/apollo/client.ts` | `server/lib/apollo/client.ts` | None |
| `server/lib/connectors/apollo.ts` | `server/lib/connectors/apollo.ts` | None |
| `server/lib/connectors/jina.ts` | `server/lib/connectors/jina.ts` | None |
| `server/lib/enrichment/company-analyzer.ts` | `server/lib/enrichment/company-analyzer.ts` | None |
| `server/lib/enrichment/hiring-signal-extractor.ts` | `server/lib/enrichment/hiring-signal-extractor.ts` | None |
| `server/lib/llm/mistral-client.ts` | `server/lib/llm/mistral-client.ts` | None |
| `lib/encryption.ts` | `lib/encryption.ts` | None |
| `lib/logger.ts` | `lib/logger.ts` | None |
| `inngest/tam-build.ts` | `inngest/tam-build.ts` | Remove LeadSens-specific imports |
| `inngest/events.ts` | `inngest/events.ts` | Keep TAM + ICP events only |
| `server/trpc/routers/tam.ts` | `server/trpc/routers/tam.ts` | Remove pipeline cross-ref |
| `components/tam/signal-popover.tsx` | `components/market/signal-popover.tsx` | Import path changes |
| `components/tam/account-timeline.tsx` | `components/market/account-timeline.tsx` | Import path changes |
| `components/tam/tam-lead-expand.tsx` | `components/market/contact-list.tsx` | Import path changes |
| `components/tam/score-tooltip.tsx` | `components/market/score-tooltip.tsx` | Import path changes |
| `app/(dashboard)/market/page.tsx` | `components/market/market-table.tsx` | Extract to component, remove LeadSens nav |
| `app/globals.css` | `app/globals.css` | Remove chat/assistant-ui styles, keep design tokens |

**Import path changes:**
- `@leadsens/ui` → local `@/components/ui` (install shadcn directly)
- `@leadsens/db` → local `@prisma/client`
- `@/lib/prisma` → same pattern, new prisma client file
- `@/lib/trpc-client` → same pattern, new tRPC client

---

## 10. Design System Tokens (from LeadSens globals.css)

```
Primary:     oklch(0.72 0.14 180)     — #17C3B2 teal
Background:  oklch(0.985 0.005 90)    — #FAFAF8 warm white
Foreground:  oklch(0.145 0.005 285)   — #1A1A1A
Muted FG:    oklch(0.5 0.015 250)     — #6B7280
Border:      oklch(0.925 0.006 90)    — #E8E8E4 warm border
Accent:      oklch(0.955 0.006 90)    — #F0F0EC warm hover

Semantic:
  Success:   oklch(0.55 0.18 155)
  Warning:   oklch(0.75 0.18 75)
  Error:     oklch(0.58 0.24 27)
  Info:      oklch(0.55 0.2 260)

Brand:
  Teal:      oklch(0.72 0.14 180)     — #17C3B2
  Blue:      oklch(0.55 0.2 260)      — #2C6BED
  Orange:    oklch(0.7 0.18 45)       — #FF7A3D

Fonts:
  Sans:      Geist (--font-geist-sans)
  Mono:      Geist Mono (--font-geist-mono)
  Heading:   Plus Jakarta Sans (--font-heading)

Typography scale:
  Compact:   10px (data tables, badges)
  Small:     12px (metadata, captions)
  Body:      14px (default)
  Heading:   18px (page titles)

Radius:      0.625rem (base)
Shadows:     sm/md/lg (very subtle, warm-toned)
```
