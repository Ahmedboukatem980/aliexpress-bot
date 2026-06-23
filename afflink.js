const got = require("got");
const { URL } = require("url");

async function getFinalRedirect(url) {
    try {
        const response = await got(url, {
            followRedirect: false,
            https: { rejectUnauthorized: false }
        });
        if (response.headers.location) return response.headers.location;
        return url;
    } catch (err) {
        return url;
    }
}

function extractProductId(url) {
    try {
        const u = new URL(url);
        if (u.searchParams.has("productIds")) return u.searchParams.get("productIds");
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
    if (/^\d+$/.test(input)) return { id: input };
    if (!input.startsWith("http")) input = "https://" + input;
    let finalUrl = await getFinalRedirect(input);
    finalUrl = await getFinalRedirect(finalUrl);
    const id = extractProductId(finalUrl);
    return { id, finalUrl };
}

async function fetchLinkPreview(productId) {
    try {
        const url = "https://linkpreview.xyz/api/get-meta-tags";
        const res = await got(url, {
            searchParams: { url: `https://vi.aliexpress.com/item/${productId}.html` },
            responseType: "json"
        });
        return {
            title: res.body.title || "",
            image_url: res.body.image || null
        };
    } catch (err) {
        return null;
    }
}

async function fetchProductDetails(productId) {
    try {
        const res = await got(`https://www.aliexpress.com/item/${productId}.html`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: { request: 10000 },
            https: { rejectUnauthorized: false }
        });

        const html = res.body;

        // Extract rating
        let rating = null;
        const ratingMatch = html.match(/"averageStartRating"\s*:\s*"?([\d.]+)"?/) ||
                           html.match(/star_rating['":\s]+([\d.]+)/) ||
                           html.match(/"storeRating['":\s]+([\d.]+)/);
        if (ratingMatch) rating = parseFloat(ratingMatch[1]);

        // Extract orders/sold count
        let orders = null;
        const ordersMatch = html.match(/"tradeDesc"\s*:\s*"([^"]+)"/) ||
                           html.match(/(\d[\d,]+)\s*sold/) ||
                           html.match(/"soldCount"\s*:\s*(\d+)/);
        if (ordersMatch) orders = ordersMatch[1];

        // Extract store name
        let storeName = null;
        const storeMatch = html.match(/"storeName"\s*:\s*"([^"]+)"/) ||
                          html.match(/"sellerInfo".*?"storeName"\s*:\s*"([^"]+)"/);
        if (storeMatch) storeName = storeMatch[1];

        // Extract store rating / positive feedback
        let positiveFeedback = null;
        const feedbackMatch = html.match(/"positiveRate"\s*:\s*"?([\d.]+%?)"?/) ||
                             html.match(/positive_feedback['":\s]+([\d.]+)/);
        if (feedbackMatch) positiveFeedback = feedbackMatch[1];

        return { rating, orders, storeName, positiveFeedback };
    } catch (err) {
        return null;
    }
}

async function fetchProductReviews(productId) {
    try {
        const res = await got('https://feedback.aliexpress.com/display/productEvaluation.htm', {
            searchParams: {
                productId,
                ownerMemberId: '',
                companyId: '',
                memberType: 'seller',
                startValidDate: '',
                i18n: 'true',
                page: 1,
                pageSize: 10
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `https://www.aliexpress.com/item/${productId}.html`
            },
            timeout: { request: 10000 },
            https: { rejectUnauthorized: false }
        });

        const html = res.body;
        const reviewMatches = html.match(/class="feedback-item-content"[^>]*>([\s\S]*?)<\/div>/g) || [];
        const reviews = reviewMatches
            .map(m => m.replace(/<[^>]+>/g, '').trim())
            .filter(r => r.length > 10)
            .slice(0, 10);

        return reviews;
    } catch (err) {
        return [];
    }
}

// Algeria restricted products keywords
const ALGERIA_RESTRICTED_KEYWORDS = [
    'drone', 'طائرة بدون طيار', 'walkie talkie', 'لاسلكي', 'radio transmitter',
    'jammer', 'مشوش', 'night vision', 'رؤية ليلية', 'tactical', 'تكتيكي',
    'suppressor', 'silencer', 'weapon', 'سلاح', 'ammunition', 'ذخيرة',
    'spy camera', 'كاميرا تجسس', 'hidden camera', 'كاميرا مخفية',
    'cbd', 'kratom', 'vape', 'سيجارة إلكترونية', 'e-cigarette',
    'laser pointer', 'ليزر قوي', 'high power laser',
    'satellite', 'ساتلايت', 'frequency scanner'
];

function checkAlgeriaRestricted(title) {
    if (!title) return false;
    const lowerTitle = title.toLowerCase();
    return ALGERIA_RESTRICTED_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
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

    let result = { aff: {}, previews: {}, details: null };
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
                searchParams: { trackId: "default", targetUrl },
                headers: { cookie: `xman_t=${cookie};` },
                responseType: "json"
            })
                .then(r => ({ type: name, data: r.body.data }))
                .catch(() => ({ type: name, data: null }))
        );
    }

    const [promoResults, previewData, detailsData] = await Promise.all([
        Promise.all(promoRequests),
        fetchLinkPreview(productId),
        fetchProductDetails(productId)
    ]);

    if (promoResults.every(pr => pr.data === null)) {
        throw new Error("❌ فشل إنشاء جميع الروابط. قد تكون الكوكيز منتهية الصلاحية.");
    }

    for (const pr of promoResults) {
        result.aff[pr.type] = pr.data;
    }

    result.previews = previewData;
    result.details = detailsData;
    result.productId = productId;
    result.isAlgeriaRestricted = checkAlgeriaRestricted(previewData?.title);

    return result;
}

exports.portaffFunction = portaffFunction;
exports.fetchProductReviews = fetchProductReviews;
exports.checkAlgeriaRestricted = checkAlgeriaRestricted;
