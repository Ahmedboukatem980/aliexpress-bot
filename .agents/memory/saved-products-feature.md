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
