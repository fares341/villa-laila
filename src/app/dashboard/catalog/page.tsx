import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { productSave, tourSave, tourFileDelete } from '../pms-actions';

export const dynamic = 'force-dynamic';

const TABS = [
  { k: 'market', label: 'Market', icon: 'store' },
  { k: 'meals', label: 'Meals', icon: 'utensils' },
  { k: 'services', label: 'In-house services', icon: 'shirt' },
  { k: 'tours', label: 'Tours', icon: 'map' },
  { k: 'movements', label: 'Stock movements', icon: 'activity' },
] as const;

const MV: Record<string, string> = { purchase: 'Stock in', sale: 'Sale', damage: 'Damaged', loss: 'Lost', return: 'Returned', adjustment_audit: 'Count adjustment' };

export default async function Catalog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('inventory.manage');
  const sp = await searchParams;
  const tab = TABS.find((t) => t.k === sp.tab)?.k ?? 'market';
  const edit = can(u.role, 'catalog.manage');
  const [products, tours, moves, stats] = await Promise.all([
    q<any>(`SELECT p.*, (SELECT COALESCE(sum(quantity),0) FROM service_orders s WHERE s.product_id=p.id AND s.created_at > now() - interval '30 days' AND s.payment_status <> 'void')::int sold30
            FROM products p WHERE p.category <> 'activity_tour' ORDER BY p.is_active DESC, p.sort_order, p.name`),
    q<any>(`SELECT t.*, (SELECT COALESCE(sum(quantity),0) FROM service_orders s WHERE s.tour_id=t.id AND s.payment_status <> 'void')::int sold FROM tours_catalog t ORDER BY t.active DESC, t.sort_order, t.name`),
    tab === 'movements' ? q<any>(`SELECT m.*, p.name, u.name by_name FROM inventory_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC LIMIT 200`) : Promise.resolve([]),
    q<any>(`SELECT count(*) FILTER (WHERE is_active AND track_stock AND stock_quantity <= low_stock_threshold)::int low,
                   COALESCE(sum(stock_quantity * cost_cents) FILTER (WHERE is_active AND track_stock),0)::bigint stock_value,
                   count(*) FILTER (WHERE is_active)::int items, count(*) FILTER (WHERE is_active AND public_visible)::int online FROM products`),
  ]);
  const rows = products.filter((p) => p.pos_category === tab);
  const sel = sp.edit === 'new' ? {} as any : sp.edit ? (tab === 'tours' ? tours : products).find((x) => x.id === sp.edit) : null;
  const st = stats[0];
  const files = tab === 'tours' && sel?.id ? await q<any>(`SELECT id, name FROM tour_files WHERE tour_id=$1 ORDER BY created_at`, [sel.id]) : [];

  return (
    <>
      <PageHeader title="Catalog & stock" sub="Everything sold on the POS. Prices and stock here are what the POS uses, live.">
        <a href="/pos" target="_blank" rel="noopener" className={BtnGhost}><Icon name="shopping-cart" size={16} /> Open POS</a>
        {edit && tab !== 'movements' && <Link href={`?tab=${tab}&edit=new#form`} className={Btn}><Icon name="plus" size={16} /> {tab === 'tours' ? 'Add tour' : 'Add item'}</Link>}
      </PageHeader>
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active items" value={st.items} />
        <Stat label="Low stock" value={st.low} tone={st.low ? 'due' : 'ok'} hint="Flashes red on the POS" />
        <Stat label="Stock value (cost)" value={fmt(Number(st.stock_value))} />
        <Stat label="Shown on website" value={st.online} hint="e.g. Extra Towel" />
      </div>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Catalog sections">
        {TABS.map((t) => (
          <Link key={t.k} href={`?tab=${t.k}`} aria-current={tab === t.k ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${tab === t.k ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600'}`}>
            <Icon name={t.icon} size={15} /> {t.label}</Link>
        ))}
      </nav>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className={sel ? 'xl:col-span-2' : 'xl:col-span-3'}>
          {tab === 'movements' ? (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Item</th><th>Type</th><th className="text-right">Change</th><th className="text-right">Stock after</th><th>Note</th></tr></thead>
              <tbody>{moves.map((m) => (
                <tr key={m.id} className="border-t border-slate-100"><td className="py-2">{dt(m.created_at)}</td><td>{m.name}</td><td>{MV[m.movement_type] ?? m.movement_type}</td>
                  <td className={`text-right tabular-nums ${m.quantity < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td className="text-right tabular-nums">{m.new_stock}</td>
                  <td className="text-xs text-slate-500">{m.note || m.reference}{m.by_name && ` · ${m.by_name}`}</td></tr>))}
                {moves.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No stock movements yet.</td></tr>}</tbody>
            </table>
          ) : tab === 'tours' ? (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">Tour</th><th>Organizer</th><th className="text-right">Cost</th><th className="text-right">Sell</th><th className="text-right">Hotel profit</th><th className="text-right">Sold</th><th /></tr></thead>
              <tbody>{tours.map((t) => (
                <tr key={t.id} className={`border-t border-slate-100 ${t.active ? '' : 'opacity-50'}`}>
                  <td className="py-2"><b>{t.name}</b>{t.duration && <div className="text-xs text-slate-500">{t.duration}</div>}</td><td>{t.organizer}</td>
                  <td className="text-right tabular-nums">{fmt(Number(t.cost_cents))}</td><td className="text-right tabular-nums">{fmt(Number(t.price_cents))}</td>
                  <td className="text-right font-semibold tabular-nums text-emerald-700">{fmt(Number(t.price_cents) - Number(t.cost_cents))}</td><td className="text-right tabular-nums">{t.sold}</td>
                  <td className="text-right">{edit && <Link href={`?tab=tours&edit=${t.id}#form`} className="text-sm font-semibold text-cocoa-600 underline">Edit</Link>}</td></tr>))}
                {tours.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No tours yet.</td></tr>}</tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">Item</th><th className="text-right">Cost</th><th className="text-right">Sell</th><th className="text-right">Margin</th><th className="text-right">Stock</th><th className="text-right">Sold 30d</th><th>Flags</th><th /></tr></thead>
              <tbody>{rows.map((p) => {
                const low = p.track_stock && p.stock_quantity <= p.low_stock_threshold;
                return (
                  <tr key={p.id} className={`border-t border-slate-100 ${p.is_active ? '' : 'opacity-50'}`}>
                    <td className="py-2"><b>{p.name}</b><div className="text-xs text-slate-500">{p.unit_label}{p.barcode && <span className="ml-1 font-mono">· {p.barcode}</span>}</div></td>
                    <td className="text-right tabular-nums">{fmt(Number(p.cost_cents))}</td><td className="text-right tabular-nums">{fmt(Number(p.price_cents))}</td>
                    <td className="text-right tabular-nums">{fmt(Number(p.price_cents) - Number(p.cost_cents))}</td>
                    <td className="text-right tabular-nums">{p.track_stock ? <span className={low ? 'font-bold text-red-700' : ''}>{p.stock_quantity}</span> : '—'}{p.track_stock && <div className="text-[11px] text-slate-400">alert at {p.low_stock_threshold}</div>}</td>
                    <td className="text-right tabular-nums">{p.sold30}</td>
                    <td className="space-x-1">{low && <Pill tone="red">Low stock</Pill>}{p.public_visible ? <Pill tone="blue">Website</Pill> : <Pill>In-house only</Pill>}</td>
                    <td className="text-right">{edit && <Link href={`?tab=${tab}&edit=${p.id}#form`} className="text-sm font-semibold text-cocoa-600 underline">Edit</Link>}</td>
                  </tr>
                );
              })}
                {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-500">Nothing in this section yet.</td></tr>}</tbody>
            </table>
          )}
        </Card>

        {sel && edit && (
          <Card title={sel.id ? `Edit ${sel.name}` : tab === 'tours' ? 'New tour' : 'New item'}>
            <div id="form" className="scroll-mt-24" />
            {tab === 'tours' ? (
              <form action={tourSave} className="space-y-3" key={sel.id ?? 'new'}>
                {sel.id && <input type="hidden" name="id" value={sel.id} />}
                <div><Lbl htmlFor="t-n">Tour name</Lbl><input id="t-n" name="name" required defaultValue={sel.name} className={Input} /></div>
                <div><Lbl htmlFor="t-o">Organizer</Lbl><input id="t-o" name="organizer" required defaultValue={sel.organizer ?? 'Villa Layla Tours Desk'} className={Input} /></div>
                <div><Lbl htmlFor="t-d">Duration</Lbl><input id="t-d" name="duration" placeholder="e.g. Half day" defaultValue={sel.duration ?? ''} className={Input} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl htmlFor="t-c">Cost to hotel (EGP)</Lbl><input id="t-c" name="cost" type="number" min={0} step="0.01" defaultValue={sel.id ? Number(sel.cost_cents) / 100 : ''} className={Input} /></div>
                  <div><Lbl htmlFor="t-p">Sell price (EGP)</Lbl><input id="t-p" name="price" type="number" min={0} step="0.01" required defaultValue={sel.id ? Number(sel.price_cents) / 100 : ''} className={Input} /></div>
                </div>
                <div><Lbl htmlFor="t-x">Internal notes</Lbl><textarea id="t-x" name="description" rows={2} defaultValue={sel.description ?? ''} className={Input} /></div>
                <div><Lbl htmlFor="t-g">Message for the guest (programme, included / not included, what to bring)</Lbl>
                  <textarea id="t-g" name="guestMessage" rows={7} defaultValue={sel.guest_message ?? ''} className={Input} placeholder={'e.g. Black & White Desert, 2 days / 1 night\nPick-up early morning (5:30 to 7:00, we confirm the day before)\nBring: swimsuit (cold spring), sunglasses, sunblock, towel, light extra clothes'} /></div>
                <div><Lbl htmlFor="t-f">Catalog files (PDF or images)</Lbl><input id="t-f" name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm" /></div>
                {sel.id && files.length > 0 && (
                  <ul className="space-y-1 text-sm">{files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2"><a href={`/api/media/tour-file/${f.id}`} target="_blank" rel="noopener" className="truncate underline">{f.name}</a>
                      <button formAction={tourFileDelete} name="fileId" value={f.id} formNoValidate className="text-xs font-semibold text-red-700">Remove</button></li>))}</ul>
                )}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={sel.active ?? true} /> Available on the POS</label>
                <div className="flex gap-2"><button className={Btn}>Save tour</button><Link href="?tab=tours" className={BtnGhost}>Close</Link></div>
              </form>
            ) : (
              <form action={productSave} className="space-y-3" key={sel.id ?? 'new'}>
                {sel.id && <input type="hidden" name="id" value={sel.id} />}
                <div><Lbl htmlFor="p-n">Name</Lbl><input id="p-n" name="name" required defaultValue={sel.name} className={Input} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl htmlFor="p-c">Section</Lbl>
                    <select id="p-c" name="posCategory" defaultValue={sel.pos_category ?? tab} className={Input}><option value="market">Market</option><option value="meals">Meals</option><option value="services">In-house services</option></select></div>
                  <div><Lbl htmlFor="p-u">Unit</Lbl><input id="p-u" name="unitLabel" placeholder="each, per person…" defaultValue={sel.unit_label ?? ''} className={Input} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl htmlFor="p-co">Cost (EGP)</Lbl><input id="p-co" name="cost" type="number" min={0} step="0.01" defaultValue={sel.id ? Number(sel.cost_cents) / 100 : ''} className={Input} /></div>
                  <div><Lbl htmlFor="p-pr">Sell price (EGP)</Lbl><input id="p-pr" name="price" type="number" min={0} step="0.01" required defaultValue={sel.id ? Number(sel.price_cents) / 100 : ''} className={Input} /></div>
                </div>
                <div><Lbl htmlFor="p-b">Barcode</Lbl><input id="p-b" name="barcode" dir="ltr" placeholder="Scan into this field" defaultValue={sel.barcode ?? ''} className={Input + ' font-mono'} /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="trackStock" defaultChecked={sel.track_stock ?? tab === 'market'} /> Track stock</label>
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl htmlFor="p-s">{sel.id ? 'Stock now (counted)' : 'Opening stock'}</Lbl><input id="p-s" name="stock" type="number" defaultValue={sel.id ? sel.stock_quantity : ''} className={Input} /></div>
                  <div><Lbl htmlFor="p-t">Low-stock alert at</Lbl><input id="p-t" name="threshold" type="number" min={0} defaultValue={sel.low_stock_threshold ?? 5} className={Input} /></div>
                </div>
                <p className="text-xs text-slate-500">Changing the stock number logs a stock movement (stock in or count adjustment).</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="public" defaultChecked={sel.public_visible ?? false} /> Offer on the website too</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={sel.is_active ?? true} /> Active on the POS</label>
                <div className="flex gap-2"><button className={Btn}>Save item</button><Link href={`?tab=${tab}`} className={BtnGhost}>Close</Link></div>
              </form>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
