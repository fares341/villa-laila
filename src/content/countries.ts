/**
 * Country and governorate lists for the website booking form.
 * Mixed dorms can't be booked by Egyptians or Arab nationals (policy rule), so for a mixed dorm the form
 * only offers the non-Arab countries. Egyptians must also pick the governorate on their national ID;
 * Cairo, Giza and Qalyubia are not offered (guests with an ID from there can't stay).
 */

/** Arab League members (ISO 3166-1 alpha-2), Egypt included. */
export const ARAB_COUNTRIES = ['DZ', 'BH', 'KM', 'DJ', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MR', 'MA', 'OM', 'PS', 'QA', 'SA', 'SO', 'SD', 'SY', 'TN', 'AE', 'YE'];

export const ALL_COUNTRIES = (
  'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ ' +
  'DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI XK KW KG ' +
  'LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE ' +
  'PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA ' +
  'AE GB US UY UZ VU VA VE VN YE ZM ZW'
).split(' ');

export const isArabNationality = (code: string) => ARAB_COUNTRIES.includes(code.toUpperCase());

/** Country codes with names in the page language, sorted by name. */
export function countryOptions(lang: string, opts: { excludeArab?: boolean } = {}): { code: string; name: string }[] {
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames([lang, 'en'], { type: 'region' }); } catch { /* old runtime: show codes */ }
  return ALL_COUNTRIES
    .filter((c) => !(opts.excludeArab && ARAB_COUNTRIES.includes(c)))
    .map((code) => ({ code, name: (dn?.of(code) ?? code) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}

/** Egypt's governorates without Cairo, Giza and Qalyubia. `value` is what the policy rules see. */
export const EG_GOVERNORATES: { value: string; en: string; ar: string }[] = [
  { value: 'alexandria', en: 'Alexandria', ar: 'الإسكندرية' },
  { value: 'aswan', en: 'Aswan', ar: 'أسوان' },
  { value: 'asyut', en: 'Asyut', ar: 'أسيوط' },
  { value: 'beheira', en: 'Beheira', ar: 'البحيرة' },
  { value: 'beni suef', en: 'Beni Suef', ar: 'بني سويف' },
  { value: 'dakahlia', en: 'Dakahlia', ar: 'الدقهلية' },
  { value: 'damietta', en: 'Damietta', ar: 'دمياط' },
  { value: 'faiyum', en: 'Faiyum', ar: 'الفيوم' },
  { value: 'gharbia', en: 'Gharbia', ar: 'الغربية' },
  { value: 'ismailia', en: 'Ismailia', ar: 'الإسماعيلية' },
  { value: 'kafr el sheikh', en: 'Kafr El Sheikh', ar: 'كفر الشيخ' },
  { value: 'luxor', en: 'Luxor', ar: 'الأقصر' },
  { value: 'matrouh', en: 'Matrouh', ar: 'مطروح' },
  { value: 'minya', en: 'Minya', ar: 'المنيا' },
  { value: 'monufia', en: 'Monufia', ar: 'المنوفية' },
  { value: 'new valley', en: 'New Valley', ar: 'الوادي الجديد' },
  { value: 'north sinai', en: 'North Sinai', ar: 'شمال سيناء' },
  { value: 'port said', en: 'Port Said', ar: 'بورسعيد' },
  { value: 'qena', en: 'Qena', ar: 'قنا' },
  { value: 'red sea', en: 'Red Sea', ar: 'البحر الأحمر' },
  { value: 'sharqia', en: 'Sharqia', ar: 'الشرقية' },
  { value: 'sohag', en: 'Sohag', ar: 'سوهاج' },
  { value: 'south sinai', en: 'South Sinai', ar: 'جنوب سيناء' },
  { value: 'suez', en: 'Suez', ar: 'السويس' },
];
