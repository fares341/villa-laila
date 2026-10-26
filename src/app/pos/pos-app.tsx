'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import {
  posState, posStaffList, posUnlock, posLock, posClock, posOpenShift, posSetDrawerRoles, posSale, posGuestFolio, posTakePayment, posExpense, posCloseShift, posManagers,
  posTasks, posTaskSave, posTaskReassign, posTasksShare, posWashReady, posRunNotes, posHandover, posTaken, posExchange, posEventTickets, posPayEvent, posEventList, posSellEvent, posCheckInEvent, posExtend, posExtendInfo, posTaxiConfirmed, posChangeList, posChangeSettle,
} from './actions';

/* ───────── helpers ───────── */

type Cur = string; // EGP, USD, EUR, or a rare currency (GBP, SAR…) picked under "Other"
const CURS: Cur[] = ['EGP', 'USD', 'EUR'];
const cur = (minor: number | null | undefined, c: string) => (c === 'EGP' ? egp(minor) : `${c} ${((minor ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const rateOf = (rates: any, c: Cur): number => (c === 'EGP' ? 1 : Number(c === 'USD' || c === 'EUR' ? rates?.[c] : rates?.others?.[c]) || 0);
const inCur = (egpCents: number, c: Cur, rates: any) => (c === 'EGP' ? egpCents : rateOf(rates, c) ? Math.round(egpCents / rateOf(rates, c)) : 0);
const CUR_NAMES = (() => { try { return new Intl.DisplayNames(['en'], { type: 'currency' }); } catch { return null; } })();
const curName = (c: string) => (c === 'EGP' ? 'Egyptian pounds' : c === 'USD' ? 'US dollars' : c === 'EUR' ? 'Euros' : CUR_NAMES?.of(c) ?? c);
const egp = (cents: number | null | undefined) => `EGP ${((cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const toCents = (v: string) => Math.round(Number(String(v).replace(/[^\d.]/g, '')) * 100) || 0;
const time = (iso: string | Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(new Date(iso));

type Staff = { id: string; full_name: string; role: string; is_manager: boolean };
type Product = { id: string; name: string; pos_category: 'market' | 'meals' | 'services'; price_cents: number; stock_quantity: number; track_stock: boolean; low_stock_threshold: number; barcode: string | null; unit_label: string | null };
type Tour = { id: string; name: string; organizer: string; cost_cents: number; price_cents: number; duration: string | null; guest_message?: string | null; files?: { id: string; name: string; mime: string }[] };
type Guest = { id: string; reference: string; full_name: string; nationality?: string | null; rooms: string | null; check_in: string; check_out: string; status: string; inHouse: boolean; charges: number; paid: number; balance: number; state: 'due' | 'settled' | 'credit' };
type Payer = { kind: 'eg' | 'foreign' | null; name: string; nationality: string; passport: string };

const ISO = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW'.split(' ');
const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } })();
const COUNTRIES = ISO.map(regionName).sort();
const countryOf = (v?: string | null) => (!v ? '' : /^[A-Z]{2}$/i.test(v) ? regionName(v.toUpperCase()) : v);
const isEgypt = (v?: string | null) => !!v && /^(eg|egypt|egyptian|مصر)/i.test(v.trim());
const newPayer = (g: Guest | null): Payer => ({ kind: g?.nationality ? (isEgypt(g.nationality) ? 'eg' : 'foreign') : null, name: g?.full_name ?? '', nationality: g?.nationality && !isEgypt(g.nationality) ? countryOf(g.nationality) : '', passport: '' });
const payerReady = (p: Payer) => p.kind === 'eg' || (p.kind === 'foreign' && p.name.trim().length >= 3 && p.nationality.trim().length >= 2 && /^[A-Z0-9]{5,20}$/.test(p.passport.replace(/\s+/g, '').toUpperCase()));
const payerOut = (p: Payer) => (p.kind === 'foreign' ? { name: p.name.trim(), nationality: p.nationality.trim(), passport: p.passport.replace(/\s+/g, '').toUpperCase() } : null);

/** Card on the venue machine: who is paying. Foreign guests give name, nationality and passport number (daily Excel). */
function CardPayerFields({ value, onChange }: { value: Payer; onChange: (p: Payer) => void }) {
  const set = (k: keyof Payer, v: string) => onChange({ ...value, [k]: v } as Payer);
  return (
    <div className="pos-payer">
      <p className="pos-payer-q">Who is paying by card?</p>
      <div className="pos-method" role="radiogroup" aria-label="Guest nationality">
        <button type="button" role="radio" aria-checked={value.kind === 'eg'} className={value.kind === 'eg' ? 'on' : ''} onClick={() => onChange({ ...value, kind: 'eg' })}>Egyptian</button>
        <button type="button" role="radio" aria-checked={value.kind === 'foreign'} className={value.kind === 'foreign' ? 'on' : ''} onClick={() => onChange({ ...value, kind: 'foreign' })}>Foreign guest</button>
      </div>
      {value.kind === 'foreign' && (
        <div className="pos-payer-grid">
          <div className="pos-field"><label htmlFor="cp-name">Name as in passport</label><input id="cp-name" value={value.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" /></div>
          <div className="pos-field"><label htmlFor="cp-nat">Nationality</label><input id="cp-nat" list="cp-countries" value={value.nationality} onChange={(e) => set('nationality', e.target.value)} autoComplete="off" placeholder="Start typing…" />
            <datalist id="cp-countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="pos-field"><label htmlFor="cp-pass">Passport number</label><input id="cp-pass" value={value.passport} onChange={(e) => set('passport', e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" inputMode="text" /></div>
        </div>
      )}
    </div>
  );
}
type CartLine = { key: string; type: 'product' | 'tour' | 'custom'; id?: string; name: string; unit: number; qty: number; max?: number | null };
type Tab = 'market' | 'meals' | 'services' | 'tours' | 'events';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'market', label: 'Drinks & snacks', icon: 'store' },
  { key: 'meals', label: 'Meals', icon: 'utensils' },
  { key: 'services', label: 'Services', icon: 'shirt' },
  { key: 'tours', label: 'Tours', icon: 'map' },
  { key: 'events', label: 'Events', icon: 'ticket' },
];

/* ───────── small UI pieces ───────── */

function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="pos-modal-bg" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`pos-modal ${wide ? 'wide' : ''}`}>
        <div className="pos-modal-hd">
          <h2>{title}</h2>
          {onClose && <button className="pos-icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>}
        </div>
        <div className="pos-modal-bd">{children}</div>
      </div>
    </div>
  );
}

function PinPad({ value, onChange, onSubmit, busy }: { value: string; onChange: (v: string) => void; onSubmit: () => void; busy?: boolean }) {
  const press = (k: string) => {
    if (k === 'del') onChange(value.slice(0, -1));
    else if (k === 'ok') onSubmit();
    else if (value.length < 6) onChange(value + k);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="pos-pin">
      <div className="pos-pin-dots" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < value.length ? 'on' : ''} />)}
      </div>
      <div className="pos-pin-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button key={k} type="button" className={`pos-key ${k === 'ok' ? 'ok' : ''}`} onClick={() => press(k)} disabled={busy || (k === 'ok' && value.length < 4)} aria-label={k === 'del' ? 'Delete' : k === 'ok' ? 'Enter' : k}>
            {k === 'del' ? <Icon name="delete" size={22} /> : k === 'ok' ? <Icon name="check" size={24} /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

function AmountPad({ label, value, onChange, unit = 'EGP' }: { label: string; value: string; onChange: (v: string) => void; unit?: string }) {
  const steps = unit === 'EGP' ? ['100', '200', '500', '1000'] : ['5', '10', '20', '50'];
  return (
    <div className="pos-field">
      <label>{label}</label>
      <div className="pos-amount">
        <span>{unit}</span>
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" autoFocus />
      </div>
      <div className="pos-quick">
        {steps.map((v) => <button type="button" key={v} onClick={() => onChange(String((Number(value) || 0) + Number(v)))}>+{v}</button>)}
        <button type="button" onClick={() => onChange('')}>Clear</button>
      </div>
    </div>
  );
}

/** One box per currency. `extra` = rare currencies that are in this drawer (they must be counted too). */
function CountGrid({ value, onChange, hint, extra = [] }: { value: Record<Cur, string>; onChange: (v: Record<Cur, string>) => void; hint?: string; extra?: string[] }) {
  return (
    <div className="pos-counts">
      {[...CURS, ...extra.filter((c) => !CURS.includes(c))].map((c) => (
        <div key={c} className="pos-field">
          <label htmlFor={`cnt-${c}`}>{curName(c)}</label>
          <div className="pos-amount small"><span>{c}</span>
            <input id={`cnt-${c}`} inputMode="decimal" value={value[c] ?? ''} placeholder="0" autoFocus={c === 'EGP'} onChange={(e) => onChange({ ...value, [c]: e.target.value.replace(/[^\d.]/g, '') })} /></div>
        </div>
      ))}
      {hint && <p className="pos-fine">{hint}</p>}
    </div>
  );
}
const countsOf = (v: Record<Cur, string>) => Object.fromEntries(Object.entries({ EGP: '', USD: '', EUR: '', ...v }).map(([k, x]) => [k, toCents(x)])) as Record<string, number> & { EGP: number; USD: number; EUR: number };

/** EGP / USD / EUR, plus "Other" for a rare currency at today's market rate (only currencies that have a rate). */
function CurSwitch({ value, onChange, rates, noEgp = false }: { value: Cur; onChange: (c: Cur) => void; rates: any; noEgp?: boolean }) {
  const others = Object.keys(rates?.others ?? {}).sort();
  const isOther = !CURS.includes(value);
  const [open, setOpen] = useState(isOther);
  return (
    <div>
      <div className="pos-cur" role="radiogroup" aria-label="Cash currency">
        {CURS.filter((c) => !(noEgp && c === 'EGP')).map((c) => (
          <button key={c} role="radio" aria-checked={value === c} className={value === c ? 'on' : ''} disabled={c !== 'EGP' && !rateOf(rates, c)} onClick={() => { setOpen(false); onChange(c); }}>
            {c}{c !== 'EGP' && rateOf(rates, c) && !rates?.plain ? <small>{rateOf(rates, c).toFixed(2)}</small> : null}
          </button>
        ))}
        {!rates?.plain && <button role="radio" aria-checked={isOther} className={isOther ? 'on' : ''} disabled={!others.length} onClick={() => setOpen(true)} title={others.length ? 'Another currency, at today’s rate' : 'Today’s rates for other currencies are not loaded yet. A manager can add one in Shifts & cash.'}>
          {isOther ? value : 'Other'}{isOther ? <small>{rateOf(rates, value).toFixed(2)}</small> : null}
        </button>}
      </div>
      {open && (
        <select className="pos-select" aria-label="Other currency" value={isOther ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">{noEgp ? 'Choose the currency…' : 'Choose the currency… (stays EGP until you choose)'}</option>
          {others.map((c) => <option key={c} value={c}>{c} · {curName(c)} · {rateOf(rates, c).toFixed(3)} EGP</option>)}
        </select>
      )}
    </div>
  );
}

/** What the guest handed over (cash). Shows the change; the change can be given now or kept for the guest to collect later. */
type ChangeState = { gave: string; later: boolean; guest: string };
const newChange = (): ChangeState => ({ gave: '', later: false, guest: '' });
const changeReady = (v: ChangeState, due: number, needName: boolean) => {
  const g = toCents(v.gave);
  if (!g) return true;
  if (g < due) return false;
  return !(g > due && v.later && needName && v.guest.trim().length < 2);
};
const changeOut = (v: ChangeState) => (toCents(v.gave) > 0 ? { gaveMinor: toCents(v.gave), later: v.later, guest: v.guest.trim() || null } : null);
const changeNote = (d: any, unit: string) => (Number(d?.changeMinor) > 0 ? (d.changeHeld ? ` · change ${cur(d.changeMinor, unit)} kept for the guest` : ` · give back ${cur(d.changeMinor, unit)}`) : '');
function ChangeField({ value, onChange, due, unit, needName }: { value: ChangeState; onChange: (v: ChangeState) => void; due: number; unit: string; needName: boolean }) {
  const gave = toCents(value.gave);
  const change = gave - due;
  const notes = unit === 'EGP' ? ['100', '200', '500', '1000'] : ['10', '20', '50', '100'];
  return (
    <div className="pos-field pos-change">
      <label htmlFor="chg-gave">Guest gave (optional)</label>
      <div className="pos-amount small"><span>{unit}</span>
        <input id="chg-gave" inputMode="decimal" value={value.gave} placeholder="exact amount" onChange={(e) => onChange({ ...value, gave: e.target.value.replace(/[^\d.]/g, '') })} /></div>
      <div className="pos-quick">{notes.map((n) => <button type="button" key={n} onClick={() => onChange({ ...value, gave: n })}>{n}</button>)}<button type="button" onClick={() => onChange(newChange())}>Exact</button></div>
      {gave > 0 && change < 0 && <p className="pos-msg bad">That is less than {cur(due, unit)}.</p>}
      {change > 0 && (
        <>
          <p className="pos-total"><span>Change for the guest</span><b className="num">{cur(change, unit)}</b></p>
          <div className="pos-method" role="radiogroup" aria-label="Change">
            <button type="button" role="radio" aria-checked={!value.later} className={!value.later ? 'on' : ''} onClick={() => onChange({ ...value, later: false })}><Icon name="check" /> Given now</button>
            <button type="button" role="radio" aria-checked={value.later} className={value.later ? 'on' : ''} onClick={() => onChange({ ...value, later: true })}><Icon name="clock" /> Guest comes back for it</button>
          </div>
          {value.later && needName && <input className="pos-input" aria-label="Guest name" value={value.guest} onChange={(e) => onChange({ ...value, guest: e.target.value })} maxLength={80} placeholder="Guest name / how you will know them" />}
          {value.later && <p className="pos-fine">The change stays in the drawer and is listed under More → Change to give back. If the guest says keep it, mark it there as a tip.</p>}
        </>
      )}
    </div>
  );
}

/** "Sun 25 Oct" — easier to read at the desk than 2026-10-25. */
const dayLabel = (d?: string | null) => (d ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z')) : '');

/** Change guests will come back for: give it back (leaves the drawer) or keep it as a tip if the guest says so. */
function ChangeOwedModal({ onClose, notify, onChanged }: { onClose: () => void; notify: (t: string, k?: 'ok' | 'bad') => void; onChanged: () => Promise<void> | void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await posChangeList(); if (r.ok) setRows(r.data); else notify(r.error, 'bad'); }, [notify]);
  useEffect(() => { load(); }, [load]);
  const act = async (o: any, a: 'given' | 'tip') => {
    setBusy(o.id);
    const r = await posChangeSettle(o.id, a);
    setBusy(null);
    if (!r.ok) { notify(r.error, 'bad'); return; }
    notify(a === 'given' ? `Gave ${cur(Number(o.minor), o.currency)} back to ${o.guest}` : `${cur(Number(o.minor), o.currency)} from ${o.guest} kept as a tip`);
    await load(); await onChanged();
  };
  return (
    <Modal title="Change to give back" onClose={onClose}>
      <p className="pos-fine">Guests who paid with a bigger note and will come back for their change. The money is in the drawer. When they come: <b>Gave it back</b>. If they say keep it: <b>Kept as tip</b>.</p>
      {rows === null ? <p className="pos-fine">Loading…</p> : !rows.length ? <p className="pos-fine">Nobody is waiting for change.</p> : (
        <ul className="pos-change-list">{rows.map((o) => (
          <li key={o.id}>
            <div className="who"><b>{o.guest} · {cur(Number(o.minor), o.currency)}</b>
              <small>{o.what}{o.gave_minor ? ` · gave ${cur(Number(o.gave_minor), o.currency)}` : ''} · {new Date(o.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })} · shift #{o.shift_no}{o.staff ? ` · ${o.staff}` : ''}</small></div>
            <div className="acts">
              <button className="pos-btn primary" disabled={busy === o.id} onClick={() => act(o, 'given')}><Icon name="check" /> Gave it back</button>
              <button className="pos-btn" disabled={busy === o.id} onClick={() => act(o, 'tip')}>Kept as tip</button>
            </div>
          </li>))}</ul>)}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* ───────── Lock screen ───────── */

function LockScreen({ hotel, branch, onUnlocked, notice }: { hotel: string; branch: string; onUnlocked: () => void; notice?: string | null }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pick, setPick] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'unlock' | 'in' | 'out'>('unlock');
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(notice ? { text: notice, kind: 'ok' } : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { posStaffList().then((r) => r.ok && setStaff(r.data)); }, []);

  const submit = async () => {
    if (!pick || pin.length < 4) return;
    setBusy(true); setMsg(null);
    if (mode === 'unlock') {
      const r = await posUnlock(pick.id, pin);
      setBusy(false); setPin('');
      if (r.ok) onUnlocked(); else setMsg({ text: r.error, kind: 'bad' });
      return;
    }
    const r = await posClock(pick.id, pin, mode);
    setBusy(false); setPin('');
    if (!r.ok) { setMsg({ text: r.error, kind: 'bad' }); return; }
    const d = r.data;
    setMsg({
      kind: 'ok',
      text: mode === 'in'
        ? d.already ? `${d.name} is already clocked in.` : d.tier > 0 ? `${d.name} clocked in · ${d.minutes} min late (tier ${d.tier}).` : `${d.name} clocked in on time.`
        : d.out ? `${d.name} clocked out.` : `${d.name} was not clocked in.`,
    });
    setPick(null);
  };
  // Six digits entered: no need to press Enter.
  useEffect(() => { if (pin.length === 6 && pick && !busy) submit(); }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pos-lock">
      <div className="pos-lock-brand">
        <img src="/assets/logo-240.webp" alt="" width={72} height={76} />
        <div><b>{hotel}</b><span>{branch}</span></div>
        <span className="pos-clock-now"><Icon name="clock" size={16} /> <LiveClock /></span>
      </div>
      <div className="pos-lock-body">
        <div className="pos-seg" role="tablist">
          {([['unlock', 'Open POS', 'lock'], ['in', 'Clock in', 'log-in'], ['out', 'Clock out', 'log-out']] as const).map(([k, l, ic]) => (
            <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setMsg(null); setPin(''); }}><Icon name={ic} size={16} />{l}</button>
          ))}
        </div>
        {msg && <p className={`pos-msg ${msg.kind}`} role="status">{msg.text}</p>}
        {!pick ? (
          <>
            <h1>{mode === 'unlock' ? 'Who is on the till?' : mode === 'in' ? 'Who is starting work?' : 'Who is finishing work?'}</h1>
            <div className="pos-staff-grid">
              {staff.map((s) => (
                <button key={s.id} className="pos-staff" onClick={() => { setPick(s); setPin(''); setMsg(null); }}>
                  <span className="av">{s.full_name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('')}</span>
                  <b>{s.full_name}</b><small>{s.role}{s.is_manager && !/manager/i.test(s.role ?? '') ? ' · Manager' : ''}</small>
                </button>
              ))}
              {!staff.length && <p className="pos-empty">No staff with a PIN yet. A manager adds staff in Dashboard → Staff.</p>}
            </div>
          </>
        ) : (
          <div className="pos-pin-wrap">
            <button className="pos-back" onClick={() => setPick(null)}><Icon name="chevron-left" size={18} /> {pick.full_name}</button>
            <h1>Enter your PIN</h1>
            <PinPad value={pin} onChange={setPin} onSubmit={submit} busy={busy} />
          </div>
        )}
      </div>
    </div>
  );
}

function LiveClock() {
  const [t, setT] = useState('');
  useEffect(() => { const f = () => setT(time(new Date())); f(); const i = setInterval(f, 15000); return () => clearInterval(i); }, []);
  return <span className="num">{t}</span>;
}

/* ───────── Main app ───────── */

export function PosApp({ hotel, branch, device, initialGuest = null }: { hotel: string; branch: string; device: string; initialGuest?: string | null }) {
  const [st, setSt] = useState<any>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [showTasks, setShowTasks] = useState(false);

  const refresh = useCallback(async () => {
    const r = await posState();
    if (r.ok) { setSt(r.data); setLastSync(new Date()); setOnline(true); } else { setOnline(false); setToast({ text: r.error, kind: 'bad' }); }
  }, []);

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 30000);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { clearInterval(i); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [refresh]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

    if (!st) {
    return (
      <div className="pos-root pos-loading">
        <Icon name="refresh" size={28} className={online ? "spin" : ""} />
        <div style={{ marginTop: 12, fontWeight: 600 }}>{online ? "Loading POS…" : "Offline / Reconnecting…"}</div>
        {toast && (
          <div style={{ marginTop: 14, color: "#f87171", fontSize: 14 }}>
            {toast.text}
          </div>
        )}
        <button
          onClick={() => refresh()}
          style={{
            marginTop: 16,
            padding: "8px 20px",
            background: "#8A5D3B",
            color: "#fff",
            borderRadius: 6,
            cursor: "pointer",
            border: "none",
            fontWeight: 600,
            fontSize: 14
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!st.me) return <div className="pos-root"><LockScreen hotel={hotel} branch={branch} notice={lockNotice} onUnlocked={() => { setLockNotice(null); refresh(); }} />{toast && <Toast t={toast} />}</div>;

  const lock = async () => { await posLock(); setLockNotice(null); refresh(); };
  const tasksBtn = (
    <button className="pos-btn" onClick={() => setShowTasks(true)}><Icon name="clipboard-list" /> My tasks{st.tasks?.open ? ` (${st.tasks.open})` : ''}</button>
  );
  const tasksModal = showTasks ? <TasksModal onClose={() => { setShowTasks(false); refresh(); }} notify={(text, kind = 'ok') => setToast({ text, kind })} /> : null;

  if (!st.shift) return <div className="pos-root"><OpenShift me={st.me} schedule={st.schedule} roles={st.roles} posStaff={st.posStaff ?? []} onRoles={refresh} tasksBtn={tasksBtn} extra={st.handoverExtra ?? []} onOpened={(m) => { setToast({ text: m, kind: 'ok' }); refresh(); }} onLock={lock} />{tasksModal}{toast && <Toast t={toast} />}</div>;

  return (
    <div className="pos-root">
      <Register initialGuest={initialGuest} st={st} hotel={hotel} branch={branch} device={device} online={online} lastSync={lastSync} refresh={refresh} lock={lock}
        notify={(text, kind = 'ok') => setToast({ text, kind })} onClosed={(msg) => { setLockNotice(msg); refresh(); }} />
      {toast && <Toast t={toast} />}
    </div>
  );
}

const hm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);

/** My rostered shift today (times, late / overtime) and who works with me and when they come. */
function ShiftPanel({ sc }: { sc: any }) {
  if (!sc) return null;
  const me = sc.me;
  const now = Date.parse(sc.now);
  return (
    <div className="pos-shiftinfo">
      {me ? (
        <div className="pos-shiftinfo-me">
          <b>My shift: {me.label} · {me.start}–{me.end}</b>
          <span>
            {me.clockIn ? <>Clocked in {hm(me.clockIn)}{sc.late > 0 ? <em className="bad"> · {mins(sc.late)} late</em> : <em className="ok"> · on time</em>}</> : Date.parse(me.startAt) > now ? `Starts at ${me.start}` : <em className="bad">Not clocked in</em>}
            {sc.overtime > 0 && <em className="ok"> · overtime {mins(sc.overtime)}</em>}
            {me.clockIn && !me.clockOut && Date.parse(me.endAt) > now && <> · ends in {mins(Math.round((Date.parse(me.endAt) - now) / 60000))}</>}
          </span>
        </div>
      ) : <div className="pos-shiftinfo-me"><b>No shift on the roster for you today</b><span>Ask the manager to put you on the roster.</span></div>}
      {sc.team?.length > 0 && (
        <ul className="pos-shiftinfo-team">
          {sc.team.map((t: any) => (
            <li key={t.staffId + t.startAt}>
              <b>{t.name}</b> <span>{t.label} · {t.start}–{t.end}</span>
              <span className={`pos-badge ${t.clockIn && !t.clockOut ? 'green' : 'gray'}`}>{t.clockIn && !t.clockOut ? `in since ${hm(t.clockIn)}` : t.clockOut ? `left ${hm(t.clockOut)}` : Date.parse(t.startAt) > now ? `comes ${t.start}` : 'not in yet'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Manager: who closes this drawer, and who opens the next one. */
function DrawerRoles({ st, notify, onDone }: { st: any; notify: (t: string, k?: 'ok' | 'bad') => void; onDone: () => void }) {
  const set = async (v: { closer?: string | null; nextOpener?: string | null }, msg: string) => {
    const r = await posSetDrawerRoles(v);
    if (!r.ok) notify(r.error, 'bad'); else { notify(msg); onDone(); }
  };
  const staff: { id: string; full_name: string }[] = st.posStaff ?? [];
  return (
    <div className="pos-drawer-roles">
      <div className="pos-field">
        <label htmlFor="pos-closer">Who closes this drawer</label>
        <select id="pos-closer" value={st.roles?.closer?.id ?? ''} onChange={(e) => set({ closer: e.target.value || null }, 'Saved · only they (or a manager) can close the shift')}>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.id === st.shift.staffId ? ' (opened it)' : ''}</option>)}
        </select>
      </div>
      <div className="pos-field">
        <label htmlFor="pos-next">Who opens the next drawer</label>
        <select id="pos-next" value={st.roles?.nextOpener?.id ?? ''} onChange={(e) => set({ nextOpener: e.target.value || null }, 'Saved · they open the drawer after this shift is closed')}>
          <option value="">— choose later —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>
    </div>
  );
}

function Toast({ t }: { t: { text: string; kind: 'ok' | 'bad' } }) {
  return <div className={`pos-toast ${t.kind}`} role="status"><Icon name={t.kind === 'ok' ? 'check-circle' : 'alert-triangle'} size={20} />{t.text}</div>;
}

function OpenShift({ me, schedule, roles, posStaff = [], onRoles, onOpened, onLock, tasksBtn, extra = [] }: { me: Staff; schedule?: any; roles?: { nextOpener: { id: string; name: string } | null } | null; posStaff?: { id: string; full_name: string }[]; onRoles: () => void; onOpened: (msg: string) => void; onLock: () => void; tasksBtn?: React.ReactNode; extra?: string[] }) {
  const [counts, setCounts] = useState<Record<Cur, string>>({ EGP: '', USD: '', EUR: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opener = roles?.nextOpener ?? null;
  const mayOpen = me.is_manager || opener?.id === me.id;
  const choose = async (id: string) => { setErr(null); const r = await posSetDrawerRoles({ nextOpener: id || null }); if (!r.ok) setErr(r.error); onRoles(); };
  const pickOpener = me.is_manager ? (
    <div className="pos-field" style={{ marginBottom: 14 }}>
      <label htmlFor="pos-opener">Who opens the drawer this shift? (manager)</label>
      <select id="pos-opener" className="pos-input" value={opener?.id ?? ''} onChange={(e) => choose(e.target.value)}>
        <option value="">— choose —</option>
        {posStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.id === me.id ? ' (me)' : ''}</option>)}
      </select>
    </div>
  ) : null;
  if (!mayOpen) {
    return (
      <div className="pos-center">
        <div className="pos-card-msg">
          <span className="pos-chip"><Icon name="user" size={14} /> {me.full_name}</span>
          <Icon name="lock" size={28} />
          <h2>The drawer isn’t open yet</h2>
          <ShiftPanel sc={schedule} />
          <p>{opener ? <>The manager chose <b>{opener.name}</b> to open the drawer. Once it’s open, everyone on the shift uses the POS.</> : <>The manager chooses who opens the drawer. Ask the manager to choose on the POS.</>}</p>
          {err && <p className="pos-msg bad">{err}</p>}
          <div className="pos-row center">{tasksBtn}<button className="pos-btn" onClick={onLock}><Icon name="lock" /> Back to lock screen</button></div>
        </div>
      </div>
    );
  }
  const go = async () => {
    setBusy(true); setErr(null);
    const r = await posOpenShift(countsOf(counts));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    const parts = [`Shift #${r.data.no} opened`];
    if (r.data.mismatch) parts.push(`difference with the last handover: ${r.data.mismatch} (manager informed)`);
    if (r.data.tier > 0) parts.push(`you were ${r.data.late} min late`);
    onOpened(parts.join(' · '));
  };
  return (
    <div className="pos-center">
      <div className="pos-card-msg wide">
        <span className="pos-chip"><Icon name="user" size={14} /> {me.full_name}</span>
        <h2>Receive the drawer</h2>
        <ShiftPanel sc={schedule} />
        {pickOpener}
        <p>Count the cash you receive, each currency on its own, and check the card slips. Any difference is the previous shift’s responsibility.</p>
        <CountGrid value={counts} onChange={setCounts} extra={extra} />
        {err && <p className="pos-msg bad">{err}</p>}
        <div className="pos-row">
          {tasksBtn}<button className="pos-btn ghost" onClick={onLock}><Icon name="lock" /> Lock</button>
          <button className="pos-btn primary big" onClick={go} disabled={busy}><Icon name="log-in" /> Open Shift</button>
        </div>
      </div>
    </div>
  );
}

function Register({ initialGuest, st, hotel, branch, device, online, lastSync, refresh, lock, notify, onClosed }: {
  initialGuest: string | null; st: any; hotel: string; branch: string; device: string; online: boolean; lastSync: Date | null;
  refresh: () => Promise<void>; lock: () => void; notify: (t: string, k?: 'ok' | 'bad') => void; onClosed: (msg: string) => void;
}) {
  const products: Product[] = st.catalog?.products ?? [];
  const tours: Tour[] = st.catalog?.tours ?? [];
  const guests: Guest[] = st.guests ?? [];
  const [tab, setTab] = useState<Tab>('market');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [guestId, setGuestId] = useState<string | null>(initialGuest);
  const [evSell, setEvSell] = useState<string | null>(null);
  const [events, setEvents] = useState<any[] | null>(null);
  const [guestQuery, setGuestQuery] = useState('');
  const [guestOpen, setGuestOpen] = useState(false);
  const [method, setMethod] = useState<PM>('cash');
  const [cashCur, setCashCur] = useState<Cur>('EGP');
  const [catalog, setCatalog] = useState<Tour | null>(null);
  const curNow: Cur = method === 'cash' ? cashCur : 'EGP';
  const [modal, setModal] = useState<null | 'custom' | 'comp' | 'pay' | 'close' | 'folio' | 'payment' | 'expense' | 'menu' | 'tasks' | 'taken' | 'exchange' | 'event' | 'extend' | 'change' | 'myshift'>(null);
  const [busy, setBusy] = useState(false);
  const [payMode, setPayMode] = useState<'pay_now' | 'settle_all' | 'walk_in'>('pay_now');
  const guest = guests.find((g) => g.id === guestId) ?? null;
  const total = cart.reduce((s, l) => s + l.unit * l.qty, 0);

  useEffect(() => { if (tab === 'events') posEventList().then((r) => setEvents(r.ok ? r.data : [])); }, [tab]);
  // Forget a guest who left the list (checked out / cancelled); wait until the list has loaded.
  useEffect(() => { if (guestId && st.guests && !guests.some((g) => g.id === guestId)) setGuestId(null); }, [guests, guestId, st.guests]);

  const add = useCallback((line: Omit<CartLine, 'key' | 'qty'> & { qty?: number }) => {
    setCart((c) => {
      const key = `${line.type}:${line.id ?? line.name}:${line.unit}`;
      const ex = c.find((x) => x.key === key);
      if (ex) {
        if (ex.max != null && ex.qty >= ex.max) { notify(`Only ${ex.max} in stock`, 'bad'); return c; }
        return c.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x));
      }
      return [...c, { ...line, key, qty: line.qty ?? 1 }];
    });
  }, [notify]);

  const addProduct = useCallback((p: Product) => {
    if (p.track_stock && p.stock_quantity <= 0) { notify(`${p.name} is out of stock`, 'bad'); return; }
    add({ type: 'product', id: p.id, name: p.name, unit: p.price_cents, max: p.track_stock ? p.stock_quantity : null });
  }, [add, notify]);

  // Barcode scanner: fast keystrokes ending in Enter, while no input is focused.
  useEffect(() => {
    let buf = '', last = 0;
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const now = Date.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 4) {
          const p = products.find((x) => x.barcode && x.barcode === buf);
          if (p) addProduct(p); else notify(`No item with barcode ${buf}`, 'bad');
        }
        buf = '';
      } else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [products, addProduct, notify]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (tab === 'tours') return tours.filter((t) => !s || t.name.toLowerCase().includes(s) || t.organizer.toLowerCase().includes(s));
    return products.filter((p) => (s ? p.name.toLowerCase().includes(s) || p.barcode === s : p.pos_category === tab));
  }, [tab, search, products, tours]);

  const guestMatches = useMemo(() => {
    const s = guestQuery.trim().toLowerCase();
    return guests.filter((g) => !s || g.full_name.toLowerCase().includes(s) || (g.rooms ?? '').toLowerCase().includes(s) || g.reference.toLowerCase().includes(s)).slice(0, 8);
  }, [guestQuery, guests]);

  // Card payments always go through the pay screen, which asks for a foreign guest's passport details.
  // Every payment goes through the pay screen: card asks for a foreign guest's passport details, and a tip can be added.
  const cardOr = (mode: 'settle_all' | 'walk_in') => { setPayMode(mode); setModal('pay'); };
  const run = async (mode: 'charge_room' | 'pay_now' | 'settle_all' | 'walk_in', extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await posSale({
      reservationId: mode === 'walk_in' ? null : guestId, mode, method, cashCurrency: curNow,
      items: cart.map((l) => ({ type: l.type, id: l.id, name: l.name, qty: l.qty, unitCents: l.unit })), ...extra,
    });
    setBusy(false);
    if (!r.ok) { notify(r.error, 'bad'); return false; }
    const d = r.data;
    notify((
      mode === 'charge_room' ? `${egp(d.cartTotal)} put on ${d.guest}'s bill` :
      mode === 'settle_all' ? `${d.cashForeign != null ? cur(d.cashForeign, d.cashCurrency) + ' (' + egp(d.paidCents) + ')' : egp(d.paidCents)} paid · ${d.guest}'s bill is fully paid` :
      `${d.cashForeign != null ? cur(d.cashForeign, d.cashCurrency) + ' (' + egp(d.paidCents) + ')' : egp(d.paidCents)} paid · ${PM_LABEL[method as PM] ?? method}`)
    + (d.tipMinor > 0 ? ` · tip ${cur(d.tipMinor, method === 'cash' ? d.cashCurrency : 'EGP')}` : '') + changeNote(d, d.cashCurrency ?? 'EGP'));
    if (d.tourLines?.length) notify(`Book the car & driver for ${d.tourLines.map((t: any) => t.name).join(', ')} now. It is in your tasks.`);
    setCart([]); setModal(null);
    if (mode === 'walk_in') setGuestId(null);
    await refresh();
    return true;
  };

  const synced = online && lastSync && Date.now() - lastSync.getTime() < 75000;

  return (
    <div className="pos-app">
      {/* ── Top bar ── */}
      <header className="pos-top">
        <div className="pos-brand"><img src="/assets/logo-240.webp" alt="" width={34} height={36} /><div><b>{hotel}</b><small>{branch}</small></div></div>
        <div className="pos-top-meta">
          <span className="pos-chip"><Icon name="user" size={14} /> {st.me.full_name}</span>
          <span className="pos-chip"><Icon name="receipt" size={14} /> Shift #{st.shift.no} · since {time(st.shift.openedAt)}</span>
          {st.schedule?.me && <button className={`pos-chip ${st.schedule.late > 0 ? 'bad' : ''}`} onClick={() => setModal('myshift')} title="My shift and who works with me"><Icon name="clock" size={14} /> My shift {st.schedule.me.start}–{st.schedule.me.end}{st.schedule.overtime > 0 ? ` · +${st.schedule.overtime} min` : ''}</button>}
          {!st.schedule?.me && <button className="pos-chip" onClick={() => setModal('myshift')}><Icon name="users" size={14} /> Shift team</button>}
          <span className="pos-chip" title="Chosen by the manager"><Icon name="key" size={14} /> Drawer: {st.shift.staffName}{st.roles?.closer ? ` · closes: ${st.roles.closer.name}` : ''}</span>
          <span className={`pos-chip ${synced ? 'ok' : 'bad'}`}><Icon name={synced ? 'wifi' : 'wifi-off'} size={14} /> {synced ? `Connected · Synced ${time(lastSync!)}` : 'Offline — retrying'}</span>
        </div>
        <div className="pos-top-figs">
          <div><small>Today’s Revenue</small><b className="num">{egp(st.revenue)}</b></div>
          <div title={st.drawer == null ? 'Hidden until the blind count at close' : undefined}><small>Cash in drawer</small><b className="num">{st.drawer == null ? 'Counted at close' : egp(st.drawer)}</b>{st.currencies && (st.currencies.USD || st.currencies.EUR) ? <small className="num">{cur(st.currencies.USD, 'USD')} · {cur(st.currencies.EUR, 'EUR')}</small> : null}</div>
        </div>
        <div className="pos-top-acts">
          <button className={`pos-btn ghost ${st.tasks?.open ? 'has-tasks' : ''}`} onClick={() => setModal('tasks')}>
            <Icon name="clipboard-list" /> Tasks{st.tasks ? (st.tasks.distributed ? ` ${st.tasks.mine - st.tasks.open}/${st.tasks.mine}` : '') : ''}
            {st.tasks?.open ? <span className="pos-dot">{st.tasks.open}</span> : null}
          </button>
          <button className="pos-btn ghost" onClick={() => setModal('extend')} title="Choose a guest, add nights, then take the payment"><Icon name="calendar-days" /> Extend stay</button>
          <button className="pos-icon-btn" onClick={() => refresh()} aria-label="Refresh"><Icon name="refresh" size={20} /></button>
          <button className="pos-icon-btn" onClick={() => setModal('menu')} aria-label="More"><Icon name="menu" size={20} /></button>
          {st.changeOwed?.length > 0 && <button className="pos-btn ghost" onClick={() => setModal('change')} title="Guests who will come back for their change"><Icon name="clock" /> Change owed <span className="pos-count">{st.changeOwed.length}</span></button>}
          <button className="pos-btn ghost" onClick={lock}><Icon name="lock" /> Lock Screen</button>
          {(st.me.is_manager || st.roles?.closer?.id === st.me.id)
            ? <button className="pos-btn danger" onClick={() => setModal('close')}><Icon name="log-out" /> Close Shift</button>
            : <span className="pos-chip" title="Only the person the manager chose closes the drawer"><Icon name="lock" size={14} /> {st.roles?.closer?.name ?? 'Manager'} closes the drawer</span>}
        </div>
      </header>

      <div className="pos-body">
        {/* ── Cart & guest (35%) ── */}
        <aside className="pos-cart">
          <div className="pos-guest">
            <label className="pos-label" htmlFor="pos-guest-q">Guest or booking</label>
            {guest ? (
              <div className="pos-guest-card">
                <div className="pos-guest-hd">
                  <div><b>{guest.full_name}</b><small>{guest.rooms ?? 'No room'} · {guest.reference} · {guest.inHouse ? `out ${guest.check_out}` : `arrives ${guest.check_in}${guest.status === 'pending' ? ' · pending' : ''}`}</small></div>
                  <button className="pos-icon-btn" onClick={() => setGuestId(null)} aria-label="Clear guest"><Icon name="x" /></button>
                </div>
                <div className="pos-bal">
                  <div><small>Bill</small><b className="num">{egp(guest.charges)}</b></div>
                  <div><small>Paid</small><b className="num">{egp(guest.paid)}</b></div>
                  <div><small>{guest.balance < 0 ? 'Guest credit' : 'Still to pay'}</small><b className="num">{egp(Math.abs(guest.balance))}</b></div>
                </div>
                <div className="pos-guest-ft">
                  {guest.state === 'settled' && <span className="pos-badge green">Fully paid</span>}
                  <button className="pos-link" onClick={() => setModal('folio')}><Icon name="file-text" size={15} /> Bill</button>
                  <button className="pos-link" onClick={() => setModal('payment')}><Icon name="banknote" size={15} /> Pay part of the bill</button>
                  {['confirmed', 'checked_in'].includes(guest.status) && <button className="pos-link" onClick={() => setModal('extend')}><Icon name="calendar-days" size={15} /> Extend stay</button>}
                </div>
              </div>
            ) : (
              <div className="pos-guest-search">
                <Icon name="search" size={18} />
                <input id="pos-guest-q" placeholder="Room, guest name or booking ref" value={guestQuery} onFocus={() => setGuestOpen(true)} onChange={(e) => { setGuestQuery(e.target.value); setGuestOpen(true); }} autoComplete="off" />
                {guestOpen && (
                  <ul className="pos-guest-list" role="listbox">
                    {guestMatches.map((g) => (
                      <li key={g.id}><button role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { setGuestId(g.id); setGuestQuery(''); setGuestOpen(false); }}>
                        <span><b>{g.rooms ?? '—'}</b> {g.full_name}{!g.inHouse && <small className="pos-arrive"> · arrives {g.check_in}</small>}</span>
                        <span className={`pos-dot ${g.state}`}>{g.state === 'due' ? egp(g.balance) : g.state === 'credit' ? 'Credit' : 'Paid'}</span>
                      </button></li>
                    ))}
                    {!guestMatches.length && <li className="pos-empty">No guest or booking matches.</li>}
                    <li><button className="pos-close-list" onMouseDown={(e) => e.preventDefault()} onClick={() => setGuestOpen(false)}>Close</button></li>
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="pos-lines" aria-label="Cart">
            {cart.length === 0 ? (
              <div className="pos-empty-cart"><Icon name="shopping-cart" size={34} /><p>Tap items to add them to the cart.</p></div>
            ) : cart.map((l) => (
              <div key={l.key} className="pos-line">
                <div className="pos-line-t"><b>{l.name}</b><small className="num">{egp(l.unit)} each</small></div>
                <div className="pos-qty">
                  <button onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} aria-label="Less"><Icon name="minus" size={18} /></button>
                  <span className="num">{l.qty}</span>
                  <button onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? (x.max != null && x.qty >= x.max ? x : { ...x, qty: x.qty + 1 }) : x)))} aria-label="More"><Icon name="plus" size={18} /></button>
                </div>
                <b className="pos-line-total num">{egp(l.unit * l.qty)}</b>
                <button className="pos-icon-btn small" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.name}`}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>

          <div className="pos-total">
            <span>Cart total</span><b className="num">{egp(total)}</b>
          </div>

          <MethodPicker value={method} onChange={setMethod} />
          {method === 'cash' && <CurSwitch value={cashCur} onChange={setCashCur} rates={st.rates} />}

          <div className="pos-actions">
            <button className="pos-btn primary" disabled={busy || !guest || !cart.length} onClick={() => run('charge_room')}><Icon name="bed" /> Put on room bill</button>
            <button className="pos-btn accent" disabled={busy || !cart.length} onClick={() => setModal('pay')}><Icon name={method === 'cash' ? 'banknote' : method === 'card' ? 'credit-card' : 'wallet'} /> Pay now · {PM_LABEL[method]}</button>
            <button className="pos-btn" disabled={busy || !guest || (guest.balance <= 0 && !cart.length)} onClick={() => cardOr('settle_all')}><Icon name="wallet" /> Pay whole bill{guest && guest.balance + total > 0 ? ` · ${curNow === 'EGP' ? egp(guest.balance + total) : cur(inCur(guest.balance + total, curNow, st.rates), curNow)}` : ''}</button>
            <button className="pos-btn" onClick={() => setModal('custom')}><Icon name="plus" /> Item not in the list</button>
            <button className="pos-btn" disabled={busy || (!cart.length && !(guest && guest.balance > 0))} onClick={() => setModal('comp')}><Icon name="gift" /> Free (owner approves)</button>
          </div>
        </aside>

        {/* ── Catalog (65%) ── */}
        <section className="pos-catalog">
          <div className="pos-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key && !search} className={tab === t.key && !search ? 'on' : ''} onClick={() => { setTab(t.key); setSearch(''); }}>
                <Icon name={t.icon} /> {t.label}
              </button>
            ))}
            <div className="pos-search">
              <Icon name="search" size={18} />
              <input placeholder="Search items or scan barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
              <Icon name="scan" size={18} className="muted" />
            </div>
          </div>

          <div className="pos-grid">
            {tab === 'events' && !search
              ? (events === null ? <p className="pos-fine">Loading events…</p> : [
                <button key="booked" className="pos-tile tour" onClick={() => { setEvSell(null); setModal('event'); }}>
                  <b>Booked online</b><small>Website bookings: take the rest (after a deposit) or check guests in</small><span className="pos-price"><Icon name="ticket" /></span>
                </button>,
                ...events.map((e) => (
                <button key={e.id} className="pos-tile tour" onClick={() => { setEvSell(e.id); setModal('event'); }}>
                  <b>{(e.title && typeof e.title === 'object' ? e.title.en || e.title.ar : e.title) || 'Event'}</b>
                  <small>Next: {dayLabel(e.dates[0]?.date)}{e.startTime ? ` · ${String(e.startTime).slice(0, 5)}` : ''}{e.dates[0]?.left != null ? ` · ${e.dates[0].left} seats` : ''}</small>
                  <span className="pos-price num">{egp(Number(e.price))}</span>
                  <span className="pos-tour-fig"><span>Hostel guests: pay what you want</span></span>
                </button>))])
              : tab === 'tours' && !search
              ? (shown as Tour[]).map((t) => (
                <div key={t.id} className="pos-tile-wrap">
                  <button className="pos-tile tour" onClick={() => add({ type: 'tour', id: t.id, name: `${t.name}`, unit: t.price_cents })}>
                    <b>{t.name}</b>
                    <small>{t.organizer}{t.duration ? ` · ${t.duration}` : ''}</small>
                    <span className="pos-price num">{egp(t.price_cents)}</span>
                    <span className="pos-tour-fig"><span>Cost {egp(t.cost_cents)}</span><span className="profit">Hotel net {egp(t.price_cents - t.cost_cents)}</span></span>
                  </button>
                  {(t.guest_message || t.files?.length) ? <button className="pos-tile-info" onClick={() => setCatalog(t)}><Icon name="file-text" size={15} /> Catalog</button> : null}
                </div>
              ))
              : (shown as Product[]).map((p) => {
                const low = p.track_stock && p.stock_quantity <= p.low_stock_threshold;
                const out = p.track_stock && p.stock_quantity <= 0;
                return (
                  <button key={p.id} className={`pos-tile ${low ? 'low' : ''} ${out ? 'out' : ''}`} onClick={() => addProduct(p)} disabled={out}>
                    {low && <span className="pos-low">{out ? 'Out of stock' : 'Low stock'}</span>}
                    <b>{p.name}</b>
                    {p.unit_label && <small>{p.unit_label}</small>}
                    <span className="pos-price num">{egp(p.price_cents)}</span>
                    {p.track_stock && <span className="pos-stock num">{p.stock_quantity} left</span>}
                  </button>
                );
              })}
            {!shown.length && <p className="pos-empty">Nothing here yet. Add items in Dashboard → Catalog.</p>}
          </div>

          {st.sales?.length > 0 && (
            <div className="pos-recent">
              <h3>Recent sales this shift</h3>
              <ul>{st.sales.slice(0, 6).map((s: any) => <li key={s.sale_id}><span>{time(s.at)} · {s.guest}</span><span className="muted">{s.items}</span><b className="num">{egp(Number(s.total))}</b><span className="pos-tag">{s.method === 'room_charge' ? 'Room' : s.method === 'card_terminal' ? 'Card' : s.method === 'comp' ? 'Comp' : 'Cash'}</span></li>)}</ul>
            </div>
          )}
        </section>
      </div>

      {modal === 'custom' && <CustomCharge onClose={() => setModal(null)} onAdd={(name, cents, qty) => { add({ type: 'custom', name, unit: cents, qty }); setModal(null); }} />}
      {modal === 'pay' && <PayModal total={payMode === 'settle_all' && guest ? guest.balance + total : total} method={method} cashCur={curNow} rates={st.rates} guest={payMode === 'walk_in' ? null : guest} whole={payMode === 'settle_all'} busy={busy}
        onClose={() => { setModal(null); setPayMode('pay_now'); }} onConfirm={async (payer, tipMinor, walletRef, change) => { const m = payMode; setPayMode('pay_now'); await run(m, { ...(payer ? { cardPayer: payerOut(payer) } : {}), ...(tipMinor > 0 ? { tipMinor } : {}), ...(walletRef ? { walletRef } : {}), ...(change ? { change } : {}) }); }} />}
      {modal === 'comp' && <CompModal cartTotal={total} guest={guest} onClose={() => setModal(null)} onDone={async (extra) => { const ok = await (async () => {
        setBusy(true);
        const r = await posSale({ reservationId: guestId, mode: 'comp', method, items: cart.map((l) => ({ type: l.type, id: l.id, name: l.name, qty: l.qty, unitCents: l.unit })), ...extra });
        setBusy(false);
        if (!r.ok) { notify(r.error, 'bad'); return false; }
        notify(`${egp(r.data.compCents)} recorded as owner comp`); setCart([]); setModal(null); await refresh(); return true;
      })(); return ok; }} />}
      {modal === 'folio' && guest && <FolioModal guest={guest} onClose={() => setModal(null)} />}
      {modal === 'payment' && guest && <PaymentModal guest={guest} method={method} rates={st.rates} onClose={() => setModal(null)} onDone={async (m) => { notify(m); setModal(null); await refresh(); }} />}
      {modal === 'expense' && <ExpenseModal onClose={() => setModal(null)} onDone={async () => { notify('Expense recorded'); setModal(null); await refresh(); }} />}
      {modal === 'menu' && (
        <Modal title="More" onClose={() => setModal(null)}>
          <div className="pos-menu">
            <button className="pos-btn" onClick={() => setModal('expense')}><Icon name="receipt" /> Paid from drawer (expense)</button>
            <button className="pos-btn" onClick={() => setModal('exchange')}><Icon name="arrow-left-right" /> Money exchange (foreign cash → EGP)</button>
            {st.takers?.length > 0 && <button className="pos-btn" onClick={() => setModal('taken')}><Icon name="wallet" /> Taken by owner</button>}
            {st.me.is_manager && <DrawerRoles st={st} notify={notify} onDone={refresh} />}
            <a className="pos-btn" href="/dashboard" target="_blank" rel="noopener"><Icon name="layout-dashboard" /> Dashboard (Today)</a>
            <p className="pos-fine">Device signed in as {device}.</p>
          </div>
        </Modal>
      )}
      {catalog && <TourCatalog t={catalog} onClose={() => setCatalog(null)} notify={notify} />}
      {modal === 'myshift' && <Modal title="My shift" onClose={() => setModal(null)}><ShiftPanel sc={st.schedule} /></Modal>}
      {modal === 'extend' && <ExtendModal guest={guest} guests={guests} onClose={() => setModal(null)}
        onDone={async (m, id, payNow) => { notify(m); setGuestId(id); await refresh(); setModal(payNow ? 'payment' : null); }} />}
      {modal === 'event' && <EventPayModal guest={guest} initialEvent={evSell} onClose={() => { setModal(null); setEvSell(null); }} onDone={async (m) => { notify(m); setModal(null); await refresh(); }} />}
      {modal === 'exchange' && <ExchangeModal rates={st.rates} guest={guest} onClose={() => setModal(null)} onDone={async (m) => { notify(m); setModal(null); await refresh(); }} />}
      {modal === 'change' && <ChangeOwedModal onClose={() => setModal(null)} notify={notify} onChanged={refresh} />}
      {modal === 'taken' && <TakenModal extra={Object.keys(st.currencies ?? {}).filter((c) => !CURS.includes(c))} takers={st.takers} onClose={() => setModal(null)} onDone={async (m) => { notify(m); setModal(null); await refresh(); }} />}
      {modal === 'tasks' && <TasksModal onClose={() => { setModal(null); refresh(); }} notify={notify} />}
      {modal === 'close' && <CloseShift owed={st.changeOwed ?? []} extra={Object.keys(st.currencies ?? {}).filter((c) => !CURS.includes(c))} shiftNo={st.shift.no} onClose={() => setModal(null)} onFinished={(m) => onClosed(m)} />}
    </div>
  );
}

/* ───────── Modals ───────── */

function CustomCharge({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, cents: number, qty: number) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [qty, setQty] = useState(1);
  const ok = name.trim().length >= 2 && toCents(amount) > 0;
  return (
    <Modal title="Add custom charge" onClose={onClose}>
      <div className="pos-field"><label htmlFor="cc-name">Description</label><input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Broken mug" autoFocus maxLength={120} /></div>
      <AmountPad label="Price (each)" value={amount} onChange={setAmount} />
      <div className="pos-field"><label>Quantity</label>
        <div className="pos-qty big"><button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less"><Icon name="minus" /></button><span className="num">{qty}</span><button onClick={() => setQty((q) => q + 1)} aria-label="More"><Icon name="plus" /></button></div>
      </div>
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button><button className="pos-btn primary" disabled={!ok} onClick={() => onAdd(name.trim(), toCents(amount), qty)}><Icon name="plus" /> Add to cart</button></div>
    </Modal>
  );
}

function PayModal({ total, method, cashCur, rates, guest, whole = false, busy, onClose, onConfirm }: { whole?: boolean; total: number; method: PM; cashCur: Cur; rates: any; guest: Guest | null; busy: boolean; onClose: () => void; onConfirm: (payer: Payer | null, tipMinor: number, walletRef: string | null, change: ReturnType<typeof changeOut>) => void }) {
  const [tip, setTip] = useState('');
  const [chg, setChg] = useState<ChangeState>(newChange);
  const [ref, setRef] = useState('');
  const [payer, setPayer] = useState<Payer>(() => newPayer(guest));
  const unit = method === 'cash' ? cashCur : 'EGP';
  const due = inCur(total, unit, rates);
  return (
    <Modal title={`${whole ? 'Pay whole bill' : 'Pay now'} · ${method === 'cash' ? `Cash ${cashCur}` : PM_LABEL[method]}`} onClose={onClose}>
      <div className="pos-big-total"><small>{whole && guest ? `${guest.full_name} · whole bill${total > guest.balance ? ' + this cart' : ''}` : guest ? `${guest.full_name} · this cart only` : 'Walk-in · this cart'}</small><b className="num">{cur(due, cashCur)}</b>
        {cashCur !== 'EGP' && <small>{egp(total)} at {rateOf(rates, cashCur).toFixed(2)} EGP per {cashCur}</small>}</div>
      {method === 'card' && <><p className="pos-fine">Run {egp(total + toCents(tip))} on the card terminal{toCents(tip) > 0 ? ' (with the tip)' : ''}, then confirm.</p><CardPayerFields value={payer} onChange={setPayer} /></>}
      <WalletRef method={method} value={ref} onChange={setRef} />
      <TipField value={tip} onChange={setTip} unit={unit} />
      {toCents(tip) > 0 && <p className="pos-total"><span>Guest pays in total</span><b className="num">{cur(due + toCents(tip), unit)}</b></p>}
      {method === 'cash' && <ChangeField value={chg} onChange={setChg} due={due + toCents(tip)} unit={unit} needName={!guest} />}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button><button className="pos-btn primary big" disabled={busy || (method === 'card' && !payerReady(payer)) || (isWal(method) && ref.trim().length < 4) || (method === 'cash' && !changeReady(chg, due + toCents(tip), !guest))} onClick={() => onConfirm(method === 'card' ? payer : null, toCents(tip), isWal(method) ? ref.trim() : null, method === 'cash' ? changeOut(chg) : null)}><Icon name="check" /> Confirm payment</button></div>
    </Modal>
  );
}

function ManagerPin({ value, onChange }: { value: { id: string; pin: string }; onChange: (v: { id: string; pin: string }) => void }) {
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  useEffect(() => { posManagers().then((r) => { if (r.ok) { setManagers(r.data); if (!value.id && r.data[0]) onChange({ ...value, id: r.data[0].id }); } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pos-two">
      <div className="pos-field"><label htmlFor="mgr">Approved by</label>
        <select id="mgr" value={value.id} onChange={(e) => onChange({ ...value, id: e.target.value })}>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
      </div>
      <div className="pos-field"><label htmlFor="mgr-pin">Manager PIN</label><input id="mgr-pin" type="password" inputMode="numeric" maxLength={6} value={value.pin} onChange={(e) => onChange({ ...value, pin: e.target.value.replace(/\D/g, '') })} /></div>
    </div>
  );
}

function CompModal({ cartTotal, guest, onClose, onDone }: { cartTotal: number; guest: Guest | null; onClose: () => void; onDone: (x: { compNote: string; approverId: string; approverPin: string; compBalance: boolean }) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  const [mgr, setMgr] = useState({ id: '', pin: '' });
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const amount = whole && guest ? Math.max(0, guest.balance) + cartTotal : cartTotal;
  return (
    <Modal title="Free (owner approves)" onClose={onClose}>
      <p className="pos-fine">No money is taken and nothing goes in the drawer. It shows in Shifts &amp; cash → Free (owner approved).</p>
      <div className="pos-big-total"><small>{guest ? guest.full_name : 'Walk-in'}</small><b className="num">{egp(amount)}</b></div>
      {guest && guest.balance > 0 && (
        <label className="pos-check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Also make the rest of the bill free ({egp(guest.balance)})</label>
      )}
      <div className="pos-field"><label htmlFor="comp-note">Approval note (required)</label><input id="comp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. On the owner’s instruction — Mr. Basel" maxLength={200} /></div>
      <ManagerPin value={mgr} onChange={setMgr} />
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn primary" disabled={busy || note.trim().length < 3 || mgr.pin.length < 4 || amount <= 0} onClick={async () => { setBusy(true); await onDone({ compNote: note.trim(), approverId: mgr.id, approverPin: mgr.pin, compBalance: whole }); setBusy(false); }}><Icon name="gift" /> Record comp</button>
      </div>
    </Modal>
  );
}

function FolioModal({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const [f, setF] = useState<any>(null);
  useEffect(() => { posGuestFolio(guest.id).then((r) => setF(r.ok ? r.data : { error: r.error })); }, [guest.id]);
  return (
    <Modal title={`Bill · ${guest.full_name}`} onClose={onClose} wide>
      {!f ? <p>Loading…</p> : f.error ? <p className="pos-msg bad">{f.error}</p> : (
        <>
          <table className="pos-table">
            <thead><tr><th>Date</th><th>Description</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {f.lines.map((l: any, i: number) => (
                <tr key={l.id ?? i} className={l.amount_cents < 0 ? 'credit' : ''}>
                  <td className="num">{l.date}</td>
                  <td>{l.description}{l.kind === 'room' && l.rate_source && <small className="pos-src">{l.rate_source === 'booking' ? 'Booked price' : l.rate_source === 'override' ? 'Manager price' : 'Our rate'}</small>}</td>
                  <td className="r num">{l.quantity}</td><td className="r num">{egp(l.amount_cents)}</td>
                </tr>
              ))}
              {f.payments.map((p: any) => <tr key={p.id} className="credit"><td className="num">{String(p.created_at).slice(0, 10)}</td><td>Payment · {p.method.replace('_', ' ')}</td><td /><td className="r num">−{egp(Number(p.amount_cents))}</td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={3}>Balance</td><td className="r num">{egp(f.balance)}</td></tr></tfoot>
          </table>
        </>
      )}
    </Modal>
  );
}

function PaymentModal({ guest, method, rates, onClose, onDone }: { guest: Guest; method: PM; rates: any; onClose: () => void; onDone: (msg: string) => void }) {
  const [c, setC] = useState<Cur>('EGP');
  const [amount, setAmount] = useState(guest.balance > 0 ? String(guest.balance / 100) : '');
  const [m, setM] = useState<PM>(method);
  const [ref, setRef] = useState('');
  const [payer, setPayer] = useState<Payer>(() => newPayer(guest));
  const curPay: Cur = m === 'cash' ? c : 'EGP';
  const pick = (x: Cur) => { setC(x); if (guest.balance > 0) setAmount(String(inCur(guest.balance, x, rates) / 100)); };
  const [tip, setTip] = useState('');
  const [chg, setChg] = useState<ChangeState>(newChange);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Pay part of the bill · ${guest.full_name}`} onClose={onClose}>
      <p className="pos-fine">Still to pay {egp(guest.balance)}. Any amount up to that; the rest stays on the guest’s bill.</p>
      <MethodPicker value={m} onChange={(x) => { setM(x); if (x !== 'cash') pick('EGP'); }} />
      {m === 'cash' && <CurSwitch value={c} onChange={pick} rates={rates} />}
      <AmountPad label={`Amount received in ${curPay}`} value={amount} onChange={setAmount} unit={curPay} />
      {m === 'card' && <CardPayerFields value={payer} onChange={setPayer} />}
      <WalletRef method={m} value={ref} onChange={setRef} />
      {curPay !== 'EGP' && toCents(amount) > 0 && <p className="pos-fine">Credited to the guest as {egp(Math.round(toCents(amount) * rateOf(rates, curPay)))} at {rateOf(rates, curPay).toFixed(2)}.</p>}
      <TipField value={tip} onChange={setTip} unit={curPay} />
      {m === 'cash' && toCents(amount) > 0 && <ChangeField value={chg} onChange={setChg} due={toCents(amount) + toCents(tip)} unit={curPay} needName={false} />}
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn primary" disabled={busy || toCents(amount) <= 0 || (m === 'card' && !payerReady(payer)) || (isWal(m) && ref.trim().length < 4) || (m === 'cash' && !changeReady(chg, toCents(amount) + toCents(tip), false))} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await posTakePayment(guest.id, toCents(amount), m, curPay, m === 'card' ? payerOut(payer) : null, toCents(tip), isWal(m) ? ref.trim() : null, m === 'cash' ? changeOut(chg) : null);
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          const left = guest.balance - r.data.egp;
          const got = curPay === 'EGP' ? egp(r.data.egp) : `${cur(toCents(amount), curPay)} (${egp(r.data.egp)})`;
          const t = (toCents(tip) > 0 ? ` · tip ${cur(toCents(tip), curPay)}` : '') + changeNote(r.data, curPay);
          onDone(left > 0 ? `${got} received · ${egp(left)} still due${t}` : `${got} received · fully settled${t}`);
        }}><Icon name="check" /> Record payment</button>
      </div>
    </Modal>
  );
}

function ExpenseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [c, setC] = useState<Cur>('EGP');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('supplies');
  const [mgr, setMgr] = useState({ id: '', pin: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Paid from drawer (expense)" onClose={onClose}>
      <CurSwitch value={c} onChange={setC} rates={{ USD: 1, EUR: 1, plain: true }} />
      <AmountPad label={`Amount taken from the drawer (${c})`} value={amount} onChange={setAmount} unit={c} />
      <div className="pos-two">
        <div className="pos-field"><label htmlFor="ex-cat">Category</label>
          <select id="ex-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
            {[['supplies', 'Supplies'], ['food_kitchen', 'Food & kitchen'], ['maintenance', 'Maintenance'], ['transport_taxi', 'Transport'], ['tips_wages', 'Tips & wages'], ['refund', 'Refund'], ['other', 'Other']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="pos-field"><label htmlFor="ex-desc">What for</label><input id="ex-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} /></div>
      </div>
      <ManagerPin value={mgr} onChange={setMgr} />
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn primary" disabled={busy || toCents(amount) <= 0 || desc.trim().length < 2 || mgr.pin.length < 4} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await posExpense({ amountCents: toCents(amount), category: cat, description: desc.trim(), approverId: mgr.id, approverPin: mgr.pin, currency: c as 'EGP' | 'USD' | 'EUR' });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          onDone();
        }}><Icon name="check" /> Record expense</button>
      </div>
    </Modal>
  );
}

function CloseShift({ shiftNo, onClose, onFinished, extra = [], owed = [] }: { owed?: any[]; shiftNo: number; onClose: () => void; onFinished: (msg: string) => void; extra?: string[] }) {
  const [counts, setCounts] = useState<Record<Cur, string>>({ EGP: '', USD: '', EUR: '' });
  const [note, setNote] = useState('');
  const [z, setZ] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (z) {
    const h = Math.floor(z.hours_worked), m = Math.round((z.hours_worked - h) * 60);
    return (
      <Modal title={`Z-Report · Shift #${z.shift_no}`} wide>
        <table className="pos-table z">
          <thead><tr><th />{Object.keys(z.currencies ?? {}).map((c) => <th key={c} className="r">{c}</th>)}</tr></thead>
          <tbody>
            {([['opening', 'Start of shift'], ['sales', '+ Cash sales'], ['payments', '+ Guest bill payments (cash)'], ['events', '+ Event tickets (cash)'], ['exchange', '± Money exchange'], ['tips', '+ Tips (cash)'], ['change', '± Change for guests (kept − given back)'], ['expenses', '− Paid from drawer'], ['taken', '− Taken by owner'], ['expected', 'Should be in drawer'], ['counted', 'Counted']] as const).filter(([k]) => ['opening', 'expected', 'counted'].includes(k) || Object.keys(z.currencies ?? {}).some((c) => Number(z.currencies?.[c]?.[k] ?? 0) !== 0)).map(([k, l]) => (
              <tr key={k} className={k === 'expected' || k === 'counted' ? 'strong' : ''}><td>{l}</td>{Object.keys(z.currencies ?? {}).map((c) => <td key={c} className="r num">{cur(z.currencies?.[c]?.[k] ?? 0, c)}</td>)}</tr>
            ))}
            <tr className="strong"><td>Difference</td>{Object.keys(z.currencies ?? {}).map((c) => { const v = Number(z.currencies?.[c]?.variance ?? 0); return <td key={c} className={`r num ${v === 0 ? 'ok' : 'bad'}`}>{v === 0 ? 'Balanced' : v > 0 ? `Over ${cur(v, c)}` : `Short ${cur(-v, c)}`}</td>; })}</tr>
          </tbody>
        </table>
        {Object.keys(z.currencies ?? {}).some((c) => Number(z.currencies?.[c]?.variance) < 0) && <p className="pos-msg bad">A shortage is recorded on your name. Pay it now in cash or it will be deducted from your salary; the manager decides.</p>}
        <table className="pos-table z">
          <tbody>
            <tr className="strong"><td colSpan={2}>Not in the drawer</td></tr>
            <tr><td>Card machine: sales &amp; tickets / room bills{Number(z.card_tips) > 0 ? ' / tips' : ''}</td><td className="r num">{egp(z.card_sales)} / {egp(z.room_card_payments)}{Number(z.card_tips) > 0 ? ` / ${egp(z.card_tips)}` : ''}</td></tr>
            <tr><td>InstaPay (check in the app)</td><td className="r num">{egp(z.instapay ?? 0)}</td></tr>
            {Number(z.vodafone ?? 0) > 0 && <tr><td>Vodafone Cash (check in the app)</td><td className="r num">{egp(z.vodafone ?? 0)}</td></tr>}
            <tr><td>Put on room bills (to pay later)</td><td className="r num">{egp(z.room_charges)}</td></tr>
            <tr><td>Free (owner approved)</td><td className="r num">{egp(z.owner_comps)}</td></tr>
            <tr><td>Tour net profit</td><td className="r num">{egp(z.tour_profit)}</td></tr>
            <tr><td>Hours worked this shift</td><td className="r num">{h} h {String(m).padStart(2, '0')} min</td></tr>
          </tbody>
        </table>
        <div className="pos-row end"><button className="pos-btn primary big" onClick={() => onFinished(`Shift #${z.shift_no} closed. Next cashier: enter your PIN.`)}><Icon name="check" /> Done</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={`Close shift #${shiftNo}`} onClose={onClose}>
      <p className="pos-fine">Count the cash in the drawer, each currency on its own, and hand it over. The expected amounts are shown only after you confirm.</p>
      {owed.length > 0 && <p className="pos-msg">Still in the drawer for guests who will come back for their change: {owed.map((o) => `${o.guest} ${cur(Number(o.minor), o.currency)}`).join(' · ')}. Count it with the rest and tell the next shift.</p>}
      <CountGrid value={counts} onChange={setCounts} extra={extra} />
      <div className="pos-field"><label htmlFor="close-note">Note (optional)</label><input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn danger big" disabled={busy || counts.EGP === ''} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await posCloseShift(countsOf(counts), note);
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          setZ(r.data);
        }}><Icon name="lock" /> Confirm count & close</button>
      </div>
    </Modal>
  );
}

/* ───────── Shift tasks ───────── */

type TaskRow = { id: string; title: string; kind: string; items: { label: string; done: boolean }[]; minutes: number; assigned_to: string | null; assignee: string | null; status: 'pending' | 'done'; note: string | null; done_by_name: string | null; started_at: string | null };

function TasksModal({ onClose, notify }: { onClose: () => void; notify: (t: string, k?: 'ok' | 'bad') => void }) {
  const [d, setD] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [handover, setHandover] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await posTasks();
    if (!r.ok) { notify(r.error, 'bad'); return; }
    setD(r.data); setNotes(r.data.run?.notes ?? '');
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <Modal title="Shift tasks" onClose={onClose} wide><p className="pos-muted"><Icon name="refresh" size={16} className="spin" /> Loading…</p></Modal>;
  if (!d.run) return <Modal title="Shift tasks" onClose={onClose}><p className="pos-muted">No shift is running at this hour.</p></Modal>;

  const mine: TaskRow[] = d.tasks.filter((t: TaskRow) => t.assigned_to === d.me.id);
  const others: TaskRow[] = d.tasks.filter((t: TaskRow) => t.assigned_to !== d.me.id);
  const done = d.tasks.filter((t: TaskRow) => t.status === 'done').length;
  const save = async (t: TaskRow, input: any, msg?: string) => {
    const r = await posTaskSave(t.id, input);
    if (!r.ok) { notify(r.error, 'bad'); return; }
    if (msg) notify(msg);
    load();
  };
  const share = async () => { const r = await posTasksShare(); if (!r.ok) notify(r.error, 'bad'); else { notify('Tasks shared between everyone clocked in'); load(); } };
  const shareAt = new Date(d.run.shareAt);
  const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d.run.date + 'T12:00:00Z'));

  return (
    <Modal title={`${d.run.label} shift tasks · ${dayLabel}`} onClose={onClose} wide>
      <div className="pos-tasks-head">
        <div className="pos-progress" aria-label={`${done} of ${d.tasks.length} done`}><span style={{ width: `${d.tasks.length ? (done / d.tasks.length) * 100 : 0}%` }} /></div>
        <b className="num">{done}/{d.tasks.length} done</b>
        <span className="pos-muted">On shift: {d.staff.map((s: any) => s.name).join(', ') || 'nobody yet'}</span>
        {d.me.is_manager && <button className="pos-btn small" onClick={share}><Icon name="refresh" size={16} /> {d.run.distributed ? 'Share again' : 'Share now'}</button>}
      </div>

      {!d.auto && (
        <p className="pos-note"><Icon name="user" size={16} /> {d.me.is_manager ? 'You give out the tasks: choose a person next to each task (or press Share now to split them at random).' : 'The manager gives out the tasks. Yours show here once assigned.'} The drawer check goes to whoever receives the drawer.</p>
      )}
      {d.auto && !d.run.distributed && (
        <p className="pos-note"><Icon name="clock" size={16} /> Last-hour tasks are shared at random at <b>{time(shareAt.toISOString())}</b> between the people on this shift. The drawer check goes to whoever receives the drawer.</p>
      )}
      {!d.onDuty && <p className="pos-note"><Icon name="alert-triangle" size={16} /> You are not clocked in, so you have no tasks this shift.</p>}

      {d.onDuty && mine.length > 0 && (
        <>
          <h3 className="pos-tasks-h">My tasks · {mine.filter((t) => t.status === 'pending').length} open</h3>
          {mine.length === 0 && <p className="pos-muted">Nothing assigned to you.</p>}
          <div className="pos-tasks">
            {mine.map((t) => <TaskCard key={t.id} t={t} d={d} onSave={save} onWash={async (id, ready) => { const r = await posWashReady(id, ready); if (!r.ok) notify(r.error, 'bad'); load(); }}
              onTaxi={async (id, ok) => { const r = await posTaxiConfirmed(id, ok); if (!r.ok) notify(r.error, 'bad'); load(); }} />)}
          </div>
        </>
      )}

      {(d.me.is_manager ? others.length > 0 : others.some((t) => t.assigned_to)) && (
        <>
          <h3 className="pos-tasks-h">{d.me.is_manager ? 'Give out the tasks' : 'Team'}</h3>
          <div className="pos-team">
            {others.map((t) => (
              <div key={t.id} className={`pos-team-row ${t.status}`}>
                <Icon name={t.status === 'done' ? 'check-circle' : 'clipboard-list'} size={18} />
                <span className="t">{t.title}</span>
                {d.me.is_manager ? (
                  <select value={t.assigned_to ?? ''} onChange={async (e) => { const r = await posTaskReassign(t.id, e.target.value); if (!r.ok) notify(r.error, 'bad'); load(); }} aria-label={`Assign ${t.title}`}>
                    <option value="">Unassigned</option>
                    {d.staff.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : <span className="who">{t.assignee ?? 'Unassigned'}</span>}
                <span className={`pos-badge ${t.status === 'done' ? 'green' : 'gray'}`}>{t.status === 'done' ? 'Done' : 'Open'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="pos-field" style={{ marginTop: 18 }}>
        <label htmlFor="shift-notes">Shift notes (handover)</label>
        <textarea id="shift-notes" className="pos-textarea" rows={2} value={notes} placeholder="e.g. Folklore free breakfast tomorrow" onChange={(e) => setNotes(e.target.value)}
          onBlur={async () => { if ((d.run.notes ?? '') !== notes) { const r = await posRunNotes(d.run.id, notes); if (!r.ok) notify(r.error, 'bad'); else load(); } }} />
      </div>
      <div className="pos-row" style={{ marginTop: 12 }}>
        <button className="pos-btn" onClick={async () => { const r = await posHandover(d.run.id); if (r.ok) setHandover(r.data); else notify(r.error, 'bad'); }}><Icon name="file-text" /> Handover report</button>
      </div>
      {handover != null && (
        <div className="pos-handover">
          <pre>{handover}</pre>
          <button className="pos-btn primary" onClick={async () => { try { await navigator.clipboard.writeText(handover); notify('Copied. Paste it in the team WhatsApp group.'); } catch { notify('Select the text and copy it', 'bad'); } }}>
            <Icon name="check" /> Copy for WhatsApp</button>
        </div>
      )}
    </Modal>
  );
}

function TaskCard({ t, d, onSave, onWash, onTaxi }: { t: TaskRow; d: any; onSave: (t: TaskRow, input: any, msg?: string) => void; onWash: (id: string, ready: boolean) => void; onTaxi: (id: string, informed: boolean) => void }) {
  const [note, setNote] = useState(t.note ?? '');
  const allTicked = t.items.every((i) => i.done);
  const isDone = t.status === 'done';
  const toggle = (idx: number) => onSave(t, { items: t.items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)), note });
  return (
    <div className={`pos-task ${isDone ? 'done' : ''}`}>
      <div className="pos-task-hd">
        <Icon name={isDone ? 'check-circle' : 'clipboard-list'} size={20} />
        <b>{t.title}</b>
        <span className="pos-muted small">~{t.minutes} min</span>
      </div>

      {t.items.length > 0 && (
        <div className="pos-task-items">
          {t.items.map((it, i) => (
            <button key={it.label} type="button" disabled={isDone} className={`pos-check ${it.done ? 'on' : ''}`} onClick={() => toggle(i)} aria-pressed={it.done}>
              <Icon name={it.done ? 'check' : 'plus'} size={16} /> {it.label}
            </button>
          ))}
        </div>
      )}

      {t.kind === 'unpaid' && (
        <ul className="pos-task-list">
          {d.unpaid.length === 0 && <li className="pos-muted">Every in-house guest is fully paid.</li>}
          {d.unpaid.map((u: any) => <li key={u.id}><span>{u.guest}{u.rooms ? ` · ${u.rooms}` : ''}</span><b className="num">{egp(u.cents)}</b></li>)}
        </ul>
      )}
      {t.kind === 'washes' && (
        <ul className="pos-task-list">
          {d.washes.length === 0 && <li className="pos-muted">No washes in progress.</li>}
          {d.washes.map((w: any) => (
            <li key={w.id}>
              <span>{w.room_number || w.guest_name || 'Walk-in'} · {['paid', 'comp'].includes(w.payment_status) ? 'paid' : 'not paid'}</span>
              <button type="button" className={`pos-check ${w.ready_at ? 'on' : ''}`} onClick={() => onWash(w.id, !w.ready_at)}>{w.ready_at ? 'Ready' : 'Mark ready'}</button>
            </li>
          ))}
        </ul>
      )}
      {t.kind === 'tours' && (
        <ul className="pos-task-list">
          {d.tours.length === 0 && <li className="pos-muted">No tours today or tomorrow.</li>}
          {d.tours.map((x: any) => <li key={x.id}><span>{x.guest_name || 'Walk-in'}{x.room_number ? ` · ${x.room_number}` : ''}</span><span>{x.item_name} × {x.quantity}</span></li>)}
        </ul>
      )}
      {t.kind === 'money' && <p className="pos-muted small">{/visa|card/i.test(t.title) ? 'Check the card machine slips against the POS card sales.' : 'Done when you receive the drawer: count each currency on the POS.'}</p>}
      {(t.kind === 'taxi' || t.kind === 'taxi_confirm') && (
        <ul className="pos-task-list">
          {(t.kind === 'taxi' ? d.taxis : d.taxis.filter((x: any) => x.id === (t as any).ref_id)).map((x: any) => (
            <li key={x.id} className="col">
              <span>{x.line}</span>
              <span className="pos-row tight">
                {x.wa && <a className="pos-check" href={x.wa} target="_blank" rel="noopener noreferrer"><Icon name="message-square" size={16} /> WhatsApp</a>}
                <button type="button" className="pos-check" onClick={async () => { try { await navigator.clipboard.writeText(x.message); } catch { /* ignore */ } }}><Icon name="file-text" size={16} /> Copy message</button>
                <button type="button" className={`pos-check ${x.confirmed_at ? 'on' : ''}`} onClick={() => onTaxi(x.id, !x.confirmed_at)}>{x.confirmed_at ? 'Informed' : 'Mark informed'}</button>
              </span>
            </li>
          ))}
          {t.kind === 'taxi' && d.taxis.length === 0 && <li className="pos-muted">No taxis today or tomorrow.</li>}
        </ul>
      )}

      {!isDone ? (
        <>
          <input className="pos-task-note" placeholder="Note (what is missing, who was informed…)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if ((t.note ?? '') !== note) onSave(t, { note }); }} />
          <div className="pos-row">
            <button className="pos-btn primary" disabled={!allTicked} onClick={() => onSave(t, { done: true, note }, `${t.title}: done`)}><Icon name="check" /> Done</button>
            {!allTicked && <button className="pos-btn" disabled={!note.trim()} onClick={() => onSave(t, { withNote: true, note }, `${t.title}: done with a note`)}>Done with note</button>}
          </div>
        </>
      ) : (
        <div className="pos-row">
          {t.note && <span className="pos-muted small">{t.note}</span>}
          <button className="pos-link" onClick={() => onSave(t, { done: false, note })}>Undo</button>
        </div>
      )}
    </div>
  );
}

/**
 * Extend a stay in three steps: choose the guest (or use the one already selected), choose the extra nights
 * (same bed, priced per date and added to the bill), then take the payment now or leave it on the bill.
 */
function ExtendModal({ guest, guests, onClose, onDone }: { guest: Guest | null; guests: Guest[]; onClose: () => void; onDone: (m: string, guestId: string, payNow: boolean) => void }) {
  const [g, setG] = useState<Guest | null>(guest && ['confirmed', 'checked_in'].includes(guest.status) ? guest : null);
  const [qy, setQy] = useState('');
  const [n, setN] = useState(1);
  const [info, setInfo] = useState<{ freeNights: number; checkOut: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { src?: string; msg: string; out: string; nights: number; extra: number; balance: number }>(null);
  useEffect(() => { setInfo(null); setErr(null); setN(1); if (g) posExtendInfo(g.id).then((r) => (r.ok ? setInfo(r.data) : setErr(r.error))); }, [g]);
  const staying = guests.filter((x) => ['confirmed', 'checked_in'].includes(x.status))
    .filter((x) => !qy.trim() || `${x.full_name} ${x.rooms ?? ''} ${x.reference}`.toLowerCase().includes(qy.trim().toLowerCase()))
    .sort((a, b) => Number(b.inHouse) - Number(a.inHouse) || a.check_out.localeCompare(b.check_out));
  const max = info?.freeNights ?? 0;
  const newOut = info ? new Date(Date.parse(info.checkOut + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10) : '';
  const step = done ? 3 : g ? 2 : 1;
  return (
    <Modal title={g ? `Extend stay · ${g.full_name}` : 'Extend stay'} onClose={onClose}>
      <ol className="pos-steps" aria-label="Steps">
        {['Choose guest', 'Extra nights', 'Payment'].map((t, i) => <li key={t} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><span>{i + 1}</span>{t}</li>)}
      </ol>
      {step === 1 && (
        <>
          <div className="pos-guest-search inline"><Icon name="search" size={18} /><input autoFocus placeholder="Room, guest name or booking ref" value={qy} onChange={(e) => setQy(e.target.value)} /></div>
          <ul className="pos-pick-list">
            {staying.map((x) => (
              <li key={x.id}><button onClick={() => setG(x)}>
                <span><b>{x.rooms ?? '—'}</b> {x.full_name}<small>{x.inHouse ? `check-out ${x.check_out}` : `arrives ${x.check_in}`} · {x.reference}</small></span>
                <span className="pos-pick-go">Choose <Icon name="chevron-right" size={16} /></span>
              </button></li>
            ))}
            {!staying.length && <li className="pos-empty">No staying guest matches.</li>}
          </ul>
        </>
      )}
      {step === 2 && g && (
        <>
          <div className="pos-ext-who"><span><b>{g.rooms ?? '—'}</b> {g.full_name} · {g.reference}</span>{!guest || guest.id !== g.id ? <button className="pos-link" onClick={() => setG(null)}>Change guest</button> : null}</div>
          {!info ? <p className="pos-fine">{err ?? 'Checking the bed…'}</p> : max === 0 ? (
            <p className="pos-msg bad">The same bed is taken from {info.checkOut}. Move the guest to a free bed on the dashboard first (booking → Dates & beds), then extend.</p>
          ) : (
            <>
              <p className="pos-fine">Check-out now {info.checkOut}. Same bed free for {max >= 30 ? '30+' : max} more night{max === 1 ? '' : 's'}.</p>
              <div className="pos-field"><label>Extra nights</label>
                <div className="pos-qty big"><button onClick={() => setN((x) => Math.max(1, x - 1))} aria-label="Less"><Icon name="minus" /></button><span className="num">{n}</span><button onClick={() => setN((x) => Math.min(max, x + 1))} aria-label="More"><Icon name="plus" /></button></div></div>
              <p className="pos-total"><span>New check-out</span><b className="num">{newOut}</b></p>
              <p className="pos-fine">Priced at today’s Hostelworld price for these nights (our own rates if Hostelworld can’t be read), added to the bill. You take the payment in the next step.</p>
            </>
          )}
          {err && info && <p className="pos-msg bad">{err}</p>}
          <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
            <button className="pos-btn primary" disabled={busy || !info || max === 0} onClick={async () => {
              setBusy(true); setErr(null);
              const r = await posExtend(g.id, n);
              setBusy(false);
              if (!r.ok) { setErr(r.error); return; }
              setDone({ src: r.data.priceSource, msg: `Extended ${g.full_name} to ${r.data.newCheckOut} (+${r.data.nights} night${r.data.nights === 1 ? '' : 's'}, ${egp(r.data.extraCents)})`, out: r.data.newCheckOut, nights: r.data.nights, extra: r.data.extraCents, balance: r.data.balance });
            }}><Icon name="check" /> Extend</button>
          </div>
        </>
      )}
      {step === 3 && g && done && (
        <>
          <p className="pos-msg ok">Stay extended to {done.out} · +{done.nights} night{done.nights === 1 ? '' : 's'} · {egp(done.extra)} added to the bill{done.src ? ` (${done.src})` : ''}.</p>
          <p className="pos-total"><span>Still to pay on the bill</span><b className="num">{egp(Math.max(0, done.balance))}</b></p>
          <div className="pos-row end">
            <button className="pos-btn ghost" onClick={() => onDone(done.msg + ' · left on the bill', g.id, false)}>Later (keep on the bill)</button>
            {done.balance > 0 && <button className="pos-btn primary" onClick={() => onDone(done.msg, g.id, true)}><Icon name="banknote" /> Take payment now</button>}
          </div>
        </>
      )}
    </Modal>
  );
}

type PM = 'cash' | 'card' | 'instapay' | 'vodafone_cash';
const PM_LABEL: Record<PM, string> = { cash: 'Cash', card: 'Card', instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash' };
const isWal = (m: PM) => m === 'instapay' || m === 'vodafone_cash';
/** Cash / Card / InstaPay / Vodafone Cash. InstaPay and Vodafone Cash are EGP and need the transaction number. */
function MethodPicker({ value, onChange }: { value: PM; onChange: (m: PM) => void }) {
  const icon: Record<PM, string> = { cash: 'banknote', card: 'credit-card', instapay: 'wallet', vodafone_cash: 'wallet' };
  return (
    <div className="pos-method three" role="radiogroup" aria-label="Payment method">
      {(['cash', 'card', 'instapay'] as PM[]).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} className={value === m ? 'on' : ''} onClick={() => onChange(m)}><Icon name={icon[m]} /> {PM_LABEL[m]}</button>
      ))}
    </div>
  );
}
/** Transaction number shown on the guest's phone after an InstaPay / Vodafone Cash transfer. */
function WalletRef({ method, value, onChange }: { method: PM; value: string; onChange: (v: string) => void }) {
  if (!isWal(method)) return null;
  return (
    <div className="pos-field"><label htmlFor="w-ref">{PM_LABEL[method]} transaction number</label>
      <input id="w-ref" value={value} onChange={(e) => onChange(e.target.value)} maxLength={60} autoComplete="off" placeholder="From the guest's phone after the transfer" />
      <p className="pos-fine">Check the transfer arrived ({method === 'instapay' ? 'InstaPay' : 'Vodafone Cash'} account of the hostel), then confirm. Not counted in the cash drawer.</p></div>
  );
}

/** Optional tip on top of a payment, in the same currency. Recorded apart from the price (it is not hostel income). */
function TipField({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit: string }) {
  const steps = unit === 'EGP' ? ['20', '50', '100'] : ['1', '2', '5'];
  return (
    <div className="pos-field">
      <label>Tip (optional)</label>
      <div className="pos-amount small"><span>{unit}</span>
        <input inputMode="decimal" value={value} placeholder="0" onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Tip" /></div>
      <div className="pos-quick">{steps.map((v) => <button type="button" key={v} onClick={() => onChange(String((Number(value) || 0) + Number(v)))}>+{v}</button>)}<button type="button" onClick={() => onChange('')}>No tip</button></div>
    </div>
  );
}

/**
 * Event tickets on the POS: sell a ticket to someone at the villa now, or take payment for a ticket booked online
 * as "pay at the door". Cash into the drawer or card on the machine; a tip can be added.
 */
function EventPayModal({ onClose, onDone, guest, initialEvent = null }: { onClose: () => void; onDone: (m: string) => void; guest: Guest | null; initialEvent?: string | null }) {
  const [mode, setMode] = useState<'sell' | 'booked'>(initialEvent ? 'sell' : 'booked');
  const [events, setEvents] = useState<any[] | null>(null);
  const [list, setList] = useState<any[] | null>(null);
  const [qy, setQy] = useState('');
  const [pick, setPick] = useState<any | null>(null);
  const [evId, setEvId] = useState<string | null>(initialEvent);
  const [date, setDate] = useState('');
  const [qty, setQty] = useState(1);
  const [opt, setOpt] = useState('');
  const [name, setName] = useState(guest?.full_name ?? '');
  const [phone, setPhone] = useState('');
  const [m, setM] = useState<PM>('cash');
  const [ref, setRef] = useState('');
  const [payer, setPayer] = useState<Payer>(newPayer(guest));
  const [tip, setTip] = useState('');
  const [pwywStr, setPwywStr] = useState('');
  const [checkIn, setCheckIn] = useState(false);
  const [dinner, setDinner] = useState(false);
  const [chg, setChg] = useState<ChangeState>(newChange);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { posEventList().then((r) => (r.ok ? setEvents(r.data) : setErr(r.error))); posEventTickets().then((r) => (r.ok ? setList(r.data) : setErr(r.error))); }, []);
  const ev = events?.find((e) => e.id === evId) ?? null;
  useEffect(() => { if (ev && !date) setDate(ev.dates[0]?.date ?? ''); if (ev?.options?.length && !opt) setOpt(ev.options[0].key); }, [ev, date, opt]);
  const title = (t: any) => (t && typeof t === 'object' ? t.en || t.ar : t) || 'Event';
  const dinnerEach = ev && dinner && ev.dinner ? Number(ev.dinner) : 0;
  // Hostel guests pay what they want for the ticket (any amount, all tickets together); dinner keeps its price.
  const pwywOn = mode === 'sell' ? !!guest : !!pick?.is_hotel_guest;
  const pwyw = pwywOn ? toCents(pwywStr) : 0;
  const unit = (ev ? (guest ? 0 : Number(ev.price)) : 0) + dinnerEach;
  const total = mode === 'sell' ? unit * qty + pwyw : Number(pick?.due_cents ?? 0) + pwyw;
  const s = qy.trim().toLowerCase();
  const shown = (list ?? []).filter((b) => !s || `${b.full_name} ${b.ticket_code} ${b.phone ?? ''}`.toLowerCase().includes(s)).slice(0, 12);
  const left = ev?.dates.find((d: any) => d.date === date)?.left;
  const ready = mode === 'sell' ? !!ev && !!date && name.trim().length >= 2 && qty >= 1 : !!pick && (Number(pick.due_cents) > 0 || !!pick.is_hotel_guest);
  const payable = (b: any) => (Number(b.due_cents) > 0 || (b.is_hotel_guest && b.status !== 'paid')) && b.status !== 'pending_verification';
  const toPay = (list ?? []).filter(payable).length;
  return (
    <Modal title="Event tickets" onClose={onClose}>
      <div className="pos-method" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'sell'} className={mode === 'sell' ? 'on' : ''} onClick={() => setMode('sell')}><Icon name="plus" /> Sell a ticket</button>
        <button type="button" role="tab" aria-selected={mode === 'booked'} className={mode === 'booked' ? 'on' : ''} onClick={() => setMode('booked')}><Icon name="ticket" /> Booked online{toPay ? ` (${toPay} to pay)` : ''}</button>
      </div>
      {mode === 'sell' ? (
        events === null ? <p className="pos-fine">Loading…</p> : !events.length ? <p className="pos-fine">No events with free seats in the next days.</p> : (
          <>
            <div className="pos-two">
              <div className="pos-field"><label htmlFor="ev-e">Event</label>
                <select id="ev-e" className="pos-select" value={evId ?? ''} onChange={(e) => { setEvId(e.target.value || null); setDate(''); setOpt(''); setDinner(false); }}>
                  <option value="">Choose…</option>{events.map((e) => <option key={e.id} value={e.id}>{title(e.title)} · {egp(Number(e.price))}</option>)}
                </select></div>
              <div className="pos-field"><label htmlFor="ev-d">Day</label>
                <select id="ev-d" className="pos-select" value={date} onChange={(e) => setDate(e.target.value)} disabled={!ev}>
                  {(ev?.dates ?? []).map((d: any) => <option key={d.date} value={d.date}>{dayLabel(d.date)}{d.left != null ? ` · ${d.left} seats left` : ''}</option>)}
                </select></div>
            </div>
            {ev?.options?.length > 0 && <div className="pos-field"><label htmlFor="ev-o">Option</label><select id="ev-o" className="pos-select" value={opt} onChange={(e) => setOpt(e.target.value)}>{ev.options.map((o: any) => <option key={o.key} value={o.key}>{o.en}</option>)}</select></div>}
            <div className="pos-two">
              <div className="pos-field"><label htmlFor="ev-n">Guest name</label><input id="ev-n" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
              <div className="pos-field"><label htmlFor="ev-p">Phone (optional)</label><input id="ev-p" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} /></div>
            </div>
            <div className="pos-field"><label>Tickets</label>
              <div className="pos-qty big"><button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less"><Icon name="minus" /></button><span className="num">{qty}</span><button onClick={() => setQty((q) => Math.min(left ?? 20, q + 1))} aria-label="More"><Icon name="plus" /></button></div></div>
            {ev?.dinner ? <label className="pos-check"><input type="checkbox" checked={dinner} onChange={(e) => setDinner(e.target.checked)} /> Home-cooked dinner by the pool (+{egp(Number(ev.dinner))} per person)</label> : null}
            {ev && <p className="pos-fine">{guest ? `Hostel guest (${guest.full_name}): pay what you want for the ticket${dinnerEach ? `, + ${egp(dinnerEach)} dinner per person` : ''}. If they are not staying that night the normal price ${egp(Number(ev.price))} is used.` : `${egp(unit)} per ticket${dinnerEach ? ' with dinner' : ''}. Hostel guests pay what they want: choose the guest on the left first.`}</p>}
            {ev && guest && <AmountPad label="Guest pays for the tickets (pay what you want)" value={pwywStr} onChange={setPwywStr} unit="EGP" />}
          </>
        )
      ) : (
        !pick ? (
          <>
            <div className="pos-field"><label htmlFor="ev-q">Name, phone or ticket code</label><input id="ev-q" value={qy} onChange={(e) => setQy(e.target.value)} autoFocus /></div>
            {list === null ? <p className="pos-fine">Loading…</p> : shown.length === 0 ? <p className="pos-fine">No bookings{s ? ' match' : ' for the coming days'}.</p> : (
              <ul className="pos-ev-list">{shown.map((b) => {
                const pending = b.status === 'pending_verification';
                return (
                  <li key={b.id} className={payable(b) ? 'due' : pending ? 'wait' : 'ok'}>
                    <div className="who">
                      <b>{b.full_name}</b>
                      <small>{title(b.title)} · {dayLabel(b.event_date)} · {b.quantity} ticket{b.quantity === 1 ? '' : 's'} · {b.ticket_code}</small>
                      {b.dinner && <small className="warn">With dinner by the pool × {b.quantity}</small>}
                      {Number(b.paid_cents) > 0 && Number(b.due_cents) > 0 && <small>Deposit {egp(Number(b.paid_cents))} paid online of {egp(Number(b.total_cents))}</small>}
                      {pending && <small className="warn">InstaPay / Vodafone receipt waiting for a manager (Payments to check). Do not take the money again.</small>}
                    </div>
                    {payable(b) ? <button className="pos-btn primary" onClick={() => { setPick(b); setPwywStr(b.is_hotel_guest && b.pwyw_offer_cents != null ? String(Number(b.pwyw_offer_cents) / 100) : ''); }}>{b.is_hotel_guest ? `Hostel guest · pay what you want${b.pwyw_offer_cents != null ? ` (said ${egp(Number(b.pwyw_offer_cents))})` : ''}${Number(b.due_cents) > 0 ? ` + ${egp(Number(b.due_cents))}` : ''}` : `Take ${egp(Number(b.due_cents))}`}</button>
                      : pending ? <span className="pos-badge">Being checked</span>
                      : b.checked_in_at ? <span className="pos-badge green"><Icon name="check" size={14} /> Checked in</span>
                      : <button className="pos-btn" onClick={async () => {
                          const r = await posCheckInEvent(b.id);
                          if (!r.ok) { setErr(r.error); return; }
                          setList((l) => (l ?? []).map((x) => (x.id === b.id ? { ...x, checked_in_at: new Date().toISOString() } : x)));
                        }}><Icon name="check" /> Paid · Check in</button>}
                  </li>
                );
              })}</ul>)}
          </>
        ) : <p className="pos-fine"><b>{pick.full_name}</b> · {title(pick.title)} · {dayLabel(pick.event_date)} · ticket {pick.ticket_code}{pick.dinner ? ` · with dinner × ${pick.quantity}` : ''}
              {Number(pick.paid_cents) > 0 && <> · total {egp(Number(pick.total_cents))}, deposit {egp(Number(pick.paid_cents))} already paid online</>} <button className="pos-link" onClick={() => setPick(null)}>change</button></p>
      )}
      {ready && (
        <>
          {mode === 'booked' && pick?.is_hotel_guest && <AmountPad label={`Hostel guest${pick.stay_reference ? ` (${pick.stay_reference})` : ''}: pay what you want for the tickets`} value={pwywStr} onChange={setPwywStr} unit="EGP" />}
          <MethodPicker value={m} onChange={setM} />
          {m === 'card' && <CardPayerFields value={payer} onChange={setPayer} />}
          <WalletRef method={m} value={ref} onChange={setRef} />
          <TipField value={tip} onChange={setTip} unit="EGP" />
          {m === 'cash' && <ChangeField value={chg} onChange={setChg} due={total + toCents(tip)} unit="EGP" needName={false} />}
          {mode === 'booked' && <label className="pos-check"><input type="checkbox" checked={checkIn} onChange={(e) => setCheckIn(e.target.checked)} /> The guest is here now: check them in too</label>}
          <p className="pos-total"><span>To pay{toCents(tip) > 0 ? ` (+ tip ${egp(toCents(tip))})` : ''}</span><b className="num">{egp(total + toCents(tip))}</b></p>
        </>
      )}
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>{mode === 'booked' && !pick ? 'Close' : 'Cancel'}</button>
        {(mode === 'sell' || pick) && <button className="pos-btn primary" disabled={busy || !ready || (m === 'card' && !payerReady(payer)) || (isWal(m) && ref.trim().length < 4) || (m === 'cash' && !changeReady(chg, total + toCents(tip), false))} onClick={async () => {
          setBusy(true); setErr(null);
          const common = { method: m, cardPayer: m === 'card' ? payerOut(payer) : null, tipMinor: toCents(tip), walletRef: isWal(m) ? ref.trim() : null, change: m === 'cash' ? changeOut(chg) : null };
          const r = mode === 'sell'
            ? await posSellEvent({ eventId: evId!, date, quantity: qty, dinner, optionKey: opt || null, fullName: name, phone: phone || null, reservationId: guest?.id ?? null, pwywCents: pwyw, ...common })
            : await posPayEvent({ bookingId: pick.id, pwywCents: pwyw, ...common });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          if (mode === 'booked' && checkIn) await posCheckInEvent(pick.id);
          onDone(`Ticket ${r.data.ticket} paid · ${egp(r.data.cents)} ${m === 'cash' ? 'cash' : 'by ' + PM_LABEL[m]}${toCents(tip) > 0 ? ` · tip ${egp(toCents(tip))}` : ''}${mode === 'booked' && checkIn ? ' · checked in' : ''}${changeNote(r.data, 'EGP')}`);
        }}><Icon name="check" /> {mode === 'sell' ? 'Sell & take payment' : 'Take payment'}</button>}
      </div>
    </Modal>
  );
}

/** Guest swaps dollars / euros for pounds at the desk. The drawer keeps the foreign notes and pays out EGP. */
function ExchangeModal({ rates, guest, onClose, onDone }: { rates: any; guest: Guest | null; onClose: () => void; onDone: (m: string) => void }) {
  const [c, setC] = useState<Cur>('USD');
  const [amount, setAmount] = useState('');
  const today = rateOf(rates, c);
  const [rate, setRate] = useState('');
  const [who, setWho] = useState(guest?.full_name ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = Number(rate) > 0 ? Number(rate) : today;
  const minor = Math.round(Number(amount || 0) * 100);
  const give = Math.floor((minor * r) / 100) * 100;
  return (
    <Modal title="Money exchange" onClose={onClose}>
      <p className="pos-fine">The guest gives you foreign money; you give pounds from the drawer. It is not a sale. Today&apos;s rate: USD {rates?.USD ?? '—'} · EUR {rates?.EUR ?? '—'}.</p>
      <CurSwitch value={c} onChange={(x) => { if (x !== 'EGP') { setC(x); setRate(''); } }} rates={rates} noEgp />
      <AmountPad label={`Guest gives (${c})`} value={amount} onChange={setAmount} unit={c} />
      <div className="pos-two">
        <div className="pos-field"><label htmlFor="ex-r">Rate (empty = today {today || '—'})</label><input id="ex-r" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(today || '')} /></div>
        <div className="pos-field"><label htmlFor="ex-g">Guest (optional)</label><input id="ex-g" value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} /></div>
      </div>
      <p className="pos-total"><span>Give the guest</span><b className="num">{egp(give)}</b></p>
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn primary" disabled={busy || !(minor > 0) || !(r > 0)} onClick={async () => {
          setBusy(true); setErr(null);
          const res = await posExchange({ currency: c, foreignMinor: minor, rate: Number(rate) > 0 ? Number(rate) : null, guest: who || null, reservationId: guest?.id ?? null });
          setBusy(false);
          if (!res.ok) { setErr(res.error); return; }
          onDone(`Exchange: ${cur(res.data.foreignMinor, c)} in, ${egp(res.data.egp)} out @ ${res.data.rate}`);
        }}><Icon name="check" /> Record exchange</button>
      </div>
    </Modal>
  );
}

function TakenModal({ takers, onClose, onDone, extra = [] }: { takers: { id: string; full_name: string }[]; onClose: () => void; onDone: (m: string) => void; extra?: string[] }) {
  const [who, setWho] = useState(takers[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [counts, setCounts] = useState<Record<Cur, string>>({ EGP: '', USD: '', EUR: '' });
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = countsOf(counts);
  return (
    <Modal title="Taken by owner" onClose={onClose}>
      <p className="pos-fine">Only the owner records this, with their own PIN. It is taken off what should be in the drawer, so the count at close still balances.</p>
      <div className="pos-two">
        <div className="pos-field"><label htmlFor="tk-who">Taken by</label><select id="tk-who" value={who} onChange={(e) => setWho(e.target.value)}>{takers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></div>
        <div className="pos-field"><label htmlFor="tk-pin">Their PIN</label><input id="tk-pin" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></div>
      </div>
      <CountGrid value={counts} onChange={setCounts} extra={extra} />
      <div className="pos-field"><label htmlFor="tk-note">Note (optional)</label><input id="tk-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn primary" disabled={busy || pin.length < 4 || !Object.values(a).some((x) => x > 0)} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await posTaken({ takerId: who, takerPin: pin, amounts: a, note });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          onDone(`Taken by ${r.data.by}: ${Object.keys(a).filter((c) => (a as any)[c]).map((c) => cur((a as any)[c], c)).join(' · ')}`);
        }}><Icon name="check" /> Record taken</button>
      </div>
    </Modal>
  );
}

function TourCatalog({ t, onClose, notify }: { t: Tour; onClose: () => void; notify: (m: string, k?: 'ok' | 'bad') => void }) {
  return (
    <Modal title={`${t.name} · catalog`} onClose={onClose} wide>
      <p className="pos-fine">Send this to the guest on WhatsApp, or go through it with them at the desk so they know the whole programme.</p>
      {t.guest_message && (
        <>
          <pre className="pos-handover-pre">{t.guest_message}</pre>
          <div className="pos-row"><button className="pos-btn primary" onClick={async () => { try { await navigator.clipboard.writeText(t.guest_message!); notify('Message copied'); } catch { notify('Select the text and copy it', 'bad'); } }}><Icon name="check" /> Copy message</button></div>
        </>
      )}
      {t.files?.length ? (
        <div className="pos-files">
          {t.files.map((f) => (
            <a key={f.id} className="pos-btn" href={`/api/media/tour-file/${f.id}`} target="_blank" rel="noopener noreferrer"><Icon name="file-text" /> {f.name}</a>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
