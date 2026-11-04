'use client';

import { useEffect, useState } from 'react';

const OURS = ['en', 'ar', 'fr', 'es'];
const OFF = 'vl_mt_off';

const readCookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1];
const setCookie = (name: string, value: string, days = 365) => {
  const exp = days ? `; max-age=${days * 86400}` : '; max-age=0';
  document.cookie = `${name}=${value}; path=/${exp}; samesite=lax`;
  // Google's translator also reads the cookie on the parent domain.
  const host = location.hostname;
  if (host.includes('.')) document.cookie = `${name}=${value}; path=/; domain=.${host.split('.').slice(-2).join('.')}${exp}; samesite=lax`;
};

/** Google's translator rewrites text nodes; React must not crash when it later updates them. */
function guardDom() {
  const w = window as any;
  if (w.__vlDomGuard) return;
  w.__vlDomGuard = true;
  const remove = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return remove.call(this, child) as T;
  };
  const insert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return node;
    return insert.call(this, node, ref) as T;
  };
}

/**
 * Visitors whose browser speaks a language the site is not written in (German, Italian, Russian, Chinese, Turkish…)
 * get the page translated into it automatically. A small pill shows the language and switches back to the original.
 * Arabic, English, French and Spanish visitors are sent to their own pages instead (middleware), so nothing loads.
 */
export function AutoTranslate() {
  const [lang, setLang] = useState<{ code: string; name: string } | null>(null);

  useEffect(() => {
    // The French and Spanish pages are written in English: they are translated into French / Spanish here, so
    // switching the language gives the whole page in that language (no pill: it is the page's own language).
    const site = location.pathname.split('/')[1];
    const pageLang = site === 'fr' || site === 'es' ? site : null;
    const pref = (navigator.languages?.[0] || navigator.language || '').trim();
    const base = pref.split('-')[0].toLowerCase();
    const foreign = !pageLang && site === 'en' && base && !OURS.includes(base) && !readCookie(OFF);
    if (!pageLang && !foreign) {
      // English / Arabic page: forget a translation left from the French or Spanish page, or it would translate this one.
      if (readCookie('googtrans')) {
        setCookie('googtrans', '', 0);
        if (/translated-(ltr|rtl)/.test(document.documentElement.className)) location.reload();
      }
      return;
    }
    // Google codes: keep the region for Chinese (zh-CN / zh-TW) and Portuguese; else the base language.
    const code = pageLang ?? (base === 'zh' ? (/tw|hk|hant/i.test(pref) ? 'zh-TW' : 'zh-CN') : base === 'pt' ? 'pt' : base === 'he' ? 'iw' : base);
    let name = code;
    try { name = new Intl.DisplayNames([pref || code], { type: 'language' }).of(code.split('-')[0]) || code; } catch { /* keep the code */ }
    if (!pageLang) setLang({ code, name: name.charAt(0).toUpperCase() + name.slice(1) });

    guardDom();
    setCookie('googtrans', pageLang ? `/en/${code}` : `/auto/${code}`);
    const w = window as any;
    w.vlTranslateInit = () => {
      try { new w.google.translate.TranslateElement({ pageLanguage: pageLang ? 'en' : 'auto', autoDisplay: false }, 'vl-gt'); } catch { /* blocked */ }
    };
    if (!document.getElementById('vl-gt-js')) {
      const s = document.createElement('script');
      s.id = 'vl-gt-js';
      s.src = 'https://translate.google.com/translate_a/element.js?cb=vlTranslateInit';
      s.async = true;
      document.body.appendChild(s);
    }
    document.documentElement.classList.add('vl-mt');
  }, []);

  if (!lang) return <div id="vl-gt" hidden />;
  const original = () => {
    setCookie(OFF, '1');
    setCookie('googtrans', '', 0);
    location.reload();
  };
  return (
    <>
      <div id="vl-gt" hidden />
      <div className="vl-mt-pill notranslate" translate="no" role="status">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
        <span>{lang.name}</span>
        <button type="button" onClick={original}>Original</button>
      </div>
    </>
  );
}
