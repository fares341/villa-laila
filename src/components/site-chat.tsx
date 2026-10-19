'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { Lang } from '@/i18n/bot';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const SUGGESTIONS: Record<string, string[]> = {
  ar: [
    '💰 أسعار الغرف وسراير الدورم',
    '🕒 مواعيد تسجيل الوصول والمغادرة',
    '🍳 هل الإفطار والإنترنت مشمولين؟',
    '🚗 رحلات الأهرامات والواحات المتاحة',
    '💳 ما هي طرق الدفع المقبولة؟',
  ],
  en: [
    '💰 What are your room & dorm rates?',
    '🕒 What are check-in & check-out times?',
    '🍳 Is breakfast and WiFi included?',
    '🚗 What day trips and tours do you offer?',
    '💳 What payment methods are accepted?',
  ],
  fr: [
    '💰 Quels sont les tarifs des chambres ?',
    '🕒 Quelles sont les heures d’arrivée et de départ ?',
    '🍳 Le petit-déjeuner et le Wi-Fi sont-ils inclus ?',
    '🚗 Quelles excursions proposez-vous ?',
  ],
  es: [
    '💰 ¿Cuáles son las tarifas de las habitaciones?',
    '🕒 ¿Cuáles son los horarios de check-in y check-out?',
    '🍳 ¿El desayuno y el wifi están incluidos?',
    '🚗 ¿Qué excursiones ofrecen?',
  ],
};

export function SiteChatWidget({ lang = 'ar' }: { lang: Lang }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAr = lang === 'ar';

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: isAr
            ? 'مرحباً بك في فيلا ليلى بالقاهرة 🌿\nأنا مساعدك الفندقي الذكي. يمكنك سؤالي عن الغرف والأسعار، المواعيد، الرحلات، أو أي استفسار تريده بأي لغة وسأجيبك فوراً.'
            : 'Welcome to Villa Layla Hostel, Cairo 🌿\nI am your AI Concierge. Feel free to ask about our rooms, dorms, prices, tours, check-in times, or anything else in your preferred language!'
        }
      ]);
    }
  }, [lang, isAr]);

  useEffect(() => {
    if (isOpen) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const q = (textToSend || input).trim();
    if (!q || loading) return;

    const newMessages: Message[] = [...messages, { role: 'user', content: q }];
    setMessages(newMessages);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          lang,
        }),
      });

      if (!res.ok) throw new Error('API request failed');
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply || '' }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: isAr
            ? 'نعتذر، حدث انقطاع مؤقت في الاتصال. يمكنك إعادة المحاولة أو التواصل معنا مباشرة عبر واتساب.'
            : 'Sorry, there was a temporary connection error. Please try again or reach out to us via WhatsApp.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = SUGGESTIONS[lang] || SUGGESTIONS.en;

  return (
    <>
      {/* Floating launcher button — Luxury Boutique Hotel Style */}
      <div className={`fixed bottom-20 md:bottom-6 z-50 ${isAr ? 'right-4 md:right-6' : 'left-4 md:left-6'} print:hidden`}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isAr ? 'فتح المحادثة للاستفسارات' : 'Open inquiries chat'}
          className="group relative flex items-center gap-3 rounded-full bg-gradient-to-r from-[#141b2f] via-[#1a2542] to-[#1e2a4a] p-1.5 pe-4 ps-2.5 text-white shadow-[0_12px_28px_-6px_rgba(20,27,47,0.5),0_0_16px_rgba(217,166,74,0.2)] border border-amber-300/35 ring-1 ring-white/10 transition-all duration-300 hover:scale-105 hover:border-amber-300/70 hover:shadow-[0_16px_34px_-4px_rgba(20,27,47,0.6),0_0_24px_rgba(217,166,74,0.35)] active:scale-95 focus:outline-none"
        >
          {/* Luminous Emblem Orb */}
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/25 via-amber-300/10 to-transparent p-0.5 border border-amber-300/40 shadow-inner">
            <svg
              className="h-5 w-5 text-amber-300 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110 drop-shadow-[0_1px_3px_rgba(217,166,74,0.5)]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              {/* Refined Sparkle & Chat Emblem */}
              <path d="M12 2L13.8 7.2L19 9L13.8 10.8L12 16L10.2 10.8L5 9L10.2 7.2L12 2Z" />
              <path d="M19 15L19.9 17.1L22 18L19.9 18.9L19 21L18.1 18.9L16 18L18.1 17.1L19 15Z" opacity="0.85" />
              <circle cx="6" cy="18" r="2.5" opacity="0.75" />
            </svg>
            {/* Live Status Pulse */}
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 border-2 border-[#141b2f]"></span>
            </span>
          </div>

          {/* Typography */}
          <div className="flex flex-col text-start">
            <span
              className="text-xs font-bold tracking-wide text-white drop-shadow-sm flex items-center gap-1.5"
              style={{ fontFamily: "'El Messiri Variable', sans-serif" }}
            >
              {isAr ? 'المساعد الفندقي' : 'Layla Concierge'}
              <span className="text-[9px] font-semibold tracking-wider text-amber-300/90 uppercase px-1 py-0.2 rounded bg-amber-400/15 border border-amber-300/30">
                AI
              </span>
            </span>
            <span className="text-[10px] text-amber-200/70 font-medium">
              {isAr ? 'استفسارات وحجز فوراً' : 'Instant Inquiries'}
            </span>
          </div>
        </button>
      </div>

      {/* Chat window — Elegant Cairo Boutique Style */}
      {isOpen && (
        <div
          className={`fixed bottom-24 md:bottom-20 z-50 flex flex-col overflow-hidden rounded-3xl border border-amber-900/15 bg-white shadow-[0_25px_60px_-15px_rgba(20,27,47,0.4),0_0_30px_rgba(217,166,74,0.15)] print:hidden ${
            isAr ? 'right-4 sm:right-6' : 'left-4 sm:left-6'
          } w-[calc(100vw-2rem)] sm:w-[390px] max-h-[75vh] h-[540px] animate-in fade-in slide-in-from-bottom-5 duration-200`}
        >
          {/* Header — Cairo Enamel Plaque Aesthetic */}
          <div className="relative flex items-center justify-between border-b border-amber-400/20 bg-gradient-to-r from-[#141b2f] via-[#1a2542] to-[#1e2a4a] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 via-amber-300/15 to-transparent border border-amber-300/40 shadow-inner">
                <svg className="h-5 w-5 text-amber-300" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L13.8 7.2L19 9L13.8 10.8L12 16L10.2 10.8L5 9L10.2 7.2L12 2Z" />
                  <path d="M19 15L19.9 17.1L22 18L19.9 18.9L19 21L18.1 18.9L16 18L18.1 17.1L19 15Z" opacity="0.85" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold leading-tight flex items-center gap-2" style={{ fontFamily: "'El Messiri Variable', sans-serif" }}>
                  <span>{isAr ? 'مساعد فيلا ليلى الذكي' : 'Villa Layla AI Concierge'}</span>
                  <span className="text-[10px] text-amber-300 px-1.5 py-0.5 rounded-full bg-amber-400/10 border border-amber-300/30">
                    24/7
                  </span>
                </h3>
                <p className="text-[11px] text-amber-100/70 flex items-center gap-1.5 mt-0.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
                  {isAr ? 'يجيبك فوراً وبأي لغة تفضلها' : 'Replies instantly in any language'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-amber-200/70 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Quick prompt chips */}
          <div className="border-b border-lapis-100/80 bg-[#fbfbfa] px-3.5 py-2.5 overflow-x-auto scrollbar-none flex gap-1.5 whitespace-nowrap">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(s)}
                disabled={loading}
                className="rounded-full border border-amber-900/10 bg-white px-3 py-1 text-xs text-lapis-800 shadow-sm hover:border-amber-400/60 hover:bg-amber-50/50 hover:text-amber-900 transition-all disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Message history */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#fdfbf7]">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-gradient-to-r from-lapis-900 to-lapis-800 text-white rounded-br-none shadow-md border border-amber-400/20'
                      : 'bg-white border border-slate-200/80 text-lapis-900 shadow-sm rounded-bl-none whitespace-pre-wrap'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200/80 px-4 py-3 shadow-sm rounded-bl-none text-lapis-700 text-xs">
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: '0ms' }}></span>
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: '150ms' }}></span>
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: '300ms' }}></span>
                  <span className="ms-1 font-medium">{isAr ? 'ليلى تكتب الرد...' : 'Layla is typing...'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Input box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="border-t border-slate-200 bg-white p-3.5 flex gap-2.5 items-center"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isAr ? 'اكتب استفسارك هنا بأي لغة...' : 'Ask anything in any language...'}
              disabled={loading}
              className="flex-1 rounded-2xl border border-slate-200 bg-[#fafafa] px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:bg-slate-100 transition-all"
              style={{ fontSize: '16px' }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-lapis-900 to-lapis-800 text-amber-300 shadow-md border border-amber-300/30 transition-all hover:scale-105 hover:border-amber-300/60 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
              aria-label="Send"
            >
              <svg className={`h-4 w-4 ${isAr ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
