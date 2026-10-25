'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EventsSection, type EventCard } from './events-section';

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
  currency?: string;
  initialRates?: LiveRoomStatusMap;
  events?: EventCard[];
};

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

export function ClaudeHome({ lang = 'en', currency = 'USD', initialRates, events = [] }: ClaudeHomeProps) {
  const router = useRouter();
  const isAr = lang === 'ar';

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

  // Films
  const [filmIdx, setFilmIdx] = useState(0);

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
          `/api/sync/hostelworld?dateStart=${encodeURIComponent(queryDate)}&nights=1&currency=${encodeURIComponent(currency)}`
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
  }, [arrive, currency]);

  // Hero Slider data (3 real videos from Villa Layla)
  const SLIDES = [
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
  const ALL_ROOMS = [
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
        '/photos/rooms/private_Sheherazade/01_Sheherazade.jpg',
        '/photos/rooms/private_Sheherazade/02_Sheherazade.jpg',
        '/photos/rooms/private_Sheherazade/03_Sheherazade.jpg',
        '/photos/rooms/private_Sheherazade/04_Sheherazade.jpg',
        '/photos/rooms/private_Sheherazade/05_Sheherazade.jpg',
        '/photos/rooms/private_Sheherazade/06_Sheherazade.jpg',
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
        '/photos/rooms/private_Ibn_Battuta/01_Ibn_Battuta.jpg',
        '/photos/rooms/private_Ibn_Battuta/02_Ibn_Battuta.jpg',
        '/photos/rooms/private_Ibn_Battuta/03_Ibn_Battuta.jpg',
        '/photos/rooms/private_Ibn_Battuta/04_Ibn_Battuta.jpg',
        '/photos/rooms/private_Ibn_Battuta/05_Ibn_Battuta.jpg',
        '/photos/rooms/private_Ibn_Battuta/06_Ibn_Battuta.jpg',
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
        '/photos/rooms/private_Mamluk/01_Mamluk.jpg',
        '/photos/rooms/private_Mamluk/02_Mamluk.jpg',
        '/photos/rooms/private_Mamluk/03_Mamluk.jpg',
        '/photos/rooms/private_Mamluk/04_Mamluk.jpg',
        '/photos/rooms/private_Mamluk/05_Mamluk.jpg',
        '/photos/rooms/private_Mamluk/06_Mamluk.jpg',
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
        '/photos/rooms/private_Golden_Room/01_Golden_Room.jpg',
        '/photos/rooms/private_Golden_Room/02_Golden_Room.jpg',
        '/photos/rooms/private_Golden_Room/03_Golden_Room.jpg',
        '/photos/rooms/private_Golden_Room/04_Golden_Room.jpg',
        '/photos/rooms/private_Golden_Room/05_Golden_Room.jpg',
        '/photos/rooms/private_Golden_Room/06_Golden_Room.jpg',
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
        '/photos/rooms/private_French_Lady/01_French_Lady.jpg',
        '/photos/rooms/private_French_Lady/02_French_Lady.jpg',
        '/photos/rooms/private_French_Lady/03_French_Lady.jpg',
        '/photos/rooms/private_French_Lady/04_French_Lady.jpg',
        '/photos/rooms/private_French_Lady/05_French_Lady.jpg',
        '/photos/rooms/private_French_Lady/06_French_Lady.jpg',
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
        '/photos/rooms/private_Folklore/01_Folklore.jpg',
        '/photos/rooms/private_Folklore/02_Folklore.jpg',
        '/photos/rooms/private_Folklore/03_Folklore.jpg',
        '/photos/rooms/private_Folklore/04_Folklore.jpg',
        '/photos/rooms/private_Folklore/05_Folklore.jpg',
        '/photos/rooms/private_Folklore/06_Folklore.jpg',
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
        '/photos/rooms/private_Violet/01_Violet.jpg',
        '/photos/rooms/private_Violet/02_Violet.jpg',
        '/photos/rooms/private_Violet/03_Violet.jpg',
        '/photos/rooms/private_Violet/04_Violet.jpg',
        '/photos/rooms/private_Violet/05_Violet.jpg',
        '/photos/rooms/private_Violet/06_Violet.jpg',
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
        '/photos/rooms/private_Islamic/01_Islamic.jpg',
        '/photos/rooms/private_Islamic/02_Islamic.jpg',
        '/photos/rooms/private_Islamic/03_Islamic.jpg',
        '/photos/rooms/private_Islamic/04_Islamic.jpg',
        '/photos/rooms/private_Islamic/05_Islamic.jpg',
        '/photos/rooms/private_Islamic/06_Islamic.jpg',
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
        '/photos/rooms/private_Amira/01_Amira.jpg',
        '/photos/rooms/private_Amira/02_Amira.jpg',
        '/photos/rooms/private_Amira/03_Amira.jpg',
        '/photos/rooms/private_Amira/04_Amira.jpg',
        '/photos/rooms/private_Amira/05_Amira.jpg',
        '/photos/rooms/private_Amira/06_Amira.jpg',
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
        '/photos/rooms/private_Triple/01_Triple.jpg',
        '/photos/rooms/private_Triple/02_Triple.jpg',
        '/photos/rooms/private_Triple/03_Triple.jpg',
        '/photos/rooms/private_Triple/04_Triple.jpg',
        '/photos/rooms/private_Triple/05_Triple.jpg',
        '/photos/rooms/private_Triple/06_Triple.jpg',
        '/photos/rooms/private_Triple/07_Triple.jpg',
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
        '/photos/rooms/dorm_Spacious_8-Bed_Female_Dormitory/01_Spacious_8-Bed_Female_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Female_Dormitory/02_Spacious_8-Bed_Female_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Female_Dormitory/03_Spacious_8-Bed_Female_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Female_Dormitory/04_Spacious_8-Bed_Female_Dormitory.jpg',
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
        '/photos/rooms/dorm_6_Bed_Female_Dormitory/01_6_Bed_Female_Dormitory.jpg',
        '/photos/rooms/dorm_6_Bed_Female_Dormitory/02_6_Bed_Female_Dormitory.jpg',
        '/photos/rooms/dorm_6_Bed_Female_Dormitory/03_6_Bed_Female_Dormitory.jpg',
        '/photos/rooms/dorm_6_Bed_Female_Dormitory/04_6_Bed_Female_Dormitory.jpg',
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
        '/photos/rooms/dorm_Spacious_8-Bed_Male_Dormitory/01_Spacious_8-Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Male_Dormitory/02_Spacious_8-Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Male_Dormitory/03_Spacious_8-Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Male_Dormitory/04_Spacious_8-Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_Spacious_8-Bed_Male_Dormitory/05_Spacious_8-Bed_Male_Dormitory.jpg',
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
        '/photos/rooms/dorm_8_Bed_Male_Dormitory/01_8_Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_8_Bed_Male_Dormitory/02_8_Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_8_Bed_Male_Dormitory/03_8_Bed_Male_Dormitory.jpg',
        '/photos/rooms/dorm_8_Bed_Male_Dormitory/04_8_Bed_Male_Dormitory.jpg',
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
        '/photos/rooms/dorm_10_Bed_Mixed_Dormitory/01_10_Bed_Mixed_Dormitory.jpg',
        '/photos/rooms/dorm_10_Bed_Mixed_Dormitory/02_10_Bed_Mixed_Dormitory.jpg',
        '/photos/rooms/dorm_10_Bed_Mixed_Dormitory/03_10_Bed_Mixed_Dormitory.jpg',
        '/photos/rooms/dorm_10_Bed_Mixed_Dormitory/04_10_Bed_Mixed_Dormitory.jpg',
      ],
      kind: 'dorm',
    },
  ];

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
      img: '/photos/rooms/private_Ibn_Battuta/01_Ibn_Battuta.jpg',
    },
    {
      t: isAr ? 'سرير في عنبر' : 'Dorm bed',
      d: isAr ? 'ابتداءً من $17 في الليلة' : 'From $17 a night',
      go: '#stay',
      filter: 'dorms',
      img: '/photos/rooms/dorm_10_Bed_Mixed_Dormitory/01_10_Bed_Mixed_Dormitory.jpg',
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

  const TOURS = [
    {
      name: isAr ? 'أهرامات الجيزة والمتحف المصري الكبير' : 'Giza Pyramids + Grand Egyptian Museum',
      dur: isAr ? '٦–٨ ساعات' : '6–8 hrs',
      tag: isAr ? 'الأكثر طلباً' : 'Most booked',
      img: '/photos/gallery_and_hostel/grand.avif',
      incl: isAr ? ['مرشد مصريات مرخص', 'سيارة خاصة مكيفة', 'أبو الهول والبانوراما'] : ['Egyptologist guide', 'A/C transport', 'Sphinx'],
    },
    {
      name: isAr ? 'سفاري الصحراء السوداء والبيضاء' : 'Black & White Desert Safari',
      dur: isAr ? 'يومان / ليلة واحدة' : '2 days / 1 night',
      tag: isAr ? 'مغامرة' : 'Adventure',
      img: '/photos/gallery_and_hostel/white-dessert-egypt.png',
      incl: isAr ? ['سيارات دفع رباعي 4x4', 'تخييم وعشاء بدوي', 'رصد النجوم'] : ['4WD', 'Camping & meals', 'Stargazing'],
    },
    {
      name: isAr ? 'مغامرة واحة الفيوم وبحيرة قارون' : 'Fayoum Oasis Adventure',
      dur: isAr ? '١٠ ساعات' : '10 hrs',
      tag: isAr ? 'طبيعة' : 'Nature',
      img: '/photos/gallery_and_hostel/white-dessert-safari-package-holiday-tours.png',
      incl: isAr ? ['وادي الريان وشلالاته', 'البحيرة المسحورة', 'وادي الحيتان'] : ['Wadi El Rayan', 'Magic Lake', 'Valley of Whales'],
    },
    {
      name: isAr ? 'سقارة وميت رهينة وهرم زوسر' : 'Saqqara & Memphis',
      dur: isAr ? '٦–٨ ساعات' : '6–8 hrs',
      tag: isAr ? 'تاريخ' : 'History',
      img: '/photos/gallery_and_hostel/Sakkara_Image-by-DEZALB-from-Pixabay.jpg',
      incl: isAr ? ['الهرم المدرج', 'تمثال رمسيس الثاني', 'سيارة خاصة مكيفة'] : ['Step Pyramid', 'Ramses II Colossus', 'Private A/C car'],
    },
    {
      name: isAr ? 'القاهرة الإسلامية والقبطية وخان الخليلي' : 'Islamic & Coptic Cairo',
      dur: isAr ? '٦–٧ ساعات' : '6–7 hrs',
      tag: isAr ? 'ثقافة وتراث' : 'Culture',
      img: '/photos/gallery_and_hostel/Sultan_Hassan_Mosque___Madrasa.jpg',
      incl: isAr ? ['جامع السلطان حسن', 'الكنيسة المعلقة', 'شارع المعز'] : ['Sultan Hassan Mosque', 'Hanging Church', 'El Moez St'],
    },
    {
      name: isAr ? 'الإسكندرية عروس البحر المتوسط' : 'Alexandria from Cairo',
      dur: isAr ? 'يوم كامل' : 'Full day',
      tag: isAr ? 'رحلة يومية' : 'Day trip',
      img: '/photos/gallery_and_hostel/Qaitbay_Citadel.jpg',
      incl: isAr ? ['قلعة قايتباي', 'مكتبة الإسكندرية', 'المقابر الرومانية'] : ['Qaitbay Citadel', 'Alexandria Library', 'Catacombs'],
    },
    {
      name: isAr ? 'عشاء فاخر في رحلة نيلية مسائية' : 'Evening Nile Dinner Cruise',
      dur: isAr ? '٣–٤ ساعات' : '3–4 hrs',
      tag: isAr ? 'سهرة نيلية' : 'Evening',
      img: '/photos/gallery_and_hostel/cairo-city.jpg',
      incl: isAr ? ['بوفيه عشاء مفتوح', 'عروض تنورة وفولكلور', 'انتقالات ذهاب وعودة'] : ['Dinner buffet', 'Folk show', 'Transfers'],
    },
  ];

  const FILMS = [
    {
      src: '/videos/guest-01.mp4',
      poster: '/photos/gallery_and_hostel/qsvj2eqgcmaurlydc1v4.jpg',
      title: isAr ? 'صباح هادئ بجانب المسبح' : 'Morning by the pool',
      guest: '@villalaylacairo',
      len: '0:32',
      reel: 'https://instagram.com/villalaylacairo',
    },
    {
      src: '/videos/guest-02.mp4',
      poster: '/photos/gallery_and_hostel/yebqgf86gomv8a8uwdmh.jpg',
      title: isAr ? 'جولة في أركان الفيلا التاريخية' : 'A tour of the villa',
      guest: '@villalaylacairo',
      len: '0:48',
      reel: 'https://instagram.com/villalaylacairo',
    },
    {
      src: '/videos/guest-03.mp4',
      poster: '/photos/gallery_and_hostel/uylahffomrk009eqcdo8.jpeg',
      title: isAr ? 'إفطار مصري في الحديقة' : 'Breakfast in the garden',
      guest: '@villalaylacairo',
      len: '0:21',
      reel: 'https://instagram.com/villalaylacairo',
    },
    {
      src: '/videos/guest-04.mp4',
      poster: '/photos/gallery_and_hostel/vgl0mf1ggg1jafpj0wit.jpg',
      title: isAr ? 'إقامتنا في غرفة شهرزاد' : 'Our room, Sheherazade',
      guest: '@villalaylacairo',
      len: '0:40',
      reel: 'https://instagram.com/villalaylacairo',
    },
    {
      src: '/videos/guest-05.mp4',
      poster: '/photos/gallery_and_hostel/hsxz6so7xjzignn77oph.jpg',
      title: isAr ? 'أمسية دافئة على التراس' : 'Evenings on the terrace',
      guest: '@villalaylacairo',
      len: '0:27',
      reel: 'https://instagram.com/villalaylacairo',
    },
    {
      src: '/videos/guest-06.mp4',
      poster: '/photos/gallery_and_hostel/kiovp5fgbbt2luk4wopj.jpg',
      title: isAr ? 'شوارع القاهرة القديمة' : 'Cairo from the gate',
      guest: '@villalaylacairo',
      len: '0:55',
      reel: 'https://instagram.com/villalaylacairo',
    },
  ];

  const REVIEWS = [
    {
      n: isAr ? 'أحمد حسن' : 'Ahmed Hassan',
      trip: isAr ? 'رحلة الصحراء البيضاء' : 'Black & White Desert',
      t: isAr
        ? 'كرم ضيافة استثنائي، مسبح رائع وغرف نظيفة للغاية. موقع مثالي لزيارة القاهرة التاريخية، ورحلة الصحراء كانت قمة المتعة.'
        : 'Warm hospitality, a great pool and clean rooms. Perfect base for Islamic Cairo, and the White Desert tour was the highlight.',
    },
    {
      n: isAr ? 'توم ويلسون' : 'Tom Wilson',
      trip: isAr ? 'رحلة الإسكندرية' : 'Alexandria day trip',
      t: isAr
        ? 'جوهرة مخفية في القاهرة. الفريق يعرف كل تفاصيل المدينة ونظموا لنا يوماً رائعاً في الإسكندرية بسيارة خاصة مريحة.'
        : 'A hidden gem. The staff know Cairo inside out and set up a brilliant day trip to Alexandria.',
    },
    {
      n: isAr ? 'إيما تومبسون' : 'Emma Thompson',
      trip: isAr ? 'عنبر البنات' : 'Female dorm',
      t: isAr
        ? 'قيمة ممتازة مقابل السعر، حديقة هادئة وإنترنت سريع جداً للعمل. عنبر البنات آمن ومريح ومكيّف بالكامل.'
        : 'Great value, a lovely garden and Wi-Fi fast enough to work. The female dorm felt safe, clean, and comfortable.',
    },
    {
      n: isAr ? 'سارة جونسون' : 'Sarah Johnson',
      trip: isAr ? 'إقامة فردية' : 'Solo stay',
      t: isAr
        ? 'المسبح والإفطار اللذيذ والرحلات المنظمة جعلت رحلتي كمسافرة بمفردي آمنة وسلسة جداً. سأعود بكل تأكيد.'
        : 'The pool, the breakfast and the tours the staff arranged made it so easy as a solo traveller. Will definitely return.',
    },
    {
      n: isAr ? 'ماركو رودريغيز' : 'Marco Rodriguez',
      trip: isAr ? 'غرفة ابن بطوطة' : 'Ibn Battuta room',
      t: isAr
        ? 'أحببت غرفة ابن بطوطة وتصميمها المميز. استقبال المطار ورحلة الأهرامات مع المرشد رتبها فريق العمل باحترافية.'
        : 'Loved the Ibn Battuta room. Airport pickup and the pyramids tour were all handled seamlessly by the team.',
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
                <b>9.9</b>Hostelworld
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
                    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 84, behavior: 'smooth' });
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

                    <div className="strip" onClick={() => { setModalRoom({ ...r, effectivePrice, isAvailable, bedsLeft }); setModalPhotoIdx(0); }}>
                      {r.photos.map((p, k) => (
                        <img key={k} src={p} alt={`${r.name} photo ${k + 1}`} loading="lazy" />
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
                          ${effectivePrice}
                          <span> / {dorm ? (isAr ? 'للسرير' : 'bed') : (isAr ? 'لليلة' : 'night')}</span>
                        </b>
                      </div>

                      <div className="acts">
                        <button
                          className="btn btn-line"
                          onClick={() => {
                            setModalRoom({ ...r, effectivePrice, isAvailable, bedsLeft });
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
                <img className="dlg-main" src={modalRoom.photos[modalPhotoIdx]} alt={modalRoom.name} />
                <div className="dlg-th">
                  {modalRoom.photos.map((p: string, idx: number) => (
                    <button
                      key={idx}
                      aria-current={idx === modalPhotoIdx}
                      onClick={() => setModalPhotoIdx(idx)}
                    >
                      <img src={p} alt="" />
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
                      ${modalRoom.effectivePrice ?? modalRoom.price}
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
                  <div className="row">
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                      {isAr ? 'السعر عند الطلب' : 'Price on request'}
                    </span>
                    <a
                      className="btn btn-wa btn-sm"
                      href={wa(isAr ? `استفسار عن رحلة ${t.name}` : `Inquiry for ${t.name}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {isAr ? 'اسأل واتساب' : 'Ask on WhatsApp'}
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

          <div className="stage">
            <img src={FILMS[filmIdx].poster} alt={FILMS[filmIdx].title} />
            <button
              className="play-btn"
              aria-label="Play video"
              onClick={() => {
                window.open(FILMS[filmIdx].reel, '_blank', 'noopener,noreferrer');
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <div className="cap">
              <b>{FILMS[filmIdx].title}</b>
              <span>{isAr ? `تصوير ضيوفنا ${FILMS[filmIdx].guest}` : `Filmed by ${FILMS[filmIdx].guest}`}</span>
            </div>
          </div>

          <div className="reel" id="reel">
            {FILMS.map((f, idx) => (
              <button
                key={idx}
                aria-current={idx === filmIdx}
                onClick={() => setFilmIdx(idx)}
                aria-label={f.title}
              >
                <img src={f.poster} alt="" loading="lazy" />
                <span className="len">{f.len}</span>
              </button>
            ))}
          </div>

          <div className="films-ft">
            <span>
              {isAr ? 'تابع حسابنا على إنستغرام لمزيد من اللقطات اليومية:' : 'Follow our official Instagram for daily reels:'}{' '}
              <b>@villalaylacairo</b>
            </span>
            <a
              className="btn btn-outline-light btn-sm"
              href="https://instagram.com/villalaylacairo"
              target="_blank"
              rel="noopener noreferrer"
            >
              {isAr ? 'افتح إنستغرام' : 'Open Instagram'}
            </a>
          </div>
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
              <b>9.9</b>
              <span>
                <strong>Hostelworld</strong>
                {isAr ? 'تقييم ممتاز من المسافرين' : 'Superb solo & dorm reviews'}
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
