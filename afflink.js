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
    const sortedKeys = Object.keys(params).sort();
    let signStr = appSecret;
    for (const key of sortedKeys) signStr += key + params[key];
    signStr += appSecret;
    return crypto.createHmac('sha256', appSecret).update(signStr).digest('hex').toUpperCase();
}

async function fetchProductDetailsAPI(productId) {
    const appKey = process.env.ALI_APP_KEY;
    const appSecret = process.env.ALI_APP_SECRET;
    if (!appKey || !appSecret) {
        console.log('No ALI_APP_KEY/ALI_APP_SECRET, skipping API');
        return null;
    }

    // Try DS API first
    try {
        const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const params = {
            app_key: appKey,
            method: 'aliexpress.ds.product.get',
            timestamp: ts,
            format: 'json',
            v: '2.0',
            sign_method: 'hmac-sha256',
            product_id: productId.toString(),
            local_country: 'DZ',
            local_language: 'en'
        };
        params.sign = buildAliSign(params, appSecret);

        const res = await got.post('https://api-sg.aliexpress.com/sync', {
            form: params,
            responseType: 'json',
            timeout: { request: 10000 }
        });

        const dsBody = res.body;
        console.log('DS API response:', JSON.stringify(dsBody).substring(0, 400));
        const dsResult = dsBody?.aliexpress_ds_product_get_response?.result;

        if (dsResult) {
            const tradeStr = dsResult.product_sale_info?.trade_count
                || dsResult.trade_count
                || dsResult.lastest_volume;
            const orders = tradeStr ? parseInt(tradeStr).toLocaleString() : null;
            const rating = dsResult.average_star
                || dsResult.averageStar
                || dsResult.ae_item_properties?.averageStar
                || null;
            const reviews = dsResult.evaluate_info?.total_valid_num
                ? parseInt(dsResult.evaluate_info.total_valid_num).toLocaleString()
                : null;
            const storeName = dsResult.store_info?.store_name || dsResult.store_name || null;

            if (orders || rating) {
                return { orders, rating, reviews, storeFeedback: null, storeName };
            }
        }
    } catch (err) {
        console.error('❌ DS API error:', err.message);
    }

    // Try Affiliate API as fallback
    try {
        const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const params = {
            app_key: appKey,
            method: 'aliexpress.affiliate.product.detail.get',
            timestamp: ts,
            format: 'json',
            v: '2.0',
            sign_method: 'hmac-sha256',
            product_id: productId.toString(),
            tracking_id: 'default'
        };
        params.sign = buildAliSign(params, appSecret);

        const res = await got.post('https://api-sg.aliexpress.com/sync', {
            form: params,
            responseType: 'json',
            timeout: { request: 10000 }
        });

        const affBody = res.body;
        console.log('Affiliate API response:', JSON.stringify(affBody).substring(0, 400));

        // Handle different response structures
        const respResult = affBody?.aliexpress_affiliate_product_detail_get_response?.resp_result;
        const productData = respResult?.result?.products?.product?.[0]
            || respResult?.result?.product_list?.product?.[0]
            || respResult?.result;

        if (!productData) return null;

        const evaluateRate = productData.evaluate_rate
            ? parseFloat(productData.evaluate_rate)
            : null;
        const volume = productData.volume ?? productData.sales_volume ?? null;
        const orders = volume != null ? parseInt(volume).toLocaleString() : null;
        const starRating = productData.star_rating
            || (evaluateRate ? (evaluateRate / 20).toFixed(1) : null);

        return {
            orders,
            rating: starRating,
            reviews: null,
            storeFeedback: evaluateRate ? `${evaluateRate.toFixed(1)}%` : null,
            storeName: productData.shop_name || productData.store_name || null
        };
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

    return result;
}
exports.portaffFunction = portaffFunction;
