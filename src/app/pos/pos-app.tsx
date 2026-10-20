'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import {
  posState, posStaffList, posUnlock, posLock, posClock, posOpenShift, posSale, posGuestFolio, posTakePayment, posExpense, posCloseShift, posManagers,
} from './actions';

/* ───────── helpers ───────── */

const egp = (cents: number | null | undefined) => `EGP ${((cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const toCents = (v: string) => Math.round(Number(String(v).replace(/[^\d.]/g, '')) * 100) || 0;
const time = (iso: string | Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(new Date(iso));

type Staff = { id: string; full_name: string; role: string; is_manager: boolean };
type Product = { id: string; name: string; pos_category: 'market' | 'meals' | 'services'; price_cents: number; stock_quantity: number; track_stock: boolean; low_stock_threshold: number; barcode: string | null; unit_label: string | null };
type Tour = { id: string; name: string; organizer: string; cost_cents: number; price_cents: number; duration: string | null };
type Guest = { id: string; reference: string; full_name: string; rooms: string | null; check_out: string; charges: number; paid: number; balance: number; state: 'due' | 'settled' | 'credit' };
type CartLine = { key: string; type: 'product' | 'tour' | 'custom'; id?: string; name: string; unit: number; qty: number; max?: number | null };
type Tab = 'market' | 'meals' | 'services' | 'tours';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'market', label: 'Market', icon: 'store' },
  { key: 'meals', label: 'Meals', icon: 'utensils' },
  { key: 'services', label: 'In-House Services', icon: 'shirt' },
  { key: 'tours', label: 'Tours & Excursions', icon: 'map' },
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

function AmountPad({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="pos-field">
      <label>{label}</label>
      <div className="pos-amount">
        <span>EGP</span>
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" autoFocus />
      </div>
      <div className="pos-quick">
        {['100', '200', '500', '1000'].map((v) => <button type="button" key={v} onClick={() => onChange(String((Number(value) || 0) + Number(v)))}>+{v}</button>)}
        <button type="button" onClick={() => onChange('')}>Clear</button>
      </div>
    </div>
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
                  <b>{s.full_name}</b><small>{s.role}{s.is_manager ? ' · Manager' : ''}</small>
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

export function PosApp({ hotel, branch, device }: { hotel: string; branch: string; device: string }) {
  const [st, setSt] = useState<any>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);

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

  if (!st) return <div className="pos-root pos-loading"><Icon name="refresh" size={28} className="spin" /> Loading POS…</div>;
  if (!st.me) return <div className="pos-root"><LockScreen hotel={hotel} branch={branch} notice={lockNotice} onUnlocked={() => { setLockNotice(null); refresh(); }} />{toast && <Toast t={toast} />}</div>;

  const lock = async () => { await posLock(); setLockNotice(null); refresh(); };

  if (!st.shift) return <div className="pos-root"><OpenShift me={st.me} onOpened={(m) => { setToast({ text: m, kind: 'ok' }); refresh(); }} onLock={lock} />{toast && <Toast t={toast} />}</div>;

  if (st.shift.staffId !== st.me.id && !st.me.is_manager) {
    return (
      <div className="pos-root pos-center">
        <div className="pos-card-msg">
          <Icon name="alert-triangle" size={28} />
          <h2>Shift #{st.shift.no} is open by {st.shift.staffName}</h2>
          <p>Only one cash drawer can be open. Ask {st.shift.staffName} to close their shift, then open yours.</p>
          <button className="pos-btn" onClick={lock}><Icon name="lock" /> Back to lock screen</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-root">
      <Register st={st} hotel={hotel} branch={branch} device={device} online={online} lastSync={lastSync} refresh={refresh} lock={lock}
        notify={(text, kind = 'ok') => setToast({ text, kind })} onClosed={(msg) => { setLockNotice(msg); refresh(); }} />
      {toast && <Toast t={toast} />}
    </div>
  );
}

function Toast({ t }: { t: { text: string; kind: 'ok' | 'bad' } }) {
  return <div className={`pos-toast ${t.kind}`} role="status"><Icon name={t.kind === 'ok' ? 'check-circle' : 'alert-triangle'} size={20} />{t.text}</div>;
}

function OpenShift({ me, onOpened, onLock }: { me: Staff; onOpened: (msg: string) => void; onLock: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    const r = await posOpenShift(toCents(amount));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onOpened(r.data.tier > 0 ? `Shift #${r.data.no} opened · you were ${r.data.late} min late` : `Shift #${r.data.no} opened`);
  };
  return (
    <div className="pos-center">
      <div className="pos-card-msg wide">
        <span className="pos-chip"><Icon name="user" size={14} /> {me.full_name}</span>
        <h2>Open your shift</h2>
        <p>Count the cash float in the drawer before you start.</p>
        <AmountPad label="Opening float" value={amount} onChange={setAmount} />
        {err && <p className="pos-msg bad">{err}</p>}
        <div className="pos-row">
          <button className="pos-btn ghost" onClick={onLock}><Icon name="lock" /> Lock</button>
          <button className="pos-btn primary big" onClick={go} disabled={busy}><Icon name="log-in" /> Open Shift</button>
        </div>
      </div>
    </div>
  );
}

function Register({ st, hotel, branch, device, online, lastSync, refresh, lock, notify, onClosed }: {
  st: any; hotel: string; branch: string; device: string; online: boolean; lastSync: Date | null;
  refresh: () => Promise<void>; lock: () => void; notify: (t: string, k?: 'ok' | 'bad') => void; onClosed: (msg: string) => void;
}) {
  const products: Product[] = st.catalog?.products ?? [];
  const tours: Tour[] = st.catalog?.tours ?? [];
  const guests: Guest[] = st.guests ?? [];
  const [tab, setTab] = useState<Tab>('market');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [guestQuery, setGuestQuery] = useState('');
  const [guestOpen, setGuestOpen] = useState(false);
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [modal, setModal] = useState<null | 'custom' | 'comp' | 'pay' | 'close' | 'folio' | 'payment' | 'expense' | 'menu'>(null);
  const [busy, setBusy] = useState(false);
  const guest = guests.find((g) => g.id === guestId) ?? null;
  const total = cart.reduce((s, l) => s + l.unit * l.qty, 0);

  useEffect(() => { if (guestId && !guests.some((g) => g.id === guestId)) setGuestId(null); }, [guests, guestId]);

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

  const run = async (mode: 'charge_room' | 'pay_now' | 'settle_all' | 'walk_in', extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await posSale({
      reservationId: mode === 'walk_in' ? null : guestId, mode, method,
      items: cart.map((l) => ({ type: l.type, id: l.id, name: l.name, qty: l.qty, unitCents: l.unit })), ...extra,
    });
    setBusy(false);
    if (!r.ok) { notify(r.error, 'bad'); return false; }
    const d = r.data;
    notify(
      mode === 'charge_room' ? `${egp(d.cartTotal)} charged to ${d.guest}` :
      mode === 'settle_all' ? `${egp(d.paidCents)} collected · ${d.guest} fully settled` :
      `${egp(d.paidCents)} paid by ${method}`,
    );
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
          <span className={`pos-chip ${synced ? 'ok' : 'bad'}`}><Icon name={synced ? 'wifi' : 'wifi-off'} size={14} /> {synced ? `Connected · Synced ${time(lastSync!)}` : 'Offline — retrying'}</span>
        </div>
        <div className="pos-top-figs">
          <div><small>Today’s Revenue</small><b className="num">{egp(st.revenue)}</b></div>
          <div title={st.drawer == null ? 'Hidden until the blind count at close' : undefined}><small>Current Drawer Cash</small><b className="num">{st.drawer == null ? 'Blind' : egp(st.drawer)}</b></div>
        </div>
        <div className="pos-top-acts">
          <button className="pos-icon-btn" onClick={() => refresh()} aria-label="Refresh"><Icon name="refresh" size={20} /></button>
          <button className="pos-icon-btn" onClick={() => setModal('menu')} aria-label="More"><Icon name="menu" size={20} /></button>
          <button className="pos-btn ghost" onClick={lock}><Icon name="lock" /> Lock Screen</button>
          <button className="pos-btn danger" onClick={() => setModal('close')}><Icon name="log-out" /> Close Shift</button>
        </div>
      </header>

      <div className="pos-body">
        {/* ── Cart & guest (35%) ── */}
        <aside className="pos-cart">
          <div className="pos-guest">
            <label className="pos-label" htmlFor="pos-guest-q">In-house guest</label>
            {guest ? (
              <div className="pos-guest-card">
                <div className="pos-guest-hd">
                  <div><b>{guest.full_name}</b><small>{guest.rooms ?? 'No room'} · {guest.reference} · out {guest.check_out}</small></div>
                  <button className="pos-icon-btn" onClick={() => setGuestId(null)} aria-label="Clear guest"><Icon name="x" /></button>
                </div>
                <div className="pos-bal">
                  <div><small>Total Charges</small><b className="num">{egp(guest.charges)}</b></div>
                  <div><small>Total Paid</small><b className="num">{egp(guest.paid)}</b></div>
                  <div><small>Current Balance</small><b className="num">{egp(Math.abs(guest.balance))}</b></div>
                </div>
                <div className="pos-guest-ft">
                  {guest.state === 'due' && <span className="pos-badge red">Balance Due: {egp(guest.balance)}</span>}
                  {guest.state === 'settled' && <span className="pos-badge green">Fully Settled</span>}
                  {guest.state === 'credit' && <span className="pos-badge blue">Credit Balance: {egp(-guest.balance)}</span>}
                  <button className="pos-link" onClick={() => setModal('folio')}><Icon name="file-text" size={15} /> Folio</button>
                  <button className="pos-link" onClick={() => setModal('payment')}><Icon name="banknote" size={15} /> Receive payment</button>
                </div>
              </div>
            ) : (
              <div className="pos-guest-search">
                <Icon name="search" size={18} />
                <input id="pos-guest-q" placeholder="Room number or guest name" value={guestQuery} onFocus={() => setGuestOpen(true)} onChange={(e) => { setGuestQuery(e.target.value); setGuestOpen(true); }} autoComplete="off" />
                {guestOpen && (
                  <ul className="pos-guest-list" role="listbox">
                    {guestMatches.map((g) => (
                      <li key={g.id}><button role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { setGuestId(g.id); setGuestQuery(''); setGuestOpen(false); }}>
                        <span><b>{g.rooms ?? '—'}</b> {g.full_name}</span>
                        <span className={`pos-dot ${g.state}`}>{g.state === 'due' ? egp(g.balance) : g.state === 'credit' ? 'Credit' : 'Settled'}</span>
                      </button></li>
                    ))}
                    {!guestMatches.length && <li className="pos-empty">No in-house guest matches.</li>}
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

          <div className="pos-method" role="radiogroup" aria-label="Payment method">
            <button role="radio" aria-checked={method === 'cash'} className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}><Icon name="banknote" /> Cash</button>
            <button role="radio" aria-checked={method === 'card'} className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}><Icon name="credit-card" /> Card</button>
          </div>

          <div className="pos-actions">
            <button className="pos-btn primary" disabled={busy || !guest || !cart.length} onClick={() => run('charge_room')}><Icon name="bed" /> Charge to Room</button>
            <button className="pos-btn accent" disabled={busy || !cart.length} onClick={() => setModal('pay')}><Icon name={method === 'cash' ? 'banknote' : 'credit-card'} /> Pay Now ({method === 'cash' ? 'Cash' : 'Card'})</button>
            <button className="pos-btn" disabled={busy || !guest || (guest.balance <= 0 && !cart.length)} onClick={() => run('settle_all')}><Icon name="wallet" /> Settle Outstanding{guest && guest.balance + total > 0 ? ` · ${egp(guest.balance + total)}` : ''}</button>
            <button className="pos-btn" disabled={busy || !cart.length} onClick={() => run('walk_in')}><Icon name="user" /> Walk-in Direct Cashier</button>
            <button className="pos-btn" onClick={() => setModal('custom')}><Icon name="plus" /> Add Custom Charge</button>
            <button className="pos-btn" disabled={busy || (!cart.length && !(guest && guest.balance > 0))} onClick={() => setModal('comp')}><Icon name="gift" /> Owner Comp / Other</button>
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
            {tab === 'tours' && !search
              ? (shown as Tour[]).map((t) => (
                <button key={t.id} className="pos-tile tour" onClick={() => add({ type: 'tour', id: t.id, name: `${t.name}`, unit: t.price_cents })}>
                  <b>{t.name}</b>
                  <small>{t.organizer}{t.duration ? ` · ${t.duration}` : ''}</small>
                  <span className="pos-price num">{egp(t.price_cents)}</span>
                  <span className="pos-tour-fig"><span>Cost {egp(t.cost_cents)}</span><span className="profit">Hotel net {egp(t.price_cents - t.cost_cents)}</span></span>
                </button>
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
      {modal === 'pay' && <PayModal total={total} method={method} guest={guest} busy={busy} onClose={() => setModal(null)} onConfirm={() => run('pay_now')} />}
      {modal === 'comp' && <CompModal cartTotal={total} guest={guest} onClose={() => setModal(null)} onDone={async (extra) => { const ok = await (async () => {
        setBusy(true);
        const r = await posSale({ reservationId: guestId, mode: 'comp', method, items: cart.map((l) => ({ type: l.type, id: l.id, name: l.name, qty: l.qty, unitCents: l.unit })), ...extra });
        setBusy(false);
        if (!r.ok) { notify(r.error, 'bad'); return false; }
        notify(`${egp(r.data.compCents)} recorded as owner comp`); setCart([]); setModal(null); await refresh(); return true;
      })(); return ok; }} />}
      {modal === 'folio' && guest && <FolioModal guest={guest} onClose={() => setModal(null)} />}
      {modal === 'payment' && guest && <PaymentModal guest={guest} method={method} onClose={() => setModal(null)} onDone={async (m) => { notify(m); setModal(null); await refresh(); }} />}
      {modal === 'expense' && <ExpenseModal onClose={() => setModal(null)} onDone={async () => { notify('Expense recorded'); setModal(null); await refresh(); }} />}
      {modal === 'menu' && (
        <Modal title="More" onClose={() => setModal(null)}>
          <div className="pos-menu">
            <button className="pos-btn" onClick={() => setModal('expense')}><Icon name="receipt" /> Record petty expense</button>
            <a className="pos-btn" href="/dashboard/frontdesk" target="_blank" rel="noopener"><Icon name="door-open" /> Front desk cockpit</a>
            <a className="pos-btn" href="/dashboard" target="_blank" rel="noopener"><Icon name="layout-dashboard" /> Dashboard</a>
            <p className="pos-fine">Device signed in as {device}. Channel manager {st.channel ? 'connected' : 'not connected'}.</p>
          </div>
        </Modal>
      )}
      {modal === 'close' && <CloseShift shiftNo={st.shift.no} onClose={() => setModal(null)} onFinished={(m) => onClosed(m)} />}
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

function PayModal({ total, method, guest, busy, onClose, onConfirm }: { total: number; method: 'cash' | 'card'; guest: Guest | null; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [given, setGiven] = useState('');
  const change = toCents(given) - total;
  return (
    <Modal title={`Pay now · ${method === 'cash' ? 'Cash' : 'Card'}`} onClose={onClose}>
      <div className="pos-big-total"><small>{guest ? `${guest.full_name} · this cart only` : 'This cart'}</small><b className="num">{egp(total)}</b></div>
      {method === 'cash' ? (
        <>
          <AmountPad label="Cash received (optional)" value={given} onChange={setGiven} />
          {toCents(given) > 0 && <p className={`pos-change ${change < 0 ? 'bad' : ''}`}>{change < 0 ? `Short by ${egp(-change)}` : `Change to give: ${egp(change)}`}</p>}
        </>
      ) : <p className="pos-fine">Run {egp(total)} on the card terminal, then confirm.</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button><button className="pos-btn primary big" disabled={busy || (method === 'cash' && toCents(given) > 0 && change < 0)} onClick={onConfirm}><Icon name="check" /> Confirm payment</button></div>
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
    <Modal title="Owner comp / other" onClose={onClose}>
      <p className="pos-fine">Settles without cash. Nothing is added to the drawer, and it appears in the Owner Allowances report.</p>
      <div className="pos-big-total"><small>{guest ? guest.full_name : 'Walk-in'}</small><b className="num">{egp(amount)}</b></div>
      {guest && guest.balance > 0 && (
        <label className="pos-check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Also waive the outstanding balance ({egp(guest.balance)})</label>
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
    <Modal title={`Folio · ${guest.full_name}`} onClose={onClose} wide>
      {!f ? <p>Loading…</p> : f.error ? <p className="pos-msg bad">{f.error}</p> : (
        <>
          <table className="pos-table">
            <thead><tr><th>Date</th><th>Description</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {f.lines.map((l: any, i: number) => (
                <tr key={l.id ?? i} className={l.amount_cents < 0 ? 'credit' : ''}>
                  <td className="num">{l.date}</td>
                  <td>{l.description}{l.kind === 'room' && l.rate_source && <small className="pos-src">{l.rate_source === 'little_hotelier' ? 'Little Hotelier rate' : l.rate_source === 'booking' ? 'Booked rate' : l.rate_source === 'override' ? 'Manager rate' : 'Local rate'}</small>}</td>
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

function PaymentModal({ guest, method, onClose, onDone }: { guest: Guest; method: 'cash' | 'card'; onClose: () => void; onDone: (msg: string) => void }) {
  const [amount, setAmount] = useState(guest.balance > 0 ? String(guest.balance / 100) : '');
  const [m, setM] = useState<'cash' | 'card'>(method);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Receive payment · ${guest.full_name}`} onClose={onClose}>
      <p className="pos-fine">Balance due {egp(guest.balance)}. Part payments are fine; the rest stays on the guest’s account.</p>
      <AmountPad label="Amount received" value={amount} onChange={setAmount} />
      <div className="pos-method"><button className={m === 'cash' ? 'on' : ''} onClick={() => setM('cash')}><Icon name="banknote" /> Cash</button><button className={m === 'card' ? 'on' : ''} onClick={() => setM('card')}><Icon name="credit-card" /> Card</button></div>
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn primary" disabled={busy || toCents(amount) <= 0} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await posTakePayment(guest.id, toCents(amount), m);
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          const left = guest.balance - toCents(amount);
          onDone(left > 0 ? `${egp(toCents(amount))} received · ${egp(left)} still due` : `${egp(toCents(amount))} received · fully settled`);
        }}><Icon name="check" /> Record payment</button>
      </div>
    </Modal>
  );
}

function ExpenseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('supplies');
  const [mgr, setMgr] = useState({ id: '', pin: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Petty expense from the drawer" onClose={onClose}>
      <AmountPad label="Amount taken from the drawer" value={amount} onChange={setAmount} />
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
          const r = await posExpense({ amountCents: toCents(amount), category: cat, description: desc.trim(), approverId: mgr.id, approverPin: mgr.pin });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          onDone();
        }}><Icon name="check" /> Record expense</button>
      </div>
    </Modal>
  );
}

function CloseShift({ shiftNo, onClose, onFinished }: { shiftNo: number; onClose: () => void; onFinished: (msg: string) => void }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [z, setZ] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (z) {
    const v = Number(z.variance);
    const h = Math.floor(z.hours_worked), m = Math.round((z.hours_worked - h) * 60);
    return (
      <Modal title={`Z-Report · Shift #${z.shift_no}`} wide>
        <table className="pos-table z">
          <tbody>
            <tr><td>Opening float</td><td className="r num">{egp(z.opening_float)}</td></tr>
            <tr><td>+ Cash sales</td><td className="r num">{egp(z.cash_sales)}</td></tr>
            <tr><td>+ Room cash payments</td><td className="r num">{egp(z.room_cash_payments)}</td></tr>
            {Number(z.event_cash) > 0 && <tr><td>+ Event tickets paid in cash</td><td className="r num">{egp(z.event_cash)}</td></tr>}
            <tr><td>− Approved expenses</td><td className="r num">{egp(z.approved_expenses)}</td></tr>
            <tr className="strong"><td>Expected cash</td><td className="r num">{egp(z.expected_cash)}</td></tr>
            <tr className="strong"><td>Counted cash</td><td className="r num">{egp(z.counted_cash)}</td></tr>
            <tr className={`strong ${v === 0 ? 'ok' : 'bad'}`}><td>Variance</td><td className="r num">{v === 0 ? 'EGP 0 · Balanced' : v > 0 ? `Over ${egp(v)}` : `Short ${egp(-v)}`}</td></tr>
            <tr><td colSpan={2} className="sep" /></tr>
            <tr><td>Card sales / card room payments</td><td className="r num">{egp(z.card_sales)} / {egp(z.room_card_payments)}</td></tr>
            <tr><td>Charged to rooms</td><td className="r num">{egp(z.room_charges)}</td></tr>
            <tr><td>Owner comps</td><td className="r num">{egp(z.owner_comps)}</td></tr>
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
      <p className="pos-fine">Count all the cash in the drawer now and enter the total. The expected amount is shown only after you confirm.</p>
      <AmountPad label="Cash counted in the drawer" value={counted} onChange={setCounted} />
      <div className="pos-field"><label htmlFor="close-note">Note (optional)</label><input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
      {err && <p className="pos-msg bad">{err}</p>}
      <div className="pos-row end"><button className="pos-btn ghost" onClick={onClose}>Cancel</button>
        <button className="pos-btn danger big" disabled={busy || counted === ''} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await posCloseShift(toCents(counted), note);
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          setZ(r.data);
        }}><Icon name="lock" /> Confirm count & close</button>
      </div>
    </Modal>
  );
}
