onmessage = (e) => {
  try {
    const a = new Int32Array(e.data.sab || e.data.mem.buffer);
    for (let i = 0; i < e.data.iters; i++) Atomics.add(a, 0, 1);
    postMessage(1);
  } catch (err) { postMessage({ err: String(err) }); }
};
