'use strict';
const out = document.getElementById('out');
const params = new URLSearchParams(location.search);
const phase = params.get('phase') || 'main';
const tick = () => new Promise((r) => setTimeout(r, 30));
function post(type, payload) {
  const s = JSON.stringify({ type, phase, origin: location.origin, payload });
  out.textContent += type + ' ' + JSON.stringify(payload) + '\n';
  try { window.webkit.messageHandlers.report.postMessage(s); } catch (e) {}
}
const safe = async (name, fn) => { try { post(name, await fn()); } catch (e) { post(name + '_error', String(e && e.stack || e)); } await tick(); };

async function envTest() {
  const r = {
    ua: navigator.userAgent, origin: location.origin, secureContext: isSecureContext,
    crossOriginIsolated: self.crossOriginIsolated, SharedArrayBuffer: typeof SharedArrayBuffer,
    cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory,
    webgl2: !!document.createElement('canvas').getContext('webgl2'), navigatorGpu: 'gpu' in navigator,
    docHidden: document.hidden, wasmTailCall: WebAssembly.validate(Uint8Array.from([0,0x61,0x73,0x6d,1,0,0,0, 1,4,1,0x60,0,0, 3,2,1,0, 10,6,1,4,0,0x12,0,0x0b])),
  };
  try { r.wasmSharedMemory = !!new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }); } catch (e) { r.wasmSharedMemory = String(e); }
  return r;
}
async function gpuTest() {
  if (!navigator.gpu) return { available: false };
  const r = { available: true };
  const ad = await navigator.gpu.requestAdapter(); r.adapter = !!ad; if (!ad) return r;
  const dev = await ad.requestDevice(); r.device = true;
  const l = dev.limits; r.limits = { maxBufferSize: Number(l.maxBufferSize), maxStorageBufferBindingSize: Number(l.maxStorageBufferBindingSize), maxComputeInvocationsPerWorkgroup: l.maxComputeInvocationsPerWorkgroup, maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize };
  const N = 1 << 20, bytes = N * 4;
  const buf = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const rb = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  dev.queue.writeBuffer(buf, 0, new Uint32Array(N).map((_, i) => i));
  const mod = dev.createShaderModule({ code: '@group(0) @binding(0) var<storage,read_write> d: array<u32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>){ d[id.x]=d[id.x]*2u+1u; }' });
  const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
  const t = performance.now();
  const enc = dev.createCommandEncoder(); const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(N / 64); p.end();
  enc.copyBufferToBuffer(buf, 0, rb, 0, bytes); dev.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const a = new Uint32Array(rb.getMappedRange());
  r.computeOk = a[5] === 11 && a[N - 1] === ((N - 1) * 2 + 1) >>> 0; r.computeMs = +(performance.now() - t).toFixed(1);
  return r;
}
async function threadsTest() {
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const sab = hasSAB ? new SharedArrayBuffer(8) : mem.buffer;
  const arr = new Int32Array(sab), N = 2, iters = 1e6;
  const r = { hasSAB, sharedBufferCtor: sab.constructor.name, bufferIsShared: Object.prototype.toString.call(sab) };
  const t = performance.now();
  const ws = [...Array(N)].map(() => new Worker('worker.js'));
  await Promise.all(ws.map((w) => new Promise((res, rej) => { w.onmessage = (e) => (e.data && e.data.err ? rej(new Error(e.data.err)) : res()); w.onerror = (e) => rej(new Error('worker error ' + (e.message || ''))); w.postMessage(hasSAB ? { sab, iters } : { mem, iters }); })));
  ws.forEach((w) => w.terminate());
  r.ok = Atomics.load(arr, 0) === N * iters; r.ms = +(performance.now() - t).toFixed(1);
  return r;
}
async function ipcTest() {
  const r = {};
  const n = 300; let t = performance.now();
  for (let i = 0; i < n; i++) { const x = new XMLHttpRequest(); x.open('GET', '/echo?' + i, false); x.send(); }
  r.syncXhr_us = +((performance.now() - t) * 1000 / n).toFixed(0);
  t = performance.now(); for (let i = 0; i < n; i++) { await (await fetch('/echo?' + i)).arrayBuffer(); }
  r.fetch_us = +((performance.now() - t) * 1000 / n).toFixed(0);
  t = performance.now(); const b = await (await fetch('/blob?' + Math.random())).arrayBuffer(); const ms = performance.now() - t;
  r.blob_MB = b.byteLength >> 20; r.blob_MBps = Math.round((b.byteLength / 1048576) / (ms / 1000));
  return r;
}
async function memTest() {
  const mem = new WebAssembly.Memory({ initial: 2048, maximum: 65536 }); // 128 МБ
  let mb = 128; post('mem_try', { mb });
  for (;;) {
    new Uint8Array(mem.buffer).fill(1); // трогаем все страницы, иначе память не «занята»
    post('mem_ok', { mb }); await tick();
    if (mb >= 4096) break;
    try { mem.grow(2048); mb += 128; } catch (e) { post('mem_grow_failed', { mb, e: String(e) }); break; }
    post('mem_try', { mb });
  }
}

(async () => {
  post('start', { phase, hidden: document.hidden });
  if (phase === 'mem') { await safe('mem', memTest); post('done', {}); return; }
  await safe('env', envTest);
  await safe('gpu', gpuTest);
  await safe('threads', threadsTest);
  await safe('ipc', ipcTest);
  const interp = new Uint8Array(await (await fetch('interp.wasm')).arrayBuffer());
  await safe('bench', () => Bench.runBench(interp, 2_000_000, 5, (n, s) => post('bench_' + n, s)));
  await safe('compileLatency', () => Bench.compileLatency(1000, () => {}));
  post('done', {});
})();
