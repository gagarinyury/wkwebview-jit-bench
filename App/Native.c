// Тот же игрушечный ISA, что в Web/bench.js: нативный threaded-интерпретатор (computed goto) и «AOT» (то же, скомпилированное clang -O3).
#include "Native.h"
#include <stdlib.h>
#include <string.h>
#include <mach/mach_time.h>

#define GBASE 0x08000000u
#define ENC(op,rd,rn,rm,imm) (((uint32_t)(op)<<24)|((rd)<<20)|((rn)<<16)|((rm)<<12)|((imm)&0xfff))
static const uint32_t PROG[23] = {
  ENC(5,2,1,0,0),ENC(5,3,1,0,1),ENC(1,4,2,3,0),ENC(2,5,4,2,0),ENC(3,6,5,0,7),ENC(4,7,6,0,13),ENC(9,8,7,3,0),ENC(1,9,8,4,0),
  ENC(2,2,9,6,0),ENC(3,3,2,0,13),ENC(1,4,3,5,0),ENC(4,5,4,0,1),ENC(2,6,5,9,0),ENC(1,7,6,8,0),ENC(6,7,1,0,2),ENC(6,2,1,0,0),
  ENC(1,3,3,7,0),ENC(2,8,8,3,0),ENC(3,9,9,0,3),ENC(1,2,2,9,0),ENC(7,0,0,0,1),ENC(8,0,0,0,0),ENC(0,0,0,0,0)};

static double now_ms(void){ static mach_timebase_info_data_t tb; if(!tb.denom) mach_timebase_info(&tb); return (double)mach_absolute_time()*tb.numer/tb.denom/1e6; }
#define LD(a) (*(uint32_t*)(pt[(a)>>12]+((a)&4095)))
#define ST(a,v) (*(uint32_t*)(pt[(a)>>12]+((a)&4095))=(v))
static inline uint32_t ror(uint32_t x,uint32_t n){ n&=31; return (x>>n)|(x<<((32-n)&31)); }

static uint32_t checksum(const uint32_t *R, uint8_t **pt){
  uint32_t h=0x811c9dc5u; for(int k=0;k<10;k++) h=(h^R[k])*16777619u;
  for(int k=0;k<3;k++){ uint32_t a=GBASE+4*k; h=(h^LD(a))*16777619u; } return h;
}
static void reset(uint32_t *R, uint8_t **pt, uint32_t iters){
  memset(R,0,16*4); R[0]=iters; R[1]=GBASE; for(uint32_t k=2;k<10;k++) R[k]=k*0x01234567u+1;
  ST(GBASE,0xdeadbeefu); ST(GBASE+4,0x01234567u); ST(GBASE+8,0);
}
__attribute__((noinline)) static void interp(const uint32_t *code, uint32_t *R, uint8_t **pt){
  static void *T[]={&&HALT,&&ADD,&&EOR,&&ROR,&&ADDI,&&LDR,&&STR,&&SUBI,&&BNZ,&&MUL};
  uint32_t pc=0, ins;
  #define NEXT do{ ins=code[pc++]; goto *T[ins>>24]; }while(0)
  #define RD ((ins>>20)&15)
  #define RN ((ins>>16)&15)
  #define RM ((ins>>12)&15)
  #define IMM (ins&4095)
  NEXT;
  ADD: R[RD]=R[RN]+R[RM]; NEXT;
  EOR: R[RD]=R[RN]^R[RM]; NEXT;
  ROR: R[RD]=ror(R[RN],IMM); NEXT;
  ADDI: R[RD]=R[RN]+IMM; NEXT;
  LDR: { uint32_t a=R[RN]+IMM*4; R[RD]=LD(a); } NEXT;
  STR: { uint32_t a=R[RN]+IMM*4; ST(a,R[RD]); } NEXT;
  SUBI: R[RD]=R[RN]-IMM; NEXT;
  BNZ: if(R[RD]) pc=IMM; NEXT;
  MUL: R[RD]=R[RN]*R[RM]; NEXT;
  HALT: return;
}
__attribute__((noinline)) static void aot(uint32_t *R, uint8_t **pt){
  uint32_t r0=R[0],r1=R[1],r2=R[2],r3=R[3],r4=R[4],r5=R[5],r6=R[6],r7=R[7],r8=R[8],r9=R[9];
  do{
    uint32_t a;
    a=r1+0;  r2=LD(a); a=r1+4; r3=LD(a);
    r4=r2+r3; r5=r4^r2; r6=ror(r5,7); r7=r6+13; r8=r7*r3; r9=r8+r4; r2=r9^r6; r3=ror(r2,13);
    r4=r3+r5; r5=r4+1; r6=r5^r9; r7=r6+r8;
    a=r1+8; ST(a,r7); a=r1+0; ST(a,r2);
    r3=r3+r7; r8=r8^r3; r9=ror(r9,3); r2=r2+r9; r0=r0-1;
  }while(r0);
  R[0]=r0;R[2]=r2;R[3]=r3;R[4]=r4;R[5]=r5;R[6]=r6;R[7]=r7;R[8]=r8;R[9]=r9;
}
NativeResult native_bench(uint32_t iters){
  NativeResult res; memset(&res,0,sizeof res);
  uint8_t **pt=calloc(1u<<20,sizeof(void*)); uint8_t *ram=calloc(1,16u<<20);
  for(uint32_t p=0;p<4096;p++) pt[(GBASE>>12)+p]=ram+p*4096;
  uint32_t R[16];
  reset(R,pt,1000); interp(PROG,R,pt); res.small_interp=checksum(R,pt);
  reset(R,pt,1000); aot(R,pt); res.small_aot=checksum(R,pt);
  double best=1e18; for(int i=0;i<5;i++){ reset(R,pt,iters); double t=now_ms(); interp(PROG,R,pt); double d=now_ms()-t; if(d<best)best=d; }
  res.interp_ms=best; res.chk_interp=checksum(R,pt);
  best=1e18; for(int i=0;i<5;i++){ reset(R,pt,iters); double t=now_ms(); aot(R,pt); double d=now_ms()-t; if(d<best)best=d; }
  res.aot_ms=best; res.chk_aot=checksum(R,pt);
  free(pt); free(ram); return res;
}
