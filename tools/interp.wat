(module
 (import "e" "mem" (memory 1))
 (func (export "run") (param $pc i32)
  (local $ins i32) (local $op i32) (local $rd i32) (local $rn i32) (local $rm i32) (local $imm i32) (local $a i32)
  (block $done (loop $L
    (local.set $ins (i32.load (i32.add (i32.const 4096) (i32.shl (local.get $pc) (i32.const 2)))))
    (local.set $pc (i32.add (local.get $pc) (i32.const 1)))
    (local.set $op (i32.shr_u (local.get $ins) (i32.const 24)))
    (local.set $rd (i32.shl (i32.and (i32.shr_u (local.get $ins) (i32.const 20)) (i32.const 15)) (i32.const 2)))
    (local.set $rn (i32.shl (i32.and (i32.shr_u (local.get $ins) (i32.const 16)) (i32.const 15)) (i32.const 2)))
    (local.set $rm (i32.shl (i32.and (i32.shr_u (local.get $ins) (i32.const 12)) (i32.const 15)) (i32.const 2)))
    (local.set $imm (i32.and (local.get $ins) (i32.const 4095)))
(block $c9
(block $c8
(block $c7
(block $c6
(block $c5
(block $c4
(block $c3
(block $c2
(block $c1
(block $c0
(br_table $c0 $c1 $c2 $c3 $c4 $c5 $c6 $c7 $c8 $c9 $c0 (local.get $op))
)
(br $done)
)
(i32.store (local.get $rd) (i32.add (i32.load (local.get $rn)) (i32.load (local.get $rm)))) (br $L)
)
(i32.store (local.get $rd) (i32.xor (i32.load (local.get $rn)) (i32.load (local.get $rm)))) (br $L)
)
(i32.store (local.get $rd) (i32.rotr (i32.load (local.get $rn)) (i32.and (local.get $imm) (i32.const 31)))) (br $L)
)
(i32.store (local.get $rd) (i32.add (i32.load (local.get $rn)) (local.get $imm))) (br $L)
)
(local.set $a (i32.add (i32.load (local.get $rn)) (i32.shl (local.get $imm) (i32.const 2)))) (i32.store (local.get $rd) (i32.load (i32.add (i32.load offset=131072 (i32.shl (i32.shr_u (local.get $a) (i32.const 12)) (i32.const 2))) (i32.and (local.get $a) (i32.const 4095))))) (br $L)
)
(local.set $a (i32.add (i32.load (local.get $rn)) (i32.shl (local.get $imm) (i32.const 2)))) (i32.store (i32.add (i32.load offset=131072 (i32.shl (i32.shr_u (local.get $a) (i32.const 12)) (i32.const 2))) (i32.and (local.get $a) (i32.const 4095))) (i32.load (local.get $rd))) (br $L)
)
(i32.store (local.get $rd) (i32.sub (i32.load (local.get $rn)) (local.get $imm))) (br $L)
)
(if (i32.load (local.get $rd)) (then (local.set $pc (local.get $imm)))) (br $L)
)
(i32.store (local.get $rd) (i32.mul (i32.load (local.get $rn)) (i32.load (local.get $rm)))) (br $L)
)))
)
