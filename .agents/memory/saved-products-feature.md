---
name: Saved products (per-user wishlist)
description: Why saved items store a self-contained snapshot instead of referencing the shared product cache.
---

# Saved products design

Telegram inline `callback_data` is capped at 64 bytes, so the "save" button can only
carry the product id (`save:<productId>`), not the full product payload. A
`products_cache` table (keyed by `product_id`, upserted on every generation) bridges
generation → save so the save handler can look the product up by id.

## Rule: saved_products must hold its own snapshot (title, image_url, details, links)
On save, copy the product data from `products_cache` INTO `saved_products` columns.
Views/lists read from `saved_products` directly — never JOIN back to `products_cache`.

**Why:** `products_cache` is shared across all users and overwritten whenever anyone
regenerates the same product. If saved items only stored `(user_id, product_id)` and
read links/title via a JOIN to the cache, a later regeneration would silently mutate
every user's saved copy. The product requirement is "show the saved links as-is", so
each save must be an immutable snapshot.

**How to apply:** if you ever "normalize" saved_products back to a thin id reference,
you reintroduce the mutation bug. Keep the snapshot columns.

## Other constraints baked in
- 50-item per-user limit is enforced atomically inside the INSERT via
  `... WHERE (SELECT COUNT(*) FROM saved_products WHERE user_id=$1) < $limit`, plus
  `ON CONFLICT (user_id, product_id) DO NOTHING` for dedupe. Distinguish the two
  zero-row outcomes (limit vs duplicate) with a follow-up count.
- Telegram photo captions cap at 1024 chars. `buildProductCaption` builds the links
  block first (the core value) and trims the title/details head if the total exceeds
  1024 — never truncate the links.

## Price-drop alerts
- `base_price` (price captured at save time) is the alert anchor — never auto-mutate it.
- Alert only on a *new* low: `current < base_price AND (last_notified_price IS NULL OR
  current < last_notified_price)`; set `last_notified_price=current` on alert; reset it to
  NULL once `current >= base_price` so a later drop re-alerts. This is what prevents spam.
- Computing "should alert" needs a *separate* UPDATE...RETURNING for the new-low rows: one
  UPDATE can't both mutate `last_notified_price` and test its *old* value in RETURNING
  (RETURNING sees the post-update value).
- The price source (affiliate `productdetail.get`) can return a valid price with zero
  stats (Choice products). Two traps: (1) the generation path must NOT drop an API
  price-only result for the cookie scrape (scrape has no price) or `base_price` ends up
  null and the product is never monitored; (2) the cron must never overwrite baselines
  when a price fetch yields null/zero — only advance its check timestamp.
