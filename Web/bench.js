// Бенчмарк «рекомпиляция гостевого кода в WASM» против интерпретатора.
// Игрушечный 32-битный ISA (10 операций, 16 регистров, память через таблицу страниц как у эмуляторов без mmap).
// Работает и в браузере, и в Node (для проверки корректности).
(function (g) {
'use strict';
const CODE = 0x1000, PT = 0x20000, RAM = 0x500000, MASK = 0xFFFFFF, GBASE = 0x08000000, PAGES = 384;
const OP = { HALT: 0, ADD: 1, EOR: 2, ROR: 3, ADDI: 4, LDR: 5, STR: 6, SUBI: 7, BNZ: 8, MUL: 9 };
const enc = (op, rd = 0, rn = 0, rm = 0, imm = 0) => ((op << 24) | (rd << 20) | (rn << 16) | (rm << 12) | (imm & 0xfff)) >>> 0;
const PROG = [
  enc(OP.LDR, 2, 1, 0, 0), enc(OP.LDR, 3, 1, 0, 1), enc(OP.ADD, 4, 2, 3), enc(OP.EOR, 5, 4, 2),
  enc(OP.ROR, 6, 5, 0, 7), enc(OP.ADDI, 7, 6, 0, 13), enc(OP.MUL, 8, 7, 3), enc(OP.ADD, 9, 8, 4),
  enc(OP.EOR, 2, 9, 6), enc(OP.ROR, 3, 2, 0, 13), enc(OP.ADD, 4, 3, 5), enc(OP.ADDI, 5, 4, 0, 1),
  enc(OP.EOR, 6, 5, 9), enc(OP.ADD, 7, 6, 8), enc(OP.STR, 7, 1, 0, 2), enc(OP.STR, 2, 1, 0, 0),
  enc(OP.ADD, 3, 3, 7), enc(OP.EOR, 8, 8, 3), enc(OP.ROR, 9, 9, 0, 3), enc(OP.ADD, 2, 2, 9),
  enc(OP.SUBI, 0, 0, 0, 1), enc(OP.BNZ, 0, 0, 0, 0), enc(OP.HALT),
];
const PER_ITER = 22;
const seed = (k) => (Math.imul(k, 0x01234567) + 1) >>> 0;

// ---------- мини-ассемблер WASM ----------
function leb(n) { const o = []; n >>>= 0; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; }
function sleb(n) { n |= 0; const o = []; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } }
const cat = (...a) => [].concat(...a);
const vec = (items) => cat(leb(items.length), ...items);
const sec = (id, bytes) => cat([id], leb(bytes.length), bytes);
const str = (s) => cat(leb(s.length), [...s].map((c) => c.charCodeAt(0)));
const B = {
  get: (i) => [0x20, ...leb(i)], set: (i) => [0x21, ...leb(i)], tee: (i) => [0x22, ...leb(i)],
  c: (n) => [0x41, ...sleb(n)],
  add: [0x6a], sub: [0x6b], mul: [0x6c], and: [0x71], xor: [0x73], shl: [0x74], shru: [0x76], rotr: [0x78], eqz: [0x45], ne: [0x47],
  load: (off) => [0x28, 2, ...leb(off)], store: (off) => [0x36, 2, ...leb(off)],
};
const HDR = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
const T_V_V = [0x60, 0, 0], T_V_I = [0x60, 0, 1, 0x7f];
const IMP_MEM = cat(str('e'), str('mem'), [0x02, 0x00], leb(1));
const IMP_TBL = cat(str('e'), str('tbl'), [0x01, 0x70, 0x00], leb(1));
const NLOC = 18, T0 = 16;
const withLen = (b) => cat(leb(b.length), b);
const body = (code) => withLen(cat([0x01], leb(NLOC), [0x7f], code, [0x0b]));
const dispBody = withLen(cat([0x01, 0x01, 0x7f], [0x03, 0x40], B.get(0), [0x11, 0, 0], B.tee(0), B.c(3), B.ne, [0x0d, 0], [0x0b], [0x0b]));

function rw(ins) {
  const op = ins >>> 24, rd = (ins >>> 20) & 15, rn = (ins >>> 16) & 15, rm = (ins >>> 12) & 15;
  switch (op) {
    case 1: case 2: case 9: return { r: [rn, rm], w: [rd] };
    case 3: case 4: case 7: case 5: return { r: [rn], w: [rd] };
    case 6: return { r: [rn, rd], w: [] };
    case 8: return { r: [rd], w: [] };
    default: return { r: [], w: [] };
  }
}
// mode: 'direct' (адрес & маска, как «быстрая память») или 'paged' (таблица страниц, как без mmap)
function genOp(ins, mode) {
  const op = ins >>> 24, rd = (ins >>> 20) & 15, rn = (ins >>> 16) & 15, rm = (ins >>> 12) & 15, imm = ins & 4095;
  const bin = (o) => cat(B.get(rn), B.get(rm), o, B.set(rd));
  const addr = cat(B.get(rn), B.c(imm * 4), B.add);
  const host = cat(addr, B.tee(T0), B.c(12), B.shru, B.c(2), B.shl, B.load(PT), B.get(T0), B.c(4095), B.and, B.add);
  switch (op) {
    case 1: return bin(B.add);
    case 2: return bin(B.xor);
    case 9: return bin(B.mul);
    case 3: return cat(B.get(rn), B.c(imm & 31), [0x78], B.set(rd));
    case 4: return cat(B.get(rn), B.c(imm), B.add, B.set(rd));
    case 7: return cat(B.get(rn), B.c(imm), B.sub, B.set(rd));
    case 5: return mode === 'direct'
      ? cat(addr, B.c(MASK), B.and, B.load(RAM), B.set(rd))
      : cat(host, B.load(0), B.set(rd));
    case 6: return mode === 'direct'
      ? cat(addr, B.c(MASK), B.and, B.get(rd), B.store(RAM))
      : cat(host, B.get(rd), B.store(0));
    default: throw new Error('bad op ' + op);
  }
}
const loadRegs = (rs) => cat(...rs.map((r) => cat(B.c(0), B.load(4 * r), B.set(r))));
const storeRegs = (rs) => cat(...rs.map((r) => cat(B.c(0), B.get(r), B.store(4 * r))));
const ALL = [...Array(16).keys()];
const CHAIN = [
  { from: 0, to: 8, ret: B.c(1) },
  { from: 8, to: 16, ret: B.c(2) },
  { from: 16, to: 21, ret: cat(B.get(0), B.eqz, B.c(3), B.mul) },  // BNZ r0 -> блок 0, иначе HALT (3)
];
function blockCode(blk, mode, prog) {
  prog = prog || PROG;
  const reads = new Set(), writes = new Set();
  for (let i = blk.from; i < blk.to; i++) { const x = rw(prog[i]); x.r.forEach((r) => reads.add(r)); x.w.forEach((w) => writes.add(w)); }
  const ops = []; for (let i = blk.from; i < blk.to; i++) ops.push(genOp(prog[i], mode));
  return body(cat(loadRegs([...reads]), ...ops, storeRegs([...writes]), blk.ret));
}
// J1: весь горячий цикл одним wasm-модулем, регистры в локалах
function modLoop(mode) {
  const ops = []; for (let i = 0; i < 21; i++) ops.push(genOp(PROG[i], mode));
  const code = cat(loadRegs(ALL), [0x03, 0x40], ...ops, B.get(0), [0x0d, 0], [0x0b], storeRegs(ALL));
  return Uint8Array.from(cat(HDR, sec(1, vec([T_V_V])), sec(2, vec([IMP_MEM])), sec(3, vec([[0]])),
    sec(7, vec([cat(str('run'), [0x00], leb(0))])), sec(10, vec([body(code)]))));
}
// J2: 3 блока + диспетчер в одном модуле (call_indirect по внутренней таблице)
function modChain(mode) {
  const blocks = CHAIN.map((b) => blockCode(b, mode));
  return Uint8Array.from(cat(HDR, sec(1, vec([T_V_I, T_V_V])), sec(2, vec([IMP_MEM])), sec(3, vec([[0], [0], [0], [1]])),
    sec(4, vec([[0x70, 0x00, 4]])), sec(7, vec([cat(str('run'), [0x00], leb(3))])),
    sec(9, vec([cat([0x00, 0x41, 0, 0x0b], vec([[0], [1], [2]]))])), sec(10, vec([...blocks, dispBody]))));
}
// J3: диспетчер и блоки — отдельные модули, общая импортируемая таблица (так JIT добавляет блоки на лету)
function modDispatcher() {
  return Uint8Array.from(cat(HDR, sec(1, vec([T_V_I, T_V_V])), sec(2, vec([IMP_MEM, IMP_TBL])), sec(3, vec([[1]])),
    sec(7, vec([cat(str('run'), [0x00], leb(0))])), sec(10, vec([dispBody]))));
}
function modBlock(blk, mode, slot, prog) {
  return Uint8Array.from(cat(HDR, sec(1, vec([T_V_I])), sec(2, vec([IMP_MEM, IMP_TBL])), sec(3, vec([[0]])),
    sec(9, vec([cat([0x00, 0x41, ...sleb(slot), 0x0b], vec([[0]]))])), sec(10, vec([blockCode(blk, mode, prog)]))));
}

// ---------- окружение гостя ----------
function makeEnv() {
  const mem = new WebAssembly.Memory({ initial: PAGES });
  const u = new Uint32Array(mem.buffer);
  for (let i = 0; i < PROG.length; i++) u[CODE / 4 + i] = PROG[i];
  for (let p = 0; p < 4096; p++) u[PT / 4 + (GBASE >>> 12) + p] = RAM + p * 4096;
  return { mem, u };
}
function reset(env, iters) {
  const u = env.u; u.fill(0, 0, 16); u[0] = iters; u[1] = GBASE;
  for (let k = 2; k < 10; k++) u[k] = seed(k);
  u[RAM / 4] = 0xdeadbeef; u[RAM / 4 + 1] = 0x01234567; u[RAM / 4 + 2] = 0;
}
function csum(regs, m) {
  let h = 0x811c9dc5;
  for (let k = 0; k < 10; k++) h = Math.imul(h ^ regs[k], 16777619) >>> 0;
  for (let k = 0; k < 3; k++) h = Math.imul(h ^ m[k], 16777619) >>> 0;
  return h;
}
const csumEnv = (env) => csum(env.u, [env.u[RAM / 4], env.u[RAM / 4 + 1], env.u[RAM / 4 + 2]]);

// эталон на чистом JS (то же, что сделал бы идеальный транслятор в JS)
function jsRef(iters) {
  let r0 = iters, r2 = seed(2) | 0, r3 = seed(3) | 0, r4 = seed(4) | 0, r5 = seed(5) | 0, r6 = seed(6) | 0, r7 = seed(7) | 0, r8 = seed(8) | 0, r9 = seed(9) | 0;
  let M0 = 0xdeadbeef | 0, M1 = 0x01234567, M2 = 0;
  do {
    r2 = M0; r3 = M1;
    r4 = (r2 + r3) | 0; r5 = r4 ^ r2; r6 = (r5 >>> 7) | (r5 << 25); r7 = (r6 + 13) | 0;
    r8 = Math.imul(r7, r3); r9 = (r8 + r4) | 0; r2 = r9 ^ r6; r3 = (r2 >>> 13) | (r2 << 19);
    r4 = (r3 + r5) | 0; r5 = (r4 + 1) | 0; r6 = r5 ^ r9; r7 = (r6 + r8) | 0;
    M2 = r7; M0 = r2; r3 = (r3 + r7) | 0; r8 = r8 ^ r3; r9 = (r9 >>> 3) | (r9 << 29); r2 = (r2 + r9) | 0;
    r0 = (r0 - 1) | 0;
  } while (r0 !== 0);
  const R = new Uint32Array(16); R[1] = GBASE; R[2] = r2; R[3] = r3; R[4] = r4; R[5] = r5; R[6] = r6; R[7] = r7; R[8] = r8; R[9] = r9;
  return csum(R, [M0 >>> 0, M1 >>> 0, M2 >>> 0]);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Number(process.hrtime.bigint()) / 1e6);
function timeRuns(fn, reps) { const ts = []; for (let i = 0; i < reps; i++) { const t = now(); fn(); ts.push(now() - t); } return ts; }
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

async function runBench(interpBytes, iters, reps, log) {
  const env = makeEnv();
  const tbl = new WebAssembly.Table({ element: 'anyfunc', initial: 4096 });
  const inst = (bytes, imports) => new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
  const E = { e: { mem: env.mem, tbl } };
  const runners = {};
  runners.js = null; // отдельная ветка
  const interp = await WebAssembly.instantiate(interpBytes, { e: { mem: env.mem } });
  runners.wasm_interp = () => interp.instance.exports.run(0);
  for (const mode of ['direct', 'paged']) {
    const loop = inst(modLoop(mode), E).exports.run; runners['loop_' + mode] = loop;
    const chain = inst(modChain(mode), E).exports.run; runners['chain_' + mode] = chain;
  }
  // J3: кросс-модульный
  const disp = inst(modDispatcher(), E).exports.run;
  for (const mode of ['direct', 'paged']) {
    CHAIN.forEach((b, i) => inst(modBlock(b, mode, i), E));
    runners['xmod_' + mode] = disp;
  }
  // на J3 слоты перезаписываются по режиму: поэтому прогоняем режимы последовательно ниже
  const result = {};
  const small = jsRef(1000), big = jsRef(iters);
  result.ref = { small: small >>> 0, big: big >>> 0 };
  // JS baseline
  { let t = now(); const c0 = jsRef(iters); const first = now() - t; const ts = timeRuns(() => jsRef(iters), reps);
    result.js_baseline = stat(first, ts, iters, c0 === big); log('js_baseline', result.js_baseline); }
  const order = ['wasm_interp', 'loop_direct', 'loop_paged', 'chain_direct', 'chain_paged', 'xmod_direct', 'xmod_paged'];
  for (const name of order) {
    if (name.startsWith('xmod_')) { const mode = name.slice(5); CHAIN.forEach((b, i) => inst(modBlock(b, mode, i), E)); }
    const fn = runners[name];
    const run = (n) => { reset(env, n); fn(name === 'wasm_interp' ? 0 : undefined); return csumEnv(env); };
    const okSmall = run(1000) === small;
    let t = now(); const c = run(iters); const first = now() - t;
    const ts = timeRuns(() => run(iters), reps);
    result[name] = stat(first, ts, iters, okSmall && c === big);
    result[name].chk1000 = run(1000) >>> 0;
    log(name, result[name]);
  }
  return result;
}
function stat(first, ts, iters, ok) {
  const best = Math.min(...ts);
  return { ok, first_ms: +first.toFixed(1), best_ms: +best.toFixed(1), median_ms: +med(ts).toFixed(1), mips_best: Math.round(PER_ITER * iters / best / 1000) };
}

// ---------- задержка компиляции «новых блоков» ----------
async function compileLatency(NB, log) {
  const env = makeEnv();
  const tbl = new WebAssembly.Table({ element: 'anyfunc', initial: 4096 });
  const E = { e: { mem: env.mem, tbl } };
  const res = { NB };
  const progs = [];
  const blk = { from: 0, to: 8, ret: B.c(1) };
  let t = now(); const mods = [];
  for (let i = 0; i < NB; i++) { const p = PROG.slice(); p[5] = enc(OP.ADDI, 7, 6, 0, i & 0xfff); p[11] = enc(OP.ADDI, 5, 4, 0, (i * 7) & 0xfff); mods.push(modBlock(blk, 'paged', i % 4096, p)); }
  res.emit_us_per_block = +((now() - t) * 1000 / NB).toFixed(1);
  res.bytes_per_block = mods[0].length;
  // синхронная компиляция
  const NS = Math.min(NB, 300);
  t = now(); const sm = []; for (let i = 0; i < NS; i++) sm.push(new WebAssembly.Module(mods[i])); res.sync_compile_us = +((now() - t) * 1000 / NS).toFixed(1);
  t = now(); for (let i = 0; i < NS; i++) new WebAssembly.Instance(sm[i], E); res.sync_instantiate_us = +((now() - t) * 1000 / NS).toFixed(1);
  // первый вызов (ленивая компиляция тела?)
  t = now(); let calls = 0; for (let i = 0; i < NS; i++) { tbl.get(i)(); calls++; } res.first_call_us = +((now() - t) * 1000 / calls).toFixed(1);
  t = now(); for (let i = 0; i < NS; i++) tbl.get(i)(); res.second_call_us = +((now() - t) * 1000 / NS).toFixed(1);
  // асинхронная компиляция пачками
  t = now(); const am = [];
  for (let i = 0; i < NB; i += 50) am.push(...await Promise.all(mods.slice(i, i + 50).map((m) => WebAssembly.compile(m))));
  res.async_compile_us = +((now() - t) * 1000 / NB).toFixed(1);
  t = now(); for (let i = 0; i < NB; i++) new WebAssembly.Instance(am[i], E); res.async_instantiate_us = +((now() - t) * 1000 / NB).toFixed(1);
  log('compileLatency', res);
  return res;
}

g.Bench = { runBench, compileLatency, jsRef, PROG, PER_ITER };
})(typeof self !== 'undefined' ? self : globalThis);
