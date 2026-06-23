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
    if (!appKey || !appSecret) return null;

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

        const result = res.body?.aliexpress_affiliate_product_detail_get_response?.resp_result?.result;
        if (!result) {
            console.log('AliExpress API no result:', JSON.stringify(res.body).substring(0, 200));
            return null;
        }

        const evaluateRate = result.evaluate_rate ? parseFloat(result.evaluate_rate) : null;
        const ratingStars = evaluateRate ? (evaluateRate / 20).toFixed(1) : null;
        const orders = result.volume != null ? parseInt(result.volume).toLocaleString() : null;

        return {
            orders,
            rating: ratingStars,
            reviews: null,
            storeFeedback: evaluateRate ? `${evaluateRate.toFixed(1)}%` : null,
            storeName: result.shop_name || null
        };
    } catch (err) {
        console.error('❌ AliExpress API error:', err.message);
        return null;
    }
}

async function fetchProductDetailsScrape(productId) {
    try {
        const res = await got(`https://www.aliexpress.com/item/${productId}.html`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            https: { rejectUnauthorized: false },
            timeout: { request: 12000 }
        });
        const html = res.body;
        let orders = null, rating = null, reviews = null, storeFeedback = null, storeName = null;

        const formattedTrade = html.match(/"formatTradeCount"\s*:\s*"([^"]+)"/);
        if (formattedTrade) orders = formattedTrade[1];
        else {
            const trade = html.match(/"tradeCount"\s*:\s*(\d+)/);
            if (trade) orders = parseInt(trade[1]).toLocaleString();
        }
        const ratingM = html.match(/"averageStar"\s*:\s*"([^"]+)"/);
        if (ratingM) rating = ratingM[1];
        const reviewsM = html.match(/"totalValidNum"\s*:\s*(\d+)/);
        if (reviewsM) reviews = parseInt(reviewsM[1]).toLocaleString();
        const feedbackM = html.match(/"positiveRate"\s*:\s*"([^"]+)"/);
        if (feedbackM) storeFeedback = feedbackM[1];
        const storeM = html.match(/"storeName"\s*:\s*"([^"]+)"/);
        if (storeM) storeName = storeM[1];

        return { orders, rating, reviews, storeFeedback, storeName };
    } catch (err) {
        console.error("❌ Scrape details error:", err.message);
        return null;
    }
}

async function fetchProductDetails(productId) {
    const apiResult = await fetchProductDetailsAPI(productId);
    if (apiResult && (apiResult.orders || apiResult.rating)) return apiResult;
    return fetchProductDetailsScrape(productId);
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
        fetchProductDetails(productId)
    ]);

    result.previews = preview;
    result.details = details;

    return result;
}
exports.portaffFunction = portaffFunction;
