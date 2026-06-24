---
name: AliExpress Affiliate Open Platform API
description: How to call the AliExpress affiliate API correctly (gateway, signing, method names, available scopes) for this bot's product-detail feature
---

# AliExpress Affiliate API (api-sg gateway)

This bot has `ALI_APP_KEY` / `ALI_APP_SECRET` env vars (set on Render only, NOT in Replit) for an **affiliate-scoped** app.

## Gateway + signing (confirmed working)
- Endpoint: `POST https://api-sg.aliexpress.com/sync` (form-encoded params).
- Timestamp: **Unix milliseconds as string** (`Date.now().toString()`) — NOT the `yyyy-MM-dd HH:mm:ss` TOP format.
- `sign_method`: `sha256`.
- Sign algorithm: sort all params by key, concat `key+value` (no separators), then `HMAC-SHA256(baseString, appSecret)` uppercased. **Do NOT wrap the secret around the string** (that md5-style wrapping is wrong here and silently fails).

## Method name gotcha
- Correct: `aliexpress.affiliate.productdetail.get` (productdetail = ONE word).
- Wrong: `aliexpress.affiliate.product.detail.get` → returns `InvalidApiPath`. The dotted form does not exist.

## What this app's keys can/can't do (diagnosed via /testapi)
- ✅ `aliexpress.affiliate.link.generate` works (`resp_code:200, "Call succeeds"`) — proves signing + affiliate scope are good.
- ✅ `aliexpress.affiliate.productdetail.get` — use this for product stats.
- ❌ `aliexpress.ds.product.get` (dropshipping) needs an OAuth `access_token` (MissingParameter) — not available without a full OAuth flow. Don't go down this path.

## Fields available from productdetail.get
Response path: `aliexpress_affiliate_productdetail_get_response.resp_result.result.products.product[0]`.
- `lastest_volume` → recent sales count (note the typo "lastest" is the real field name).
- `evaluate_rate` → positive feedback rate, e.g. "92.3%". Approximate stars as `rate/20`.
- `shop_id`, `shop_url` available; **no star rating, no review count, no separate store-trust score** in affiliate scope. evaluate_rate is the best trust proxy.

## Why scraping was abandoned
feedback.aliexpress.com returns zeros; www/vi.aliexpress.com HTML scraping is blocked; linkpreview.xyz 500s. The official affiliate API is the only reliable source. Cookie scraping remains only as a last-resort fallback.

## Deploy/test loop
Render runs from GitHub main (auto-deploy). Replit main agent cannot push (git blocked) — user must Commit & Push from Replit Git panel. Admin-only `/testapi <productId>` command dumps the raw + parsed API response in Telegram for diagnosis without needing Render logs.
