import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../Web/bench.js', import.meta.url), 'utf8');
vm.runInThisContext(src);
const bytes = fs.readFileSync(new URL('../Web/interp.wasm', import.meta.url));
const r = await Bench.runBench(bytes, 300000, 3, (n, s) => console.log(n, JSON.stringify(s)));
const c = await Bench.compileLatency(400, (n, s) => console.log(n, JSON.stringify(s)));
