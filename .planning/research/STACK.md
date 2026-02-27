# Stack Research

**Domain:** Web-based Returns Management System (RMS) / RMA Portal — electronics distributor
**Researched:** 2026-02-27
**Confidence:** MEDIUM-HIGH (versions verified via npm/official sources; architectural choices verified across multiple sources)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| React | 18.x | Frontend UI framework | Already chosen; React 18 required by TanStack Query v5. Concurrent rendering handles complex approval workflows and multi-step forms without blocking UI. | HIGH |
| NestJS | 11.x (`@nestjs/core` 11.1.14) | Node.js API backend | The structured, TypeScript-first framework for this project. Built-in RBAC guards (`@nestjs/jwt` + guards), dependency injection, modular architecture, Fastify adapter available for ~2x throughput over plain Express. At 500–2,000 RMAs/month, the overhead is worth the structure — prevents the technical debt that plain Express accumulates in multi-role, multi-workflow systems. | HIGH |
| PostgreSQL | 16+ | Primary database | Wins over MySQL for this domain: native JSON support for audit log payloads, JSONB indexing, superior trigger support for audit trails, ACID compliance for approval state transitions, row-level security for RBAC enforcement at DB level. PostgreSQL audit logging via triggers is well-established and avoids application-layer gaps. | HIGH |
| Prisma ORM | 7.x (7.4.2 current) | Database access layer | Best developer experience for a TypeScript + PostgreSQL stack: auto-generated type-safe client, declarative migrations, schema-as-source-of-truth. Handles soft deletes via partial indexes (`@index` with `deletedAt IS NULL` filter). Prisma 7 is stable and actively maintained. Use over Drizzle (less mature for complex schema) and TypeORM (spotty maintenance, critical bugs sitting unresolved). | MEDIUM-HIGH |
| Vite | 6.x | Frontend build tool | Standard for React 2025 — replaced Create React App (deprecated). Instant HMR, ESM-native, <500ms cold starts. `vite-plugin-federation` handles module federation if the host portal needs to consume the RMS as a remote module. | HIGH |

---

### Supporting Libraries

#### Frontend — UI & Data Display

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| Ant Design (antd) | 5.27.x (v5; do NOT use v6 yet — see below) | Component library | Primary UI system: Table, Form, Modal, Steps, Tag, Badge, Drawer — all needed. Ant Design v5 is designed for complex, data-driven enterprise portals. Includes ProTable (Ant Design ProComponents) for RMA list views with built-in filtering, sorting, pagination, virtual scroll. | HIGH |
| @ant-design/pro-components | latest v5-compatible | ProTable, ProForm | Use ProTable for the central returns workspace (replaces hand-rolling TanStack Table). Use ProForm and StepsForm for multi-step RMA submission. Saves significant development time over raw antd. | MEDIUM |
| TanStack Table (react-table) | v8 | Headless data grid fallback | If ProTable becomes too constrained, TanStack Table v8 gives full control over rendering at the cost of more boilerplate. Use for custom line-item grids within an RMA where ProTable doesn't fit. | MEDIUM |

#### Frontend — State Management & Data Fetching

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| TanStack Query (@tanstack/react-query) | 5.90.x | Server-state management | All API calls: RMA list, RMA detail, user roles, status updates. Handles caching, background refetch, optimistic updates (critical for approval actions), pagination. This replaces Redux for server data in 2025. Required: React 18+. | HIGH |
| Zustand | 5.0.x (5.0.11 current) | Client-state management | UI-local state: current user session (role, permissions), filter panel state, selected RMAs for bulk actions, multi-step form wizard progress. Do NOT use for server data — that belongs in TanStack Query. | HIGH |
| XState | 5.28.x + @xstate/react 6.x | Workflow/approval state machine | Model the RMA lifecycle state machine (Draft → Submitted → Approved → In Transit → Received → QC → Resolved → Closed, plus rejection/contest/Info Required branches). XState v5 actor model prevents illegal transitions and makes the workflow self-documenting. Use on the frontend to drive UI state; mirror the same state logic in the Node.js backend for authoritative transitions. | MEDIUM |

#### Frontend — Forms & Validation

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| React Hook Form | 7.71.x (7.71.2 current) | Form state & submission | All forms: RMA submission, line-item entry, disposition selection, approval/rejection with comments. Dramatically fewer re-renders than Formik — critical for multi-line RMAs with complex validation. 7M+ weekly downloads; active maintenance. | HIGH |
| Zod | 3.x | Schema validation | Pair with React Hook Form via `@hookform/resolvers/zod`. Define one schema per step in multi-step forms; validate only the current step before advancing. Zod schemas are also shareable between frontend and NestJS (via `class-validator` or re-used as runtime checks in the API layer). | HIGH |
| @hookform/resolvers | 3.x | RHF + Zod adapter | Required bridge between React Hook Form and Zod. Install alongside both libraries. | HIGH |

#### Frontend — Routing

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| React Router | 7.x | Client-side routing | Standard choice for embedded React modules. The RMS embeds into the host portal, so framework-mode React Router v7 (with SSR/file-based routing) is NOT needed — use it in library/SPA mode. TanStack Router is excellent but introduces learning curve without sufficient benefit for this non-SSR use case. | MEDIUM |

#### Frontend — File Upload

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| Built-in antd Upload component | antd 5.x | File attachment UI | Ant Design's Upload component handles drag-and-drop, file lists, progress, previews. Configure it to call the NestJS presigned-URL endpoint and upload directly to S3 to avoid routing file data through the API server. | HIGH |

---

#### Backend — API & Middleware

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| @nestjs/jwt | latest | JWT validation | Validate tokens passed from the host portal. NestJS guards apply RBAC at the route level using decoded role claims. Use HTTP-only cookies for the refresh token; short-lived bearer tokens for API calls. | HIGH |
| @nestjs/passport | latest | Auth strategy wiring | Wires JWT strategy into NestJS guard system. Standard pattern for NestJS auth. | HIGH |
| Multer (via @nestjs/platform-express) | bundled | File upload to presigned URL generation | Handle multipart file metadata on initial request; return S3 presigned PUT URL to frontend; do NOT buffer file bytes through the API server. Use multer only for metadata extraction if needed, not for streaming to S3. | HIGH |
| @aws-sdk/client-s3 | 3.x | S3 presigned URL generation | Generate presigned PUT URLs for the frontend to upload directly; generate presigned GET URLs for viewing attachments. Scoped by RMA ID with short TTLs. | MEDIUM |
| Pino + pino-http | latest | Structured HTTP logging | Pino is significantly faster than Winston for high-throughput logging and outputs structured JSON. `pino-http` auto-logs every request with correlation IDs. Use for both operational logging and as the transport for the application audit log before writing to the database. | MEDIUM |

#### Backend — Background Jobs

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| BullMQ | 5.70.x | Background job queue | Email notifications (approval decisions, info-required requests), async MERP API stub calls, attachment virus scanning hooks. BullMQ is the 2025 successor to Bull, built on Redis Streams. Deferred from v1 scope (notifications are out of scope), but design the NestJS module structure to add it without refactoring. | MEDIUM |
| Redis | 7.x | BullMQ backing store | Required by BullMQ. Also usable for rate limiting NestJS endpoints and caching user role lookups. | MEDIUM |

---

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript | 5.x | Type safety across frontend and backend | NestJS requires TypeScript. XState v5 requires TypeScript 5.0+. Enables sharing Zod schemas between FE and BE. |
| ESLint + Prettier | Linting / formatting | Use `@typescript-eslint` plugin. NestJS CLI scaffolds this by default. |
| Jest | Unit testing | NestJS default test runner. Test workflow state transitions, RBAC guards, and service-layer logic. |
| Playwright | E2E testing | Preferred over Cypress for modern React 18 + portal-embedded apps. Test full RMA submission and approval flows. |
| Prisma Studio | Database GUI | Built into Prisma; useful for inspecting audit log entries and RMA state during development. |
| Docker Compose | Local dev environment | Run PostgreSQL 16 and Redis 7 locally. NestJS and Vite dev server run outside Docker for HMR speed. |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| NestJS 11 | Express.js | Express has no structure for multi-role API with guards, middleware, and modular services. Teams inevitably reinvent what NestJS provides; debt accumulates fast at this complexity level. |
| NestJS 11 | Fastify (standalone) | Fastify alone lacks the RBAC guard system, DI container, and module structure needed. Use Fastify as the NestJS adapter for performance, not standalone. |
| Ant Design v5 | Material UI (MUI) | MUI is more design-system-focused and less enterprise-data-table-focused. AntD's Table, ProTable, and Form components are purpose-built for the admin/portal use case. MUI requires significantly more custom work to achieve the same density. |
| Ant Design v5 | shadcn/ui | shadcn/ui is excellent for design-system-controlled products. This project needs immediately usable complex components (multi-step forms, data tables with filters) without building a design system. Not the right tradeoff for an internal business tool. |
| Prisma 7 | Drizzle ORM | Drizzle is the better choice for serverless/edge; this is a traditional Node.js server. Drizzle is newer with a smaller community and less established migration story for complex schemas with audit extensions. |
| Prisma 7 | TypeORM | TypeORM has spotty maintenance — critical bugs sit unresolved for months. Not acceptable for a financial-adjacent system handling credit memos and approval audit trails. |
| React Hook Form + Zod | Formik + Yup | Formik re-renders the entire form on every keystroke; performance degrades noticeably on multi-line RMAs. React Hook Form's uncontrolled approach is the correct default in 2025. |
| TanStack Query | Redux Toolkit Query | Redux RTK Query is the right choice only if Redux is already in the stack. It adds ~15KB bundle overhead and significant boilerplate vs TanStack Query for a greenfield project. |
| XState | Custom reducer logic | Custom `useReducer` + `switch` for a 9-state workflow with 12+ transitions and branching (contest, info-required, rejection) will become unmaintainable. XState makes illegal transitions impossible and the workflow is self-documenting. |
| PostgreSQL | MySQL | PostgreSQL wins on audit trigger support, JSONB for flexible audit payloads, and row-level security. MySQL is faster for simple reads but this system is not read-latency-critical. |
| React Router v7 (SPA mode) | TanStack Router | TanStack Router's advantages (full type-safe routing, search params) shine most in full-stack TypeScript apps with SSR. In SPA-mode portal embedding, the added learning curve and ecosystem immaturity relative to React Router don't justify switching. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Ant Design 6.x | Released November 2025; major migration (CSS variables by default, drops React 17, limited community resources yet). ProComponents ecosystem not fully updated. Too new for a production greenfield in Q1 2026. | Ant Design 5.x (5.27.x) — actively maintained, stable ProComponents ecosystem. |
| Create React App | Officially deprecated; no longer maintained. Build times are 10-30x slower than Vite. | Vite |
| Redux (classic) | Excessive boilerplate for a project using TanStack Query for server state and Zustand for local state. "Redux peaked in 2017" — even its maintainer says so. | TanStack Query + Zustand |
| Formik | Re-renders entire form on every keystroke; visible performance lag on multi-line RMAs with 10+ fields per line. Maintenance has slowed. | React Hook Form + Zod |
| Bull (original, not BullMQ) | Deprecated; Bull's GitHub archive notes it is no longer actively maintained. BullMQ is the supported successor. | BullMQ |
| TypeORM | Maintenance gaps; critical bug fixes delayed for months. Not appropriate for a financial-adjacent system. | Prisma |
| iframe embedding for the RMS | iFrames create auth complexity (cross-origin token passing via postMessage), break browser history, and create UX seams (scroll, resize, accessibility). The host portal should mount the React RMS module directly as a JavaScript component, sharing the host's auth context via React context or a shared token store. | Direct React module mounting with shared JWT from host app |
| Session cookies (server-side sessions) | The host portal owns auth; the RMS cannot and should not maintain its own session store. JWT bearer tokens inherited from the host's auth flow are the correct pattern for portal-embedded modules. | JWT from host portal, validated per-request by NestJS guards |

---

## Stack Patterns by Variant

**If the host portal passes auth via a shared cookie (HTTP-only, same domain):**
- NestJS reads the cookie and validates the JWT on every request
- No token-in-URL, no postMessage; cleanest security model
- Requires host portal and RMS to share a cookie domain

**If the host portal passes auth via a JavaScript context (React props/context):**
- Host mounts the RMS React app and passes `{ token, user, roles }` as props
- Zustand store initializes from these props on mount
- NestJS receives JWT as a Bearer token in the Authorization header
- This is the most portable pattern for embedding into a server-rendered host portal

**If MERP REST API uses basic auth or API keys (not JWT):**
- Create a NestJS MerpService with its own credential management (environment variables, not user-forwarded tokens)
- The RMS backend calls MERP on behalf of the user — user JWT does not flow to MERP
- This is the correct architecture for a service-to-service integration

**If attachment storage on-premises is required (no AWS):**
- Replace S3 presigned URL pattern with MinIO (S3-compatible, self-hosted)
- `@aws-sdk/client-s3` works unchanged against MinIO; only the endpoint URL changes

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `antd` 5.27.x | React 18.x | antd v6 drops React 17 support; v5 supports React 16.8+, 17, 18 |
| `@tanstack/react-query` 5.90.x | React 18.0+ | v5 requires React 18 (uses `useSyncExternalStore`) |
| `xstate` 5.28.x + `@xstate/react` 6.x | TypeScript 5.0+, React 18 | XState v5 breaking change from v4 actors API |
| `prisma` 7.x | Node.js 18+, PostgreSQL 14+ | Prisma 7 drops Node.js 16 support |
| `@nestjs/core` 11.x | Node.js 20+ LTS recommended | NestJS 11 requires Node.js 18+; 20 LTS recommended for production |
| `react-hook-form` 7.71.x | React 16.8+, TypeScript 4.5+ | No React 18 specific requirements; works with React 18 |
| `zustand` 5.x | React 18+ | Zustand v5 removes deprecated APIs from v4 |

---

## Installation

```bash
# Frontend (Vite + React app)
npm create vite@latest rms-frontend -- --template react-ts

# Frontend core
npm install antd @ant-design/pro-components
npm install @tanstack/react-query @tanstack/react-query-devtools
npm install zustand
npm install react-router-dom
npm install react-hook-form @hookform/resolvers zod
npm install xstate @xstate/react

# Frontend dev dependencies
npm install -D typescript @types/react @types/react-dom eslint prettier

# Backend (NestJS)
npm install -g @nestjs/cli
nest new rms-api

# Backend core
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install prisma @prisma/client
npm install pino pino-http
npm install bullmq  # install now, activate in v2
npm install @aws-sdk/client-s3  # for S3/MinIO presigned URLs

# Backend dev dependencies
npm install -D @types/passport-jwt ts-jest jest
```

---

## Sources

- [NestJS official docs](https://docs.nestjs.com/) — RBAC guards, JWT, modular architecture
- [Announcing NestJS 11](https://trilon.io/blog/announcing-nestjs-11-whats-new) — version confirmed (11.1.14 current)
- [TanStack Query v5 announcement](https://tanstack.com/blog/announcing-tanstack-query-v5) — React 18 requirement, v5 features; 5.90.21 confirmed current
- [react-hook-form npm](https://www.npmjs.com/package/react-hook-form) — 7.71.2 confirmed current
- [zustand npm / GitHub releases](https://github.com/pmndrs/zustand/releases) — 5.0.11 confirmed current
- [XState v5 announcement + npm](https://stately.ai/blog/2023-12-01-xstate-v5) — xstate 5.28.x, @xstate/react 6.x confirmed
- [Ant Design changelog](https://ant.design/changelog/) — v5.27.x stable, v6.0.0 released Nov 2025
- [Prisma GitHub releases](https://github.com/prisma/prisma/releases) — 7.4.2 confirmed current
- [BullMQ npm](https://www.npmjs.com/package/bullmq) — 5.70.1 confirmed current
- [Makersden: React UI libs 2025](https://makersden.io/blog/react-ui-libs-2025-comparing-shadcn-radix-mantine-mui-chakra) — component library comparison
- [Makersden: React state management 2025](https://makersden.io/blog/react-state-management-in-2025) — Zustand + TanStack Query pattern
- [Better Stack: Drizzle vs Prisma](https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/) — ORM comparison
- [Better Stack: NestJS vs Fastify](https://betterstack.com/community/guides/scaling-nodejs/nestjs-vs-fastify/) — framework comparison
- [Bytebase: PostgreSQL audit logging](https://www.bytebase.com/blog/postgres-audit-logging/) — PostgreSQL trigger audit pattern
- [LogRocket: Multi-step form with RHF + Zod](https://blog.logrocket.com/building-reusable-multi-step-form-react-hook-form-zod/) — form wizard pattern
- [vite-plugin-federation](https://github.com/originjs/vite-plugin-federation) — module federation for embedded portal pattern
- [Pino logger guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) — structured logging choice

---

*Stack research for: Returns Management System (RMS) / RMA Portal — Master Electronics*
*Researched: 2026-02-27*
