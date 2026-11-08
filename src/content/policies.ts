/**
 * The hostel's policies as written by the owner (Nov 2026). Used on the website (/policies, the booking page) and by
 * the bot whenever Dashboard → Settings has no text of its own for that language.
 * Format: "## Heading", "- point", other lines are paragraphs. French/Spanish pages are translated from English.
 */
export type PolicyKey = 'booking_howto' | 'payment_instructions' | 'cancellation_policy' | 'house_rules' | 'privacy_policy';

export const POLICY_TEXT: Record<PolicyKey, { en: string; ar: string }> = {
  privacy_policy: {
    en: `At Villa Layla Hostel, we respect your privacy and handle your personal information responsibly.
## Information we collect
When you make a reservation or use our services, we may collect information such as your name, contact details, booking information, payment details, and identification documents required by local regulations.
## How we use your information
We use your information to manage reservations, process payments, communicate with you about your stay, provide requested services, and comply with applicable legal requirements.
## Payments & third parties
Online payments may be processed through third-party payment providers. We may share necessary information with service providers involved in managing reservations and delivering our services, or with authorities when legally required.
## Data protection & retention
We take reasonable measures to protect your personal information. We retain it for the periods necessary for our services and applicable legal requirements.
## Your rights
You may contact us to request access to, correction of, or deletion of your personal information, subject to applicable legal requirements.
## Cookies
Our website may use cookies to support its functionality. Additional information about cookies will be provided where required.
## Contact us
For any questions or requests regarding your personal information, please contact us at:
- Villa Layla Hostel, Cairo, Egypt
- Email: hostel.layla@gmail.com
Last updated: 5 November 2026`,
    ar: `في فيلا ليلى هوستل بنحترم خصوصيتك وبنتعامل مع بياناتك الشخصية بمسؤولية.
## البيانات اللي بنجمعها
لما تحجز أو تستخدم خدماتنا، ممكن نجمع بيانات زي اسمك، وطرق التواصل معاك، وتفاصيل الحجز، وبيانات الدفع، ووثائق إثبات الشخصية المطلوبة بالقانون المحلي.
## بنستخدم بياناتك في إيه
بنستخدمها عشان ندير الحجوزات، ونستلم المدفوعات، ونتواصل معاك بخصوص إقامتك، ونقدم الخدمات اللي بتطلبها، ونلتزم بالقوانين المطبّقة.
## الدفع والجهات التانية
الدفع أونلاين ممكن يتم عن طريق شركات دفع خارجية. وممكن نشارك البيانات اللازمة بس مع مقدمي الخدمات اللي بيساعدونا في إدارة الحجوزات وتقديم خدماتنا، أو مع الجهات الرسمية لما القانون يطلب ده.
## حماية البيانات ومدة الاحتفاظ بيها
بناخد إجراءات مناسبة لحماية بياناتك الشخصية، وبنحتفظ بيها المدة اللازمة لخدماتنا وللمتطلبات القانونية.
## حقوقك
تقدر تكلّمنا تطلب تشوف بياناتك أو تصححها أو تمسحها، في حدود المتطلبات القانونية.
## الكوكيز
موقعنا ممكن يستخدم كوكيز عشان يشتغل كويس. وهنوضح معلومات أكتر عن الكوكيز لما يكون ده مطلوب.
## تواصل معانا
لأي سؤال أو طلب بخصوص بياناتك الشخصية، كلّمنا على:
- فيلا ليلى هوستل، القاهرة، مصر
- الإيميل: hostel.layla@gmail.com
آخر تحديث: 5 نوفمبر 2026`,
  },
  booking_howto: {
    en: `Booking your stay at Villa Layla is simple!
Choose your room, select your dates, and complete your reservation directly through our website.
A 10% deposit is required at the time of booking. Once your online payment is successful, your reservation is automatically confirmed.
The remaining 90% is payable upon arrival.`,
    ar: `الحجز في فيلا ليلى سهل!
اختار أوضتك وتواريخك، وكمّل الحجز على موقعنا مباشرة.
مطلوب عربون 10% وقت الحجز. أول ما الدفع أونلاين يتم بنجاح، حجزك بيتأكد تلقائيًا.
الـ 90% الباقيين بيتدفعوا لما توصل.`,
  },
  payment_instructions: {
    en: `- A 10% deposit of the total booking amount is required at the time of reservation and is paid securely online.
- Your booking is automatically confirmed once the deposit payment is successfully completed.
- The remaining 90% must be paid upon arrival at check-in.
Cancellation and refund conditions are outlined in our Cancellation Policy.`,
    ar: `- مطلوب عربون 10% من إجمالي الحجز وقت الحجز، وبيتدفع أونلاين بشكل آمن.
- حجزك بيتأكد تلقائيًا أول ما دفع العربون يتم بنجاح.
- الـ 90% الباقيين بيتدفعوا لما توصل وقت تسجيل الدخول.
شروط الإلغاء واسترداد الفلوس موجودة في سياسة الإلغاء.`,
  },
  cancellation_policy: {
    en: `## Free cancellation
Cancel at least 72 hours before your scheduled check-in (3:00 PM, Cairo time) for a full refund of your deposit.
## Late cancellation
Cancellations made less than 72 hours before check-in will result in the loss of the 10% deposit.
## No-show
If you do not arrive and have not cancelled your reservation, your deposit will be non-refundable.
## Early departure
Please inform reception if you need to shorten your stay. Any refund for unused nights is subject to our cancellation policy.
For any changes or cancellations, please contact our reception team directly.`,
    ar: `## إلغاء مجاني
لو ألغيت قبل ميعاد تسجيل الدخول (3:00 العصر بتوقيت القاهرة) بـ 72 ساعة على الأقل، العربون بيرجعلك كامل.
## إلغاء متأخر
الإلغاء قبل تسجيل الدخول بأقل من 72 ساعة بيضيّع العربون (10%).
## عدم الحضور
لو ماجيتش ومالغيتش الحجز، العربون مش بيرجع.
## المغادرة بدري
لو محتاج تقصّر إقامتك بلّغ الاستقبال. أي استرداد عن الليالي اللي ماقضيتهاش بيمشي على سياسة الإلغاء.
لأي تعديل أو إلغاء، كلّم فريق الاستقبال مباشرة.`,
  },
  house_rules: {
    en: `## Check-in & Check-out
- Check-in: From 3:00 PM.
- Check-out: By 11:00 AM.
Arriving early? You're welcome to leave your luggage with us and enjoy our common areas until your room is ready.
After check-out, you're welcome to store your luggage and spend time in our common areas. Sleeping in common areas is not permitted.
## Quiet Hours
Quiet hours are from 11:00 PM to 7:00 AM.
We love a lively, social atmosphere, but we also want everyone to enjoy a good night's sleep. Please keep noise to a minimum during these hours, especially near guest rooms.
## Visitors
- Outside visitors are welcome in designated common areas until 10:00 PM.
- Visitors are not permitted inside guest rooms or dormitories.
- During scheduled events, registered event attendees may remain for the duration of the event, even if it ends after 10:00 PM.
- All visitors must respect our house rules.
## Smoking
Smoking is permitted only in designated outdoor areas, such as the garden and terrace. Smoking inside rooms or indoor common areas is not allowed.
## Swimming Pool & Safety
- The swimming pool is available during its designated operating hours.
- There is no lifeguard on duty. Guests use the pool at their own risk.
- Children must be supervised by a parent or responsible adult at all times, particularly around the pool.
## Children & Families
Villa Layla is primarily designed for independent travellers and adults. Families travelling with children are welcome to contact us before booking to ensure our facilities are suitable for their needs.
Parents or guardians are responsible for supervising their children throughout their stay.
## Personal Belongings
Guests are responsible for their personal belongings. Please use the available lockers to secure cash, passports, electronics, and other valuables.
## Respect for Others
Villa Layla is a shared home for travellers from around the world. We ask everyone to respect fellow guests, our team, and the property.
Harassment, discrimination, threatening behaviour, or repeated disturbance of other guests will not be tolerated.
We want everyone to feel safe, comfortable, and welcome at Villa Layla.`,
    ar: `## تسجيل الدخول والخروج
- تسجيل الدخول: من 3:00 العصر.
- تسجيل الخروج: لحد 11:00 الصبح.
جاي بدري؟ تقدر تسيب شنطك معانا وتقعد في الأماكن المشتركة لحد ما أوضتك تجهز.
بعد تسجيل الخروج، تقدر تسيب شنطك وتقضي وقت في الأماكن المشتركة. النوم في الأماكن المشتركة ممنوع.
## ساعات الهدوء
ساعات الهدوء من 11:00 بالليل لحد 7:00 الصبح.
بنحب الجو الاجتماعي والحيوي، بس عايزين الكل ينام كويس. من فضلك خلّي الصوت واطي في الساعات دي، خصوصًا جنب أوض الضيوف.
## الزوار
- الزوار من بره مرحب بيهم في الأماكن المشتركة المخصصة لحد 10:00 بالليل.
- مش مسموح للزوار يدخلوا أوض الضيوف أو الدورمز.
- في الإيفنتات، اللي حاجزين في الإيفنت يقدروا يفضلوا لحد ما يخلص حتى لو بعد 10:00 بالليل.
- كل الزوار لازم يحترموا قواعد البيت.
## التدخين
التدخين مسموح بس في الأماكن المفتوحة المخصصة زي الجنينة والتراس. ممنوع التدخين جوه الأوض أو الأماكن المشتركة المقفولة.
## حمام السباحة والأمان
- حمام السباحة متاح في مواعيد تشغيله.
- مفيش منقذ. استخدام البيسين على مسؤولية الضيف.
- الأطفال لازم يكونوا مع أب أو أم أو شخص كبير مسؤول طول الوقت، خصوصًا جنب البيسين.
## الأطفال والعائلات
فيلا ليلى معمولة أساسًا للمسافرين المستقلين والكبار. العائلات اللي معاها أطفال مرحب بيها تكلمنا قبل الحجز عشان نتأكد إن المكان مناسب ليهم.
الأهل مسؤولين عن الإشراف على أطفالهم طول الإقامة.
## الحاجات الشخصية
كل ضيف مسؤول عن حاجته. من فضلك استخدم اللوكرز المتاحة للفلوس والباسبور والأجهزة وأي حاجة قيمة.
## احترام الآخرين
فيلا ليلى بيت مشترك لمسافرين من كل حتة في العالم. بنطلب من الكل يحترم الضيوف التانيين وفريقنا والمكان.
التحرش أو التمييز أو التهديد أو إزعاج الضيوف بشكل متكرر مش مقبول.
عايزين الكل يحس بالأمان والراحة وإنه مرحب بيه في فيلا ليلى.`,
  },
};
