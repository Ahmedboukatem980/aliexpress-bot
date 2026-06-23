const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();
const { portaffFunction, fetchProductReviews } = require('./afflink');
const { Pool } = require('pg');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const bot = new Telegraf(process.env.token);
const cookies = process.env.cook;
const Channel = process.env.Channel || '';
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

// AI setup — OpenAI primary, Gemini fallback
let openai = null;
let geminiModel = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
if (process.env.GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

const hasAI = openai || geminiModel;

async function analyzeWithAI(prompt) {
  // Try OpenAI first
  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `أنت محلل متخصص في آراء المتسوقين من AliExpress. حلل التعليقات وقدم ملخصاً مختصراً باللغة العربية يتضمن:
1. التقييم العام (ممتاز/جيد/متوسط/سيء)
2. أبرز الإيجابيات (3 نقاط كحد أقصى)
3. أبرز السلبيات (3 نقاط كحد أقصى)
4. توصيتك النهائية
استخدم الإيموجي لتحسين القراءة.`
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600
      });
      return { text: completion.choices[0].message.content, provider: 'OpenAI 🤖' };
    } catch (e) {
      console.log('OpenAI failed, trying Gemini:', e.message);
    }
  }
  // Fallback to Gemini
  if (geminiModel) {
    try {
      const fullPrompt = `أنت محلل متخصص في آراء المتسوقين من AliExpress. حلل التعليقات التالية وقدم ملخصاً مختصراً باللغة العربية يتضمن:
1. التقييم العام (ممتاز/جيد/متوسط/سيء)
2. أبرز الإيجابيات (3 نقاط كحد أقصى)
3. أبرز السلبيات (3 نقاط كحد أقصى)
4. توصيتك النهائية
استخدم الإيموجي لتحسين القراءة.

${prompt}`;
      const result = await geminiModel.generateContent(fullPrompt);
      return { text: result.response.text(), provider: 'Gemini 🟣' };
    } catch (e) {
      console.log('Gemini also failed:', e.message);
    }
  }
  return null;
}

let pool = null;
let dbConnected = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false
  });
  pool.query('SELECT 1')
    .then(() => { dbConnected = true; console.log('Database connected'); initDB(); })
    .catch(err => { console.log('Database connection failed:', err.message); dbConnected = false; });
}

let botSettings = { subCheckEnabled: true };

async function loadBotSettings() {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS bot_settings (id TEXT PRIMARY KEY, val BOOLEAN DEFAULT TRUE);`);
    const res = await pool.query("SELECT * FROM bot_settings WHERE id = 'sub_check'");
    if (res.rows.length > 0) botSettings.subCheckEnabled = res.rows[0].val;
  } catch (e) { console.log('Error loading bot settings:', e.message); }
}

async function saveBotSetting(id, val) {
  if (!pool || !dbConnected) return;
  try {
    await pool.query('INSERT INTO bot_settings (id, val) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET val = $2', [id, val]);
    if (id === 'sub_check') botSettings.subCheckEnabled = val;
  } catch (e) {}
}

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        last_active TIMESTAMPTZ DEFAULT NOW(),
        ref_by BIGINT DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS converted_links (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        converted_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS saved_products (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        product_id TEXT NOT NULL,
        title TEXT,
        image_url TEXT,
        aff_link TEXT,
        saved_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referred_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(referred_id)
      );
      CREATE TABLE IF NOT EXISTS user_points (
        user_id BIGINT PRIMARY KEY,
        points INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await loadButtonSettings();
    await loadBotSettings();
  } catch (e) { console.log('DB init error:', e.message); }
}

// ─── Add points helper ────────────────────────────────────────────────────────
async function addPoints(userId, pts) {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(`
      INSERT INTO user_points (user_id, points) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET points = user_points.points + $2, updated_at = NOW()
    `, [userId, pts]);
  } catch (e) {}
}

app.use(express.json());
app.use('/public', express.static('public'));
app.use(bot.webhookCallback('/bot'));
app.get('/', (req, res) => res.send('Bot is running!'));

async function safeSend(ctx, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.code === 403) return null;
    if (err.code === 429) return null;
    console.error('SafeSend Error:', err.message);
    return null;
  }
}

async function isUserSubscribed(userId) {
  try {
    if (!Channel) return true;
    const idChannel = Channel.replace('https://t.me/', '@');
    const member = await bot.telegram.getChatMember(idChannel, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) { return true; }
}

const mainKeyboard = (ctx) => {
  if (ctx.from.id === ADMIN_ID) {
    return Markup.keyboard([
      ['📢 إرسال رسالة', '👥 المشتركين', '📊 الإحصائيات'],
      ['⚙️ إعدادات الأزرار', '🏆 المتصدرين']
    ]).resize();
  }
  return Markup.keyboard([
    ['❤️ منتجاتي المحفوظة', '🎁 دعوة الأصدقاء'],
    ['🏆 المتصدرين']
  ]).resize();
};

let buttonSettings = {
  btn1: { text: '🛍️ لمزيد من العروض اشترك في قناتنا من هنا', url: '' },
  btn2: { text: '', url: '' },
  btn3: { text: '🔴 ملاحظة', url: '', isCallback: true }
};

async function loadButtonSettings() {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS button_settings (
        id TEXT PRIMARY KEY, btn_text TEXT, btn_url TEXT, is_callback BOOLEAN DEFAULT FALSE
      );
    `);
    const result = await pool.query('SELECT * FROM button_settings');
    result.rows.forEach(row => {
      if (buttonSettings[row.id]) {
        buttonSettings[row.id] = { text: row.btn_text, url: row.btn_url, isCallback: row.is_callback };
      }
    });
  } catch (e) {}
}

async function saveButtonSetting(id, text, url, isCallback = false) {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(
      'INSERT INTO button_settings (id, btn_text, btn_url, is_callback) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET btn_text = $2, btn_url = $3, is_callback = $4',
      [id, text, url, isCallback]
    );
    buttonSettings[id] = { text, url, isCallback };
  } catch (e) {}
}

// ─── Middleware: track users ──────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  if (ctx.from && pool && dbConnected) {
    try {
      await pool.query(
        'INSERT INTO users (user_id, username, last_active) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_active = NOW(), username = EXCLUDED.username',
        [ctx.from.id, ctx.from.username]
      );
    } catch (e) {}
  }
  return next();
});

// ─── /start ───────────────────────────────────────────────────────────────────
bot.command(['start', 'help'], async (ctx) => {
  const args = ctx.message.text.split(' ');
  const refCode = args[1] || null;

  // Handle referral
  if (refCode && refCode.startsWith('ref_') && pool && dbConnected) {
    const referrerId = parseInt(refCode.replace('ref_', ''));
    const userId = ctx.from.id;
    if (referrerId && referrerId !== userId) {
      try {
        const existing = await pool.query('SELECT id FROM referrals WHERE referred_id = $1', [userId]);
        if (existing.rows.length === 0) {
          await pool.query('INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [referrerId, userId]);
          await addPoints(referrerId, 10);
          await bot.telegram.sendMessage(referrerId, `🎉 شخص جديد انضم عبر رابط دعوتك!\n+10 نقاط أضيفت لرصيدك 🏆`).catch(() => {});
        }
      } catch (e) {}
    }
  }

  const welcomeMessage = `🛍 *أهلاً بك في بوت Zed Store Online!*\n\n🤖 مساعدك الذكي للتسوّق من AliExpress\n\n✨ *ما يقدمه البوت:*\n💰 أفضل روابط خصم لأي منتج (عملات، Bundle، تخفيضات...)\n🤖 تحليل آراء الزبائن بالذكاء الاصطناعي\n❤️ حفظ المنتجات المفضلة\n🇩🇿 تنبيه المنتجات المقيّدة في الجمارك الجزائرية\n🎁 ادعُ أصدقاءك واجمع نقاط\n\n👇 *أرسل رابط أي منتج من AliExpress للبدء!*`;

  await safeSend(ctx, () =>
    ctx.replyWithMarkdown(welcomeMessage, mainKeyboard(ctx))
  );
});

// ─── ❤️ منتجاتي المحفوظة ──────────────────────────────────────────────────────
bot.hears('❤️ منتجاتي المحفوظة', async (ctx) => {
  await showSavedProducts(ctx, ctx.from.id, 1);
});

async function showSavedProducts(ctx, userId, page = 1) {
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const perPage = 5;
    const offset = (page - 1) * perPage;
    const total = await pool.query('SELECT COUNT(*) FROM saved_products WHERE user_id = $1', [userId]);
    const totalCount = parseInt(total.rows[0].count);

    if (totalCount === 0) {
      return ctx.reply('❤️ لم تحفظ أي منتج بعد!\n\nأرسل رابط منتج وستجد زر الحفظ في الرسالة.');
    }

    const result = await pool.query(
      'SELECT * FROM saved_products WHERE user_id = $1 ORDER BY saved_at DESC LIMIT $2 OFFSET $3',
      [userId, perPage, offset]
    );

    const totalPages = Math.ceil(totalCount / perPage);
    let text = `❤️ *منتجاتي المحفوظة* (${totalCount} منتج) — صفحة ${page}/${totalPages}\n\n`;

    const buttons = [];
    result.rows.forEach((p, i) => {
      const num = offset + i + 1;
      text += `${num}. ${p.title ? p.title.substring(0, 50) : 'منتج'}\n`;
      buttons.push([
        Markup.button.callback(`🛍 ${num}. فتح الرابط`, `open_saved_${p.id}`),
        Markup.button.callback(`🗑 حذف`, `del_saved_${p.id}`)
      ]);
    });

    const navButtons = [];
    if (page > 1) navButtons.push(Markup.button.callback('⬅️ السابق', `saved_page_${page - 1}`));
    if (page < totalPages) navButtons.push(Markup.button.callback('التالي ➡️', `saved_page_${page + 1}`));
    if (navButtons.length > 0) buttons.push(navButtons);

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
  } catch (e) { ctx.reply('حدث خطأ في جلب المنتجات المحفوظة'); }
}

bot.action(/saved_page_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await showSavedProducts(ctx, ctx.from.id, parseInt(ctx.match[1]));
});

bot.action(/open_saved_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!pool || !dbConnected) return;
  try {
    const result = await pool.query('SELECT * FROM saved_products WHERE id = $1 AND user_id = $2', [ctx.match[1], ctx.from.id]);
    if (!result.rows[0]) return ctx.reply('المنتج غير موجود');
    const p = result.rows[0];
    const text = `🛍 *${p.title || 'منتج محفوظ'}*\n\n🔗 رابط الافلييت:\n${p.aff_link}`;
    if (p.image_url) {
      await ctx.replyWithPhoto({ url: p.image_url }, { caption: text, parse_mode: 'Markdown' });
    } else {
      await ctx.replyWithMarkdown(text);
    }
  } catch (e) {}
});

bot.action(/del_saved_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery('تم الحذف ✅');
  if (!pool || !dbConnected) return;
  try {
    await pool.query('DELETE FROM saved_products WHERE id = $1 AND user_id = $2', [ctx.match[1], ctx.from.id]);
    await ctx.editMessageText('🗑 تم حذف المنتج من المحفوظات.');
  } catch (e) {}
});

bot.action(/save_product_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('⏳ جاري الحفظ...');
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  const userId = ctx.from.id;
  const productId = ctx.match[1];

  try {
    const existing = await pool.query('SELECT id FROM saved_products WHERE user_id = $1 AND product_id = $2', [userId, productId]);
    if (existing.rows.length > 0) {
      return ctx.answerCbQuery('⚠️ المنتج محفوظ مسبقاً!', { show_alert: true });
    }

    // Get product info from message caption
    const caption = ctx.callbackQuery.message?.caption || '';
    const titleMatch = caption.match(/اسم المنتج:\s*(.+)/);
    const title = titleMatch ? titleMatch[1].trim() : null;
    const image = ctx.callbackQuery.message?.photo;
    const imageUrl = image ? image[image.length - 1]?.file_id : null;

    // Get best aff link (coin)
    const linkMatch = caption.match(/رابط تخفيض النقاط:\s*\n?(https?:\/\/[^\n]+)/);
    const affLink = linkMatch ? linkMatch[1].trim() : null;

    await pool.query(
      'INSERT INTO saved_products (user_id, product_id, title, image_url, aff_link) VALUES ($1, $2, $3, $4, $5)',
      [userId, productId, title, imageUrl, affLink]
    );

    await ctx.answerCbQuery('❤️ تم حفظ المنتج!', { show_alert: true });
  } catch (e) { ctx.answerCbQuery('حدث خطأ', { show_alert: true }); }
});

// ─── 🤖 AI Review Analysis ────────────────────────────────────────────────────
bot.action(/analyze_reviews_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('⏳ جاري التحليل...');

  if (!hasAI) {
    return ctx.reply('⚠️ ميزة الذكاء الاصطناعي غير مفعلة.\nأضف OPENAI_API_KEY أو GEMINI_API_KEY في إعدادات Render.');
  }

  const productId = ctx.match[1];
  const loadingMsg = await ctx.reply('🤖 جاري تحليل آراء الزبائن...\n⏳ يرجى الانتظار لحظات');

  try {
    const reviews = await fetchProductReviews(productId);

    if (!reviews || reviews.length === 0) {
      if (loadingMsg) ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
      return ctx.reply('⚠️ لم أتمكن من جلب تعليقات هذا المنتج. جرب منتجاً آخر.');
    }

    const prompt = `تعليقات المنتج:\n${reviews.join('\n---\n')}`;
    const result = await analyzeWithAI(prompt);

    if (loadingMsg) ctx.deleteMessage(loadingMsg.message_id).catch(() => {});

    if (!result) return ctx.reply('❗ حدث خطأ في جميع خدمات الذكاء الاصطناعي. حاول مرة أخرى.');

    await ctx.reply(
      `🤖 *تحليل آراء الزبائن* — ${result.provider}\n\n${result.text}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    if (loadingMsg) ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
    ctx.reply('❗ حدث خطأ أثناء تحليل الآراء');
    console.error('AI Review error:', e.message);
  }
});

// ─── 🎁 نظام الدعوة والنقاط ────────────────────────────────────────────────────
bot.hears('🎁 دعوة الأصدقاء', async (ctx) => {
  const userId = ctx.from.id;
  const refLink = `https://t.me/${ctx.botInfo.username}?start=ref_${userId}`;

  let points = 0;
  let refCount = 0;
  if (pool && dbConnected) {
    try {
      const ptRes = await pool.query('SELECT points FROM user_points WHERE user_id = $1', [userId]);
      if (ptRes.rows.length > 0) points = ptRes.rows[0].points;
      const refRes = await pool.query('SELECT COUNT(*) FROM referrals WHERE referrer_id = $1', [userId]);
      refCount = parseInt(refRes.rows[0].count);
    } catch (e) {}
  }

  const text = `🎁 *نظام الدعوة والمكافآت*\n\n` +
    `👤 رصيدك الحالي: *${points} نقطة* 🏅\n` +
    `👥 أصدقاء دعوتهم: *${refCount}*\n\n` +
    `📌 *كيف يعمل النظام؟*\n` +
    `• ادعُ صديقاً عبر رابطك الخاص\n` +
    `• عند انضمامه تحصل على *10 نقاط* 🎯\n` +
    `• كلما جمعت نقاطاً أكثر، ارتقيت في المتصدرين 🏆\n\n` +
    `🔗 *رابط دعوتك الشخصي:*\n\`${refLink}\`\n\n` +
    `شارك الرابط مع أصدقائك الآن! 👇`;

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    [Markup.button.url('📤 مشاركة الرابط', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('🛍 تعال معي على بوت Zed Store Online وحصّل أفضل الخصومات من AliExpress!')}`)]
  ]));
});

// ─── 🏆 المتصدرين ──────────────────────────────────────────────────────────────
bot.hears('🏆 المتصدرين', async (ctx) => {
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const result = await pool.query(`
      SELECT up.user_id, up.points, u.username,
             (SELECT COUNT(*) FROM referrals WHERE referrer_id = up.user_id) as ref_count
      FROM user_points up
      LEFT JOIN users u ON u.user_id = up.user_id
      ORDER BY up.points DESC
      LIMIT 10
    `);

    if (result.rows.length === 0) {
      return ctx.reply('🏆 لا يوجد متصدرون بعد! كن أول من يجمع النقاط عبر دعوة الأصدقاء 🎁');
    }

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    let text = `🏆 *لوحة المتصدرين*\n\n`;

    result.rows.forEach((row, i) => {
      const name = row.username ? `@${row.username}` : `مستخدم ${row.user_id}`;
      text += `${medals[i]} ${name} — *${row.points} نقطة* (${row.ref_count} دعوة)\n`;
    });

    const userId = ctx.from.id;
    const myRank = await pool.query(`
      SELECT rank FROM (
        SELECT user_id, RANK() OVER (ORDER BY points DESC) as rank
        FROM user_points
      ) ranked WHERE user_id = $1
    `, [userId]);

    if (myRank.rows.length > 0) {
      text += `\n📍 مرتبتك: *#${myRank.rows[0].rank}*`;
    }

    await ctx.replyWithMarkdown(text);
  } catch (e) { ctx.reply('حدث خطأ في جلب المتصدرين'); }
});

// ─── Admin handlers ────────────────────────────────────────────────────────────
bot.hears('👥 المشتركين', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const users = await pool.query('SELECT user_id, username FROM users ORDER BY joined_at DESC LIMIT 50');
    let list = '👥 قائمة بآخر 50 مشترك:\n\n';
    users.rows.forEach(u => { list += `- ${u.username ? '@' + u.username : u.user_id}\n`; });
    await ctx.reply(list, Markup.inlineKeyboard([[Markup.button.callback('📥 تحميل القائمة كاملة (CSV)', 'download_users')]]));
  } catch (e) { ctx.reply('حدث خطأ في جلب القائمة'); }
});

bot.action('download_users', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const result = await pool.query('SELECT user_id, username, joined_at FROM users ORDER BY joined_at DESC');
    let csvContent = 'User ID,Username,Joined At\n';
    result.rows.forEach(row => { csvContent += `${row.user_id},${row.username || ''},${row.joined_at.toISOString()}\n`; });
    const filePath = path.join(__dirname, 'users_list.csv');
    fs.writeFileSync(filePath, csvContent);
    await ctx.replyWithDocument({ source: filePath, filename: 'users_list.csv' });
    fs.unlinkSync(filePath);
  } catch (e) { ctx.reply('حدث خطأ أثناء تصدير القائمة'); }
});

bot.hears('📊 الإحصائيات', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const total = await pool.query('SELECT COUNT(*) FROM users');
    const newToday = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '1 day'");
    const newWeek = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '7 days'");
    const newMonth = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '30 days'");
    const activeToday = await pool.query("SELECT COUNT(*) FROM users WHERE last_active >= NOW() - INTERVAL '1 day'");
    const activeWeek = await pool.query("SELECT COUNT(*) FROM users WHERE last_active >= NOW() - INTERVAL '7 days'");
    const activeMonth = await pool.query("SELECT COUNT(*) FROM users WHERE last_active >= NOW() - INTERVAL '30 days'");
    const linksToday = await pool.query("SELECT COUNT(*) FROM converted_links WHERE converted_at >= NOW() - INTERVAL '1 day'");
    const linksWeek = await pool.query("SELECT COUNT(*) FROM converted_links WHERE converted_at >= NOW() - INTERVAL '7 days'");
    const linksMonth = await pool.query("SELECT COUNT(*) FROM converted_links WHERE converted_at >= NOW() - INTERVAL '30 days'");
    const linksTotal = await pool.query("SELECT COUNT(*) FROM converted_links");
    const totalRefs = await pool.query("SELECT COUNT(*) FROM referrals");
    const totalSaved = await pool.query("SELECT COUNT(*) FROM saved_products");

    const statsText = `📊 إحصائيات البوت:\n\n👥 المشتركين:\n├ الإجمالي: ${total.rows[0].count}\n├ جدد اليوم: ${newToday.rows[0].count}\n├ جدد الأسبوع: ${newWeek.rows[0].count}\n└ جدد الشهر: ${newMonth.rows[0].count}\n\n🟢 المستخدمين النشطين:\n├ اليوم: ${activeToday.rows[0].count}\n├ الأسبوع: ${activeWeek.rows[0].count}\n└ الشهر: ${activeMonth.rows[0].count}\n\n🔗 الروابط المحولة:\n├ الإجمالي: ${linksTotal.rows[0].count}\n├ اليوم: ${linksToday.rows[0].count}\n├ الأسبوع: ${linksWeek.rows[0].count}\n└ الشهر: ${linksMonth.rows[0].count}\n\n🎁 الدعوات: ${totalRefs.rows[0].count}\n❤️ المنتجات المحفوظة: ${totalSaved.rows[0].count}`;

    await ctx.reply(statsText);
  } catch (e) { ctx.reply('حدث خطأ في جلب الإحصائيات'); }
});

bot.hears('⚙️ إعدادات الأزرار', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const currentSettings = `⚙️ إعدادات البوت والأزرار:\n\n1️⃣ ${buttonSettings.btn1.text}\n🔗 ${buttonSettings.btn1.url || Channel || 'رابط القناة'}\n\n2️⃣ ${buttonSettings.btn2.text}\n🔗 ${buttonSettings.btn2.url || 'غير محدد'}\n\n3️⃣ ${buttonSettings.btn3.text}\n${buttonSettings.btn3.isCallback ? '📌 زر منبثق (ملاحظة)' : '🔗 ' + buttonSettings.btn3.url}\n\n📢 فحص الاشتراك: ${botSettings.subCheckEnabled ? '✅ مفعل' : '❌ معطل'}`;

  await ctx.reply(currentSettings, Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل الزر 1', 'edit_btn1')],
    [Markup.button.callback('✏️ تعديل الزر 2', 'edit_btn2')],
    [Markup.button.callback('✏️ تعديل الزر 3', 'edit_btn3')],
    [Markup.button.callback(botSettings.subCheckEnabled ? '❌ تعطيل فحص الاشتراك' : '✅ تفعيل فحص الاشتراك', 'toggle_sub_check')]
  ]));
});

bot.action('toggle_sub_check', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  const newVal = !botSettings.subCheckEnabled;
  await saveBotSetting('sub_check', newVal);
  await ctx.answerCbQuery(`تم ${newVal ? 'تفعيل' : 'تعطيل'} فحص الاشتراك`);
  const currentSettings = `⚙️ إعدادات البوت والأزرار:\n\n1️⃣ ${buttonSettings.btn1.text}\n🔗 ${buttonSettings.btn1.url || Channel || 'رابط القناة'}\n\n2️⃣ ${buttonSettings.btn2.text}\n🔗 ${buttonSettings.btn2.url || 'غير محدد'}\n\n3️⃣ ${buttonSettings.btn3.text}\n${buttonSettings.btn3.isCallback ? '📌 زر منبثق (ملاحظة)' : '🔗 ' + buttonSettings.btn3.url}\n\n📢 فحص الاشتراك: ${newVal ? '✅ مفعل' : '❌ معطل'}`;
  await ctx.editMessageText(currentSettings, Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل الزر 1', 'edit_btn1')],
    [Markup.button.callback('✏️ تعديل الزر 2', 'edit_btn2')],
    [Markup.button.callback('✏️ تعديل الزر 3', 'edit_btn3')],
    [Markup.button.callback(newVal ? '❌ تعطيل فحص الاشتراك' : '✅ تفعيل فحص الاشتراك', 'toggle_sub_check')]
  ]));
});

bot.action('edit_btn1', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  broadcastState[ctx.from.id] = 'editing_btn1';
  await ctx.reply('✏️ أرسل (النص | الرابط) للزر الأول:');
});

bot.action('edit_btn2', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  broadcastState[ctx.from.id] = 'editing_btn2';
  await ctx.reply('✏️ أرسل (النص | الرابط) للزر الثاني:');
});

bot.action('edit_btn3', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  broadcastState[ctx.from.id] = 'editing_btn3';
  await ctx.reply('✏️ أرسل (النص | الرابط) أو (النص | منبثق) للزر الثالث:');
});

let broadcastState = {};

bot.hears('📢 إرسال رسالة', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  broadcastState[ctx.from.id] = 'awaiting_message';
  await ctx.reply('📝 أرسل الرسالة التي تريد تعميمها على جميع المشتركين:', {
    reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_broadcast' }]] }
  });
});

bot.action('cancel_broadcast', async (ctx) => {
  delete broadcastState[ctx.from.id];
  await ctx.answerCbQuery('تم الإلغاء');
  await ctx.editMessageText('تم إلغاء عملية الإرسال.');
});

bot.action('note_info', async (ctx) => {
  const noteMessage = `🔴 ملاحظة:\nللحصول على أفضل الأسعار:\n📦 عروض الباندل: قم بوضع البلد الجزائر 🇩🇿\n💰 عروض العملات: قم بوضع البلد كندا 🇨🇦\n\n📌 ماتنساوش تثبيت البوت عندكم لمساعدتكم في الشراء بأرخص الأسعار`;
  await ctx.answerCbQuery(noteMessage, { show_alert: true });
});

// ─── Main text handler ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  // Handle button editing
  if (broadcastState[userId] && broadcastState[userId].startsWith('editing_btn')) {
    const btnId = broadcastState[userId].replace('editing_', '');
    delete broadcastState[userId];
    const parts = text.split('|');
    if (parts.length !== 2) return ctx.reply('❌ تنسيق غير صحيح. استخدم: النص | الرابط');
    const btnText = parts[0].trim();
    const btnUrl = parts[1].trim();
    const isCallback = btnUrl.toLowerCase() === 'منبثق';
    await saveButtonSetting(btnId, btnText, isCallback ? '' : btnUrl, isCallback);
    return ctx.reply(`✅ تم حفظ الزر بنجاح!\n\n${btnText}\n${isCallback ? '📌 زر منبثق' : '🔗 ' + btnUrl}`, mainKeyboard(ctx));
  }

  // Broadcast
  if (broadcastState[userId] === 'awaiting_message') {
    delete broadcastState[userId];
    if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
    try {
      const users = await pool.query('SELECT user_id FROM users');
      let count = 0;
      await ctx.reply(`⏳ بدأ الإرسال إلى ${users.rows.length} مستخدم...`);
      for (const row of users.rows) {
        try { await bot.telegram.sendMessage(row.user_id, text); count++; } catch (e) {}
      }
      return ctx.reply(`✅ تم الإرسال بنجاح إلى ${count} مستخدم.`);
    } catch (e) { return ctx.reply('حدث خطأ أثناء الإرسال'); }
  }

  // Subscription check
  const subscribed = botSettings.subCheckEnabled ? await isUserSubscribed(userId) : true;
  if (!subscribed) {
    if (Channel && Channel.startsWith('https://')) {
      await safeSend(ctx, () => ctx.reply('⚠️ أنت غير مشترك في القناة. يرجى الاشتراك أولًا:', {
        reply_markup: { inline_keyboard: [[{ text: 'اشترك الآن ✅', url: Channel }]] }
      }));
    } else {
      await safeSend(ctx, () => ctx.reply('⚠️ أنت غير مشترك في القناة. يرجى الاشتراك أولًا.'));
    }
    return;
  }

  if (!text.includes('aliexpress.com')) {
    return ctx.reply('🚫 الرجاء إرسال رابط من AliExpress فقط.');
  }

  const urlRegex = /(https?:\/\/[^\s]+aliexpress\.com[^\s]+)/gi;
  const match = text.match(urlRegex);
  const targetUrl = match ? match[0] : text;

  const sent = await safeSend(ctx, () => ctx.reply('⏳ جاري البحث عن أفضل العروض 🔍'));

  try {
    const coinPi = await portaffFunction(cookies, targetUrl);
    if (!coinPi?.previews?.image_url) {
      if (sent) ctx.deleteMessage(sent.message_id).catch(() => {});
      return ctx.reply('🚨 البوت يدعم فقط روابط منتجات AliExpress');
    }

    // Build caption
    let caption = `🛍️ *${coinPi.previews.title || 'منتج AliExpress'}*\n\n`;

    // ⭐ Product details
    if (coinPi.details) {
      const d = coinPi.details;
      if (d.rating) caption += `⭐️ التقييم: ${d.rating}/5\n`;
      if (d.orders) caption += `📦 الطلبات: ${d.orders}\n`;
      if (d.storeName) caption += `🏪 المتجر: ${d.storeName}\n`;
      if (d.positiveFeedback) caption += `👍 رضا المشترين: ${d.positiveFeedback}\n`;
      caption += '\n';
    }

    // 🇩🇿 Algeria restriction warning
    if (coinPi.isAlgeriaRestricted) {
      caption += `⚠️ *تنبيه جمارك الجزائر:*\n🚫 هذا المنتج قد يكون ممنوعاً أو يسبب مشاكل عند الاستيراد إلى الجزائر! تأكد قبل الشراء.\n\n`;
    }

    caption += `🛒 رابط تخفيض العملات:\n${coinPi.aff.coin}\n\n`;
    caption += `🛒 رابط تخفيض النقاط القديم:\n${coinPi.aff.point}\n\n`;
    caption += `🛒 رابط السوبر ديلز:\n${coinPi.aff.super}\n\n`;
    caption += `🛒 رابط العرض المحدود:\n${coinPi.aff.limit}\n\n`;
    caption += `🛒 رابط Bundle:\n${coinPi.aff.ther3}`;

    // Build inline buttons
    const inlineButtons = [];
    if (buttonSettings.btn1.text) {
      inlineButtons.push([{ text: buttonSettings.btn1.text, url: buttonSettings.btn1.url || Channel || 'https://t.me/channel' }]);
    }
    if (buttonSettings.btn2.text && buttonSettings.btn2.url) {
      inlineButtons.push([{ text: buttonSettings.btn2.text, url: buttonSettings.btn2.url }]);
    }

    // Save + AI Analysis buttons
    const actionButtons = [
      { text: '❤️ حفظ المنتج', callback_data: `save_product_${coinPi.productId}` }
    ];
    if (hasAI) {
      actionButtons.push({ text: '🤖 تحليل الآراء', callback_data: `analyze_reviews_${coinPi.productId}` });
    }
    inlineButtons.push(actionButtons);

    if (buttonSettings.btn3.text) {
      if (buttonSettings.btn3.isCallback) {
        inlineButtons.push([{ text: buttonSettings.btn3.text, callback_data: 'note_info' }]);
      } else if (buttonSettings.btn3.url) {
        inlineButtons.push([{ text: buttonSettings.btn3.text, url: buttonSettings.btn3.url }]);
      }
    }

    await ctx.replyWithPhoto(
      { url: coinPi.previews.image_url },
      { caption, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineButtons } }
    ).then(() => { if (sent) ctx.deleteMessage(sent.message_id).catch(() => {}); });

    // Track converted link + give points for conversion
    if (pool && dbConnected) {
      try {
        await pool.query('INSERT INTO converted_links (user_id) VALUES ($1)', [userId]);
        await addPoints(userId, 1);
      } catch (e) {}
    }
  } catch (e) {
    if (sent) ctx.deleteMessage(sent.message_id).catch(() => {});
    ctx.reply('❗ حدث خطأ أثناء معالجة الرابط');
    console.error('Processing error:', e.message);
  }
});

// ─── Daily re-engagement cron ─────────────────────────────────────────────────
cron.schedule('0 18 * * *', async () => {
  if (!pool || !dbConnected) return;
  try {
    const inactiveUsers = await pool.query("SELECT user_id FROM users WHERE last_active < NOW() - INTERVAL '3 days'");
    for (const row of inactiveUsers.rows) {
      try {
        await bot.telegram.sendMessage(row.user_id, "👋 اشتقنا لك! هل هناك منتج جديد تريد البحث عن خصومات له؟ أرسل الرابط الآن وجرب حظك مع خصومات العملات الرائعة! 💸");
        await pool.query('UPDATE users SET last_active = NOW() WHERE user_id = $1', [row.user_id]);
      } catch (e) {}
    }
  } catch (e) {}
}, { timezone: "Africa/Algiers" });

bot.catch((err, ctx) => { console.error('Bot error:', err.message); });

const PORT = process.env.PORT || 5000;
function getWebhookUrl() {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return null;
}
const WEBHOOK_URL = getWebhookUrl();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  if (!process.env.token) return;
  if (WEBHOOK_URL) {
    bot.telegram.setWebhook(`${WEBHOOK_URL}/bot`)
      .then(() => console.log(`✅ Webhook set: ${WEBHOOK_URL}/bot`))
      .catch(err => console.error('Webhook failed:', err.message));
  } else {
    bot.launch().then(() => console.log('Bot started with polling'));
  }
});
