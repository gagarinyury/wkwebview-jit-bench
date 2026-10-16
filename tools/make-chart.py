"""Generates assets/benchmark-{light,dark}.svg from the numbers in results/*-scheme.txt (paged variants)."""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
log = (root / 'results/iphone-air-ios27.0.1-scheme.txt').read_text()
def mips(name):
    m = re.search(r'^%s\s+.*?"mips_best": (\d+)' % name, log, re.M); return int(m.group(1))
nat = json.loads(re.search(r'^native\s+(\{.*\})', log, re.M).group(1))
base = nat['interp_mips']
rows = [  # label, value, kind
    ('Native AOT, clang -O3', nat['aot_mips'], 'ref'),
    ('WASM JIT · hot loop as one unit', mips('bench_loop_paged'), 'jit'),
    ('WASM JIT · blocks + dispatcher', mips('bench_chain_paged'), 'jit'),
    ('WASM JIT · one module per block', mips('bench_xmod_paged'), 'jit'),
    ('Native interpreter (best without JIT)', base, 'base'),
    ('Interpreter compiled to WASM', mips('bench_wasm_interp'), 'base'),
]
themes = {
  'light': dict(surface='#fcfcfb', ink='#0b0b0b', ink2='#52514e', grid='#e4e3de', jit='#2a78d6', gray='#8b8a85', ref='#b9b8b2'),
  'dark':  dict(surface='#1a1a19', ink='#f0efec', ink2='#c3c2b7', grid='#33332f', jit='#3987e5', gray='#8a897f', ref='#5b5a55'),
}
W, X0, BARMAX, ROW, TOP = 820, 262, 340, 40, 92
H = TOP + ROW * len(rows) + 74
FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
def fmt(n): return f'{n:,}'.replace(',', ' ')
def build(t):
    c = themes[t]; o = []
    a = o.append
    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">')
    a(f'<title id="t">Guest MIPS: WASM JIT in WKWebView vs. native interpreter</title>')
    a(f'<desc id="d">' + '; '.join(f'{r[0]}: {r[1]} MIPS' for r in rows) + '</desc>')
    a(f'<rect width="{W}" height="{H}" rx="14" fill="{c["surface"]}"/>')
    a(f'<g font-family=\'{FONT}\'>')
    a(f'<text x="28" y="40" font-size="19" font-weight="700" fill="{c["ink"]}">JIT inside WKWebView, measured on a stock iPhone</text>')
    a(f'<text x="28" y="62" font-size="13" fill="{c["ink2"]}">Guest MIPS, higher is better · iPhone Air (A19 Pro) · iOS 27.0.1 · toy ISA with software MMU</text>')
    a(f'<text x="{W-28}" y="84" font-size="11" text-anchor="end" fill="{c["ink2"]}">vs. native interpreter</text>')
    for i, (label, v, kind) in enumerate(rows):
        y = TOP + i * ROW
        w = max(2, round(v / rows[0][1] * BARMAX))
        col = {'jit': c['jit'], 'base': c['gray'], 'ref': c['ref']}[kind]
        bold = ' font-weight="700"' if kind == 'base' and i == 4 else ''
        a(f'<text x="{X0-12}" y="{y+19}" font-size="13" text-anchor="end" fill="{c["ink"]}"{bold}>{label}</text>')
        # bar: square at the baseline, 4px rounded data end
        a(f'<path d="M{X0} {y+4} H{X0+w-4} a4 4 0 0 1 4 4 V{y+22} a4 4 0 0 1 -4 4 H{X0} Z" fill="{col}"/>')
        sup = '¹' if i == 1 else ''
        a(f'<text x="{X0+w+10}" y="{y+19}" font-size="13" font-weight="600" fill="{c["ink"]}">{fmt(v)}{sup}</text>')
        mult = v / base
        a(f'<text x="{W-28}" y="{y+19}" font-size="13" text-anchor="end" fill="{c["ink2"]}">{mult:.1f}×</text>')
    ly = TOP + ROW * len(rows) + 14
    a(f'<line x1="28" y1="{ly-6}" x2="{W-28}" y2="{ly-6}" stroke="{c["grid"]}" stroke-width="1"/>')
    for x, col, txt in [(28, c['jit'], 'WASM recompiler, JIT-compiled by WebKit'), (318, c['gray'], 'no-JIT baselines'), (462, c['ref'], 'native reference (needs JIT-capable host)')]:
        a(f'<rect x="{x}" y="{ly+6}" width="10" height="10" rx="2" fill="{col}"/>')
        a(f'<text x="{x+16}" y="{ly+15}" font-size="12" fill="{c["ink2"]}">{txt}</text>')
    a(f'<text x="28" y="{ly+40}" font-size="11" fill="{c["ink2"]}">¹ Safari rounds timers to ~1 ms; this run lasts 5 ms, so ±20 %. Ratios on a toy ISA are not a prediction for real ARM code.</text>')
    a('</g></svg>')
    return '\n'.join(o)
for t in themes:
    (root / f'assets/benchmark-{t}.svg').write_text(build(t))
print('ok', base)
