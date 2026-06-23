const got = require("got");

const GEMINI_MODEL = "gemini-2.0-flash";

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  try {
    const res = await got.post(url, {
      searchParams: { key: apiKey },
      json: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 400 }
      },
      responseType: "json",
      timeout: { request: 20000 }
    });

    const text = res.body?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : null;
  } catch (err) {
    const detail = err.response?.body ? JSON.stringify(err.response.body) : err.message;
    console.error("❌ Gemini API error:", detail);
    return null;
  }
}

async function fetchReviews(productId, pageSize = 20) {
  const url = `https://feedback.aliexpress.com/pc/searchEvaluation.do`;
  try {
    const res = await got(url, {
      searchParams: {
        productId,
        lang: "en_US",
        country: "US",
        page: 1,
        pageSize,
        filter: "all",
        sort: "complex_default"
      },
      responseType: "json",
      timeout: { request: 15000 }
    });

    const data = res.body?.data || {};
    const list = data.evaViewList || [];
    const stat = data.productEvaluationStatistic || {};

    const reviews = list
      .map(r => ({
        country: r.buyerCountry || "",
        stars: typeof r.buyerEval === "number" ? Math.round(r.buyerEval / 20) : null,
        text: (r.buyerProductFeedBack || "").trim(),
        sku: r.skuInfo || "",
        suggestion: r.samePurchaseSuggestion || ""
      }))
      .filter(r => r.text || r.stars);

    return {
      reviews,
      stats: {
        avgStar: stat.evarageStar || 0,
        total: stat.totalNum || 0,
        positiveRate: stat.positiveRate || 0,
        negativeNum: stat.negativeNum || 0,
        fiveStarRate: stat.fiveStarRate || 0
      }
    };
  } catch (err) {
    console.error("❌ Reviews fetch error:", err.message);
    return null;
  }
}

async function summarizeReviews(productId) {
  if (!process.env.GEMINI_API_KEY) return null;

  const data = await fetchReviews(productId);
  if (!data) return null;

  const { reviews, stats } = data;

  if (stats.total === 0 && reviews.length === 0) {
    return { noReviews: true };
  }

  const reviewsWithText = reviews.filter(r => r.text);

  const reviewsText = reviewsWithText
    .slice(0, 15)
    .map(r => `- (${r.stars || "?"}⭐ ${r.country}) ${r.text}`)
    .join("\n");

  const statsLine = `متوسط التقييم: ${stats.avgStar}/5 | عدد التقييمات: ${stats.total} | نسبة الإيجابي: ${stats.positiveRate}%`;

  const prompt = `أنت مساعد تسوق ذكي. لخّص آراء المشترين عن منتج من AliExpress بالعربية الفصحى البسيطة، بشكل موجز ومفيد لمشترٍ جزائري.

${statsLine}

${reviewsText ? `عينة من تعليقات المشترين:\n${reviewsText}` : "لا توجد تعليقات نصية، اعتمد على الإحصائيات فقط."}

اكتب ملخصاً منظماً يحتوي على:
✅ الإيجابيات (نقطتان أو ثلاث)
⚠️ السلبيات أو الملاحظات (إن وُجدت)
🎯 خلاصة: هل ينصح بالشراء؟

اجعل الرد قصيراً (لا يتجاوز 6 أسطر) وواضحاً وصادقاً. لا تخترع معلومات غير موجودة في البيانات.`;

  const summary = await callGemini(prompt);
  if (!summary) return null;

  return { summary, stats };
}

module.exports = { fetchReviews, summarizeReviews };
