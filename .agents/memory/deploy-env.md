---
name: Deployment & env split
description: How this AliExpress Telegram bot is deployed and why secrets/integrations must be plain env vars
---

# Deployment model
The bot is deployed and runs in production on **Render** (auto-deploys from GitHub main). **Replit is only the dev/test environment.**

**Why this matters:**
- Secrets must exist **independently in both** Render and Replit. Adding a key to Render does NOT make it available when testing on Replit, and vice-versa. Expect to request the same secret twice.
- **Do not use Replit connector-based integrations** (the ones relying on `REPLIT_CONNECTORS_HOSTNAME` / credential proxy). They only work inside Replit and break on Render. Use plain `process.env.X` API keys (e.g. `OPENAI_API_KEY`) so the same code runs in both places.

**How to apply:** When adding any third-party API, wire it via a standard env-var API key, install the plain SDK, and gate features on the key's presence so they degrade gracefully when unset.

# AI provider choice
The AI reviews-summary feature uses **Google Gemini** (model `gemini-2.0-flash`, key `GEMINI_API_KEY`), NOT OpenAI. **Why:** OpenAI required paid billing (hit 429 quota-exceeded with no credits); Gemini's free tier solves this at zero cost for the user's volume.

Gemini is called via **direct REST** (`POST generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=...`, body `{contents:[{parts:[{text}]}], generationConfig}`) using the existing `got` package — **NOT the `@google/genai` SDK**.

# Render free-tier install constraint
**Render's free tier (~512MB RAM) crashes `npm install` with `npm error Exit handler never called!` when the dependency tree grows too large.** Adding heavy SDKs (`openai`, `@google/genai`) triggered repeated build failures; the bot deployed fine only with its original lean dependency set.
**Why:** the error is an npm OOM symptom, not a code bug — removing junk packages (`https`, `url` stubs) alone did NOT fix it; removing the heavy SDK did.
**How to apply:** on this project, integrate third-party APIs via direct REST using the already-present `got` package instead of installing vendor SDKs. Keep the dependency footprint minimal.

# DB connection
Connection string comes from `DATABASE_URL || NEON_DATABASE_URL` (Neon Postgres). SSL is required for all non-localhost hosts (`{ rejectUnauthorized: false }`), disabled only for localhost.

# AliExpress reviews
Reviews are fetched from `https://feedback.aliexpress.com/pc/searchEvaluation.do` (params: productId, lang, country, page, pageSize, filter=all, sort=complex_default). Returns `data.evaViewList[]` (text in `buyerProductFeedBack`, rating `buyerEval` is 0-100) and `data.productEvaluationStatistic` (avg/total/positiveRate). Works under strict TLS — no need to disable cert verification.
