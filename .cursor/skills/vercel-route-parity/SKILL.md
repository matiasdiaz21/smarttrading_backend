---
name: vercel-route-parity
description: Ensure Express routes stay synchronized between src/server.ts and api/index.ts for Vercel deployments. Use when adding, removing, or changing backend routes to prevent Route not found errors in production.
---

# Vercel Route Parity

## Goal
Prevent production 404s caused by route drift between:
- `src/server.ts` (local runtime)
- `api/index.ts` (Vercel serverless entrypoint)

## When To Use
- Any change to Express routes (`app.get/post/put/delete/...`)
- Any new admin/public endpoint
- Any rename of path, method, middleware chain, or controller handler

## Mandatory Workflow
1. **Edit both files**
   - Apply the same route change in `src/server.ts` and `api/index.ts`.
2. **Verify parity**
   - Search both files for the exact path string and confirm:
     - same HTTP method
     - same path
     - same middleware (`authenticate`, `requireAdmin`, etc.)
     - same controller method
3. **Type-check**
   - Run backend TypeScript check (or equivalent project check).
4. **Smoke test key endpoints**
   - Test locally and in deployed env for:
     - existing route(s)
     - newly added route(s)
5. **Document env dependencies**
   - If endpoint depends on env vars, update docs/UI hints.

## Route Parity Checklist
Copy this checklist before finishing route work:

```text
Route Parity Checklist
- [ ] Route added/updated in src/server.ts
- [ ] Same route added/updated in api/index.ts
- [ ] Method/path/middleware/handler match exactly
- [ ] Backend checks executed
- [ ] Endpoint smoke-tested (local + deployed)
- [ ] Related docs/env hints updated
```

## Common Failure Pattern
- Route exists in `src/server.ts` but missing in `api/index.ts`.
- Result: works locally, fails on Vercel with `Route not found`.

## Quick Validation Commands
- Search by path in backend:
  - `rg "/api/admin/ai/news-provider/test" src/server.ts api/index.ts`
- Search all admin AI routes:
  - `rg "/api/admin/ai/" src/server.ts api/index.ts`

