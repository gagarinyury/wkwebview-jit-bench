# wkwebview-jit-bench

**Does JIT work inside `WKWebView` on a stock, non-jailbroken iPhone — and how much faster is it than an interpreter?**

Third-party iOS apps cannot mark memory executable, so emulators that ship through the App Store are stuck with interpreters. `WKWebView` runs in a separate WebContent process that *does* hold the JIT entitlement. This repo measures what that is actually worth for an emulator-style workload: guest code translated to **WebAssembly at runtime**, compiled by WebKit's JIT.

Short answer, measured on an **iPhone Air (A19 Pro), iOS 27.0.1**, App built with a normal development certificate, no jailbreak, no debugger attached:

| | guest MIPS | vs. native interpreter |
|---|---:|---:|
| Native threaded interpreter (C, `goto *`, clang -O3) — the best you can do without JIT | **1 524** | 1.0× |
| Interpreter compiled to WASM, running in WKWebView | 1 467 | 1.0× |
| WASM recompiler, 8-instruction blocks, `call_indirect` dispatcher | 3 143 – 3 667 | **2.1 – 2.4×** |
| WASM recompiler, every block its own module (how a real JIT adds code on the fly) | 2 588 – 2 933 | 1.7 – 1.9× |
| WASM recompiler, hot loop translated as one unit | ~8 800 ¹ | ~5.8× |
| *Reference: native AOT (clang -O3), same ISA* | 10 110 | 6.6× |

¹ Safari coarsens `performance.now()` to ~1 ms and this run takes 5 ms, so treat this row as ±20 %.

Every variant produces the same checksum as a reference implementation, so the numbers compare equal work.

## What else turned out to work (all inside `WKWebView`, third-party app)

| Capability | Result |
|---|---|
| JIT-compiled WASM | works; hot code reaches ~87 % of native AOT in the best case |
| WebGPU | available, compute shader ran and returned correct data |
| Threads | **work through a shared `WebAssembly.Memory`** passed to Workers (2 workers, atomics correct). Under a custom URL scheme the global `SharedArrayBuffer` constructor is hidden even though `crossOriginIsolated === true`; over `http://127.0.0.1` it is visible |
| Host ↔ page round trip | custom `WKURLSchemeHandler`: ~70–110 µs per sync XHR / fetch, ~3 GB/s bulk. Loopback HTTP server: ~490 µs, ~0.9 GB/s. Use the scheme handler |
| WASM module compile cost | ~20 µs per 276-byte block (sync), ~4 µs async; instantiate 2–3 µs |
| Memory ceiling | WebContent survived ~1.9 GB of touched wasm memory; killed at 2 048 MB |
| WASM tail calls | `WebAssembly.validate` accepts `return_call` |

Raw logs: [`results/`](results/).

## What is being measured

A toy 32-bit ISA (10 operations, 16 registers, loads/stores through a 4 KB-page table — i.e. software MMU as in any emulator without `mmap`). The guest program is a 22-instruction loop with two loads, one store, a multiply and rotates. See [`Web/bench.js`](Web/bench.js).

Variants:

- `wasm_interp` — switch interpreter written in WAT ([`tools/build-interp.mjs`](tools/build-interp.mjs)).
- `loop_*` — the whole hot loop translated to one WASM function, guest registers in WASM locals.
- `chain_*` — 3 blocks (8/8/6 instructions), registers loaded/stored at block boundaries, dispatcher loop with `call_indirect`.
- `xmod_*` — as `chain`, but the dispatcher and each block are separate modules sharing one imported `WebAssembly.Table`; blocks register themselves through element segments. This is the layout a real incremental JIT needs.
- `*_direct` / `*_paged` — address masking vs. page-table lookup.
- Native (`App/Native.c`) — the same ISA as a computed-goto interpreter and as straight C.

The translator is a ~100-line hand-written WASM binary emitter, no toolchain at runtime.

## Reproduce

Requires Xcode, `xcodegen` (`brew install xcodegen`), Node, an iPhone with Developer Mode on.

```sh
npm install                      # wabt, only to rebuild Web/interp.wasm
node tools/test-node.mjs         # correctness check in Node (V8); all variants must print "ok": true

xcodegen generate
xcodebuild -project JitSpike.xcodeproj -scheme JitSpike -configuration Release \
  -destination 'id=<DEVICE_UDID>' -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=<TEAM_ID> PRODUCT_BUNDLE_IDENTIFIER=<your.bundle.id> \
  -derivedDataPath build build
xcrun devicectl device install app --device <DEVICE_UDID> build/Build/Products/Release-iphoneos/JitSpike.app

# unlock the phone and keep the app in the foreground (a backgrounded WebView is throttled)
xcrun devicectl device process launch --device <DEVICE_UDID> --console --terminate-existing \
  <your.bundle.id> -- -origin scheme -native 1       # custom URL scheme + native baseline
#                      -origin http                   # 127.0.0.1 server with COOP/COEP headers
#                      -phase mem                     # memory ceiling test (the WebView is expected to be killed)
```

Output lines start with `SPIKE|`; `tools/show-results.py <log>` prints them readably.

## Caveats — please read before quoting the numbers

- **The ISA is a toy.** No condition flags, no conditional execution, no Thumb, no FPU. A real ARM translator does more work per guest instruction, and so does a real interpreter. The *ratios* need to be re-measured on real guest code; they are not a prediction for any particular emulator.
- One device, one OS build, one run set. `performance.now()` is coarse in Safari.
- Single-threaded guest. The thread results only show that the primitives work.
- This says nothing about **App Store review**. Apple's guidelines (2.5.2, 4.7) do not mention this technique, and I found no shipped app that uses it. Treat it as unverified.
- JIT in `WKWebView` is a WebKit behaviour, not a documented API guarantee; it could change.

## Why this exists / what's next

Goal: a Nintendo 3DS-class emulator that runs at useful speed on an iPhone without the JIT entitlement. The plan is to fork [Panda3DS](https://github.com/wheremyfoodat/Panda3DS) (GPL-3.0), reuse Dynarmic's ARM front end and IR (0BSD), and write the one missing piece: an IR → WASM backend. This repo is the feasibility check for that plan.

## Notes

Not affiliated with Apple or Nintendo. No game data, firmware or keys are in this repository.

License: MIT.
