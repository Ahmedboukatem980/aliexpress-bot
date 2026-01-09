const translations = {
  ar: {
    welcome: `مرحبا بك معنا، كل ما عليك الان هو إرسال لنا رابط المنتج التي تريد شرائه وسنقوم بتوفير لك أعلى نسبة خصم العملات 👌 أيضا عروض اخرى للمنتج بأسعار ممتازة،`,
    chooseLanguage: '🌐 اختر لغتك المفضلة:',
    languageChanged: '✅ تم تغيير اللغة إلى العربية',
    notSubscribed: '⚠️ أنت غير مشترك في القناة. يرجى الاشتراك أولًا:',
    subscribeNow: 'اشترك الآن ✅',
    searching: '⏳ جاري البحث عن أفضل العروض 🔍',
    onlyAliexpress: '🚨 البوت يدعم فقط روابط منتجات AliExpress',
    errorProcessing: '❗ حدث خطأ أثناء معالجة الرابط',
    productName: '🛍️ اسم المنتج:',
    coinDiscount: '🛒 رابط تخفيض النقاط:',
    oldCoinDiscount: '🛒 رابط تخفيض النقاط القديم:',
    superDeals: '🛒 رابط السوبر ديلز:',
    limitedOffer: '🛒 رابط العرض المحدود:',
    bundleDeals: '🛒 رابط عرض bundle:',
    changeCountry: '⚠️ غيّر البلد إلى كندا 🇨🇦 للحصول على أفضل الخصومات',
    moreOffers: '🛍️ لمزيد من العروض اشترك في قناتنا من هنا',
    trackBot: '📦 بوت التتبع',
    note: '🔴 ملاحظة',
    dbNotConnected: 'قاعدة البيانات غير متصلة',
    sendMessage: '📝 أرسل الرسالة التي تريد تعميمها على جميع المشتركين:',
    cancel: '❌ إلغاء',
    cancelled: 'تم الإلغاء',
    broadcastCancelled: 'تم إلغاء عملية الإرسال.',
    broadcastStarted: '⏳ بدأ الإرسال إلى {count} مستخدم...',
    broadcastSuccess: '✅ تم الإرسال بنجاح إلى {count} مستخدم.',
    broadcastError: 'حدث خطأ أثناء الإرسال',
    subscribersList: '👥 قائمة بآخر 50 مشترك:\n\n',
    downloadList: '📥 تحميل القائمة كاملة (CSV)',
    errorFetchingList: 'حدث خطأ في جلب القائمة',
    exportError: 'حدث خطأ أثناء تصدير القائمة',
    stats: `📊 إحصائيات البوت:
👥 إجمالي المشتركين: {total}
📅 مشتركين اليوم: {today}
🗓️ مشتركين الأسبوع: {week}
🌙 مشتركين الشهر: {month}`,
    statsError: 'حدث خطأ في جلب الإحصائيات',
    currentButtons: '⚙️ الأزرار الحالية تحت المنشورات:',
    editButton: '✏️ تعديل الزر',
    editButton1Prompt: '✏️ أرسل النص والرابط للزر الأول:\nالصيغة: النص | الرابط',
    editButton2Prompt: '✏️ أرسل النص والرابط للزر الثاني:\nالصيغة: النص | الرابط',
    editButton3Prompt: '✏️ أرسل النص والرابط للزر الثالث:\nالصيغة: النص | الرابط\n\nأو أرسل "منبثق" ليظهر كرسالة منبثقة:\nالنص | منبثق',
    invalidFormat: '❌ تنسيق غير صحيح. استخدم: النص | الرابط',
    buttonSaved: '✅ تم حفظ الزر بنجاح!',
    popupButton: '📌 زر منبثق',
    unauthorized: 'غير مصرح',
    missYou: '👋 اشتقنا لك! هل هناك منتج جديد تريد البحث عن خصومات له؟ أرسل الرابط الآن وجرب حظك مع خصومات العملات الرائعة! 💸'
  },
  fr: {
    welcome: `Bienvenue! Envoyez-nous le lien du produit que vous souhaitez acheter et nous vous fournirons les meilleures réductions 👌`,
    chooseLanguage: '🌐 Choisissez votre langue:',
    languageChanged: '✅ Langue changée en français',
    notSubscribed: '⚠️ Vous n\'êtes pas abonné à la chaîne. Veuillez vous abonner d\'abord:',
    subscribeNow: 'S\'abonner ✅',
    searching: '⏳ Recherche des meilleures offres 🔍',
    onlyAliexpress: '🚨 Le bot ne prend en charge que les liens produits AliExpress',
    errorProcessing: '❗ Erreur lors du traitement du lien',
    productName: '🛍️ Nom du produit:',
    coinDiscount: '🛒 Lien réduction coins:',
    oldCoinDiscount: '🛒 Ancien lien réduction coins:',
    superDeals: '🛒 Lien Super Deals:',
    limitedOffer: '🛒 Lien offre limitée:',
    bundleDeals: '🛒 Lien Bundle Deals:',
    changeCountry: '⚠️ Changez le pays en Canada 🇨🇦 pour de meilleures réductions',
    moreOffers: '🛍️ Pour plus d\'offres, abonnez-vous à notre chaîne',
    trackBot: '📦 Bot de suivi',
    note: '🔴 Note',
    dbNotConnected: 'Base de données non connectée',
    sendMessage: '📝 Envoyez le message à diffuser à tous les abonnés:',
    cancel: '❌ Annuler',
    cancelled: 'Annulé',
    broadcastCancelled: 'Diffusion annulée.',
    broadcastStarted: '⏳ Envoi en cours à {count} utilisateurs...',
    broadcastSuccess: '✅ Envoyé avec succès à {count} utilisateurs.',
    broadcastError: 'Erreur lors de l\'envoi',
    subscribersList: '👥 Liste des 50 derniers abonnés:\n\n',
    downloadList: '📥 Télécharger la liste complète (CSV)',
    errorFetchingList: 'Erreur lors de la récupération de la liste',
    exportError: 'Erreur lors de l\'exportation de la liste',
    stats: `📊 Statistiques du bot:
👥 Total abonnés: {total}
📅 Abonnés aujourd'hui: {today}
🗓️ Abonnés cette semaine: {week}
🌙 Abonnés ce mois: {month}`,
    statsError: 'Erreur lors de la récupération des statistiques',
    currentButtons: '⚙️ Boutons actuels sous les publications:',
    editButton: '✏️ Modifier le bouton',
    editButton1Prompt: '✏️ Envoyez le texte et le lien pour le bouton 1:\nFormat: Texte | Lien',
    editButton2Prompt: '✏️ Envoyez le texte et le lien pour le bouton 2:\nFormat: Texte | Lien',
    editButton3Prompt: '✏️ Envoyez le texte et le lien pour le bouton 3:\nFormat: Texte | Lien\n\nOu envoyez "popup" pour un message popup:\nTexte | popup',
    invalidFormat: '❌ Format invalide. Utilisez: Texte | Lien',
    buttonSaved: '✅ Bouton enregistré avec succès!',
    popupButton: '📌 Bouton popup',
    unauthorized: 'Non autorisé',
    missYou: '👋 Tu nous manques! Avez-vous un nouveau produit pour lequel vous souhaitez trouver des réductions? Envoyez le lien maintenant! 💸'
  },
  en: {
    welcome: `Welcome! Just send us the product link you want to buy and we will provide you with the best discount rates 👌`,
    chooseLanguage: '🌐 Choose your language:',
    languageChanged: '✅ Language changed to English',
    notSubscribed: '⚠️ You are not subscribed to the channel. Please subscribe first:',
    subscribeNow: 'Subscribe Now ✅',
    searching: '⏳ Searching for the best deals 🔍',
    onlyAliexpress: '🚨 Bot only supports AliExpress product links',
    errorProcessing: '❗ Error processing the link',
    productName: '🛍️ Product Name:',
    coinDiscount: '🛒 Coin Discount Link:',
    oldCoinDiscount: '🛒 Old Coin Discount Link:',
    superDeals: '🛒 Super Deals Link:',
    limitedOffer: '🛒 Limited Offer Link:',
    bundleDeals: '🛒 Bundle Deals Link:',
    changeCountry: '⚠️ Change country to Canada 🇨🇦 for best discounts',
    moreOffers: '🛍️ For more offers, subscribe to our channel',
    trackBot: '📦 Tracking Bot',
    note: '🔴 Note',
    dbNotConnected: 'Database not connected',
    sendMessage: '📝 Send the message to broadcast to all subscribers:',
    cancel: '❌ Cancel',
    cancelled: 'Cancelled',
    broadcastCancelled: 'Broadcast cancelled.',
    broadcastStarted: '⏳ Sending to {count} users...',
    broadcastSuccess: '✅ Successfully sent to {count} users.',
    broadcastError: 'Error during broadcast',
    subscribersList: '👥 Last 50 subscribers:\n\n',
    downloadList: '📥 Download full list (CSV)',
    errorFetchingList: 'Error fetching list',
    exportError: 'Error exporting list',
    stats: `📊 Bot Statistics:
👥 Total subscribers: {total}
📅 Today's subscribers: {today}
🗓️ This week's subscribers: {week}
🌙 This month's subscribers: {month}`,
    statsError: 'Error fetching statistics',
    currentButtons: '⚙️ Current buttons under posts:',
    editButton: '✏️ Edit button',
    editButton1Prompt: '✏️ Send text and link for button 1:\nFormat: Text | Link',
    editButton2Prompt: '✏️ Send text and link for button 2:\nFormat: Text | Link',
    editButton3Prompt: '✏️ Send text and link for button 3:\nFormat: Text | Link\n\nOr send "popup" for a popup message:\nText | popup',
    invalidFormat: '❌ Invalid format. Use: Text | Link',
    buttonSaved: '✅ Button saved successfully!',
    popupButton: '📌 Popup button',
    unauthorized: 'Unauthorized',
    missYou: '👋 We miss you! Have a new product you want to find discounts for? Send the link now! 💸'
  }
};

function getText(lang, key, replacements = {}) {
  const text = translations[lang]?.[key] || translations['ar'][key] || key;
  let result = text;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replace(`{${placeholder}}`, value);
  }
  return result;
}

module.exports = { translations, getText };
