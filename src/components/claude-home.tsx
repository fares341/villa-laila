'use client';

import { convertCents, formatPrice, FX_FALLBACK, type DisplayCurrency, type Fx } from '@/lib/display-currency';
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EventsSection, type EventCard } from './events-section';
import { GuestFilms, type GuestFilmsData } from './guest-films';

export type LiveRoomStatusMap = Record<
  string,
  {
    price: number;
    currency?: string;
    available: boolean;
    bedsAvailable?: number | null;
    status: 'available' | 'few_left' | 'sold_out';
  }
>;

export type ClaudeHomeProps = {
  lang: string;
  /** Visitor's currency and rates: room prices come from Hostelworld in USD and are shown converted. */
  view?: { cur: DisplayCurrency; fx: Fx };
  initialRates?: LiveRoomStatusMap;
  events?: EventCard[];
  /** From the dashboard (Website): day trips, guest films and room photos by room code. */
  tours?: { name: Loc; duration: Loc; tag: Loc; included: { ar?: string[]; en?: string[] }; excluded: Loc; image: string | null }[] | null;
  films?: GuestFilmsData | null;
  roomPhotos?: Record<string, string[]>;
  slides?: { video: string; poster: string | null; label: Loc; sub: Loc; crumb: Loc }[] | null;
};
type Loc = { ar?: string; en?: string };

const icons = {
  bed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="2" />
    </svg>
  ),
  ppl: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  left: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-[18px] h-[18px]">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  right: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-[18px] h-[18px]">
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-[18px] h-[18px]">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="m5 12 5 5 9-10" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24">
      <path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" />
    </svg>
  ),
};

const isVideo = (u: string | undefined) => !!u && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);

export function ClaudeHome({ lang = 'en', view, initialRates, events = [], tours: siteTours = null, films = null, roomPhotos = {}, slides = null }: ClaudeHomeProps) {
  const router = useRouter();
  const isAr = lang === 'ar';
  const pv = view ?? { cur: 'USD' as DisplayCurrency, fx: FX_FALLBACK };
  /** A room price (whole units in `from`, USD unless Hostelworld said otherwise) in the visitor's currency. */
  const roomPrice = (amount: number, from = 'USD') => formatPrice(convertCents(amount * 100, from, pv.cur, pv.fx), pv.cur, lang);

  // Live rates & availability state synced with Hostelworld
  const [liveRates, setLiveRates] = useState<LiveRoomStatusMap>(initialRates || {});

  // Hero Slider
  const [slideIdx, setSlideIdx] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const heroTimer = useRef<NodeJS.Timeout | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // Search Dates
  const [arrive, setArrive] = useState('');
  const [depart, setDepart] = useState('');
  const [guests, setGuests] = useState('2');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Rooms Filter
  const [roomFilter, setRoomFilter] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [modalRoom, setModalRoom] = useState<any | null>(null);
  const [modalPhotoIdx, setModalPhotoIdx] = useState(0);

  // Tours horizontal scroll ref
  const toursScrollRef = useRef<HTMLDivElement | null>(null);

  // Date initialization
  useEffect(() => {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(today.getDate() + 1);
    const d3 = new Date(today);
    d3.setDate(today.getDate() + 3);
    setArrive(iso(d1));
    setDepart(iso(d3));

    try {
      const saved = localStorage.getItem('vl-favs');
      if (saved) setFavs(new Set(JSON.parse(saved)));
    } catch (e) {}
  }, []);

  // Sync rates & availability with Hostelworld whenever arrive date changes
  useEffect(() => {
    let active = true;
    const fetchLiveRates = async () => {
      try {
        const queryDate = arrive || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const res = await fetch(
          `/api/sync/hostelworld?dateStart=${encodeURIComponent(queryDate)}&nights=1&currency=USD`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.rooms) {
          setLiveRates(data.rooms);
        }
      } catch (err) {
        // silent fallback to current cached rates
      }
    };

    if (arrive) {
      const timer = setTimeout(fetchLiveRates, 350);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [arrive]);

  // Hero Slider data (3 real videos from Villa Layla) — the dashboard (Website → Home slider) replaces them.
  const BASE_SLIDES = [
    {
      video: '/videos/hero-01.mp4',
      poster: '/photos/gallery_and_hostel/jtfzrhhp3g0fj6vdnxjq.jpeg',
      label: isAr ? 'مسبح وحديقة الفيلا' : 'Garden pool & villa',
      sub: isAr ? 'واحة في قلب السيدة زينب' : 'Oasis in El Sayeda Zeinab',
      crumb: isAr ? 'السيدة زينب · مسبح وحديقة هادئة' : 'El Sayeda Zeinab · Garden pool',
    },
    {
      video: '/videos/hero-02.mp4?v=20261025b',
      poster: '/photos/hero-02-poster.jpg?v=20261025b',
      label: isAr ? 'أجواء فيلا ليلى' : 'The villa vibes',
      sub: isAr ? 'أركان استرخاء وتراس ساحر' : 'Terraces & lounges',
      crumb: isAr ? 'فيلا قاهرية تاريخية مرممة' : 'A restored Cairo villa',
    },
    {
      video: '/videos/hero-03.mp4?v=20261025b',
      poster: '/photos/hero-03-poster.jpg?v=20261025b',
      label: isAr ? 'غرف وأجنحة ملكية' : 'Rooms & royal stay',
      sub: isAr ? 'عشر غرف خاصة لكل منها طابع' : '10 unique named rooms',
      crumb: isAr ? 'شهرزاد · جناح كينج ملكي' : 'Sheherazade · King room',
    },
  ];
  const SL = (x: Loc | undefined) => (isAr ? x?.ar || x?.en : x?.en || x?.ar) || '';
  const SLIDES = slides && slides.length
    ? slides.map((x) => ({ video: x.video, poster: x.poster ?? '', label: SL(x.label), sub: SL(x.sub), crumb: SL(x.crumb) }))
    : BASE_SLIDES;

  // Auto slide effect
  useEffect(() => {
    if (heroPaused) return;
    heroTimer.current = setTimeout(() => {
      setSlideIdx((prev) => (prev + 1) % SLIDES.length);
    }, 7000);
    return () => {
      if (heroTimer.current) clearTimeout(heroTimer.current);
    };
  }, [slideIdx, heroPaused, SLIDES.length]);

  // Synchronize video playback with current slide (iOS Safari & cross-browser optimized)
  useEffect(() => {
    videoRefs.current.forEach((vid, i) => {
      if (!vid) return;
      vid.muted = true;
      vid.defaultMuted = true;
      if (i === slideIdx && !heroPaused) {
        vid.currentTime = 0;
        const p = vid.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } else {
        vid.pause();
      }
    });
  }, [slideIdx, heroPaused]);

  // Handle Search Submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!arrive) {
      setSearchError(isAr ? 'اختر تاريخ تسجيل الوصول.' : 'Choose your check-in date.');
      return;
    }
    if (!depart) {
      setSearchError(isAr ? 'اختر تاريخ تسجيل المغادرة.' : 'Choose your check-out date.');
      return;
    }
    if (depart <= arrive) {
      setSearchError(isAr ? 'يجب أن يكون تاريخ المغادرة بعد يوم الوصول.' : 'Check-out must be at least one night after check-in.');
      return;
    }
    setSearchError(null);
    setSearchLoading(true);
    router.push(`/${lang}/book?checkIn=${encodeURIComponent(arrive)}&checkOut=${encodeURIComponent(depart)}&guests=${encodeURIComponent(guests)}`);
  };

  // Toggle favorite
  const toggleFav = (slug: string) => {
    const next = new Set(favs);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setFavs(next);
    try {
      localStorage.setItem('vl-favs', JSON.stringify([...next]));
    } catch (e) {}
  };

  // Scroll to booking search
  const scrollToBook = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const el = document.getElementById('arrive-input');
    if (el) setTimeout(() => el.focus(), 800);
  };

  // WhatsApp quick link
  const wa = (msg: string) => `https://wa.me/201040551515?text=${encodeURIComponent(msg + (isAr ? ' — فيلا ليلى' : ' — Villa Layla'))}`;

  // Rooms Data
  const BASE_ROOMS = [
    {
      slug: 'sheherazade',
      name: isAr ? 'شهرزاد' : 'Sheherazade',
      ar: 'شهرزاد',
      bed: isAr ? 'سرير كينج' : 'King bed',
      bedKey: 'king',
      sleeps: 2,
      price: 75,
      tag: isAr ? 'الغرفة الملكية' : 'Signature room',
      desc: isAr ? 'غرفة مزدوجة فسيحة بسرير كينج، حمام خاص داخلي وتكييف مستقل.' : 'King-size double room with private en-suite bathroom and air conditioning.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126388/2126388/033788c5-e7f0-4daa-a8ee-f8e512c018a7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126389/2126389/cd2761af-6f0f-452f-8597-b56375dc606f',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126384/2126384/5ea3824f-b382-47ee-9ade-9a05c63903c5',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126387/2126387/5bd4e55b-199e-4fb7-b762-616a54abad7b',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126386/2126386/8019f313-63c3-47a1-af44-c47dfdb052fc',
      ],
      kind: 'private',
    },
    {
      slug: 'ibn-battuta',
      name: isAr ? 'ابن بطوطة' : 'Ibn Battuta',
      ar: 'ابن بطوطة',
      bed: isAr ? 'سرير كوين' : 'Queen bed',
      bedKey: 'queen',
      sleeps: 2,
      price: 65,
      desc: isAr ? 'غرفة بسرير كوين مزدوج، حمام خاص وديكور مستوحى من رحلات ابن بطوطة.' : 'Queen-size double room with private bathroom inspired by Ibn Battuta travels.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126498/2126498/0c6cbf2c-27cf-4210-a2e8-72f5ee1c2d55',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126499/2126499/cfd5dea1-de6e-4a3b-89ac-1cb46db34241',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126497/2126497/9b03da7e-8b7b-4a48-8054-5568dba23e5d',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126503/2126503/2b695ae3-ff55-49e0-ad83-9eacd4dd4609',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126504/2126504/1c1d6f18-58ca-4ca6-8b64-119ef170920b',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126514/2126514/0a870d3a-09b9-45b1-8368-0db9065fd992',
      ],
      kind: 'private',
    },
    {
      slug: 'mamluk',
      name: isAr ? 'مملوك' : 'Mamluk',
      ar: 'مملوك',
      bed: isAr ? 'سرير كينج' : 'King bed',
      bedKey: 'king',
      sleeps: 2,
      price: 64,
      desc: isAr ? 'طابع مملوكي أصيل، سرير كينج، حمام خاص وإطلالة هادئة.' : 'Authentic Mamluk atmosphere, king-size bed, private bathroom, and quiet courtyard view.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126560/2126560/b3184152-d9ea-49cf-a782-2dfc3840d3ec',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126561/2126561/a1557524-f880-475b-a59f-53821dbbe07d',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126555/2126555/966b6017-d78b-4703-9b05-4d5c2ba396d7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126559/2126559/ffd2d8eb-535f-48b8-ad56-2eda6fed6d2c',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126554/2126554/cc348b83-61e0-4dd1-af30-55458faa5e6d',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126570/2126570/473d384f-2b0d-4300-9060-1da65c91651b',
      ],
      kind: 'private',
    },
    {
      slug: 'golden-room',
      name: isAr ? 'الغرفة الذهبية' : 'Golden Room',
      ar: 'الغرفة الذهبية',
      bed: isAr ? 'سرير كينج' : 'King bed',
      bedKey: 'king',
      sleeps: 2,
      price: 49,
      desc: isAr ? 'إضاءة دافئة وزخارف مذهبة، سرير كينج وحمام خاص مجهز.' : 'Warm ambient golden hues, king bed, and private bathroom.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126577/2126577/ff7371b5-b974-4a50-95a7-b23139fbff50',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126574/2126574/c08bdf33-1265-435a-b02a-4f5a9a8b7ebd',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126575/2126575/99517e7a-98ac-4b52-9b67-09b9ed651988',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126573/2126573/9f9dc2ed-d627-4756-a06a-03e8fe2a46a0',
      ],
      kind: 'private',
    },
    {
      slug: 'french-lady',
      name: isAr ? 'السيدة الفرنسية' : 'French Lady',
      ar: 'السيدة الفرنسية',
      bed: isAr ? 'سرير كينج أو سريران' : 'King or twin beds',
      bedKey: 'twin king',
      sleeps: 2,
      price: 75,
      tag: isAr ? 'غرفة مميزة' : 'Signature room',
      desc: isAr ? 'طراز فرنسي كلاسيكي أنيق، خيار سرير كينج أو سريرين منفصلين مع حمام خاص.' : 'Elegant classical French style, flexible king or twin beds, private bathroom.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126531/2126531/f1aadc8d-2354-4e68-bb15-f3fc8c566dc8',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126529/2126529/3b8f9332-e829-4ef8-b1f3-c2fe12f194d3',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126527/2126527/e43faeef-788b-4794-b504-aaeb5e8019cd',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126526/2126526/033f90b3-286d-47b1-a363-db48d5415c5d',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126528/2126528/6fe6fee8-16e0-4613-9c9c-32229838a6b6',
      ],
      kind: 'private',
    },
    {
      slug: 'folklore',
      name: isAr ? 'فولكلور' : 'Folklore',
      ar: 'فولكلور',
      bed: isAr ? 'سريران فرديان' : 'Two single beds',
      bedKey: 'twin',
      sleeps: 2,
      price: 65,
      desc: isAr ? 'سريران فرديان، وصول مباشر للمسبح وحمام خاص بجوار الغرفة.' : 'Twin single beds with direct pool access and private bathroom just outside the door.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126543/2126543/50880502-92de-4f4d-8797-de4bc1254253',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126537/2126537/ad1e2b9f-63e8-4508-84ad-2eb85c3f0474',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126542/2126542/58273dd4-2b0a-48a4-9923-bd941c5a9b41',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126538/2126538/23d90115-d01d-433d-b281-80548cfc7530',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126536/2126536/4f8be223-26d8-4897-86a0-d7e1ae2d2d4f',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126547/2126547/633b6f62-a72f-45c6-870d-b57c1f692e3b',
      ],
      kind: 'private',
    },
    {
      slug: 'violet',
      name: isAr ? 'فيوليت' : 'Violet',
      ar: 'فيوليت',
      bed: isAr ? 'سرير كينج' : 'King bed',
      bedKey: 'king',
      sleeps: 2,
      price: 59,
      desc: isAr ? 'سرير كينج مريح، تكييف، وحمام مشترك مجاور.' : 'Cozy king-size room with air conditioning and shared bathroom.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126429/2126429/0e8e55a5-5212-46e4-94fc-8447ab1fe9db',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126432/2126432/6e7b5576-2493-47d3-a664-63730d9563a7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126428/2126428/52542935-ce5a-40fe-974a-357f6443fd4e',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126426/2126426/51c23851-66c5-409f-a81f-1eced8ed2db8',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126430/2126430/1bf7b970-a254-48cd-837c-9eda030791a4',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126438/2126438/0d92cfc5-50bc-4584-87fe-9c2f35929506',
      ],
      kind: 'private',
    },
    {
      slug: 'islamic',
      name: isAr ? 'الإسلامية' : 'Islamic',
      ar: 'الإسلامية',
      bed: isAr ? 'سرير كينج' : 'King bed',
      bedKey: 'king',
      sleeps: 2,
      price: 49,
      desc: isAr ? 'زخارف إسلامية دافئة، سرير كينج كبير، وتكييف هواء.' : 'Islamic geometric motifs, spacious king bed, and air conditioning.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126477/2126477/3adf9b35-2584-42aa-a946-339c729fc5d7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126478/2126478/68d5987f-db69-452d-bc4a-0cd9708930ec',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126474/2126474/81fb2a67-dee5-486d-8c59-22a44862f226',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126471/2126471/ca231fe9-a77a-4653-a1f8-5e049ddb87ca',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126472/2126472/71d0a301-bf69-4621-b273-a13f31b20ea3',
      ],
      kind: 'private',
    },
    {
      slug: 'amira',
      name: isAr ? 'أميرة' : 'Amira',
      ar: 'أميرة',
      bed: isAr ? 'سرير كينج' : 'King bed',
      bedKey: 'king',
      sleeps: 2,
      price: 59,
      desc: isAr ? 'غرفة أميرة المريحة بسرير كينج، إطلالة هادئة ومكتب عمل.' : 'Serene Amira room with king bed, quiet courtyard view, and work desk.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126484/2126484/4a450c72-1ca8-4349-9f50-1548977aa6c2',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126485/2126485/a92c034e-f318-401c-a2df-0fef47ada104',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126483/2126483/346ae365-b6c0-4f21-8b96-38ee7e314609',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126487/2126487/c97a2eb0-d87b-4123-b549-52bec727a503',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126481/2126481/d9f4c3ca-229a-4653-a20e-219412311e5d',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126492/2126492/f4fd5c6b-53ea-4967-8854-3ed1979b8cc9',
      ],
      kind: 'private',
    },
    {
      slug: 'triple',
      name: isAr ? 'الثلاثية' : 'Triple',
      ar: 'الثلاثية',
      bed: isAr ? 'سرير كينج + سرير فردي' : 'King + single bed',
      bedKey: 'king twin',
      sleeps: 3,
      price: 59,
      desc: isAr ? 'تتسع لثلاثة أشخاص، سرير كينج وسرير فردي وتراس خارجي.' : 'Accommodates 3 guests with king bed plus single bed, and an outdoor terrace.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126401/2126401/2aaf0de2-7edc-4fb2-bf3f-20dd51c48fa3',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126403/2126403/7d0731f3-ad47-4b42-b243-2b53a1d9a243',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126402/2126402/9fb8950e-f9b0-4e82-8624-162999b628b6',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126396/2126396/966b9193-c498-4ded-bf63-e46f520870c7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126400/2126400/f1814d61-b50b-4817-b94f-ab7cafa7d866',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126407/2126407/ff213972-0393-4718-98e7-4b0691ec1b17',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126408/2126408/e06c65f8-9690-4439-a5be-22d6bca4a269',
      ],
      kind: 'private',
    },
    // Dorms
    {
      slug: 'female-dorm-8',
      name: isAr ? 'عنبر نسائي واسع ٨ أسرّة' : 'Spacious 8-bed female dorm',
      ar: 'عنبر نسائي ٨ أسرّة',
      tag: isAr ? 'للسيدات فقط' : 'Women only',
      bed: isAr ? '٨ أسرّة بطابقين' : '8 bunk beds',
      sleeps: 8,
      price: 18,
      perBed: true,
      who: 'women',
      desc: isAr ? 'عنبر فسيح مخصص للسيدات فقط يطل على المسبح، مع تكييف وخزائن آمنة.' : 'Spacious women-only dorm overlooking the pool, with air conditioning and secure lockers.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126368/2126368/d413d906-7c4c-4b57-a9e1-454880f83e0b',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126362/2126362/3d7dc9be-0a9d-4a4e-9591-58ed1d25eb87',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126370/2126370/eaf955ec-f101-46d8-b626-161e44dba1e8',
      ],
      kind: 'dorm',
    },
    {
      slug: 'female-dorm-6',
      name: isAr ? 'عنبر نسائي ٦ أسرّة' : '6-bed female dorm',
      ar: 'عنبر نسائي ٦ أسرّة',
      tag: isAr ? 'للسيدات فقط' : 'Women only',
      bed: isAr ? '٦ أسرّة فردية' : '6 beds',
      sleeps: 6,
      price: 18,
      perBed: true,
      who: 'women',
      desc: isAr ? 'عنبر هادئ مخصص للسيدات فقط يطل على الفناء الداخلي.' : 'Cozy, quiet women-only dorm facing the courtyard.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126454/2126454/ce2a6a57-368b-4cd8-ba54-af7f028ce926',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126457/2126457/e529f8e4-4aff-4872-9503-1d928e0970ea',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126455/2126455/09eab609-4348-41f0-b6ba-f5c4d6333e88',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126458/2126458/d8e1a98d-f749-4968-a27b-5d80cf8e1910',
      ],
      kind: 'dorm',
    },
    {
      slug: 'male-dorm-8-pool',
      name: isAr ? 'عنبر رجالي واسع ٨ أسرّة' : 'Spacious 8-bed male dorm',
      ar: 'عنبر رجالي ٨ أسرّة',
      tag: isAr ? 'للرجال فقط' : 'Men only',
      bed: isAr ? '٨ أسرّة بطابقين' : '8 bunk beds',
      sleeps: 8,
      price: 18,
      perBed: true,
      who: 'men',
      desc: isAr ? 'عنبر شبابي واسع يطل مباشرة على المسبح والحديقة.' : 'Spacious men-only dorm with a direct view of the swimming pool and garden.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126469/2126469/d37d593d-9707-4354-896a-6f88d004d2e4',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126468/2126468/11b4406c-3bbe-41e9-a6c2-e42557861c4d',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126467/2126467/06a90edb-9439-4cbf-a6b2-8fe574d60ad7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126466/2126466/cbb58fce-fc9f-4db1-8f6f-20ebd7938a2c',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126461/2126461/2d03ea66-34a8-4cef-879e-01400c290b45',
      ],
      kind: 'dorm',
    },
    {
      slug: 'male-dorm-8',
      name: isAr ? 'عنبر رجالي ٨ أسرّة' : '8-bed male dorm',
      ar: 'عنبر رجالي ٨ أسرّة',
      tag: isAr ? 'للرجال فقط' : 'Men only',
      bed: isAr ? '٨ أسرّة فردية' : '8 single beds',
      sleeps: 8,
      price: 17,
      perBed: true,
      who: 'men',
      desc: isAr ? 'أسرّة فردية مريحة في عنبر مكيّف مع خزائن خاصة.' : 'Comfortable single beds in an air-conditioned dorm with private guest lockers.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126418/2126418/b8ea57d8-fae1-4736-b637-68bf2e4c736f',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126417/2126417/3b08dd5b-22ca-416e-8fe0-f7a831491435',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126419/2126419/abb7f801-0bbc-434c-94f5-4e493abb91be',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126414/2126414/f4e65c84-cdc0-4820-a2e6-7c9f628587e2',
      ],
      kind: 'dorm',
    },
    {
      slug: 'mixed-dorm-10',
      name: isAr ? 'عنبر مختلط ١٠ أسرّة' : '10-bed mixed dorm',
      ar: 'عنبر مختلط ١٠ أسرّة',
      tag: isAr ? 'للجميع' : 'Everyone',
      bed: isAr ? '١٠ أسرّة بطابقين' : '10 bunk beds',
      sleeps: 10,
      price: 17,
      perBed: true,
      who: 'mixed',
      desc: isAr ? 'سرير بطابقين في عنبر اجتماعي ممتع للمسافرين حول العالم.' : 'A bunk bed in our lively international backpackers mixed dorm.',
      photos: [
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126446/2126446/2ab3201c-0e40-4d1a-944f-328648dc6bda',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126451/2126451/1cfd97d9-2783-4738-9b77-0756b334c556',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126450/2126450/6f9e02bb-9a87-42d9-81fb-bbea580e13c7',
        'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126447/2126447/a2f70c07-10ae-4bf3-8673-e1e20d6a29bd',
      ],
      kind: 'dorm',
    },
  ];
  // Room photos are managed in the dashboard (Website → Room photos); the list above is the fallback.
  const ALL_ROOMS = BASE_ROOMS.map((r) => (roomPhotos[r.slug]?.length ? { ...r, photos: roomPhotos[r.slug] } : r));

  const filteredRooms = ALL_ROOMS.filter((r) => {
    if (roomFilter === 'all') return true;
    if (roomFilter === 'private') return r.kind === 'private';
    if (roomFilter === 'dorms') return r.kind === 'dorm';
    if (roomFilter === 'women') return r.who === 'women';
    if (roomFilter === 'king') return r.bedKey?.includes('king');
    if (roomFilter === 'twin') return r.bedKey?.includes('twin');
    return true;
  });

  const SERVICES = [
    {
      t: isAr ? 'غرف خاصة' : 'Private room',
      d: isAr ? '١٠ غرف لكل منها اسمها' : '10 named rooms',
      go: '#stay',
      filter: 'private',
      img: 'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126498/2126498/0c6cbf2c-27cf-4210-a2e8-72f5ee1c2d55',
    },
    {
      t: isAr ? 'سرير في عنبر' : 'Dorm bed',
      d: isAr ? 'ابتداءً من $17 في الليلة' : 'From $17 a night',
      go: '#stay',
      filter: 'dorms',
      img: 'https://tbb-prod-emea.imgix.net/attachments/room_type_photos/images/2126446/2126446/2ab3201c-0e40-4d1a-944f-328648dc6bda',
    },
    {
      t: isAr ? 'رحلات يومية' : 'Day tours',
      d: isAr ? '٧ رحلات تنطلق يومياً' : '7 trips, daily',
      go: '#tours',
      filter: 'all',
      img: '/photos/gallery_and_hostel/Sultan_Hassan_Mosque___Madrasa.jpg',
    },
    {
      t: isAr ? 'توصيل من المطار' : 'Airport pickup',
      d: isAr ? 'ترتيب سريع عبر واتساب' : 'Arranged on WhatsApp',
      go: wa(isAr ? 'حجز توصيل من المطار' : 'Airport pickup'),
      filter: 'all',
      img: '/photos/gallery_and_hostel/f3.jpg',
    },
    {
      t: isAr ? 'إقامة وعمل هادئ' : 'Work & stay',
      d: isAr ? 'واي فاي سريع ومكاتب' : 'Fast Wi-Fi, quiet desks',
      go: '#stay',
      filter: 'all',
      img: '/photos/gallery_and_hostel/joxg0ghsuozk2omoecp6.jpg',
    },
  ];

  const BASE_TOURS = [
    {
      name: isAr ? 'أهرامات الجيزة وسقارة وميت رهينة' : 'Pyramids of Giza, Saqqara & Memphis',
      dur: isAr ? '٧–٨ ساعات · تبدأ 8:30 ص' : '7–8 hrs · Starts 8:30 AM',
      tag: isAr ? 'الأكثر طلباً' : 'Most booked',
      img: '/photos/gallery_and_hostel/grand.avif',
      incl: isAr
        ? ['أهرامات الجيزة الثلاثة وأبو الهول والبانوراما', 'سقارة وهرم زوسر وهرم تيتي وأوناس (دخول أوناس مجاناً)', 'ميت رهينة أول عاصمة لمصر ومتحف رمسيس الثاني المفتوح', 'سيارة خاصة مكيفة وانتقالات كاملة من الفيلا']
        : ['Three Pyramids of Giza & Great Sphinx', 'Saqqara step pyramid, Titi & Unas (Free entry to Unas!)', 'Memphis & open-air King Ramses II museum', 'Private A/C transport & pickup from villa'],
      excl: isAr ? 'لا يشمل: تذاكر دخول المزارات' : 'Exclude: The entrance fees',
    },
    {
      name: isAr ? 'سفاري الصحراء السوداء والبيضاء' : 'The Black & White Desert Safari',
      dur: isAr ? 'يومان / ليلة واحدة' : '2 days / 1 night',
      tag: isAr ? 'مغامرة وتخييم' : 'Adventure & Camping',
      img: '/photos/gallery_and_hostel/white-dessert-egypt.png',
      incl: isAr
        ? ['انتقال مبكر للواحات البحرية والغداء بالقرية', 'سفاري جيب 4x4 للصحراء السوداء وجبل الكريستال وصخور المشروم', 'كثبان العقبات وتزلج الرمال والعيون الكبريتية الحارة والباردة', 'تخييم كامل بالصحراء البيضاء الجديدة مع عشاء المشويات والإفطار']
        : ['Early morning pickup to Bahariya oasis & village lunch', '4x4 Jeep to Black Desert, Crystal Mountain & Mushroom rocks', 'Agabat sand dunes, sandboarding & cold/hot springs', 'Camping at New White Desert with BBQ dinner & breakfast'],
      excl: isAr ? 'لا يشمل: تذاكر الدخول' : 'Exclude: The entrance fees',
    },
    {
      name: isAr ? 'الإسكندرية عروس البحر المتوسط' : 'Alexandria Day Trip',
      dur: isAr ? 'يوم كامل' : 'Full day',
      tag: isAr ? 'رحلة ساحلية' : 'Day trip',
      img: '/photos/gallery_and_hostel/Qaitbay_Citadel.jpg',
      incl: isAr
        ? ['مكتبة الإسكندرية الصرح الثقافي العالمي', 'مقابر كوم الشقافة الرومانية التاريخية', 'قلعة قايتباي الأثرية على البحر مباشرة', 'عمود السواري وسيارة خاصة مكيفة وانتقالات مريحة']
        : ['Bibliotheca Alexandrina (Alexandria Library)', 'Catacombs of Kom El Shoqafa', 'Historic Citadel of Qaitbay by the sea', 'Pompey’s Pillar & comfortable private A/C car'],
      excl: isAr ? 'لا يشمل: تذاكر الدخول' : 'Exclude: Entrance fees',
    },
    {
      name: isAr ? 'سهرة العشاء النيلي الفاخر' : 'Nile Dinner Cruise',
      dur: isAr ? 'ساعتان إبحار' : '2 hours',
      tag: isAr ? 'سهرة نيلية' : 'Evening cruise',
      img: '/photos/gallery_and_hostel/cairo-city.jpg',
      incl: isAr
        ? ['إبحار ساعتان في النيل مع بوفيه عشاء مفتوح فاخر', 'موسيقى حية وتخت شرقي أصيل', 'عروض تنورة صوفية ورقص شرقي فلكلوري', 'شاملة تذاكر الدخول وسيارة خاصة مع سائق ذهاباً وإياباً']
        : ['2-hour Nile cruise with luxury open buffet dinner', 'Live oriental music performance', 'Authentic Sufi Tanoura dance & belly dance show', 'Entrance fees and private car with driver included'],
      excl: isAr ? 'لا يشمل: المشروبات والمياه' : 'Exclude: Drinks and water',
    },
    {
      name: isAr ? 'جولة القاهرة القديمة ومتحف الحضارة' : 'Old Cairo & Civilization Museum Tour',
      dur: isAr ? 'يوم كامل' : 'Full day tour',
      tag: isAr ? 'تاريخ وتراث' : 'Heritage & History',
      img: '/photos/gallery_and_hostel/Sultan_Hassan_Mosque___Madrasa.jpg',
      incl: isAr
        ? ['القاهرة القبطية: كنيسة المغارة (أبي سرجة) والكنيسة المعلقة', 'القاهرة الإسلامية: قلعة صلاح الدين الأيوبي وجامع محمد علي', 'المتحف القومي للحضارة المصرية (NMEC) وقاعة المومياوات', 'سيارة خاصة مكيفة مع مرشد سياحي وانتقالات الفندق']
        : ['Coptic: The Cavern Church (Abu Serga) & The Hanging Church', 'Islamic: Citadel of Salah El Din & Mohamed Ali Mosque', 'National Museum of Egyptian Civilization (NMEC)', 'Private A/C vehicle & licensed guide'],
      excl: isAr ? 'لا يشمل: تذاكر الدخول' : 'Exclude: Entrance fees',
    },
    {
      name: isAr ? 'مغامرة واحة الفيوم وسفاري وادي الحيتان' : 'Fayoum Oasis & Safari Day Trip',
      dur: isAr ? 'يوم كامل' : 'Day trip',
      tag: isAr ? 'طبيعة وسفاري' : 'Nature & Safari',
      img: '/photos/gallery_and_hostel/fayoum-magic-lake.jpg',
      incl: isAr
        ? ['وادي الريان والشلالات وجبل المدورة البانورامي', 'تزلج على الرمال الناعمة في الكثبان الذهبية (Sandboarding)', 'سفاري وادي الحيتان (موقع تراث عالمي) والبحيرة المسحورة', 'زيارة قرية تونس ومدارس الفخار التقليدية + وجبة غداء طازجة']
        : ['Wadi El Rayan waterfalls & panoramic Mudawara hills', 'Sandboarding on golden desert dunes', 'Safari to Valley of Whales (Wadi El Hitan) & Magic Lake', 'Tunis Village & pottery schools visit + Fresh local Lunch'],
      excl: isAr ? 'لا يشمل: تذاكر الدخول' : 'Exclude: Entrance fees',
    },
  ];
  // Day trips are managed in the dashboard (Website → Day trips); the list above is the fallback.
  const L = (x: Loc | undefined) => (isAr ? x?.ar || x?.en : x?.en || x?.ar) || '';
  const TOURS = siteTours && siteTours.length
    ? siteTours.map((t) => ({ name: L(t.name), dur: L(t.duration), tag: L(t.tag), img: t.image || '/photos/gallery_and_hostel/grand.avif', incl: (isAr ? t.included.ar?.length ? t.included.ar : t.included.en : t.included.en?.length ? t.included.en : t.included.ar) ?? [], excl: L(t.excluded) }))
    : BASE_TOURS;

  const REVIEWS = [
    {
      n: isAr ? 'أحمد حسن' : 'Ahmed Hassan',
      trip: isAr ? 'رحلة الصحراء البيضاء · Booking.com' : 'Black & White Desert · Booking.com',
      t: isAr
        ? 'كرم ضيافة استثنائي، مسبح رائع وغرف نظيفة للغاية. موقع مثالي لزيارة القاهرة التاريخية، ورحلة الصحراء كانت قمة المتعة.'
        : 'Warm hospitality, a great pool and clean rooms. Perfect base for Islamic Cairo, and the White Desert tour was the highlight.',
    },
    {
      n: isAr ? 'توم ويلسون' : 'Tom Wilson',
      trip: isAr ? 'رحلة الإسكندرية · Booking.com' : 'Alexandria day trip · Booking.com',
      t: isAr
        ? 'جوهرة مخفية في وسط القاهرة. الفريق يعرف كل تفاصيل المدينة ونظموا لنا يوماً رائعاً في الإسكندرية بسيارة خاصة مريحة.'
        : 'A hidden gem in central Cairo. The staff know the city inside out and set up a brilliant day trip to Alexandria.',
    },
    {
      n: isAr ? 'إيما تومبسون' : 'Emma Thompson',
      trip: isAr ? 'عنبر البنات الواسع · Hostelworld' : 'Spacious female dorm · Hostelworld',
      t: isAr
        ? 'قيمة ممتازة مقابل السعر، حديقة هادئة ومسبح منعش، والواي فاي سريع جداً للعمل. عنبر البنات آمن ومريح ومكيّف بالكامل.'
        : 'Great value, a lovely garden and refreshing pool. Fast Wi-Fi for remote work, and the female dorm felt very safe, clean, and comfortable.',
    },
    {
      n: isAr ? 'سارة جونسون' : 'Sarah Johnson',
      trip: isAr ? 'إقامة فردية - غرفة أميرة · Booking.com' : 'Solo stay - Amira room · Booking.com',
      t: isAr
        ? 'المسبح والإفطار اللذيذ والرحلات المنظمة جعلت رحلتي كمسافرة بمفردي آمنة وسلسة جداً. طابع الفيلا التاريخي ساحر للغاية.'
        : 'The pool, the breakfast and the tours the staff arranged made it so easy as a solo traveller. Vintage villa with historic charm!',
    },
    {
      n: isAr ? 'ماركو رودريغيز' : 'Marco Rodriguez',
      trip: isAr ? 'غرفة ابن بطوطة · Booking.com' : 'Ibn Battuta room · Booking.com',
      t: isAr
        ? 'أحببت غرفة ابن بطوطة وتصميمها المميز. استقبال المطار ورحلة الأهرامات مع المرشد رتبها فريق العمل باحترافية وسلاسة.'
        : 'Loved the Ibn Battuta room. Airport pickup and the pyramids tour were all handled seamlessly and professionally by the team.',
    },
    {
      n: isAr ? 'كلارا بيكر' : 'Clara Becker',
      trip: isAr ? 'عنبر ٦ بنات · Hostelworld' : '6-bed female dorm · Hostelworld',
      t: isAr
        ? 'واحة من الهدوء والاسترخاء في قلب القاهرة! الحديقة والمسبح خياليان بعد يوم طويل في المعالم السياحية، والأسرة مريحة ونظيفة.'
        : 'An oasis of calm in the heart of Cairo! The garden and pool are fantastic after a long day of sightseeing, beds are super clean.',
    },
    {
      n: isAr ? 'جوليان لوران' : 'Julien Laurent',
      trip: isAr ? 'غرفة السيدة الفرنسية · Booking.com' : 'French Lady room · Booking.com',
      t: isAr
        ? 'فيلا تاريخية أصيلة بأسقف عالية وديكور كلاسيكي راقٍ. الإفطار اليومي في الحديقة المشمسة كان بداية لا تُنسى لكل صباح.'
        : 'Authentic historic villa with royal ceilings and classic decor. Daily breakfast in the sunny garden was the best way to start each day.',
    },
    {
      n: isAr ? 'جيسيكا تايلور' : 'Jessica Taylor',
      trip: isAr ? 'جولة أهرامات الجيزة · Booking.com' : 'Giza Pyramids tour · Booking.com',
      t: isAr
        ? 'طاقم الاستقبال متعاون ولطيف للغاية على مدار الساعة. رتبوا لنا التنقلات والجولات بأسعار ممتازة وأمان كامل. تجربة ١٠ من ١٠.'
        : 'The front desk team is incredibly helpful and friendly 24/7. They arranged our airport rides and tours safely at great rates. 10/10.',
    },
    {
      n: isAr ? 'عمر السيد' : 'Omar Al-Sayed',
      trip: isAr ? 'جناح شهرزاد الملكي · Booking.com' : 'Sheherazade royal suite · Booking.com',
      t: isAr
        ? 'جناح شهرزاد فخم وواسع وتكييفه ممتاز. المسبح نظيف والهدوء التام يجعلك تنسى أنك في وسط القاهرة. تجربة فندقية راقية.'
        : 'Sheherazade suite is spacious, elegant and quiet. The pool is crystal clean and the serene garden makes you forget you are in central Cairo.',
    },
    {
      n: isAr ? 'لوكاس فيبر' : 'Lukas Weber',
      trip: isAr ? 'عنبر شباب ٨ أسرّة · Hostelworld' : '8-bed male dorm · Hostelworld',
      t: isAr
        ? 'أفضل مكان أقمت فيه في مصر! مساحات عمل مريحة وإنترنت ممتاز، ولقاء مسافرين رائعين حول المسبح مساءً. أنصح به بشدة.'
        : 'The best hostel I stayed at in Egypt! Great workspaces, fast internet, and wonderful fellow travelers around the pool in the evening.',
    },
  ];

  const FAQS = [
    {
      q: isAr ? 'ما هي مواعيد تسجيل الوصول والمغادرة؟' : 'What time is check-in and check-out?',
      a: isAr
        ? 'تسجيل الوصول يبدأ من الساعة 15:00 وتسجيل المغادرة حتى الساعة 11:00 صباحاً. مكتب الاستقبال مفتوح من 08:00 إلى 22:00، واستقبال واتساب متاح 24/7 لأي وصول متأخر.'
        : 'Check-in is from 15:00 and check-out is by 11:00. The front desk is open 08:00–22:00, and WhatsApp reception answers 24/7.',
    },
    {
      q: isAr ? 'هل الإفطار مشمول في الإقامة؟' : 'Is breakfast included?',
      a: isAr
        ? 'نعم، يُقدَّم إفطار طازج يومياً في حديقة الفيلا من الساعة 8:00 إلى 11:00 صباحاً مع خيارات نباتية وحلال.'
        : 'Breakfast is served every morning in the garden from 8:00 to 11:00, with vegetarian, vegan, and halal options.',
    },
    {
      q: isAr ? 'هل يمكن ترتيب التوصيل من وإلى المطار؟' : 'Can you arrange airport pickup?',
      a: isAr
        ? 'بكل سرور. راسل الاستقبال على واتساب مع تفاصيل رحلتك وموعد الوصول وسيكون سائقنا بانتظارك في المطار.'
        : 'Yes. Message reception on WhatsApp with your flight number and arrival time, and our driver will meet you.',
    },
    {
      q: isAr ? 'هل تتوفر عنابر مخصصة للسيدات فقط؟' : 'Are there women-only dorms?',
      a: isAr
        ? 'نعم، لدينا عنبر نسائي فسيح ٨ أسرّة يطل على المسبح، وعنبر ٦ أسرّة هادئ، بالإضافة لعنابر للرجال وعنبر مختلط.'
        : 'Yes, we have an 8-bed and a 6-bed women-only dorm, as well as men-only dorms and one mixed dorm.',
    },
    {
      q: isAr ? 'كيف يمكنني حجز رحلة يومية للأهرامات أو الصحراء؟' : 'How do I book a tour?',
      a: isAr
        ? 'الرحلات تنطلق يومياً من الفيلا. يمكنك طلب الحجز عبر واتساب أو في مكتب الاستقبال فور وصولك وسنؤكد لك الموعد والسعر فوراً.'
        : 'Tours run daily from the villa. Message reception on WhatsApp or speak to the front desk upon arrival for instant confirmation.',
    },
  ];

  return (
    <>
      {/* ================= HERO SLIDER ================= */}
      <section className={`hero ${heroPaused ? 'paused' : ''}`} id="top">
        <div className="slides">
          {SLIDES.map((s, idx) => (
            <div key={idx} className={`slide ${idx === slideIdx ? 'on' : ''}`}>
              <img src={s.poster} alt={s.label} fetchPriority={idx === 0 ? 'high' : 'low'} />
              {s.video && (
                <video
                  ref={(el) => {
                    videoRefs.current[idx] = el;
                    if (el) {
                      el.muted = true;
                      el.defaultMuted = true;
                    }
                  }}
                  muted
                  playsInline
                  loop
                  autoPlay={idx === 0}
                  preload={idx === 0 ? 'auto' : 'metadata'}
                  src={s.video}
                  className="ready"
                  controls={false}
                  disablePictureInPicture
                  disableRemotePlayback
                />
              )}
            </div>
          ))}
        </div>

        <div className="wrap hero-in">
          <span className="crumb">
            <i className="pin" />
            <span>{SLIDES[slideIdx].crumb}</span>
          </span>

          <h1>
            {isAr ? (
              <>
                واحتك الهادئة في <em>قلب القاهرة</em>
              </>
            ) : (
              <>
                Your oasis in the <em>heart of Cairo</em>.
              </>
            )}
          </h1>

          <p className="hero-sub">
            {isAr
              ? 'فيلا تاريخية مرممة بمسبح في الحديقة، عشر غرف خاصة لكل منها طابعها، عنابر بالسرير، إفطار يومي، ورحلات تنطلق من باب الفيلا.'
              : 'A restored villa with a garden pool, ten named private rooms, dorms by the bed, breakfast every morning and daily tours from the door.'}
          </p>

          {/* Search Booking Bar */}
          <form className="search" onSubmit={handleSearchSubmit}>
            <div className={`sf ${searchError ? 'invalid' : ''}`}>
              <label htmlFor="arrive-input">{isAr ? 'تاريخ الوصول' : 'Check-in'}</label>
              <input
                id="arrive-input"
                type="date"
                required
                value={arrive}
                onChange={(e) => {
                  setArrive(e.target.value);
                  setSearchError(null);
                }}
              />
            </div>
            <div className={`sf ${searchError ? 'invalid' : ''}`}>
              <label htmlFor="depart-input">{isAr ? 'تاريخ المغادرة' : 'Check-out'}</label>
              <input
                id="depart-input"
                type="date"
                required
                value={depart}
                onChange={(e) => {
                  setDepart(e.target.value);
                  setSearchError(null);
                }}
              />
            </div>
            <div className="sf">
              <label htmlFor="guests-select">{isAr ? 'النزلاء' : 'Guests'}</label>
              <select id="guests-select" value={guests} onChange={(e) => setGuests(e.target.value)}>
                <option value="1">{isAr ? 'ضيف واحد (1)' : '1 guest'}</option>
                <option value="2">{isAr ? 'ضيفان (2)' : '2 guests'}</option>
                <option value="3">{isAr ? '3 ضيوف' : '3 guests'}</option>
                <option value="4">{isAr ? '4 ضيوف' : '4 guests'}</option>
                <option value="5">{isAr ? '5+ ضيوف' : '5+ guests'}</option>
              </select>
            </div>
            <button className={`btn btn-book ${searchLoading ? 'loading' : ''}`} type="submit">
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              {isAr ? 'تحقق من التوفر' : 'Check availability'}
            </button>
            {searchError && (
              <p className="form-msg">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v6M12 16.5v.5" />
                </svg>
                {searchError}
              </p>
            )}
          </form>

          {/* Hero Footer Controls */}
          <div className="hero-foot">
            <div className="scores">
              <span className="score">
                <b>9.5</b>Booking.com
              </span>
              <span className="score">
                <b>9.8</b>Hostelworld
              </span>
              <span className="score" style={{ paddingInlineStart: '12px' }}>
                {isAr ? 'أفضل سعر مضمون عند الحجز المباشر' : 'Best rate when you book direct'}
              </span>
            </div>

            <div className="hero-ctrl">
              <div className="slide-tabs" role="tablist">
                {SLIDES.map((s, idx) => (
                  <button
                    key={idx}
                    role="tab"
                    className={idx === slideIdx ? 'on' : ''}
                    aria-selected={idx === slideIdx}
                    onClick={() => setSlideIdx(idx)}
                  >
                    <b>{s.label}</b>
                    <small>{s.sub}</small>
                  </button>
                ))}
              </div>

              <div className="hero-dots">
                {SLIDES.map((_, idx) => (
                  <i key={idx} className={idx === slideIdx ? 'on' : ''} />
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="hbtn"
                  onClick={() => setSlideIdx((prev) => (prev - 1 + SLIDES.length) % SLIDES.length)}
                  aria-label="Previous slide"
                >
                  {isAr ? icons.right : icons.left}
                </button>
                <button
                  className="hbtn"
                  onClick={() => setSlideIdx((prev) => (prev + 1) % SLIDES.length)}
                  aria-label="Next slide"
                >
                  {isAr ? icons.left : icons.right}
                </button>
                <button
                  className="hbtn"
                  onClick={() => setHeroPaused(!heroPaused)}
                  aria-label={heroPaused ? 'Play' : 'Pause'}
                >
                  {heroPaused ? (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 4.5v15l13-7.5z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= SERVICES ================= */}
      <section className="sec band-light" id="svc-sec">
        <div className="wrap">
          <div className="sec-hd">
            <div>
              <span className="kicker">{isAr ? 'فيلا ليلى' : 'The Villa'}</span>
              <h2>{isAr ? 'كل ما تحتاجه لإقامة قاهرية لا تُنسى.' : 'Everything you need for an easy stay in Cairo.'}</h2>
            </div>
          </div>

          <div className="svc">
            {SERVICES.map((s, idx) => (
              <a
                key={idx}
                href={s.go}
                onClick={(e) => {
                  if (s.go.startsWith('#')) {
                    e.preventDefault();
                    if (s.filter) setRoomFilter(s.filter);
                    const el = document.getElementById('stay');
                    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });
                  }
                }}
                target={s.go.startsWith('http') ? '_blank' : undefined}
                rel={s.go.startsWith('http') ? 'noopener noreferrer' : undefined}
              >
                <img src={s.img} alt={s.t} loading="lazy" />
                <span className="go">{icons.arrow}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ================= EVENTS ================= */}
      <EventsSection lang={lang} events={events} limit={6} />

      {/* ================= ROOMS & DORMS ================= */}
      <section className="sec band-white" id="stay">
        <div className="wrap">
          <div className="sec-hd">
            <div>
              <span className="kicker">{isAr ? 'أين ستقيم' : 'Where you sleep'}</span>
              <h2>{isAr ? 'غرف خاصة وعنابر مريحة.' : 'Private rooms and dorms by the bed.'}</h2>
              <p>
                {isAr
                  ? 'عشر غرف خاصة لكل منها طابع واسم، وعنابر هادئة مكيفة للسيدات والرجال، مسبح الحديقة وإفطار طازج كل صباح.'
                  : 'Ten named private rooms and quiet air-conditioned dorms. Pool access and breakfast included.'}
              </p>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="tabs">
            {[
              ['all', isAr ? 'الكل' : 'All', ALL_ROOMS.length],
              ['private', isAr ? 'غرف خاصة' : 'Private', 10],
              ['king', isAr ? 'سرير كينج' : 'King bed', undefined],
              ['twin', isAr ? 'سريران منفصلان' : 'Twin beds', undefined],
              ['dorms', isAr ? 'عنابر' : 'Dorms', 5],
              ['women', isAr ? 'للسيدات فقط' : 'Women only', undefined],
            ].map(([k, label, count]) => (
              <button
                key={k as string}
                className="tab"
                aria-pressed={roomFilter === k}
                onClick={() => setRoomFilter(k as string)}
              >
                {label} {count !== undefined && <span className="n">{count}</span>}
              </button>
            ))}
          </div>

          {/* Room Cards Grid */}
          <div className="cards">
            {filteredRooms.map((r) => {
              const dorm = !!r.perBed;
              const live = liveRates[r.slug];
              const effectivePrice = live?.price && live.price > 0 ? live.price : r.price;
              const priceFrom = live?.price && live.price > 0 ? live.currency || 'USD' : 'USD';
              const isAvailable = live ? live.available : true;
              const bedsLeft = live?.bedsAvailable;

              return (
                <article key={r.slug} className={`card ${!isAvailable ? 'sold-out' : ''}`}>
                  <div className="media">
                    {r.tag ? (
                      <span className={`badge ${r.tag.includes('الملكية') || r.tag.includes('Signature') ? 'gold' : ''}`}>
                        {r.tag}
                      </span>
                    ) : effectivePrice >= 75 ? (
                      <span className="badge gold">{isAr ? 'غرفة مميزة' : 'Signature room'}</span>
                    ) : null}

                    {/* Live Availability Badge from Hostelworld */}
                    {live && (
                      <span className={`live-avail ${isAvailable ? 'ok' : 'full'}`}>
                        {isAvailable && <span className="live-dot" />}
                        {!isAvailable
                          ? isAr ? 'مكتمل اليوم' : 'Sold out today'
                          : bedsLeft && bedsLeft <= 2
                          ? isAr ? `متبقي ${bedsLeft} فقط` : `Only ${bedsLeft} left`
                          : isAr ? 'متاح للحجز' : 'Available'}
                      </span>
                    )}

                    <button
                      className="fav"
                      aria-label="Save"
                      aria-pressed={favs.has(r.slug)}
                      onClick={() => toggleFav(r.slug)}
                    >
                      {icons.heart}
                    </button>

                    <div className="strip" onClick={() => { setModalRoom({ ...r, effectivePrice, priceFrom, isAvailable, bedsLeft }); setModalPhotoIdx(0); }}>
                      {r.photos.map((p, k) => (
                        isVideo(p)
                          ? <video key={k} src={p} muted loop playsInline autoPlay={k === 0} preload="metadata" aria-label={`${r.name} video`} />
                          : <img key={k} src={p} alt={`${r.name} photo ${k + 1}`} loading="lazy" />
                      ))}
                    </div>

                    <div className="dots">
                      {r.photos.map((_, k) => (
                        <i key={k} className={k === 0 ? 'on' : ''} />
                      ))}
                    </div>
                  </div>

                  <div className="body">
                    <div className="meta">
                      <span>{icons.bed} {r.bed}</span>
                      <span>
                        {icons.ppl} {dorm ? (isAr ? `${r.sleeps} أسرّة` : `${r.sleeps} beds`) : (isAr ? `تتسع لـ ${r.sleeps}` : `Sleeps ${r.sleeps}`)}
                      </span>
                    </div>

                    <div className="ttl">
                      <h3>{r.name}</h3>
                      {!isAr && <span className="ar-name">{r.ar}</span>}
                    </div>

                    <p className="desc">{r.desc}</p>

                    <div className="row">
                      <div className="price">
                        <small>{isAr ? 'ابتداءً من' : 'From'}</small>
                        <b className="num">
                          {roomPrice(effectivePrice, priceFrom)}
                          <span> / {dorm ? (isAr ? 'للسرير' : 'bed') : (isAr ? 'لليلة' : 'night')}</span>
                        </b>
                      </div>

                      <div className="acts">
                        <button
                          className="btn btn-line"
                          onClick={() => {
                            setModalRoom({ ...r, effectivePrice, priceFrom, isAvailable, bedsLeft });
                            setModalPhotoIdx(0);
                          }}
                        >
                          {isAr ? 'التفاصيل' : 'Details'}
                        </button>
                        <button className="btn btn-primary" onClick={scrollToBook}>
                          {isAvailable ? (isAr ? 'احجز' : 'Book') : (isAr ? 'اختر تواريخ' : 'Dates')}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= ROOM DETAILS MODAL ================= */}
      {modalRoom && (
        <div className="dlg-backdrop" onClick={() => setModalRoom(null)}>
          <div className="dlg-box" onClick={(e) => e.stopPropagation()}>
            <button className="dlg-close" onClick={() => setModalRoom(null)} aria-label="Close">
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>

            <div className="dlg-grid">
              <div className="dlg-m">
                {isVideo(modalRoom.photos[modalPhotoIdx])
                  ? <video key={modalRoom.photos[modalPhotoIdx]} className="dlg-main" src={modalRoom.photos[modalPhotoIdx]} controls autoPlay muted playsInline />
                  : <img className="dlg-main" src={modalRoom.photos[modalPhotoIdx]} alt={modalRoom.name} />}
                <div className="dlg-th">
                  {modalRoom.photos.map((p: string, idx: number) => (
                    <button
                      key={idx}
                      aria-current={idx === modalPhotoIdx}
                      onClick={() => setModalPhotoIdx(idx)}
                    >
                      {isVideo(p) ? <video src={`${p}#t=0.5`} muted playsInline preload="metadata" aria-hidden /> : <img src={p} alt="" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dlg-b">
                <div>
                  <span className="kicker">{modalRoom.perBed ? modalRoom.tag : (isAr ? 'غرفة خاصة' : 'Private room')}</span>
                  <h3>{modalRoom.name}</h3>
                  {!isAr && <div className="ar-font text-bronze text-xl mt-1">{modalRoom.ar}</div>}
                </div>

                <p style={{ color: 'var(--color-text-secondary)' }}>{modalRoom.desc}</p>

                <ul className="amen">
                  {(modalRoom.perBed
                    ? (isAr
                        ? ['حمامات مشتركة فاخرة', 'تكييف هواء', 'بياضات ومناشف', 'واي فاي سريع', 'مسبح الحديقة', 'إفطار يومي ٨–١١']
                        : ['Shared bathrooms', 'Air conditioning', 'Linen provided', 'Fast Wi-Fi', 'Pool access', 'Breakfast 8–11'])
                    : (isAr
                        ? ['حمام خاص مجهز', 'تكييف هواء', 'مجفف شعر', 'بياضات ومناشف', 'واي فاي سريع', 'مسبح الحديقة', 'إفطار يومي ٨–١١']
                        : ['Private bathroom', 'Air conditioning', 'Hairdryer', 'Linen & towels', 'Fast Wi-Fi', 'Pool access', 'Breakfast 8–11'])
                  ).map((a, idx) => (
                    <li key={idx}>
                      {icons.check} {a}
                    </li>
                  ))}
                </ul>

                <div className="row" style={{ borderTopStyle: 'solid' }}>
                  <div className="price">
                    <small>{isAr ? 'ابتداءً من' : 'From'}</small>
                    <b className="num">
                      {roomPrice(modalRoom.effectivePrice ?? modalRoom.price, modalRoom.priceFrom ?? 'USD')}
                      <span> / {modalRoom.perBed ? (isAr ? 'للسرير' : 'bed') : (isAr ? 'لليلة' : 'night')}</span>
                    </b>
                  </div>

                  {modalRoom.isAvailable !== undefined && (
                    <span
                      className={`live-avail ${modalRoom.isAvailable ? 'ok' : 'full'}`}
                      style={{ position: 'static' }}
                    >
                      {modalRoom.isAvailable && <span className="live-dot" />}
                      {!modalRoom.isAvailable
                        ? isAr ? 'مكتمل اليوم' : 'Sold out today'
                        : modalRoom.bedsLeft && modalRoom.bedsLeft <= 2
                        ? isAr ? `متبقي ${modalRoom.bedsLeft} فقط` : `Only ${modalRoom.bedsLeft} left`
                        : isAr ? 'متاح للحجز' : 'Available'}
                    </span>
                  )}
                </div>

                <button
                  className={`btn ${modalRoom.isAvailable === false ? 'btn-primary' : 'btn-book'}`}
                  onClick={() => {
                    setModalRoom(null);
                    scrollToBook();
                  }}
                >
                  {modalRoom.isAvailable === false
                    ? isAr ? 'اختر تواريخ أخرى لهذه الغرفة' : 'Check other dates for this room'
                    : isAr ? 'تحقق من التواريخ لهذه الغرفة' : 'Check dates for this room'}
                </button>

                <a
                  className="btn btn-wa"
                  href={wa(isAr ? `استفسار عن حجز ${modalRoom.name}` : `Is ${modalRoom.name} free for my dates?`)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {isAr ? 'اسأل الاستقبال عبر واتساب' : 'Ask on WhatsApp'}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= DAY TOURS ================= */}
      <section className="sec band-light" id="tours">
        <div className="wrap">
          <div className="sec-hd">
            <div>
              <span className="kicker">{isAr ? 'رحلات اليوم الواحد' : 'Day trips'}</span>
              <h2>{isAr ? 'تنطلق يومياً من باب الفيلا.' : 'Organized daily from the front door.'}</h2>
              <p>
                {isAr
                  ? 'سيارات خاصة مكيفة ومرشدون مرخصون. احجز موعدك مع الاستقبال مباشرة عبر واتساب.'
                  : 'Private A/C transport and licensed Egyptologist guides. Book on WhatsApp with front desk.'}
              </p>
            </div>

            <div className="sc-nav">
              <button
                onClick={() => {
                  if (toursScrollRef.current) {
                    toursScrollRef.current.scrollBy({ left: isAr ? 320 : -320, behavior: 'smooth' });
                  }
                }}
                aria-label="Previous"
              >
                {isAr ? icons.right : icons.left}
              </button>
              <button
                onClick={() => {
                  if (toursScrollRef.current) {
                    toursScrollRef.current.scrollBy({ left: isAr ? -320 : 320, behavior: 'smooth' });
                  }
                }}
                aria-label="Next"
              >
                {isAr ? icons.left : icons.right}
              </button>
            </div>
          </div>

          <div className="scroller" ref={toursScrollRef}>
            {TOURS.map((t, idx) => (
              <article key={idx} className="card">
                <div className="media">
                  <span className={`badge ${idx === 0 ? 'gold' : ''}`}>{t.tag}</span>
                  <img src={t.img} alt={t.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div className="body">
                  <div className="meta">
                    <span>{icons.clock} {t.dur}</span>
                    <span>{icons.pin} {isAr ? 'من باب الفيلا' : 'From the villa'}</span>
                  </div>
                  <h3 style={{ fontSize: '18px', marginTop: '4px' }}>{t.name}</h3>
                  <ul className="incl">
                    {t.incl.map((item, k) => (
                      <li key={k}>{item}</li>
                    ))}
                  </ul>
                  {t.excl && (
                    <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 600, marginTop: '8px', padding: '4px 8px', background: '#fef2f2', borderRadius: '6px' }}>
                      {t.excl}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: '12px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary-dark)' }}>
                      {isAr ? 'الأسعار عبر واتساب الاستقبال' : 'Inquire on WhatsApp'}
                    </span>
                    <a
                      className="btn btn-wa btn-sm"
                      href={wa(isAr ? `مرحباً، أود الاستفسار عن موعد وسعر رحلة: ${t.name}` : `Hello, I’d like to inquire about dates and price for: ${t.name}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {isAr ? 'احجز عبر واتساب' : 'Book on WhatsApp'}
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FILMS (REELS) ================= */}
      <section className="sec films" id="films">
        <div className="wrap">
          <div className="sec-hd">
            <div>
              <span className="kicker">{isAr ? 'بعدسة ضيوفنا' : 'Guest films'}</span>
              <h2>{isAr ? 'لقطات وريلز من واقع الإقامة في الفيلا.' : 'Moments from life at the villa.'}</h2>
              <p>
                {isAr
                  ? 'شاهد أجواء المسبح والحديقة ووجبات الإفطار وجولات ضيوفنا عبر إنستغرام.'
                  : 'Watch guest reels by the pool, breakfasts in the garden and Cairo discoveries.'}
              </p>
            </div>
          </div>

          <GuestFilms isAr={isAr} films={films} />

        </div>
      </section>

      {/* ================= REVIEWS ================= */}
      <section className="sec band-light" id="reviews">
        <div className="wrap">
          <div className="sec-hd">
            <div>
              <span className="kicker">{isAr ? 'تجارب المسافرين' : 'Guest reviews'}</span>
              <h2>{isAr ? 'ما يقوله نزلاؤنا بعد إقامتهم.' : 'What guests say after their stay.'}</h2>
            </div>
          </div>

          <div className="revs">
            {REVIEWS.map((r, idx) => (
              <article key={idx} className="rev">
                <div className="stars">
                  {icons.star}
                  {icons.star}
                  {icons.star}
                  {icons.star}
                  {icons.star}
                </div>
                <p>"{r.t}"</p>
                <div className="who">
                  <span className="av">{r.n.charAt(0)}</span>
                  <div>
                    <b>{r.n}</b>
                    <small>{r.trip}</small>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="platforms">
            <div className="plat">
              <b>9.5</b>
              <span>
                <strong>Booking.com</strong>
                {isAr ? 'استثنائي · 500+ تقييم حقيقي' : 'Exceptional · 500+ verified reviews'}
              </span>
            </div>
            <div className="plat">
              <b>9.8</b>
              <span>
                <strong>Hostelworld</strong>
                {isAr ? 'تقييم ممتاز للمسافرين والعنابر' : 'Superb solo & dorm reviews'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= CTA OVER PHOTO ================= */}
      <section className="sec band-white">
        <div className="wrap">
          <div className="cta">
            <img src="/photos/gallery_and_hostel/f2.jpg" alt="Villa Layla" />
            <div>
              <h2>{isAr ? 'احجز إقامتك مباشرة بأفضل سعر.' : 'Book direct for the guaranteed best rate.'}</h2>
              <p>
                {isAr
                  ? 'تأكيد فوري، إفطار طازج كل صباح، واستقبال واتساب متاح طوال اليوم لخدمتك وترتيب إقامتك.'
                  : 'Instant confirmation, daily breakfast, and WhatsApp reception ready around the clock.'}
              </p>
            </div>
            <div className="cta-acts">
              <button className="btn btn-book" onClick={scrollToBook}>
                {isAr ? 'احجز غرفتك الآن' : 'Check availability'}
              </button>
              <a
                className="btn btn-outline-light"
                href={wa(isAr ? 'استفسار عن حجز فيلا ليلى' : 'Booking inquiry')}
                target="_blank"
                rel="noopener noreferrer"
              >
                {isAr ? 'تحدث مع الاستقبال على واتساب' : 'Chat on WhatsApp'}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FIND US & FAQ ================= */}
      <section className="sec band-light" id="find">
        <div className="wrap">
          <div className="sec-hd">
            <div>
              <span className="kicker">{isAr ? 'كيف تصل إلينا' : 'Find us'}</span>
              <h2>{isAr ? 'بالقرب من النيل والمتحف المصري.' : 'Near the Nile and the Egyptian Museum.'}</h2>
            </div>
          </div>

          <div className="find">
            <div className="find-card">
              <address>
                {isAr ? (
                  <>
                    ٢٠ شارع صفية زغلول، الإنشاء والمنيرة،
                    <br />
                    السيدة زينب، القاهرة، مصر
                  </>
                ) : (
                  <>
                    20 Safiya Zaghloul St, Al Inshaa Wa Al Munirah,
                    <br />
                    El Sayeda Zeinab, Cairo 4262101, Egypt
                  </>
                )}
              </address>

              <dl className="dist num">
                <dt>{isAr ? 'ميدان التحرير' : 'Tahrir Square'}</dt>
                <dd>{isAr ? '١٤ دقيقة مشياً' : '14 min walk'}</dd>
                <dt>{isAr ? 'المتحف المصري بالتحرير' : 'The Egyptian Museum'}</dt>
                <dd>1.6 km</dd>
                <dt>{isAr ? 'جامع أحمد بن طولون' : 'Ibn Tulun Mosque'}</dt>
                <dd>1.9 km</dd>
                <dt>{isAr ? 'مطار القاهرة الدولي' : 'Cairo International Airport'}</dt>
                <dd>18 km</dd>
                <dt>{isAr ? 'تسجيل الوصول / المغادرة' : 'Check-in / Check-out'}</dt>
                <dd>15:00 / 11:00</dd>
              </dl>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: 'auto' }}>
                <a
                  className="btn btn-blue"
                  href="https://maps.app.goo.gl/H7YGjCVT7nshDExj9"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m3 11 18-8-8 18-2-8z" />
                  </svg>
                  {isAr ? 'الاتجاهات على الخريطة' : 'Get directions'}
                </a>
                <a
                  className="btn btn-wa"
                  href={wa(isAr ? 'حجز توصيل من المطار' : 'Airport pickup')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {isAr ? 'حجز استقبال المطار' : 'Book airport pickup'}
                </a>
              </div>
            </div>

            <div className="map-wrap">
              <iframe
                title="Villa Layla on Google Maps"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2392.109411453033!2d31.234714300835588!3d30.035821551113976!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x1458410066316bbd%3A0xed6927270f8c6574!2sHostel%20Layla!5e0!3m2!1sen!2sus!4v1758301801593!5m2!1sen!2sus"
              />
            </div>
          </div>

          <div className="sec-hd" style={{ marginTop: 'clamp(56px, 7vw, 88px)' }}>
            <div>
              <span className="kicker">{isAr ? 'معلومات تهمك' : 'Good to know'}</span>
              <h2>{isAr ? 'أسئلة شائعة قبل الحجز.' : 'Questions before you book.'}</h2>
            </div>
          </div>

          <div className="faq">
            {FAQS.map((f, idx) => (
              <details key={idx}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
