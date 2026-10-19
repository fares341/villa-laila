// Real room catalogue of Villa Layla, taken from the hostel's own website data feed
// (https://www.villalaylahostel.com/api/rooms, read 2026-10-14): names, descriptions, bed types,
// bathrooms, views and photos. Translations of the descriptions are ours.
// Bed counts for dorms come from the dorm names. Prices: the feed published only ONE price
// (18 for "Spacious 8-Bed Male Dormitory", currency not shown) — all other prices must be entered by the owner.

const IMG = 'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/';
const p = (...ids: string[]) => ids.map((x) => IMG + x);

export type FeatureKey = 'ac' | 'hairdryer' | 'linen' | 'pool_view' | 'courtyard_view' | 'private_bath' | 'shared_bath' | 'private_external_bath' | 'terrace' | 'pool_access';
export const FEATURES: Record<FeatureKey, Record<'en' | 'es' | 'fr' | 'ar', string>> = {
  ac: { en: 'Air conditioning', es: 'Aire acondicionado', fr: 'Climatisation', ar: 'تكييف' },
  hairdryer: { en: 'Hairdryer', es: 'Secador de pelo', fr: 'Sèche-cheveux', ar: 'مجفف شعر' },
  linen: { en: 'Linen and towels provided', es: 'Ropa de cama y toallas incluidas', fr: 'Draps et serviettes fournis', ar: 'مفارش ومناشف' },
  pool_view: { en: 'Pool view', es: 'Vista a la piscina', fr: 'Vue sur la piscine', ar: 'إطلالة على المسبح' },
  courtyard_view: { en: 'Courtyard view', es: 'Vista al patio', fr: 'Vue sur la cour', ar: 'إطلالة على الفناء' },
  private_bath: { en: 'Private bathroom', es: 'Baño privado', fr: 'Salle de bain privée', ar: 'حمام خاص' },
  shared_bath: { en: 'Shared bathroom', es: 'Baño compartido', fr: 'Salle de bain partagée', ar: 'حمام مشترك' },
  private_external_bath: { en: 'Private bathroom outside the room', es: 'Baño privado fuera de la habitación', fr: 'Salle de bain privée hors de la chambre', ar: 'حمام خاص خارج الغرفة' },
  terrace: { en: 'Terrace', es: 'Terraza', fr: 'Terrasse', ar: 'تراس' },
  pool_access: { en: 'Pool access', es: 'Acceso a la piscina', fr: 'Accès à la piscine', ar: 'وصول للمسبح' },
};

type L4 = Record<'en' | 'es' | 'fr' | 'ar', string>;
export type CatalogRoom = {
  ref: string; code: string; kind: 'dorm' | 'private'; gender: 'mixed' | 'female' | 'male';
  name: L4; description: L4; bed: L4; sleeps: number; beds?: number; features: FeatureKey[]; photos: string[]; publishedPrice?: number;
};

const king: L4 = { en: 'King bed', es: 'Cama king', fr: 'Lit king size', ar: 'سرير كينج' };
const dblShared: L4 = { en: 'King-size double room with shared bathroom.', es: 'Habitación doble con cama king y baño compartido.', fr: 'Chambre double avec lit king size et salle de bain partagée.', ar: 'غرفة مزدوجة بسرير كينج وحمام مشترك.' };
const dblPrivate: L4 = { en: 'King-size double room with private bathroom.', es: 'Habitación doble con cama king y baño privado.', fr: 'Chambre double avec lit king size et salle de bain privée.', ar: 'غرفة مزدوجة بسرير كينج وحمام خاص.' };
const bunk: L4 = { en: 'Bunk beds', es: 'Literas', fr: 'Lits superposés', ar: 'أسرّة بطابقين' };

export const CATALOG: CatalogRoom[] = [
  // ───────── private rooms ─────────
  { ref: '390366', code: 'sheherazade', kind: 'private', gender: 'mixed', sleeps: 2, bed: king,
    name: { en: 'Sheherazade', es: 'Sheherazade', fr: 'Shéhérazade', ar: 'شهرزاد' }, description: dblPrivate,
    features: ['private_bath', 'ac', 'hairdryer', 'linen'],
    publishedPrice: 75, photos: p('2126388/2126388/033788c5-e7f0-4daa-a8ee-f8e512c018a7', '2126389/2126389/cd2761af-6f0f-452f-8597-b56375dc606f', '2126384/2126384/5ea3824f-b382-47ee-9ade-9a05c63903c5', '2126387/2126387/5bd4e55b-199e-4fb7-b762-616a54abad7b', '2126386/2126386/8019f313-63c3-47a1-af44-c47dfdb052fc') },
  { ref: '428176', code: 'ibn-battuta', kind: 'private', gender: 'mixed', sleeps: 2, bed: { en: 'Queen bed', es: 'Cama queen', fr: 'Lit queen size', ar: 'سرير كوين' },
    name: { en: 'Ibn Battuta', es: 'Ibn Battuta', fr: 'Ibn Battûta', ar: 'ابن بطوطة' },
    description: { en: 'Queen-size double room with private bathroom.', es: 'Habitación doble con cama queen y baño privado.', fr: 'Chambre double avec lit queen size et salle de bain privée.', ar: 'غرفة مزدوجة بسرير كوين وحمام خاص.' },
    features: ['private_bath'],
    publishedPrice: 65, photos: p('2126498/2126498/0c6cbf2c-27cf-4210-a2e8-72f5ee1c2d55', '2126499/2126499/cfd5dea1-de6e-4a3b-89ac-1cb46db34241', '2126497/2126497/9b03da7e-8b7b-4a48-8054-5568dba23e5d', '2126503/2126503/2b695ae3-ff55-49e0-ad83-9eacd4dd4609', '2126504/2126504/1c1d6f18-58ca-4ca6-8b64-119ef170920b', '2126514/2126514/0a870d3a-09b9-45b1-8368-0db9065fd992') },
  { ref: '428189', code: 'mamluk', kind: 'private', gender: 'mixed', sleeps: 2, bed: king,
    name: { en: 'Mamluk', es: 'Mameluco', fr: 'Mamelouk', ar: 'مملوك' }, description: dblPrivate, features: ['private_bath'],
    publishedPrice: 64, photos: p('2126560/2126560/b3184152-d9ea-49cf-a782-2dfc3840d3ec', '2126561/2126561/a1557524-f880-475b-a59f-53821dbbe07d', '2126555/2126555/966b6017-d78b-4703-9b05-4d5c2ba396d7', '2126559/2126559/ffd2d8eb-535f-48b8-ad56-2eda6fed6d2c', '2126554/2126554/cc348b83-61e0-4dd1-af30-55458faa5e6d', '2126570/2126570/473d384f-2b0d-4300-9060-1da65c91651b') },
  { ref: '428188', code: 'golden-room', kind: 'private', gender: 'mixed', sleeps: 2, bed: king,
    name: { en: 'Golden Room', es: 'Habitación Dorada', fr: 'Chambre Dorée', ar: 'الغرفة الذهبية' }, description: dblPrivate, features: ['private_bath'],
    publishedPrice: 49, photos: p('2126577/2126577/ff7371b5-b974-4a50-95a7-b23139fbff50', '2126574/2126574/c08bdf33-1265-435a-b02a-4f5a9a8b7ebd', '2126575/2126575/99517e7a-98ac-4b52-9b67-09b9ed651988', '2126573/2126573/9f9dc2ed-d627-4756-a06a-03e8fe2a46a0') },
  { ref: '428185', code: 'french-lady', kind: 'private', gender: 'mixed', sleeps: 2, bed: { en: 'King bed or twin beds', es: 'Cama king o dos camas', fr: 'Lit king size ou lits jumeaux', ar: 'سرير كينج أو سريران منفصلان' },
    name: { en: 'French Lady', es: 'La Dama Francesa', fr: 'La Dame Française', ar: 'السيدة الفرنسية' }, description: dblPrivate, features: ['private_bath'],
    publishedPrice: 75, photos: p('2126531/2126531/f1aadc8d-2354-4e68-bb15-f3fc8c566dc8', '2126529/2126529/3b8f9332-e829-4ef8-b1f3-c2fe12f194d3', '2126527/2126527/e43faeef-788b-4794-b504-aaeb5e8019cd', '2126526/2126526/033f90b3-286d-47b1-a363-db48d5415c5d', '2126528/2126528/6fe6fee8-16e0-4613-9c9c-32229838a6b6') },
  { ref: '428186', code: 'folklore', kind: 'private', gender: 'mixed', sleeps: 2, bed: { en: 'Two single beds', es: 'Dos camas individuales', fr: 'Deux lits simples', ar: 'سريران فرديان' },
    name: { en: 'Folklore', es: 'Folclore', fr: 'Folklore', ar: 'فولكلور' },
    description: { en: 'Twin room with a private bathroom just outside, and pool access.', es: 'Habitación con dos camas, baño privado justo fuera y acceso a la piscina.', fr: 'Chambre à deux lits, salle de bain privée juste à côté et accès à la piscine.', ar: 'غرفة بسريرين، حمام خاص بجوارها مباشرة، ووصول للمسبح.' },
    features: ['private_external_bath', 'pool_view', 'pool_access'],
    publishedPrice: 65, photos: p('2126543/2126543/50880502-92de-4f4d-8797-de4bc1254253', '2126537/2126537/ad1e2b9f-63e8-4508-84ad-2eb85c3f0474', '2126542/2126542/58273dd4-2b0a-48a4-9923-bd941c5a9b41', '2126538/2126538/23d90115-d01d-433d-b281-80548cfc7530', '2126536/2126536/4f8be223-26d8-4897-86a0-d7e1ae2d2d4f', '2126547/2126547/633b6f62-a72f-45c6-870d-b57c1f692e3b') },
  { ref: '390375', code: 'violet', kind: 'private', gender: 'mixed', sleeps: 2, bed: king,
    name: { en: 'Violet', es: 'Violeta', fr: 'Violette', ar: 'فيوليت' }, description: dblShared, features: ['shared_bath', 'ac', 'hairdryer', 'linen'],
    publishedPrice: 59, photos: p('2126429/2126429/0e8e55a5-5212-46e4-94fc-8447ab1fe9db', '2126432/2126432/6e7b5576-2493-47d3-a664-63730d9563a7', '2126428/2126428/52542935-ce5a-40fe-974a-357f6443fd4e', '2126426/2126426/51c23851-66c5-409f-a81f-1eced8ed2db8', '2126430/2126430/1bf7b970-a254-48cd-837c-9eda030791a4', '2126438/2126438/0d92cfc5-50bc-4584-87fe-9c2f35929506') },
  { ref: '391967', code: 'islamic', kind: 'private', gender: 'mixed', sleeps: 2, bed: king,
    name: { en: 'Islamic', es: 'Islámica', fr: 'Islamique', ar: 'الإسلامية' }, description: dblShared, features: ['shared_bath'],
    publishedPrice: 49, photos: p('2126477/2126477/3adf9b35-2584-42aa-a946-339c729fc5d7', '2126478/2126478/68d5987f-db69-452d-bc4a-0cd9708930ec', '2126474/2126474/81fb2a67-dee5-486d-8c59-22a44862f226', '2126471/2126471/ca231fe9-a77a-4653-a1f8-5e049ddb87ca', '2126472/2126472/71d0a301-bf69-4621-b273-a13f31b20ea3') },
  { ref: '391968', code: 'amira', kind: 'private', gender: 'mixed', sleeps: 2, bed: king,
    name: { en: 'Amira', es: 'Amira', fr: 'Amira', ar: 'أميرة' }, description: dblShared, features: ['shared_bath'],
    publishedPrice: 59, photos: p('2126484/2126484/4a450c72-1ca8-4349-9f50-1548977aa6c2', '2126485/2126485/a92c034e-f318-401c-a2df-0fef47ada104', '2126483/2126483/346ae365-b6c0-4f21-8b96-38ee7e314609', '2126487/2126487/c97a2eb0-d87b-4123-b549-52bec727a503', '2126481/2126481/d9f4c3ca-229a-4653-a20e-219412311e5d', '2126492/2126492/f4fd5c6b-53ea-4967-8854-3ed1979b8cc9') },
  { ref: '390370', code: 'triple', kind: 'private', gender: 'mixed', sleeps: 3, bed: { en: 'King bed and a single bed', es: 'Cama king y una individual', fr: 'Lit king size et un lit simple', ar: 'سرير كينج وسرير فردي' },
    name: { en: 'Triple', es: 'Triple', fr: 'Triple', ar: 'الثلاثية' },
    description: { en: 'King bed plus a single bed, shared bathroom and a terrace.', es: 'Cama king más una individual, baño compartido y terraza.', fr: 'Lit king size et lit simple, salle de bain partagée et terrasse.', ar: 'سرير كينج وسرير فردي، حمام مشترك وتراس.' },
    features: ['terrace', 'shared_bath', 'ac', 'hairdryer', 'linen'],
    publishedPrice: 59, photos: p('2126401/2126401/2aaf0de2-7edc-4fb2-bf3f-20dd51c48fa3', '2126403/2126403/7d0731f3-ad47-4b42-b243-2b53a1d9a243', '2126402/2126402/9fb8950e-f9b0-4e82-8624-162999b628b6', '2126396/2126396/966b9193-c498-4ded-bf63-e46f520870c7', '2126400/2126400/f1814d61-b50b-4817-b94f-ab7cafa7d866', '2126407/2126407/ff213972-0393-4718-98e7-4b0691ec1b17', '2126408/2126408/e06c65f8-9690-4439-a5be-22d6bca4a269') },
  // ───────── dorms (priced per bed) ─────────
  { ref: '390357', code: 'female-dorm-8', kind: 'dorm', gender: 'female', sleeps: 1, beds: 8, bed: bunk,
    name: { en: 'Spacious 8-bed female dorm', es: 'Dormitorio femenino amplio de 8 camas', fr: 'Grand dortoir féminin de 8 lits', ar: 'عنبر بنات واسع ٨ أسرّة' },
    description: { en: 'A bed in a spacious women-only dorm overlooking the pool.', es: 'Una cama en un amplio dormitorio solo para mujeres con vista a la piscina.', fr: 'Un lit dans un grand dortoir réservé aux femmes, avec vue sur la piscine.', ar: 'سرير في عنبر واسع للسيدات فقط بإطلالة على المسبح.' },
    features: ['pool_view', 'ac', 'hairdryer', 'linen', 'shared_bath'],
    publishedPrice: 18, photos: p('2126368/2126368/d413d906-7c4c-4b57-a9e1-454880f83e0b', '2126362/2126362/3d7dc9be-0a9d-4a4e-9591-58ed1d25eb87', '2126370/2126370/eaf955ec-f101-46d8-b626-161e44dba1e8') },
  { ref: '391901', code: 'female-dorm-6', kind: 'dorm', gender: 'female', sleeps: 1, beds: 6, bed: { en: 'Beds', es: 'Camas', fr: 'Lits', ar: 'أسرّة' },
    name: { en: '6-bed female dorm', es: 'Dormitorio femenino de 6 camas', fr: 'Dortoir féminin de 6 lits', ar: 'عنبر بنات ٦ أسرّة' },
    description: { en: 'A bed in a smaller women-only dorm facing the courtyard.', es: 'Una cama en un dormitorio más pequeño solo para mujeres, con vista al patio.', fr: 'Un lit dans un petit dortoir réservé aux femmes, côté cour.', ar: 'سرير في عنبر أصغر للسيدات فقط يطل على الفناء.' },
    features: ['courtyard_view', 'shared_bath'],
    publishedPrice: 18, photos: p('2126454/2126454/ce2a6a57-368b-4cd8-ba54-af7f028ce926', '2126457/2126457/e529f8e4-4aff-4872-9503-1d928e0970ea', '2126455/2126455/09eab609-4348-41f0-b6ba-f5c4d6333e88', '2126458/2126458/d8e1a98d-f749-4968-a27b-5d80cf8e1910') },
  { ref: '391097', code: 'male-dorm-8-pool', kind: 'dorm', gender: 'male', sleeps: 1, beds: 8, bed: bunk, publishedPrice: 18,
    name: { en: 'Spacious 8-bed male dorm', es: 'Dormitorio masculino amplio de 8 camas', fr: 'Grand dortoir masculin de 8 lits', ar: 'عنبر شباب واسع ٨ أسرّة' },
    description: { en: 'A bunk in a spacious men-only dorm overlooking the pool.', es: 'Una litera en un amplio dormitorio solo para hombres con vista a la piscina.', fr: 'Un lit superposé dans un grand dortoir réservé aux hommes, vue sur la piscine.', ar: 'سرير في عنبر واسع للرجال فقط بإطلالة على المسبح.' },
    features: ['pool_view', 'shared_bath'],
    photos: p('2126469/2126469/d37d593d-9707-4354-896a-6f88d004d2e4', '2126468/2126468/11b4406c-3bbe-41e9-a6c2-e42557861c4d', '2126467/2126467/06a90edb-9439-4cbf-a6b2-8fe574d60ad7', '2126466/2126466/cbb58fce-fc9f-4db1-8f6f-20ebd7938a2c', '2126461/2126461/2d03ea66-34a8-4cef-879e-01400c290b45') },
  { ref: '390372', code: 'male-dorm-8', kind: 'dorm', gender: 'male', sleeps: 1, beds: 8, bed: { en: 'Single beds', es: 'Camas individuales', fr: 'Lits simples', ar: 'أسرّة فردية' },
    name: { en: '8-bed male dorm', es: 'Dormitorio masculino de 8 camas', fr: 'Dortoir masculin de 8 lits', ar: 'عنبر شباب ٨ أسرّة' },
    description: { en: 'A bed in a men-only dorm with air conditioning.', es: 'Una cama en un dormitorio solo para hombres con aire acondicionado.', fr: 'Un lit dans un dortoir réservé aux hommes, climatisé.', ar: 'سرير في عنبر للرجال فقط مكيّف.' },
    features: ['ac', 'hairdryer', 'linen', 'shared_bath'],
    publishedPrice: 17, photos: p('2126418/2126418/b8ea57d8-fae1-4736-b637-68bf2e4c736f', '2126417/2126417/3b08dd5b-22ca-416e-8fe0-f7a831491435', '2126419/2126419/abb7f801-0bbc-434c-94f5-4e493abb91be', '2126414/2126414/f4e65c84-cdc0-4820-a2e6-7c9f628587e2') },
  { ref: '391093', code: 'mixed-dorm-10', kind: 'dorm', gender: 'mixed', sleeps: 1, beds: 10, bed: bunk,
    name: { en: '10-bed mixed dorm', es: 'Dormitorio mixto de 10 camas', fr: 'Dortoir mixte de 10 lits', ar: 'عنبر مختلط ١٠ أسرّة' },
    description: { en: 'A bunk bed in the mixed dorm.', es: 'Una litera en el dormitorio mixto.', fr: 'Un lit superposé dans le dortoir mixte.', ar: 'سرير بطابقين في العنبر المختلط.' },
    features: ['shared_bath'],
    publishedPrice: 17, photos: p('2126446/2126446/2ab3201c-0e40-4d1a-944f-328648dc6bda', '2126451/2126451/1cfd97d9-2783-4738-9b77-0756b334c556', '2126450/2126450/6f9e02bb-9a87-42d9-81fb-bbea580e13c7', '2126447/2126447/a2f70c07-10ae-4bf3-8673-e1e20d6a29bd') },
];

/** imgix resize helper (works for the catalogue photos; other URLs are returned unchanged). */
export const sized = (url: string, w: number) => (url.includes('imgix.net') ? `${url}?w=${w}&auto=format&fit=crop` : url);
