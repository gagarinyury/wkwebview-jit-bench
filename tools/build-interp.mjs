// Генерирует Web/interp.wasm — switch-интерпретатор игрушечного ISA (см. Web/bench.js) на WAT.
import wabtInit from 'wabt';
import fs from 'node:fs';

const PT = 0x20000;   // таблица страниц гостя: u32 на страницу 4К -> смещение в wasm-памяти
const CODE = 0x1000;  // гостевой код (u32 на инструкцию)
const R = (x) => `(i32.load (local.get ${x}))`;
const EA = `(local.set $a (i32.add ${R('$rn')} (i32.shl (local.get $imm) (i32.const 2))))`;
const PTE = `(i32.load offset=${PT} (i32.shl (i32.shr_u (local.get $a) (i32.const 12)) (i32.const 2)))`;
const HOST = `(i32.add ${PTE} (i32.and (local.get $a) (i32.const 4095)))`;
const bin = (inst) => `(i32.store (local.get $rd) (${inst} ${R('$rn')} ${R('$rm')})) (br $L)`;
const bini = (inst) => `(i32.store (local.get $rd) (${inst} ${R('$rn')} (local.get $imm))) (br $L)`;

const cases = [
  `(br $done)`,                                                                            // 0 HALT
  bin('i32.add'),                                                                          // 1 ADD
  bin('i32.xor'),                                                                          // 2 EOR
  `(i32.store (local.get $rd) (i32.rotr ${R('$rn')} (i32.and (local.get $imm) (i32.const 31)))) (br $L)`, // 3 ROR
  bini('i32.add'),                                                                         // 4 ADDI
  `${EA} (i32.store (local.get $rd) (i32.load ${HOST})) (br $L)`,                          // 5 LDR
  `${EA} (i32.store ${HOST} ${R('$rd')}) (br $L)`,                                         // 6 STR
  bini('i32.sub'),                                                                         // 7 SUBI
  `(if ${R('$rd')} (then (local.set $pc (local.get $imm)))) (br $L)`,                      // 8 BNZ
  bin('i32.mul'),                                                                          // 9 MUL
];
const N = cases.length;
const reg = (sh) => `(i32.shl (i32.and (i32.shr_u (local.get $ins) (i32.const ${sh})) (i32.const 15)) (i32.const 2))`;

let wat = `(module
 (import "e" "mem" (memory 1))
 (func (export "run") (param $pc i32)
  (local $ins i32) (local $op i32) (local $rd i32) (local $rn i32) (local $rm i32) (local $imm i32) (local $a i32)
  (block $done (loop $L
    (local.set $ins (i32.load (i32.add (i32.const ${CODE}) (i32.shl (local.get $pc) (i32.const 2)))))
    (local.set $pc (i32.add (local.get $pc) (i32.const 1)))
    (local.set $op (i32.shr_u (local.get $ins) (i32.const 24)))
    (local.set $rd ${reg(20)})
    (local.set $rn ${reg(16)})
    (local.set $rm ${reg(12)})
    (local.set $imm (i32.and (local.get $ins) (i32.const 4095)))
`;
for (let i = N - 1; i >= 0; i--) wat += `(block $c${i}\n`;
wat += `(br_table ${Array.from({ length: N }, (_, i) => `$c${i}`).join(' ')} $c0 (local.get $op))\n`;
for (let i = 0; i < N; i++) wat += `)\n${cases[i]}\n`;
wat += `)))\n)\n`;

const wabt = await wabtInit();
const m = wabt.parseWat('interp.wat', wat);
m.resolveNames();
m.validate();
const { buffer } = m.toBinary({});
fs.writeFileSync(new URL('../Web/interp.wasm', import.meta.url), buffer);
fs.writeFileSync(new URL('../tools/interp.wat', import.meta.url), wat);
console.log('interp.wasm', buffer.length, 'bytes');
