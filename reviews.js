const got = require("got");
const OpenAI = require("openai");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

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
  if (!openai) return null;

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

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: 350
    });

    const summary = completion.choices?.[0]?.message?.content?.trim();
    if (!summary) return null;

    return { summary, stats };
  } catch (err) {
    console.error("❌ OpenAI summarize error:", err.message);
    return null;
  }
}

module.exports = { fetchReviews, summarizeReviews };
