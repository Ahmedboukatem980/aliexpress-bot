const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();
const { portaffFunction } = require('./afflink');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.token);
const cookies = process.env.cook;
const Channel = process.env.Channel || '';
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      username TEXT,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
initDB().catch(console.error);

app.use(express.json());
app.use(bot.webhookCallback('/bot'));

app.get('/', (req, res) => res.sendStatus(200));

async function safeSend(ctx, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 403) {
      console.log(`User ${ctx.chat?.id} blocked the bot`);
      return null;
    } else {
      console.error(err);
      throw err;
    }
  }
}

async function isUserSubscribed(userId) {
  try {
    const idChannel = Channel.replace('https://t.me/', '@');
    const member = await bot.telegram.getChatMember(idChannel, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

bot.use(async (ctx, next) => {
  if (ctx.from) {
    await pool.query(
      'INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [ctx.from.id, ctx.from.username]
    );
  }
  return next();
});

bot.command(['start', 'help'], async (ctx) => {
  const welcomeMessage = `مرحبا بك معنا، كل ما عليك الان هو إرسال لنا رابط المنتج التي تريد شرائه وسنقوم بتوفير لك أعلى نسبة خصم العملات 👌 أيضا عروض اخرى للمنتج بأسعار ممتازة،`;

  let keyboard = [];
  if (Channel && Channel.startsWith('https://')) {
    keyboard.push([{ text: 'اشترك في القناة 📢', url: Channel }]);
  }

  if (ctx.from.id === ADMIN_ID) {
    keyboard.push([{ text: 'لوحة التحكم 🛠️', callback_data: 'admin_panel' }]);
  }

  await safeSend(ctx, () =>
    ctx.reply(welcomeMessage, {
      reply_markup: { inline_keyboard: keyboard }
    })
  );
});

bot.action('admin_panel', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
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
  if (ctx.from.id !== ADMIN_ID) return;
  const total = await pool.query('SELECT COUNT(*) FROM users');
  const today = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '1 day'");
  const week = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '7 days'");
  const month = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '30 days'");

  const statsText = `
📊 إحصائيات البوت:
👥 إجمالي المشتركين: ${total.rows[0].count}
📅 مشتركين اليوم: ${today.rows[0].count}
🗓️ مشتركين الأسبوع: ${week.rows[0].count}
🌙 مشتركين الشهر: ${month.rows[0].count}
`;
  await ctx.editMessageText(statsText, {
    reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
  });
});

let broadcastState = {};

bot.action('broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  broadcastState[ctx.from.id] = 'awaiting_message';
  await ctx.editMessageText('📝 أرسل الرسالة التي تريد تعميمها على جميع المشتركين:', {
    reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_panel' }]] }
  });
});

bot.action('user_list', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const users = await pool.query('SELECT user_id, username FROM users LIMIT 50');
  let list = '👥 قائمة بآخر 50 مشترك:\n\n';
  users.rows.forEach(u => {
    list += `- ${u.username ? '@' + u.username : u.user_id}\n`;
  });
  await ctx.editMessageText(list, {
    reply_markup: { inline_keyboard: [[{ text: '🔙 عودة', callback_data: 'admin_panel' }]] }
  });
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  if (broadcastState[userId] === 'awaiting_message') {
    delete broadcastState[userId];
    const users = await pool.query('SELECT user_id FROM users');
    let count = 0;
    ctx.reply(`⏳ بدأ الإرسال إلى ${users.rows.length} مستخدم...`);
    for (const row of users.rows) {
      try {
        await bot.telegram.sendMessage(row.user_id, text);
        count++;
      } catch (e) {}
    }
    return ctx.reply(`✅ تم الإرسال بنجاح إلى ${count} مستخدم.`);
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
    if (userId !== ADMIN_ID) {
      await safeSend(ctx, () => ctx.reply('🚫 الرجاء إرسال رابط من AliExpress فقط.'));
    }
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
    ).then(() => ctx.deleteMessage(sent.message_id));
  } catch (e) {
    ctx.reply('❗ حدث خطأ أثناء معالجة الرابط');
  }
});

const PORT = process.env.PORT || 5000;

function getWebhookUrl() {
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  if (process.env.WEBHOOK_URL) {
    return process.env.WEBHOOK_URL;
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
      .then(() => console.log(`Webhook set: ${WEBHOOK_URL}/bot`))
      .catch(err => console.error('Webhook failed:', err.message));
  } else {
    console.log('No webhook URL configured');
  }
});
