#include <stdint.h>
typedef struct { double interp_ms, aot_ms; uint32_t chk_interp, chk_aot, small_interp, small_aot; } NativeResult;
NativeResult native_bench(uint32_t iters);
