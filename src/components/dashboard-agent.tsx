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
  }, [user]);

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

  const renderMessageContent = (text: string) => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const label = match[1];
      const href = match[2];
      parts.push(
        <Link
          key={match.index}
          href={href}
          className="inline-flex items-center gap-1 font-semibold text-amber-700 underline underline-offset-4 hover:text-amber-900 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/60 transition-colors my-0.5"
          target={href.startsWith('http') ? '_blank' : undefined}
        >
          <span>{label}</span>
          <Icon name="external-link" size={12} />
        </Link>
      );
      lastIndex = linkRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  };

  return (
    <>
      {/* Floating launcher button — Executive Luxury Insignia */}
      <div className="fixed bottom-6 right-6 z-50 print:hidden">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Executive assistant"
          className="group relative flex items-center gap-3.5 rounded-full bg-gradient-to-r from-[#101626] via-[#18223c] to-[#1e2a4a] p-1.5 pe-5 ps-2 text-white shadow-[0_14px_34px_-6px_rgba(16,22,38,0.55),0_0_20px_rgba(217,166,74,0.22)] border border-amber-300/40 ring-1 ring-white/10 transition-all duration-300 hover:scale-105 hover:border-amber-300/80 hover:shadow-[0_18px_40px_-4px_rgba(16,22,38,0.65),0_0_28px_rgba(217,166,74,0.35)] active:scale-95 focus:outline-none"
        >
          {/* Luminous Emblem Medallion */}
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/30 via-amber-300/15 to-transparent p-1 border border-amber-300/50 shadow-inner">
            <svg
              className="h-5 w-5 text-amber-300 transition-transform duration-300 group-hover:rotate-45 drop-shadow-[0_1px_4px_rgba(217,166,74,0.6)]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              {/* Executive Compass Star Emblem */}
              <path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8L12 2Z" />
              <circle cx="12" cy="12" r="2.5" fill="#101626" />
            </svg>
            {/* Live Indicator */}
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400 border-2 border-[#101626]"></span>
            </span>
          </div>

          {/* Typography */}
          <div className="flex flex-col text-start">
            <span
              className="text-xs font-bold tracking-wide text-white drop-shadow-sm flex items-center gap-1.5"
              style={{ fontFamily: "'El Messiri Variable', sans-serif" }}
            >
              Executive assistant
              <span className="text-[9px] font-semibold text-amber-300 uppercase px-1.5 py-0.2 rounded-full bg-amber-400/20 border border-amber-300/40">
                PRO
              </span>
            </span>
            <span className="text-[10px] text-amber-200/70 font-medium">
              Operations insights
            </span>
          </div>
        </button>
      </div>

      {/* Assistant Modal / Drawer — Executive Theme */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 flex w-[calc(100vw-2rem)] sm:w-[450px] max-h-[82vh] h-[630px] flex-col overflow-hidden rounded-3xl border border-amber-900/15 bg-white shadow-[0_25px_60px_-15px_rgba(16,22,38,0.5),0_0_35px_rgba(217,166,74,0.18)] animate-in fade-in slide-in-from-bottom-5 duration-200 print:hidden">
          {/* Header */}
          <div className="relative flex items-center justify-between border-b border-amber-400/25 bg-gradient-to-r from-[#101626] via-[#18223c] to-[#1e2a4a] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/30 via-amber-300/15 to-transparent border border-amber-300/40 shadow-inner">
                <svg className="h-5 w-5 text-amber-300" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8L12 2Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold leading-tight flex items-center gap-2" style={{ fontFamily: "'El Messiri Variable', sans-serif" }}>
                  <span>Villa Layla assistant</span>
                  <span className="text-[10px] text-amber-300 px-1.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/30">
                    Read-only
                  </span>
                </h3>
                <p className="text-[11px] text-amber-100/70 flex items-center gap-1.5 mt-0.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
                  Operations, revenue, stock, shifts and staff
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([])}
                title="Clear conversation"
                aria-label="Clear conversation"
                className="flex h-8 w-8 items-center justify-center rounded-full text-amber-200/70 hover:bg-white/10 hover:text-white transition-colors text-xs"
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-amber-200/70 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>

          {/* Quick Prompts Bar */}
          <div className="border-b border-cocoa-100/80 bg-[#fbfbfa] px-3.5 py-2.5 flex gap-1.5 overflow-x-auto scrollbar-none whitespace-nowrap">
            {DASHBOARD_PROMPTS.map((p, i) => (
              <button
                key={i}
                onClick={() => handleSend(p)}
                disabled={loading}
                className="rounded-full border border-amber-900/10 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:border-amber-400/60 hover:bg-amber-50/50 hover:text-amber-900 transition-all disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Messages Body */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#fdfbf7]">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-gradient-to-r from-lapis-900 to-lapis-800 text-white rounded-br-none shadow-md border border-amber-400/20'
                      : 'bg-white border border-slate-200/80 text-slate-800 rounded-bl-none shadow-sm whitespace-pre-wrap'
                  }`}
                >
                  {m.role === 'assistant' ? renderMessageContent(m.content) : m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200/80 px-4 py-3 text-xs text-slate-700 shadow-sm rounded-bl-none">
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: '0ms' }}></span>
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: '150ms' }}></span>
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: '300ms' }}></span>
                  <span className="font-semibold text-cocoa-800 ms-1">Looking up the data...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input Box */}
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
              placeholder="Ask about operations, revenue, stock, shifts or staff..."
              disabled={loading}
              className="flex-1 rounded-2xl border border-slate-200 bg-[#fafafa] px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:bg-slate-100 transition-all"
              style={{ fontSize: '16px' }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-10 px-4 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-lapis-900 to-lapis-800 text-amber-300 font-semibold shadow-md border border-amber-300/30 transition-all hover:scale-105 hover:border-amber-300/60 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 text-sm gap-1.5"
            >
              <span>Send</span>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
