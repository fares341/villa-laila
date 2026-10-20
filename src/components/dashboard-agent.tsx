'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { Icon } from '@/components/icons';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const DASHBOARD_PROMPTS = [
  'Who arrives today?',
  "Today's revenue",
  'Low stock items',
  'Unpaid in-house guests',
  'Last shift Z-report',
  'Who was late today?',
];

export function DashboardAgent({ user }: { user: SessionUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Hello ${user.name}. I am the Villa Layla executive assistant. I answer questions about operations, revenue, stock, shifts and staff.\n\nI am read-only: I report on the data but do not change bookings, payments or records.`,
        },
      ]);
    }
  }, [user, messages.length]);

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
      const res = await fetch('/api/dashboard/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply || '' }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, the assistant could not be reached. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Links [label](/path) and **bold**; keeps line breaks.
  const renderInline = (text: string, keyBase: string) => {
    const out: React.ReactNode[] = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
    let last = 0, m: RegExpExecArray | null, i = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) {
        const href = m[2];
        out.push(
          <Link key={`${keyBase}-${i++}`} href={href} target={href.startsWith('http') ? '_blank' : undefined}
            className="inline-flex items-center gap-1 rounded-md bg-cocoa-50 px-1.5 py-0.5 font-semibold text-cocoa-800 underline decoration-gold-500/60 underline-offset-4 hover:bg-gold-300/30">
            {m[1]}<Icon name="chevron-right" size={12} />
          </Link>,
        );
      } else out.push(<strong key={`${keyBase}-${i++}`} className="font-bold text-cocoa-900">{m[3]}</strong>);
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
  const renderMessageContent = (text: string) =>
    text.split('\n').map((line, n) => {
      const bullet = /^\s*[-*•]\s+/.test(line);
      const body = renderInline(line.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, ''), String(n));
      if (!line.trim()) return <div key={n} className="h-2" />;
      return bullet
        ? <div key={n} className="flex gap-2 ps-1"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" /><span>{body}</span></div>
        : <div key={n}>{body}</div>;
    });

  return (
    <>
      {/* Launcher: a round brand button with the Villa Layla gold spark */}
      <div className="fixed bottom-6 right-6 z-50 print:hidden">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
          aria-expanded={isOpen}
          className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cocoa-600 to-cocoa-900 text-gold-300 shadow-[0_12px_28px_-8px_rgba(47,41,37,.6)] ring-4 ring-[#FBF7F1] transition-transform duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-gold-300"
        >
          <span className="absolute inset-[3px] rounded-full border border-gold-500/40" aria-hidden />
          {isOpen ? <Icon name="x" size={22} /> : (
            <svg viewBox="0 0 32 32" className="h-7 w-7 transition-transform duration-300 group-hover:-rotate-6" aria-hidden>
              <path d="M6 8.5A3.5 3.5 0 0 1 9.5 5h13A3.5 3.5 0 0 1 26 8.5v9a3.5 3.5 0 0 1-3.5 3.5H14l-5.2 4.3c-.6.5-1.5.1-1.5-.7V21h0A3.5 3.5 0 0 1 6 17.5z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
              <path d="M16 8.6l1.15 3.25L20.4 13l-3.25 1.15L16 17.4l-1.15-3.25L11.6 13l3.25-1.15z" fill="#E9C27E" />
            </svg>
          )}
          {!isOpen && (
            <span className="pointer-events-none absolute right-[calc(100%+12px)] whitespace-nowrap rounded-full bg-cocoa-900 px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              Ask the assistant
            </span>
          )}
        </button>
      </div>

      {isOpen && (
        <div role="dialog" aria-label="Villa Layla assistant"
          className="fixed bottom-24 right-4 z-50 flex h-[640px] max-h-[80vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[22px] border border-cocoa-200 bg-[#FBF7F1] shadow-[0_30px_70px_-20px_rgba(47,41,37,.55)] sm:right-6 sm:w-[440px] print:hidden">
          {/* Header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-cocoa-800 to-cocoa-900 px-5 pb-4 pt-5 text-white">
            <svg className="pointer-events-none absolute -right-6 -top-10 h-40 w-40 text-gold-500/10" viewBox="0 0 100 100" aria-hidden>
              <path d="M50 4a46 46 0 0 1 46 46H4A46 46 0 0 1 50 4z" fill="currentColor" />
            </svg>
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-500/15 ring-1 ring-gold-500/40">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="#E9C27E" /><circle cx="18.5" cy="17.5" r="1.6" fill="#E9C27E" opacity=".7" /></svg>
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-gold-300">Villa Layla</p>
                  <h3 className="text-base font-extrabold leading-tight">Operations assistant</h3>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setMessages([])} title="New conversation" aria-label="New conversation"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-cocoa-200 transition-colors hover:bg-white/10 hover:text-white"><Icon name="refresh" size={16} /></button>
                <button onClick={() => setIsOpen(false)} aria-label="Close"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-cocoa-200 transition-colors hover:bg-white/10 hover:text-white"><Icon name="x" size={18} /></button>
              </div>
            </div>
            <p className="relative mt-3 flex items-center gap-2 text-xs text-cocoa-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Live data · read-only
            </p>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cocoa-800" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="#E9C27E" /></svg>
                  </span>
                )}
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user'
                  ? 'rounded-br-md bg-cocoa-800 text-white'
                  : 'rounded-tl-md border border-cocoa-200 bg-white text-cocoa-900 shadow-[0_1px_2px_rgba(81,64,47,.06)]'}`}>
                  {m.role === 'assistant' ? renderMessageContent(m.content) : m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 ps-9 text-xs font-medium text-cocoa-600">
                {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold-500" style={{ animationDelay: `${d}ms` }} />)}
                Checking the live data
              </div>
            )}
            {messages.length <= 1 && !loading && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {DASHBOARD_PROMPTS.map((p) => (
                  <button key={p} onClick={() => handleSend(p)}
                    className="rounded-xl border border-cocoa-200 bg-white px-3 py-2.5 text-start text-xs font-semibold text-cocoa-800 transition-colors hover:border-gold-500 hover:bg-gold-300/15">
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="border-t border-cocoa-200 bg-white p-3">
            {messages.length > 1 && (
              <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {DASHBOARD_PROMPTS.map((p) => (
                  <button key={p} type="button" onClick={() => handleSend(p)} disabled={loading}
                    className="shrink-0 rounded-full bg-cocoa-50 px-3 py-1 text-[11px] font-semibold text-cocoa-600 hover:bg-gold-300/25 disabled:opacity-50">{p}</button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 rounded-full border border-cocoa-200 bg-[#FBF7F1] p-1.5 ps-4 focus-within:border-cocoa-600">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
                placeholder="Ask about revenue, guests, stock, shifts…" aria-label="Message"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-cocoa-900 placeholder:text-cocoa-400 focus:outline-none" />
              <button type="submit" disabled={loading || !input.trim()} aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-500 text-cocoa-900 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
