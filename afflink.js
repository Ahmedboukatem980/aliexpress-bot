const got = require("got");
const { URL } = require("url");
const crypto = require("crypto");

async function getFinalRedirect(url) {
    try {
        const response = await got(url, {
            followRedirect: false,
            https: { rejectUnauthorized: false }
        });

        if (response.headers.location) {
            return response.headers.location;
        }

        return url;
    } catch (err) {
        console.error("❌ Redirect error:", err.message);
        return url;
    }
}

function extractProductId(url) {
    try {
        const u = new URL(url);

        if (u.searchParams.has("productIds")) {
            return u.searchParams.get("productIds");
        }

        if (u.searchParams.has("redirectUrl")) {
            const decoded = decodeURIComponent(u.searchParams.get("redirectUrl"));
            const m = decoded.match(/item\/(\d+)\.html/);
            if (m) return m[1];
        }

        const m = u.pathname.match(/item\/(\d+)\.html/);
        if (m) return m[1];

        return null;
    } catch {
        return null;
    }
}

async function idCatcher(input) {
    if (!input || typeof input !== "string") return null;

    if (/^\d+$/.test(input)) {
        return { id: input };
    }

    if (!input.startsWith("http")) {
        input = "https://" + input;
    }

    let finalUrl = await getFinalRedirect(input);
    finalUrl = await getFinalRedirect(finalUrl);

    const id = extractProductId(finalUrl);

    return { id, finalUrl };
}

async function fetchLinkPreview(productId) {
    try {
        const url = "https://linkpreview.xyz/api/get-meta-tags";

        const res = await got(url, {
            searchParams: {
                url: `https://vi.aliexpress.com/item/${productId}.html`
            },
            responseType: "json"
        });

        return {
            title: res.body.title || "",
            image_url: res.body.image || null
        };

    } catch (err) {
        console.error("❌ Preview error:", err.message);
        return null;
    }
}

function buildAliSign(params, appSecret) {
    // AliExpress IOP signing: HMAC-SHA256 over sorted key+value (no secret wrapping)
    const sortedKeys = Object.keys(params).sort();
    let baseStr = '';
    for (const key of sortedKeys) baseStr += key + params[key];
    return crypto.createHmac('sha256', appSecret).update(baseStr).digest('hex').toUpperCase();
}

async function callAffiliateDetail(productId, appKey, appSecret, country) {
    const params = {
        app_key: appKey,
        method: 'aliexpress.affiliate.productdetail.get',
        timestamp: Date.now().toString(),
        sign_method: 'sha256',
        product_ids: productId.toString(),
        tracking_id: 'default',
        target_currency: 'USD',
        target_language: 'EN'
    };
    if (country) params.country = country;
    params.sign = buildAliSign(params, appSecret);

    const res = await got.post('https://api-sg.aliexpress.com/sync', {
        form: params,
        responseType: 'json',
        timeout: { request: 12000 }
    });

    return res.body?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result?.products?.product?.[0] || null;
}

function parseAffiliateProduct(productData) {
    if (!productData) return null;

    // lastest_volume = recent sales count (hide zero — it's misleading, not real)
    const volume = productData.lastest_volume ?? productData.volume ?? null;
    let orders = null;
    if (volume != null) {
        const vStr = String(volume).trim();
        const numeric = parseInt(vStr.replace(/[^\d]/g, ''), 10);
        if (numeric > 0) {
            orders = /^\d+$/.test(vStr) ? numeric.toLocaleString() : vStr;
        }
    }

    // evaluate_rate = positive feedback rate, e.g. "92.3%"
    const evaluateRate = productData.evaluate_rate
        ? parseFloat(String(productData.evaluate_rate).replace('%', ''))
        : null;
    const hasRate = evaluateRate && evaluateRate > 0;
    const rating = hasRate ? (evaluateRate / 20).toFixed(1) : null;
    const storeFeedback = hasRate ? `${evaluateRate.toFixed(1)}%` : null;

    return {
        orders,
        rating,
        reviews: null,
        storeFeedback,
        storeName: productData.shop_name || null
    };
}

async function fetchProductDetailsAPI(productId) {
    const appKey = process.env.ALI_APP_KEY;
    const appSecret = process.env.ALI_APP_SECRET;
    if (!appKey || !appSecret) {
        console.log('No ALI_APP_KEY/ALI_APP_SECRET, skipping API');
        return null;
    }

    try {
        // First attempt: default (no country)
        let productData = await callAffiliateDetail(productId, appKey, appSecret, null);
        let parsed = parseAffiliateProduct(productData);

        // Choice / region-restricted products often return zeros on the default
        // country. Retry with explicit countries to recover their real stats.
        if (!parsed || (!parsed.orders && !parsed.rating)) {
            for (const country of ['US', 'DZ']) {
                const retryData = await callAffiliateDetail(productId, appKey, appSecret, country);
                const retryParsed = parseAffiliateProduct(retryData);
                if (retryParsed && (retryParsed.orders || retryParsed.rating)) {
                    console.log(`Affiliate detail recovered with country=${country}`);
                    return retryParsed;
                }
            }
        }

        if (!parsed) console.log('No product data in affiliate response');
        return parsed;
    } catch (err) {
        console.error('❌ Affiliate API error:', err.message);
        return null;
    }
}

async function fetchProductDetailsWithCookie(productId, cookie) {
    try {
        const res = await got(`https://www.aliexpress.com/item/${productId}.html`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cookie': cookie ? `xman_t=${cookie}; aep_usuc_f=site=glo&c_tp=USD` : ''
            },
            https: { rejectUnauthorized: false },
            timeout: { request: 12000 }
        });

        const html = res.body;
        let orders = null, rating = null, reviews = null, storeFeedback = null, storeName = null;

        const fmt = html.match(/"formatTradeCount"\s*:\s*"([^"]+)"/);
        if (fmt) orders = fmt[1];
        else {
            const tr = html.match(/"tradeCount"\s*:\s*(\d+)/);
            if (tr) orders = parseInt(tr[1]).toLocaleString();
        }
        const ratM = html.match(/"averageStar"\s*:\s*"([^"]+)"/);
        if (ratM) rating = ratM[1];
        const revM = html.match(/"totalValidNum"\s*:\s*(\d+)/);
        if (revM) reviews = parseInt(revM[1]).toLocaleString();
        const feedM = html.match(/"positiveRate"\s*:\s*"([^"]+)"/);
        if (feedM) storeFeedback = feedM[1];
        const storeM = html.match(/"storeName"\s*:\s*"([^"]+)"/);
        if (storeM) storeName = storeM[1];

        console.log(`Details found - orders:${orders} rating:${rating} reviews:${reviews}`);
        return { orders, rating, reviews, storeFeedback, storeName };
    } catch (err) {
        console.error("❌ Cookie scrape error:", err.message);
        return null;
    }
}

async function fetchProductDetails(productId, cookie) {
    // Try official API first (if keys available)
    const apiResult = await fetchProductDetailsAPI(productId);
    if (apiResult && (apiResult.orders || apiResult.rating)) return apiResult;
    // Fallback: scrape with cookie authentication
    return fetchProductDetailsWithCookie(productId, cookie);
}

async function portaffFunction(cookie, ids) {

    const idObj = await idCatcher(ids);
    const productId = idObj?.id;

    if (!productId) throw new Error("❌ لم يتم استخراج Product ID.");

    const sourceTypes = {
        "555": "coin",
        "620": "point",
        "562": "super",
        "570": "limit",
        "561": "ther3"
    };

    let result = { aff: {}, previews: {} };
    let promoRequests = [];

    for (const type in sourceTypes) {
        const name = sourceTypes[type];

        const targetUrl = type === "561"
            ? `https://www.aliexpress.com/ssr/300000512/BundleDeals2?disableNav=YES&pha_manifest=ssr&_immersiveMode=true&productIds=${productId}&aff_fcid=`
            : type === "555"
                ? `https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true&from=syicon&productIds=${productId}&aff_fcid=`
                : `https://star.aliexpress.com/share/share.htm?redirectUrl=https%3A%2F%2Fvi.aliexpress.com%2Fitem%2F${productId}.html%3FsourceType%3D${type === "620" ? '620%26channel%3Dcoin' : type}`;

        promoRequests.push(
            got("https://portals.aliexpress.com/tools/linkGenerate/generatePromotionLink.htm", {
                searchParams: {
                    trackId: "default",
                    targetUrl
                },
                headers: {
                    cookie: `xman_t=${cookie};`
                },
                responseType: "json"
            })
                .then(r => ({ type: name, data: r.body.data }))
                .catch(() => ({ type: name, data: null }))
        );
    }

    const promoResults = await Promise.all(promoRequests);

    if (promoResults.every(pr => pr.data === null)) {
        throw new Error("❌ فشل إنشاء جميع الروابط. قد تكون الكوكيز منتهية الصلاحية.");
    }

    for (const pr of promoResults) {
        result.aff[pr.type] = pr.data;
    }

    const [preview, details] = await Promise.all([
        fetchLinkPreview(productId),
        fetchProductDetails(productId, cookie)
    ]);

    result.previews = preview;
    result.details = details;
    result.productId = productId;

    return result;
}
exports.portaffFunction = portaffFunction;
exports.idCatcher = idCatcher;
exports.fetchProductDetailsAPI = fetchProductDetailsAPI;
