const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();
const { portaffFunction } = require('./afflink');
const { Pool } = require('pg');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.token);
const cookies = process.env.cook;
const Channel = process.env.Channel || '';
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

let pool = null;
let dbConnected = false;

if (process.env.DATABASE_URL) {
  const isLocalDB = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalDB ? false : { rejectUnauthorized: false }
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

let botSettings = {
  subCheckEnabled: true
};

async function loadBotSettings() {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id TEXT PRIMARY KEY,
        val BOOLEAN DEFAULT TRUE
      );
    `);
    const res = await pool.query('SELECT * FROM bot_settings WHERE id = \'sub_check\'');
    if (res.rows.length > 0) {
      botSettings.subCheckEnabled = res.rows[0].val;
    }
  } catch (e) { console.log('Error loading bot settings:', e.message); }
}

async function saveBotSetting(id, val) {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(
      'INSERT INTO bot_settings (id, val) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET val = $2',
      [id, val]
    );
    if (id === 'sub_check') botSettings.subCheckEnabled = val;
  } catch (e) { console.log('Error saving bot setting:', e.message); }
}

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        last_active TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS converted_links (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        converted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await loadButtonSettings();
    await loadBotSettings();
    console.log('Database tables ready');
  } catch (e) {
    console.log('DB init error:', e.message);
  }
}

app.use(express.json());
app.use('/public', express.static('public'));
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
    if (err.code === 429) {
      console.log(`Rate limited, waiting...`);
      return null;
    }
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
  } catch (e) {
    return true;
  }
}

const mainKeyboard = (ctx) => {
  if (ctx.from.id === ADMIN_ID) {
    return Markup.keyboard([
      ['📢 إرسال رسالة', '👥 المشتركين', '📊 الإحصائيات'],
      ['⚙️ إعدادات الأزرار']
    ]).resize();
  }
  return Markup.removeKeyboard();
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
        id TEXT PRIMARY KEY,
        btn_text TEXT,
        btn_url TEXT,
        is_callback BOOLEAN DEFAULT FALSE
      );
    `);
    const result = await pool.query('SELECT * FROM button_settings');
    result.rows.forEach(row => {
      if (buttonSettings[row.id]) {
        buttonSettings[row.id] = { text: row.btn_text, url: row.btn_url, isCallback: row.is_callback };
      }
    });
  } catch (e) { console.log('Error loading button settings:', e.message); }
}

async function saveButtonSetting(id, text, url, isCallback = false) {
  if (!pool || !dbConnected) return;
  try {
    await pool.query(
      'INSERT INTO button_settings (id, btn_text, btn_url, is_callback) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET btn_text = $2, btn_url = $3, is_callback = $4',
      [id, text, url, isCallback]
    );
    buttonSettings[id] = { text, url, isCallback };
  } catch (e) { console.log('Error saving button setting:', e.message); }
}

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
    
    await ctx.reply(list, Markup.inlineKeyboard([
      [Markup.button.callback('📥 تحميل القائمة كاملة (CSV)', 'download_users')]
    ]));
  } catch (e) { ctx.reply('حدث خطأ في جلب القائمة'); }
});

bot.action('download_users', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('غير مصرح');
  await ctx.answerCbQuery();
  
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  
  try {
    const result = await pool.query('SELECT user_id, username, joined_at FROM users ORDER BY joined_at DESC');
    let csvContent = 'User ID,Username,Joined At\n';
    result.rows.forEach(row => {
      csvContent += `${row.user_id},${row.username || ''},${row.joined_at.toISOString()}\n`;
    });
    
    const filePath = path.join(__dirname, 'users_list.csv');
    fs.writeFileSync(filePath, csvContent);
    
    await ctx.replyWithDocument({ source: filePath, filename: 'users_list.csv' });
    fs.unlinkSync(filePath);
  } catch (e) {
    console.error(e);
    ctx.reply('حدث خطأ أثناء تصدير القائمة');
  }
});

bot.hears('📊 الإحصائيات', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  if (!pool || !dbConnected) return ctx.reply('قاعدة البيانات غير متصلة');
  try {
    // Subscriber stats
    const total = await pool.query('SELECT COUNT(*) FROM users');
    const newToday = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '1 day'");
    const newWeek = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '7 days'");
    const newMonth = await pool.query("SELECT COUNT(*) FROM users WHERE joined_at >= NOW() - INTERVAL '30 days'");
    
    // Active users stats
    const activeToday = await pool.query("SELECT COUNT(*) FROM users WHERE last_active >= NOW() - INTERVAL '1 day'");
    const activeWeek = await pool.query("SELECT COUNT(*) FROM users WHERE last_active >= NOW() - INTERVAL '7 days'");
    const activeMonth = await pool.query("SELECT COUNT(*) FROM users WHERE last_active >= NOW() - INTERVAL '30 days'");
    
    // Converted links stats
    const linksToday = await pool.query("SELECT COUNT(*) FROM converted_links WHERE converted_at >= NOW() - INTERVAL '1 day'");
    const linksWeek = await pool.query("SELECT COUNT(*) FROM converted_links WHERE converted_at >= NOW() - INTERVAL '7 days'");
    const linksMonth = await pool.query("SELECT COUNT(*) FROM converted_links WHERE converted_at >= NOW() - INTERVAL '30 days'");
    const linksTotal = await pool.query("SELECT COUNT(*) FROM converted_links");
    
    const statsText = `📊 إحصائيات البوت:

👥 المشتركين:
├ الإجمالي: ${total.rows[0].count}
├ جدد اليوم: ${newToday.rows[0].count}
├ جدد الأسبوع: ${newWeek.rows[0].count}
└ جدد الشهر: ${newMonth.rows[0].count}

🟢 المستخدمين النشطين:
├ اليوم: ${activeToday.rows[0].count}
├ الأسبوع: ${activeWeek.rows[0].count}
└ الشهر: ${activeMonth.rows[0].count}

🔗 الروابط المحولة:
├ الإجمالي: ${linksTotal.rows[0].count}
├ اليوم: ${linksToday.rows[0].count}
├ الأسبوع: ${linksWeek.rows[0].count}
└ الشهر: ${linksMonth.rows[0].count}`;
    await ctx.reply(statsText);
  } catch (e) { 
    console.log('Stats error:', e.message);
    ctx.reply('حدث خطأ في جلب الإحصائيات'); 
  }
});

bot.hears('⚙️ إعدادات الأزرار', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  
  const currentSettings = `⚙️ إعدادات البوت والأزرار:

1️⃣ ${buttonSettings.btn1.text}
🔗 ${buttonSettings.btn1.url || Channel || 'رابط القناة'}

2️⃣ ${buttonSettings.btn2.text}
🔗 ${buttonSettings.btn2.url || 'غير محدد'}

3️⃣ ${buttonSettings.btn3.text}
${buttonSettings.btn3.isCallback ? '📌 زر منبثق (ملاحظة)' : '🔗 ' + buttonSettings.btn3.url}

📢 فحص الاشتراك: ${botSettings.subCheckEnabled ? '✅ مفعل' : '❌ معطل'}`;
  
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
  
  // Refresh settings message
  const currentSettings = `⚙️ إعدادات البوت والأزرار:

1️⃣ ${buttonSettings.btn1.text}
🔗 ${buttonSettings.btn1.url || Channel || 'رابط القناة'}

2️⃣ ${buttonSettings.btn2.text}
🔗 ${buttonSettings.btn2.url || 'غير محدد'}

3️⃣ ${buttonSettings.btn3.text}
${buttonSettings.btn3.isCallback ? '📌 زر منبثق (ملاحظة)' : '🔗 ' + buttonSettings.btn3.url}

📢 فحص الاشتراك: ${newVal ? '✅ مفعل' : '❌ معطل'}`;

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
  const noteMessage = `🔴 ملاحظة:
للحصول على أفضل الأسعار:
📦 عروض الباندل: قم بوضع البلد الجزائر 🇩🇿
💰 عروض العملات: قم بوضع البلد كندا 🇨🇦

📌 ماتنساوش تثبيت البوت عندكم لمساعدتكم في الشراء بأرخص الأسعار`;
  await ctx.answerCbQuery(noteMessage, { show_alert: true });
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  
  // Handle button editing
  if (broadcastState[userId] && broadcastState[userId].startsWith('editing_btn')) {
    const btnId = broadcastState[userId].replace('editing_', '');
    delete broadcastState[userId];
    
    const parts = text.split('|');
    if (parts.length !== 2) {
      return ctx.reply('❌ تنسيق غير صحيح. استخدم: النص | الرابط');
    }
    
    const btnText = parts[0].trim();
    const btnUrl = parts[1].trim();
    const isCallback = btnUrl.toLowerCase() === 'منبثق';
    
    await saveButtonSetting(btnId, btnText, isCallback ? '' : btnUrl, isCallback);
    return ctx.reply(`✅ تم حفظ الزر بنجاح!\n\n${btnText}\n${isCallback ? '📌 زر منبثق' : '🔗 ' + btnUrl}`, mainKeyboard(ctx));
  }
  
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
  const subscribed = botSettings.subCheckEnabled ? await isUserSubscribed(userId) : true;
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
    return ctx.reply('🚫 الرجاء إرسال رابط من AliExpress فقط.');
  }

  // Extract the URL from the text to handle messages with text + link
  const urlRegex = /(https?:\/\/[^\s]+aliexpress\.com[^\s]+)/gi;
  const match = text.match(urlRegex);
  const targetUrl = match ? match[0] : text;
  
  // Send the waiting message as indicator
  const sent = await safeSend(ctx, () => ctx.reply('⏳ جاري البحث عن أفضل العروض 🔍'));
  
  try {
    const coinPi = await portaffFunction(cookies, targetUrl);
    if (!coinPi?.previews?.image_url) {
      if (sent) ctx.deleteMessage(sent.message_id).catch(() => {});
      return ctx.reply('🚨 البوت يدعم فقط روابط منتجات AliExpress');
    }
    // Build dynamic inline keyboard from buttonSettings
    const inlineButtons = [];
    if (buttonSettings.btn1.text) {
      const btn1Url = buttonSettings.btn1.url || Channel || 'https://t.me/channel';
      inlineButtons.push([{ text: buttonSettings.btn1.text, url: btn1Url }]);
    }
    if (buttonSettings.btn2.text && buttonSettings.btn2.url) {
      inlineButtons.push([{ text: buttonSettings.btn2.text, url: buttonSettings.btn2.url }]);
    }
    if (buttonSettings.btn3.text) {
      if (buttonSettings.btn3.isCallback) {
        inlineButtons.push([{ text: buttonSettings.btn3.text, callback_data: 'note_info' }]);
      } else if (buttonSettings.btn3.url) {
        inlineButtons.push([{ text: buttonSettings.btn3.text, url: buttonSettings.btn3.url }]);
      }
    }

    await ctx.replyWithPhoto(
      { url: coinPi.previews.image_url },
      {
        caption: `🛍️ اسم المنتج: ${coinPi.previews.title}\n\n🛒 رابط تخفيض النقاط:\n${coinPi.aff.coin}\n\n🛒 رابط تخفيض النقاط القديم:\n${coinPi.aff.point}\n\n🛒 رابط السوبر ديلز:\n${coinPi.aff.super}\n\n🛒 رابط العرض المحدود:\n${coinPi.aff.limit}\n\n🛒 رابط عرض bundle:\n${coinPi.aff.ther3}`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineButtons }
      }
    ).then(() => { if (sent) ctx.deleteMessage(sent.message_id).catch(() => {}); });
    
    // Track converted link
    if (pool && dbConnected) {
      try {
        await pool.query('INSERT INTO converted_links (user_id) VALUES ($1)', [userId]);
      } catch (e) {}
    }
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
