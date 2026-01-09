const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();
const { portaffFunction } = require('./afflink');
const { Pool } = require('pg');
const cron = require('node-cron');

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
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='users' AND COLUMN_NAME='last_active') THEN
          ALTER TABLE users ADD COLUMN last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
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

const mainKeyboard = (ctx) => {
  if (ctx.from.id === ADMIN_ID) {
    return Markup.keyboard([
      ['📢 إرسال رسالة', '👥 المشتركين', '📊 الإحصائيات']
    ]).resize();
  }
  return Markup.removeKeyboard();
};

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

bot.command(['start', 'help'], async (ctx) => {
  const welcomeMessage = `مرحبا بك معنا، كل ما عليك الان هو إرسال لنا رابط المنتج التي تريد شرائه وسنقوم بتوفير لك أعلى نسبة خصم العملات 👌 أيضا عروض اخرى للمنتج بأسعار ممتازة،`;
  await safeSend(ctx, () =>
    ctx.reply(welcomeMessage, mainKeyboard(ctx))
  );
});

bot.hears('👥 المشتركين', async (ctx) => {
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

bot.hears('📊 الإحصائيات', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
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
    await ctx.reply(statsText);
  } catch (e) { ctx.reply('حدث خطأ في جلب الإحصائيات'); }
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

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  if (broadcastState[userId] === 'awaiting_message') {
    delete broadcastState[userId];
    if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
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
    } catch (e) { return ctx.reply('حدث خطأ أثناء الإرسال'); }
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
  if (!text.includes('aliexpress.com')) return;
  
  // Send the "Hourglass" GIF Animation (using a better high-quality hourglass gif)
  const hourglassGif = 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHpob2Y3MWRzMTQ3Nnc0MGRpNm02dGZ5OWV6b3lsdmd0eHljb2ZkdyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/VvM5oN84S603O/giphy.gif';
  const sent = await safeSend(ctx, () => ctx.sendAnimation(hourglassGif, { caption: '⏳ جاري البحث عن أفضل العروض 🔍' }));
  
  try {
    const coinPi = await portaffFunction(cookies, text);
    if (!coinPi?.previews?.image_url) {
      if (sent) ctx.deleteMessage(sent.message_id).catch(() => {});
      return ctx.reply('🚨 البوت يدعم فقط روابط منتجات AliExpress');
    }
    await ctx.replyWithPhoto(
      { url: coinPi.previews.image_url },
      {
        caption: `${coinPi.previews.title}\n\n<b>🎉 روابط التخفيض</b>\n\n🔹 تخفيض العملات:\n${coinPi.aff.coin}\n\n🔹 العملات:\n${coinPi.aff.point}\n\n🔹 السوبر ديلز:\n${coinPi.aff.super}\n\n🔹 العرض المحدود:\n${coinPi.aff.limit}\n\n🔹 Bundle deals:\n${coinPi.aff.ther3}\n\n⚠️ غيّر البلد إلى كندا 🇨🇦`,
        parse_mode: 'HTML',
      }
    ).then(() => { if (sent) ctx.deleteMessage(sent.message_id).catch(() => {}); });
  } catch (e) { 
    if (sent) ctx.deleteMessage(sent.message_id).catch(() => {});
    ctx.reply('❗ حدث خطأ أثناء معالجة الرابط'); 
  }
});

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
