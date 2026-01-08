const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();
const { portaffFunction } = require('./afflink');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.token);
const cookies = process.env.cook;
const Channel = process.env.Channel || '';
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

let pool = null;
let dbConnected = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false
  });
  
  pool.query('SELECT 1')
    .then(() => {
      dbConnected = true;
      console.log('Database connected');
      initDB();
    })
    .catch(err => {
      console.log('Database connection failed, running without DB:', err.message);
      dbConnected = false;
    });
}

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.log('DB init error:', e.message);
  }
}

app.use(express.json());
app.use(bot.webhookCallback('/bot'));

app.get('/', (req, res) => res.send('Bot is running!'));

async function safeSend(ctx, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 403) {
      console.log(`User ${ctx.chat?.id} blocked the bot`);
      return null;
    }
    console.error(err);
    return null;
  }
}

async function isUserSubscribed(userId) {
  try {
    if (!Channel) return true;
    const idChannel = Channel.replace('https://t.me/', '@');
    const member = await bot.telegram.getChatMember(idChannel, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return true;
  }
}

// Updated main keyboard to match the layout in the screenshot using existing buttons
const mainKeyboard = (ctx) => {
  let buttons = [];
  
  // Custom buttons for all users (Placeholder text based on original buttons)
  buttons.push(['🏠 القائمة الرئيسية', '📢 نشر عرض']);
  
  // Admin specific buttons
  if (ctx.from.id === ADMIN_ID) {
    buttons.push(['📊 الإحصائيات', '📢 إرسال رسالة']);
    buttons.push(['👥 قائمة المشتركين', '🛠️ لوحة التحكم']);
  }
  
  return Markup.keyboard(buttons).resize();
};

bot.use(async (ctx, next) => {
  if (ctx.from && pool && dbConnected) {
    try {
      await pool.query(
        'INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
        [ctx.from.id, ctx.from.username]
      );
    } catch (e) {}
  }
  return next();
});

bot.command(['start', 'help'], async (ctx) => {
  const welcomeMessage = `مرحبا بك معنا، كل ما عليك الان هو إرسال لنا رابط المنتج التي تريد شرائه وسنقوم بتوفير لك أعلى نسبة خصم العملات 👌 أيضا عروض اخرى للمنتج بأسعار ممتازة،`;

  let inlineKeyboard = [];
  if (Channel && Channel.startsWith('https://')) {
    inlineKeyboard.push([{ text: 'اشترك في القناة 📢', url: Channel }]);
  }

  await safeSend(ctx, () =>
    ctx.reply(welcomeMessage, mainKeyboard(ctx))
  );
  
  if (inlineKeyboard.length > 0) {
    await safeSend(ctx, () =>
      ctx.reply('روابط إضافية:', {
        reply_markup: { inline_keyboard: inlineKeyboard }
      })
    );
  }
});

bot.hears('🏠 القائمة الرئيسية', async (ctx) => {
  await ctx.reply('مرحباً بك في القائمة الرئيسية!', mainKeyboard(ctx));
});

bot.hears('📢 نشر عرض', (ctx) => ctx.reply('ميزة نشر العرض قيد التطوير.'));

bot.hears('📊 الإحصائيات', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const total = await pool.query('SELECT COUNT(*) FROM users');
    const today = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '1 day'");
    const week = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '7 days'");
    const month = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '30 days'");
    const statsText = `📊 إحصائيات البوت:\n👥 إجمالي المشتركين: ${total.rows[0].count}\n📅 مشتركين اليوم: ${today.rows[0].count}\n🗓️ مشتركين الأسبوع: ${week.rows[0].count}\n🌙 مشتركين الشهر: ${month.rows[0].count}`;
    await ctx.reply(statsText);
  } catch (e) { ctx.reply('حدث خطأ في جلب الإحصائيات'); }
});

bot.hears('📢 إرسال رسالة', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  broadcastState[ctx.from.id] = 'awaiting_message';
  await ctx.reply('📝 أرسل الرسالة التي تريد تعميمها على جميع المشتركين:', {
    reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_panel' }]] }
  });
});

bot.hears('👥 قائمة المشتركين', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    const users = await pool.query('SELECT user_id, username FROM users ORDER BY joined_at DESC LIMIT 50');
    let list = '👥 قائمة بآخر 50 مشترك:\n\n';
    users.rows.forEach(u => {
      list += `- ${u.username ? '@' + u.username : u.user_id}\n`;
    });
    await ctx.reply(list);
  } catch (e) { ctx.reply('حدث خطأ في جلب القائمة'); }
});

bot.hears('🛠️ لوحة التحكم', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.reply('🛠️ لوحة التحكم الخاصة بالمسؤول:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 الإحصائيات', callback_data: 'stats' }],
        [{ text: '📢 إرسال رسالة للمشتركين', callback_data: 'broadcast' }],
        [{ text: '👥 قائمة المشتركين', callback_data: 'user_list' }]
      ]
    }
  });
});

bot.action('admin_panel', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  await ctx.editMessageText('🛠️ لوحة التحكم الخاصة بالمسؤول:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 الإحصائيات', callback_data: 'stats' }],
        [{ text: '📢 إرسال رسالة للمشتركين', callback_data: 'broadcast' }],
        [{ text: '👥 قائمة المشتركين', callback_data: 'user_list' }]
      ]
    }
  });
});

bot.action('stats', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  
  if (!pool || !dbConnected) {
    return ctx.editMessageText('قاعدة البيانات غير متصلة', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
    });
  }

  try {
    const total = await pool.query('SELECT COUNT(*) FROM users');
    const today = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '1 day'");
    const week = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '7 days'");
    const month = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '30 days'");

    const statsText = `📊 إحصائيات البوت:
👥 إجمالي المشتركين: ${total.rows[0].count}
📅 مشتركين اليوم: ${today.rows[0].count}
🗓️ مشتركين الأسبوع: ${week.rows[0].count}
🌙 مشتركين الشهر: ${month.rows[0].count}`;

    await ctx.editMessageText(statsText, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
    });
  } catch (e) {
    await ctx.editMessageText('حدث خطأ في جلب الإحصائيات', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
    });
  }
});

let broadcastState = {};

bot.action('broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  broadcastState[ctx.from.id] = 'awaiting_message';
  await ctx.editMessageText('📝 أرسل الرسالة التي تريد تعميمها على جميع المشتركين:', {
    reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_panel' }]] }
  });
});

bot.action('user_list', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  
  if (!pool || !dbConnected) {
    return ctx.editMessageText('قاعدة البيانات غير متصلة', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
    });
  }

  try {
    const users = await pool.query('SELECT user_id, username FROM users ORDER BY joined_at DESC LIMIT 50');
    let list = '👥 قائمة بآخر 50 مشترك:\n\n';
    users.rows.forEach(u => {
      list += `- ${u.username ? '@' + u.username : u.user_id}\n`;
    });
    await ctx.editMessageText(list, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
    });
  } catch (e) {
    await ctx.editMessageText('حدث خطأ في جلب القائمة', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
    });
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  if (broadcastState[userId] === 'awaiting_message') {
    delete broadcastState[userId];
    
    if (!pool || !dbConnected) {
      return ctx.reply('قاعدة البيانات غير متصلة');
    }

    try {
      const users = await pool.query('SELECT user_id FROM users');
      let count = 0;
      await ctx.reply(`⏳ بدأ الإرسال إلى ${users.rows.length} مستخدم...`);
      for (const row of users.rows) {
        try {
          await bot.telegram.sendMessage(row.user_id, text);
          count++;
        } catch (e) {}
      }
      return ctx.reply(`✅ تم الإرسال بنجاح إلى ${count} مستخدم.`);
    } catch (e) {
      return ctx.reply('حدث خطأ أثناء الإرسال');
    }
  }

  const subscribed = await isUserSubscribed(userId);
  if (!subscribed) {
    if (Channel && Channel.startsWith('https://')) {
      await safeSend(ctx, () =>
        ctx.reply('⚠️ أنت غير مشترك في القناة. يرجى الاشتراك أولًا:', {
          reply_markup: { inline_keyboard: [[{ text: 'اشترك الآن ✅', url: Channel }]] }
        })
      );
    } else {
      await safeSend(ctx, () => ctx.reply('⚠️ أنت غير مشترك في القناة. يرجى الاشتراك أولًا.'));
    }
    return;
  }

  if (!text.includes('aliexpress.com')) {
    return;
  }

  const sent = await safeSend(ctx, () => ctx.reply('⏳ جاري البحث عن أفضل العروض 🔍'));
  try {
    const coinPi = await portaffFunction(cookies, text);
    if (!coinPi?.previews?.image_url) {
      return ctx.reply('🚨 البوت يدعم فقط روابط منتجات AliExpress');
    }
    await ctx.replyWithPhoto(
      { url: coinPi.previews.image_url },
      {
        caption: `${coinPi.previews.title}\n\n<b>🎉 روابط التخفيض</b>\n\n🔹 تخفيض العملات:\n${coinPi.aff.coin}\n\n🔹 العملات:\n${coinPi.aff.point}\n\n🔹 السوبر ديلز:\n${coinPi.aff.super}\n\n🔹 العرض المحدود:\n${coinPi.aff.limit}\n\n🔹 Bundle deals:\n${coinPi.aff.ther3}\n\n⚠️ غيّر البلد إلى كندا 🇨🇦`,
        parse_mode: 'HTML',
      }
    ).then(() => {
      if (sent) ctx.deleteMessage(sent.message_id).catch(() => {});
    });
  } catch (e) {
    ctx.reply('❗ حدث خطأ أثناء معالجة الرابط');
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
});

const PORT = process.env.PORT || 5000;

function getWebhookUrl() {
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return null;
}

const WEBHOOK_URL = getWebhookUrl();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  
  if (!process.env.token) {
    console.log('Missing Telegram token');
    return;
  }
  
  if (WEBHOOK_URL) {
    bot.telegram.setWebhook(`${WEBHOOK_URL}/bot`)
      .then(() => console.log(`✅ Webhook set: ${WEBHOOK_URL}/bot`))
      .catch(err => console.error('Webhook failed:', err.message));
  } else {
    console.log('No webhook URL, starting polling...');
    bot.launch().then(() => console.log('Bot started with polling'));
  }
});
