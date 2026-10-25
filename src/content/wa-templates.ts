/**
 * WhatsApp message templates to create in Meta (WhatsApp Manager → Message templates).
 * Category: Utility · Language: Arabic. The variables are filled by the dashboard in this order
 * (see driverJobParams / driverReminderParams in services/pms/taxi.ts).
 *
 * Sample values for Meta's review:
 *  {{1}} استقبال من المطار ✈️ ← الفيلا   {{2}} مطار القاهرة   {{3}} الثلاثاء 28 أكتوبر 2:30 م
 *  {{4}} John Smith · غرفة شهرزاد   {{5}} +491701234567   {{6}} رحلة MS 778، شنطتين
 */
export const META_DRIVER_JOB = `🚖 *مشوار جديد من فيلا ليلى*

▪️ *النوع:* {{1}}
▪️ *المطار:* {{2}}
▪️ *الميعاد:* {{3}}
▪️ *العميل:* {{4}}
▪️ *رقم العميل:* {{5}}
▪️ *ملاحظات:* {{6}}

📍 العنوان: فيلا ليلى، 20 شارع صفية زغلول، السيدة زينب.
من فضلك أكد استلام المشوار بالرد على الرسالة دي. شكراً 🙏`;

/**
 * Sample values: {{1}} الثلاثاء 28 أكتوبر 2:30 م   {{2}} استقبال من المطار ✈️ ← الفيلا   {{3}} مطار القاهرة
 *                {{4}} John Smith · غرفة شهرزاد   {{5}} +491701234567
 */
export const META_DRIVER_REMINDER = `⏰ *تذكير من فيلا ليلى*
مشوارك بعد حوالي نص ساعة.

▪️ *الميعاد:* {{1}}
▪️ *النوع:* {{2}} · {{3}}
▪️ *العميل:* {{4}} · {{5}}

من فضلك اتحرك في الميعاد. شكراً 🙏`;
