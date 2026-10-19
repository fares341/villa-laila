'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Lang } from '@/i18n/bot';

export function ClaudeHeader({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const pathname = usePathname();
  const isHomePage = pathname === `/${lang}` || pathname === `/${lang}/`;

  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [headerHide, setHeaderHide] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setHeaderSolid(y > 10);
      if (y > 400 && y > lastScrollY.current + 6) {
        setHeaderHide(true);
      } else if (y < lastScrollY.current - 6) {
        setHeaderHide(false);
      }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleNavClick = (anchor: string) => {
    if (isHomePage) {
      const el = document.getElementById(anchor);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 84;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }
  };

  const href = (anchor: string) => (isHomePage ? `#${anchor}` : `/${lang}#${anchor}`);

  const scrollToBook = () => {
    if (isHomePage) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const el = document.getElementById('arrive-input');
      if (el) setTimeout(() => el.focus(), 800);
    } else {
      window.location.href = `/${lang}#top`;
    }
  };

  return (
    <header className={`hdr ${headerSolid ? 'solid' : ''} ${headerHide ? 'hide' : ''}`} id="hdr">
      <div className="wrap hdr-in">
        <Link href={`/${lang}`} className="logo" aria-label="Villa Layla">
          <img className="logo-img" src="/assets/logo-240.webp" alt="Villa Layla" width={180} height={52} />
        </Link>

        <nav className="nav" aria-label="Main">
          <a
            href={href('stay')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('stay');
              }
            }}
          >
            {isAr ? 'الغرف' : 'Rooms'}
          </a>
          <a
            href={href('stay')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('stay');
              }
            }}
          >
            {isAr ? 'العنابر' : 'Dorms'}
          </a>
          <a
            href={href('tours')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('tours');
              }
            }}
          >
            {isAr ? 'الرحلات' : 'Tours'}
          </a>
          <a
            href={href('events')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('events');
              }
            }}
          >
            {isAr ? 'الفعاليات' : 'Events'}
          </a>
          <a
            href={href('films')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('films');
              }
            }}
          >
            {isAr ? 'ريلز ولقطات' : 'Guest films'}
          </a>
          <a
            href={href('reviews')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('reviews');
              }
            }}
          >
            {isAr ? 'الآراء' : 'Reviews'}
          </a>
          <a
            href={href('find')}
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                handleNavClick('find');
              }
            }}
          >
            {isAr ? 'موقعنا' : 'Find us'}
          </a>
        </nav>

        <div className="hdr-end">
          <div className="lang-dropdown">
            <button
              className="lang-btn"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              aria-expanded={langMenuOpen}
              aria-label="Language selector"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
              </svg>
              {lang.toUpperCase()}
            </button>
            {langMenuOpen && (
              <div className="lang-menu">
                <Link href="/en" onClick={() => setLangMenuOpen(false)}>
                  <span>English</span> {lang === 'en' && '✓'}
                </Link>
                <Link href="/ar" onClick={() => setLangMenuOpen(false)}>
                  <span className="ar-font">العربية</span> {lang === 'ar' && '✓'}
                </Link>
                <Link href="/fr" onClick={() => setLangMenuOpen(false)}>
                  <span>Français</span> {lang === 'fr' && '✓'}
                </Link>
                <Link href="/es" onClick={() => setLangMenuOpen(false)}>
                  <span>Español</span> {lang === 'es' && '✓'}
                </Link>
              </div>
            )}
          </div>

          <button className="btn btn-book book-hdr" onClick={scrollToBook}>
            {isAr ? 'احجز مباشرة' : 'Book direct'}
          </button>
        </div>
      </div>
    </header>
  );
}

export function ClaudeFooter({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const pathname = usePathname();
  const isHomePage = pathname === `/${lang}` || pathname === `/${lang}/`;

  const scrollToBook = () => {
    if (isHomePage) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const el = document.getElementById('arrive-input');
      if (el) setTimeout(() => el.focus(), 800);
    } else {
      window.location.href = `/${lang}#top`;
    }
  };

  const handleNavClick = (anchor: string) => {
    if (isHomePage) {
      const el = document.getElementById(anchor);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 84;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }
  };

  const href = (anchor: string) => (isHomePage ? `#${anchor}` : `/${lang}#${anchor}`);
  const wa = (msg: string) => `https://wa.me/201040551515?text=${encodeURIComponent(msg + (isAr ? ' — فيلا ليلى' : ' — Villa Layla'))}`;

  return (
    <footer className="foot" id="foot">
      <svg className="foot-arch" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 80V64C240 64 420 0 720 0s480 64 720 64v16z" />
      </svg>

      <div className="foot-body">
        <div className="wrap">
          <a
            href={isHomePage ? '#top' : `/${lang}#top`}
            className="foot-logo"
            aria-label="Villa Layla, back to top"
            onClick={(e) => {
              if (isHomePage) {
                e.preventDefault();
                scrollToBook();
              }
            }}
          >
            <img src="/assets/logo-480.webp" alt="Villa Layla" width={240} height={252} loading="lazy" />
          </a>

          <div className="foot-intro">
            <span className="foot-ar">فيلا ليلى</span>
            <p>
              {isAr ? (
                <>
                  واحتك الهادئة في <span>قلب القاهرة</span>. نسعد باستضافتك دائماً.
                </>
              ) : (
                <>
                  Your oasis in the <span>heart of Cairo</span>. We'd love to host you.
                </>
              )}
            </p>
            <div className="foot-rates">
              <span className="foot-rate">
                <b>9.9</b>Hostelworld
              </span>
              <span className="foot-rate">
                <b>9.8</b>Booking.com
              </span>
            </div>
            <div className="foot-ctas">
              <button className="btn btn-gold" onClick={scrollToBook}>
                {isAr ? 'احجز مباشرة' : 'Book direct'}
              </button>
              <a
                className="btn btn-wa"
                href="https://wa.me/201040551515"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z" />
                </svg>
                {isAr ? 'استقبال واتساب' : 'WhatsApp reception'}
              </a>
            </div>
          </div>

          <div className="foot-orn" aria-hidden="true">
            <img src="/assets/fleur.webp" alt="" width={34} height={34} />
          </div>

          <div className="foot-g">
            <div>
              <h4>{isAr ? 'الإقامة' : 'Stay'}</h4>
              <ul>
                <li>
                  <a
                    href={href('stay')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('stay');
                      }
                    }}
                  >
                    {isAr ? 'الغرف الخاصة' : 'Private rooms'}
                  </a>
                </li>
                <li>
                  <a
                    href={href('stay')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('stay');
                      }
                    }}
                  >
                    {isAr ? 'العنابر المشتركة' : 'Dorms'}
                  </a>
                </li>
                <li>
                  <a
                    href={href('stay')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('stay');
                      }
                    }}
                  >
                    {isAr ? 'عنابر السيدات' : 'Women-only dorms'}
                  </a>
                </li>
                <li>
                  <Link href={`/${lang}/gallery`}>{isAr ? 'معرض الصور' : 'Photo gallery'}</Link>
                </li>
                <li>
                  <a
                    href={href('films')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('films');
                      }
                    }}
                  >
                    {isAr ? 'ريلز ولقطات' : 'Guest films'}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4>{isAr ? 'استكشف' : 'Explore'}</h4>
              <ul>
                <li>
                  <a
                    href={href('tours')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('tours');
                      }
                    }}
                  >
                    {isAr ? 'رحلات اليوم الواحد' : 'Day tours'}
                  </a>
                </li>
                <li>
                  <a
                    href={href('events')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('events');
                      }
                    }}
                  >
                    {isAr ? 'فعاليات الفيلا' : 'Events at the villa'}
                  </a>
                </li>
                <li>
                  <a href={wa(isAr ? 'حجز توصيل المطار' : 'Airport pickup')} target="_blank" rel="noopener noreferrer">
                    {isAr ? 'توصيل المطار' : 'Airport pickup'}
                  </a>
                </li>
                <li>
                  <a
                    href={href('reviews')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('reviews');
                      }
                    }}
                  >
                    {isAr ? 'آراء النزلاء' : 'Guest reviews'}
                  </a>
                </li>
                <li>
                  <a
                    href={href('find')}
                    onClick={(e) => {
                      if (isHomePage) {
                        e.preventDefault();
                        handleNavClick('find');
                      }
                    }}
                  >
                    {isAr ? 'كيف تصل إلينا' : 'Getting here'}
                  </a>
                </li>
                <li>
                  <Link href={`/${lang}/faq`}>{isAr ? 'الأسئلة الشائعة' : 'FAQ'}</Link>
                </li>
              </ul>
            </div>

            <div className="wide">
              <h4>{isAr ? 'التواصل' : 'Contact'}</h4>
              <ul>
                <li className="ci">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z" />
                  </svg>
                  <a href="https://wa.me/201040551515" dir="ltr">
                    +20 104 055 1515
                  </a>
                </li>
                <li className="ci">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                  <a href="mailto:hostel.layla@gmail.com" dir="ltr">
                    hostel.layla@gmail.com
                  </a>
                </li>
                <li className="ci">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                  <span>
                    {isAr
                      ? '٢٠ شارع صفية زغلول، السيدة زينب، القاهرة'
                      : '20 Safiya Zaghloul St, El Sayeda Zeinab, Cairo'}
                  </span>
                </li>
                <li className="ci">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m3 11 18-8-8 18-2-8z" />
                  </svg>
                  <a href="https://maps.app.goo.gl/H7YGjCVT7nshDExj9" target="_blank" rel="noopener noreferrer">
                    {isAr ? 'الاتجاهات على الخريطة' : 'Get directions'}
                  </a>
                </li>
              </ul>
            </div>

            <div className="wide">
              <h4>{isAr ? 'المواعيد' : 'Hours'}</h4>
              <dl className="hrs">
                <dt>{isAr ? 'مكتب الاستقبال' : 'Front desk'}</dt>
                <dd>08:00–22:00</dd>
                <dt>{isAr ? 'استقبال واتساب' : 'WhatsApp'}</dt>
                <dd>24 / 7</dd>
                <dt>{isAr ? 'الإفطار الصباحي' : 'Breakfast'}</dt>
                <dd>08:00–11:00</dd>
                <dt>{isAr ? 'تسجيل الوصول' : 'Check-in'}</dt>
                <dd>{isAr ? 'من 15:00' : 'from 15:00'}</dd>
                <dt>{isAr ? 'تسجيل المغادرة' : 'Check-out'}</dt>
                <dd>{isAr ? 'حتى 11:00' : 'by 11:00'}</dd>
              </dl>
              <p className="foot-pay">
                <b>{isAr ? 'أفضل سعر مضمون' : 'Best rate guaranteed'}</b>{' '}
                {isAr ? 'عند الحجز المباشر معنا.' : 'when you book directly with us.'}
              </p>
            </div>
          </div>

          <div className="foot-b">
            <span>© {new Date().getFullYear()} Villa Layla Hostel · Cairo, Egypt</span>
            <nav aria-label="Legal">
              <Link href={`/${lang}/policies`}>{isAr ? 'السياسات' : 'Policies'}</Link>
              <Link href={`/${lang}/policies#privacy`}>{isAr ? 'الخصوصية' : 'Privacy'}</Link>
              <Link href={`/${lang}/faq`}>{isAr ? 'الأسئلة الشائعة' : 'FAQ'}</Link>
            </nav>
            <div className="foot-b-group">
              <div className="foot-langs" aria-label="Language">
                <Link href="/en" aria-current={lang === 'en' ? 'page' : undefined}>
                  EN
                </Link>
                <Link href="/ar" aria-current={lang === 'ar' ? 'page' : undefined}>
                  ع
                </Link>
                <Link href="/fr" aria-current={lang === 'fr' ? 'page' : undefined}>
                  FR
                </Link>
                <Link href="/es" aria-current={lang === 'es' ? 'page' : undefined}>
                  ES
                </Link>
              </div>
              <div className="foot-soc">
                <a
                  href="https://instagram.com/villalaylacairo"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
                  </svg>
                </a>
                <a
                  href="https://t.me/villalayldbot"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Telegram"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 4 3 11l6 2 2 6 3-4 5 4z" />
                    <path d="m9 13 8-6" />
                  </svg>
                </a>
                <a href="https://wa.me/201040551515" aria-label="WhatsApp" target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function ClaudeFabs({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [chatOpen, setChatOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: isAr
        ? 'مرحباً بك في فيلا ليلى بالقاهرة 🌿\nأنا مساعدك الفندقي الذكي. يمكنك سؤالي عن الغرف، المواعيد، الإفطار، المسبح أو الرحلات بأي لغة وسأجيبك فوراً.'
        : 'Welcome to Villa Layla, Cairo 🌿\nI am your AI Concierge. Feel free to ask about our rooms, dorms, check-in, breakfast, pool, or day tours in any language!'
    }
  ]);
  const msgsEndRef = useRef<HTMLDivElement>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    const newMsgs = [...messages, { role: 'user' as const, content: q }];
    setMessages(newMsgs);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMsgs, lang }),
      });
      const data = await res.json();
      setMessages([...newMsgs, { role: 'assistant', content: data.reply || data.content || (isAr ? 'عذراً، يمكنك التواصل مع الاستقبال مباشرة عبر واتساب!' : 'You can reach reception directly on WhatsApp!') }]);
    } catch {
      setMessages([...newMsgs, { role: 'assistant', content: isAr ? 'يسعدنا تواصلك مع الاستقبال مباشرة عبر واتساب +20 104 055 1515!' : 'You can reach us directly on WhatsApp +20 104 055 1515!' }]);
    } finally {
      setLoading(false);
      setTimeout(() => msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return (
    <>
      <div className="fabs">
        <button
          className="fab ai"
          onClick={() => setChatOpen(!chatOpen)}
          aria-label={isAr ? 'المساعد الذكي' : 'Layla AI Concierge'}
        >
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 20, height: 20 }}>
              <path d="M12 2L13.8 7.2L19 9L13.8 10.8L12 16L10.2 10.8L5 9L10.2 7.2L12 2Z" />
              <path d="M19 15L19.9 17.1L22 18L19.9 18.9L19 21L18.1 18.9L16 18L18.1 17.1L19 15Z" opacity="0.85" />
            </svg>
          </span>
          <span className="t">{isAr ? 'المساعد الذكي' : 'Layla AI'}</span>
        </button>

        <a
          className="fab wa"
          href="https://wa.me/201040551515"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp"
        >
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.5-.3z" />
            </svg>
          </span>
          <span className="t">{isAr ? 'واتساب الاستقبال' : 'WhatsApp'}</span>
        </a>
      </div>

      {chatOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
            insetInlineEnd: 'max(18px, env(safe-area-inset-right, 0px))',
            zIndex: 90,
            width: 'min(390px, calc(100vw - 32px))',
            height: '520px',
            background: '#fff',
            borderRadius: '24px',
            boxShadow: '0 24px 60px rgba(74, 50, 34, 0.35)',
            border: '1px solid #ECE2D4',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: '#4A3222',
              color: '#fff',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(210,154,69,.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '12px',
                  background: 'rgba(210,154,69,.25)',
                  border: '1px solid #D29A45',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#E9C27E',
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 20, height: 20 }}>
                  <path d="M12 2L13.8 7.2L19 9L13.8 10.8L12 16L10.2 10.8L5 9L10.2 7.2L12 2Z" />
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>
                  {isAr ? 'مساعد فيلا ليلى الذكي' : 'Villa Layla AI Concierge'}
                </div>
                <div style={{ fontSize: '11px', color: '#E9C27E' }}>
                  {isAr ? 'إجابات فورية بجميع اللغات 24/7' : 'Instant replies in any language 24/7'}
                </div>
              </div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                fontSize: '24px',
                cursor: 'pointer',
                opacity: 0.8,
                padding: '0 4px',
              }}
            >
              &times;
            </button>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              background: '#FBF7F1',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              fontSize: '14px',
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? '#4A3222' : '#fff',
                  color: m.role === 'user' ? '#fff' : '#2F2925',
                  border: m.role === 'user' ? 'none' : '1px solid #ECE2D4',
                  padding: '12px 16px',
                  borderRadius:
                    m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  maxWidth: '85%',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  background: '#fff',
                  border: '1px solid #ECE2D4',
                  padding: '10px 16px',
                  borderRadius: '16px 16px 16px 4px',
                  color: '#76695D',
                  fontSize: '13px',
                }}
              >
                {isAr ? 'ليلى تكتب...' : 'Layla is typing...'}
              </div>
            )}
            <div ref={msgsEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSend}
            style={{
              display: 'flex',
              gap: '8px',
              padding: '12px',
              background: '#fff',
              borderTop: '1px solid #ECE2D4',
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isAr ? 'اكتب سؤالك بأي لغة...' : 'Ask anything in any language...'}
              style={{
                flex: 1,
                border: '1px solid #ECE2D4',
                borderRadius: '12px',
                padding: '10px 14px',
                fontSize: '16px',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              style={{
                background: '#D29A45',
                color: '#2F2925',
                border: 'none',
                borderRadius: '12px',
                padding: '0 16px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: loading || !input.trim() ? 0.6 : 1,
              }}
            >
              {isAr ? 'إرسال' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function ClaudeBottomBar({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const pathname = usePathname();
  const isHomePage = pathname === `/${lang}` || pathname === `/${lang}/`;

  const scrollToBook = () => {
    if (isHomePage) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const el = document.getElementById('arrive-input');
      if (el) setTimeout(() => el.focus(), 800);
    } else {
      window.location.href = `/${lang}#top`;
    }
  };

  const handleNavScroll = (anchor: string) => {
    if (isHomePage) {
      const el = document.getElementById(anchor);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 84;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }
  };

  const href = (anchor: string) => (isHomePage ? `#${anchor}` : `/${lang}#${anchor}`);

  return (
    <nav className="bbar" aria-label="Quick mobile bar">
      <a
        href={href('top')}
        className="on"
        onClick={(e) => {
          if (isHomePage) {
            e.preventDefault();
            scrollToBook();
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 11 12 4l9 7v9H5z" />
        </svg>
        {isAr ? 'الرئيسية' : 'Home'}
      </a>
      <a
        href={href('stay')}
        onClick={(e) => {
          if (isHomePage) {
            e.preventDefault();
            handleNavScroll('stay');
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
          <circle cx="7" cy="11" r="2" />
        </svg>
        {isAr ? 'الغرف' : 'Rooms'}
      </a>
      <a
        href={href('tours')}
        onClick={(e) => {
          if (isHomePage) {
            e.preventDefault();
            handleNavScroll('tours');
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 20h18L14 6l-4 7-2-3z" />
        </svg>
        {isAr ? 'الرحلات' : 'Tours'}
      </a>
      <a
        href={href('events')}
        onClick={(e) => {
          if (isHomePage) {
            e.preventDefault();
            handleNavScroll('events');
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />
          <path d="M14 6v12" strokeDasharray="2 2" />
        </svg>
        {isAr ? 'الفعاليات' : 'Events'}
      </a>
      <a
        href={href('films')}
        onClick={(e) => {
          if (isHomePage) {
            e.preventDefault();
            handleNavScroll('films');
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m10 9 5 3-5 3z" />
        </svg>
        {isAr ? 'ريلز' : 'Films'}
      </a>
      <a
        href={href('top')}
        className="bk"
        onClick={(e) => {
          e.preventDefault();
          scrollToBook();
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {isAr ? 'احجز' : 'Book'}
      </a>
    </nav>
  );
}
