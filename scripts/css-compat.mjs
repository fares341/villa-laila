// Builds src/styles/compat.css: fallbacks for older phones' browsers (old Android Chrome / WebView, Samsung Internet,
// Huawei / Xiaomi browsers, older iPhones). Every rule sits behind `@supports not (...)` or the `.no-flexgap` class,
// so up-to-date browsers ignore all of it. Runs before `next build` (npm prebuild) and can be run by hand:
//   node scripts/css-compat.mjs
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCES = [
  'src/styles/villa-layla-claude.css',
  'src/app/c/[slug]/collab.css',
  'src/app/[lang]/join/join.css',
  'src/app/[lang]/policies/policies.css',
].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
const OUT = path.join(root, 'src/styles/compat.css');

const SUP = {
  inset: 'not (inset: 0)',
  insetInline: 'not (inset-inline-start: 0)',
  inlineShort: 'not (padding-inline: 0)',
  vp: 'not (height: 1dvh)',
  math: 'not (width: clamp(1px, 2px, 3px))',
};
const groups = { flexgap: [], inset: [], insetInline: [], inlineShort: [], vp: [], math: [] };

const split = (v) => postcss.list.space(v);
const box = (v) => { const p = split(v); return [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]]; };
// The @media / @supports around a rule, so the fallback keeps the same conditions.
const wrappers = (node) => { const w = []; let p = node.parent; while (p && p.type === 'atrule') { w.unshift({ name: p.name, params: p.params }); p = p.parent; } return w; };
const inAnim = (node) => { let p = node.parent; while (p) { if (p.type === 'atrule' && /keyframes/i.test(p.name)) return true; p = p.parent; } return false; };
const add = (g, rule, selectors, decls) => { if (decls.length) groups[g].push({ wrap: wrappers(rule), selectors, decls }); };
// A safe fixed value for browsers without CSS math: clamp() → its minimum; min() → its % / vw part, else the
// smallest px; max() → the largest px. Skipped when nothing simple is there.
const plain = (x) => /^-?[\d.]+(px|rem|em|%|vw|vh)?$/.test(x);
const px = (x) => (/px$/.test(x) ? parseFloat(x) : /rem$|em$/.test(x) ? parseFloat(x) * 16 : NaN);
const mathFallback = (v) => {
  const m = /^(clamp|min|max)\((.*)\)$/.exec(v.trim());
  if (!m) return null;
  const args = postcss.list.comma(m[2]).map((x) => x.trim());
  if (m[1] === 'clamp') return plain(args[0]) ? args[0] : null;
  const rel = args.find((x) => /^-?[\d.]+(%|vw)$/.test(x));
  const abs = args.filter((x) => plain(x) && !isNaN(px(x))).sort((a, b) => px(a) - px(b));
  if (m[1] === 'min') return rel ?? (abs.length === args.length ? abs[0] : null);
  return abs[abs.length - 1] ?? null;
};

for (const file of SOURCES) {
  const ast = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
  ast.walkRules((rule) => {
    if (inAnim(rule)) return;
    const sels = rule.selectors;
    const d = {};
    rule.each((n) => { if (n.type === 'decl') d[n.prop] = n.value; });

    // Flexbox gap (Chrome < 84, Safari < 14.1): margins between the children instead.
    const flex = /(^|\s)(inline-)?flex\b/.test(d.display ?? '');
    const gapV = d.gap ?? d['column-gap'] ?? d['row-gap'];
    if (flex && gapV && !/var\(|calc\(|clamp\(|min\(|max\(/.test(gapV)) {
      const [rowGap, colGap] = d.gap ? [split(d.gap)[0], split(d.gap)[1] ?? split(d.gap)[0]] : [d['row-gap'] ?? '0', d['column-gap'] ?? '0'];
      const column = /column/.test(d['flex-direction'] ?? '');
      const decls = column ? [['margin-top', rowGap]] : [['margin-inline-start', colGap]];
      if (!column && /wrap/.test(d['flex-wrap'] ?? '') && rowGap !== '0') decls.push(['margin-bottom', rowGap]);
      if (decls.some(([, v]) => v && v !== '0' && v !== 'normal')) add('flexgap', rule, sels.map((s) => `.no-flexgap ${s} > * + *`), decls);
    }

    const insetD = [], logical = { ltr: [], rtl: [] }, shorts = [], vp = [], math = [];
    rule.each((n) => {
      if (n.type !== 'decl') return;
      const imp = n.important ? ' !important' : '';
      if (n.prop === 'inset') { const [t, r, b, l] = box(n.value); insetD.push(['top', t + imp], ['right', r + imp], ['bottom', b + imp], ['left', l + imp]); }
      const lm = /^inset-inline-(start|end)$/.exec(n.prop);
      if (lm) { logical.ltr.push([lm[1] === 'start' ? 'left' : 'right', n.value + imp]); logical.rtl.push([lm[1] === 'start' ? 'right' : 'left', n.value + imp]); }
      if (n.prop === 'inset-inline') { const [s, e] = [split(n.value)[0], split(n.value)[1] ?? split(n.value)[0]]; logical.ltr.push(['left', s + imp], ['right', e + imp]); logical.rtl.push(['right', s + imp], ['left', e + imp]); }
      const sm = /^(padding|margin)-(inline|block)$/.exec(n.prop);
      if (sm && !/^(clamp|min|max)\(/.test(n.value.trim())) {
        const [s, e] = [split(n.value)[0], split(n.value)[1] ?? split(n.value)[0]];
        shorts.push(...(sm[2] === 'inline' ? [[`${sm[1]}-inline-start`, s + imp], [`${sm[1]}-inline-end`, e + imp]] : [[`${sm[1]}-top`, s + imp], [`${sm[1]}-bottom`, e + imp]]));
      }
      if (/\d(d|s|l)v(h|w)\b/.test(n.value)) vp.push([n.prop, n.value.replace(/(\d)(d|s|l)v(h|w)\b/g, '$1v$3') + imp]);
      if (/^(clamp|min|max)\(/.test(n.value.trim())) {
        const f = mathFallback(n.value);
        // Logical shorthands are newer than clamp() support, so the fallback uses physical sides.
        const phys = { 'padding-block': ['padding-top', 'padding-bottom'], 'margin-block': ['margin-top', 'margin-bottom'], 'padding-inline': ['padding-left', 'padding-right'], 'margin-inline': ['margin-left', 'margin-right'] }[n.prop];
        if (f && phys) phys.forEach((p) => math.push([p, f + imp]));
        else if (f && !/^inset-/.test(n.prop)) math.push([n.prop, f + imp]);
      }
    });
    add('inset', rule, sels, insetD);
    // Selectors that already name a direction keep their own; the rest get one rule per direction.
    const free = sels.filter((s) => !/\[dir=/.test(s));
    if (free.length) {
      add('insetInline', rule, free.map((s) => `[dir='ltr'] ${s}`), logical.ltr);
      add('insetInline', rule, free.map((s) => `[dir='rtl'] ${s}`), logical.rtl);
    }
    add('inlineShort', rule, sels, shorts);
    add('vp', rule, sels, vp);
    add('math', rule, sels, math);
  });
}

const print = (items) => items.map(({ wrap, selectors, decls }) => {
  const body = `${selectors.join(',\n')} { ${decls.map(([p, v]) => `${p}: ${v};`).join(' ')} }`;
  return wrap.reduceRight((inner, w) => `@${w.name} ${w.params} {\n${inner}\n}`, body);
}).join('\n');

let out = `/* GENERATED by scripts/css-compat.mjs — do not edit by hand. Fallbacks for older phone browsers only;
   modern browsers skip every block below. */\n`;
for (const [g, items] of Object.entries(groups)) {
  if (!items.length) continue;
  out += g === 'flexgap' ? `\n/* gap in flex rows (Chrome < 84) — only when <html> has .no-flexgap */\n${print(items)}\n` : `\n@supports ${SUP[g]} {\n${print(items)}\n}\n`;
}
fs.writeFileSync(OUT, out);
console.log(`css-compat: ${Object.entries(groups).map(([g, i]) => `${g} ${i.length}`).join(', ')} → ${path.relative(root, OUT)}`);
