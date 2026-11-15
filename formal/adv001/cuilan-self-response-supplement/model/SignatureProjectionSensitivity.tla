---------------------- MODULE SignatureProjectionSensitivity ----------------------
EXTENDS Naturals, FiniteSets
(* 直接有限输入域检查，不是从业务初态开始的可达图。
   stored可比真实捕获域更宽：逐坐标不来自未来即可。Init域是假设的归纳前件，
   不是过滤业务可达图的CONSTRAINT；旧共享模型仍单独保留。
   等价引理只适用generation/epoch单调1->2，无回绕、无ABA。 *)
(* R-ISSUE62-STD-001 独立故障副本：原输入域、断言方向和两个旧故障分支不变。
   Fault=none 时以下构造函数展开为固定原模块表达式；错误仅修改被检查的输入构造，
   不把断言反置或改为FALSE。原SignatureProjectionLemmas及旧证据不修改。 *)
CONSTANT Fault
Purposes == {"appearance","private_items"}
Players == {"p1","p2"}
Actors == Players \cup {"C","W"}
Requests == Purposes \X (1..2)
Requester(q) == IF q[2]=1 THEN "p1" ELSE "p2"
Dependencies(q) == {"C",Requester(q)} \cup IF q[1]="appearance" THEN {"W"} ELSE {}
ReferenceSig(q,g,es) == [generation|->g,
               epochs|->[a \in Actors|->IF a \in Dependencies(q) THEN es[a] ELSE 0]]
(* 捕获时读错旧代号，或把尚未发生的C控制版本提前写进proof。 *)
Sig(q,g,es) ==
 IF Fault="capture-stale-generation" THEN ReferenceSig(q,g-1,es)
 ELSE IF Fault="capture-future-epoch" THEN
      [ReferenceSig(q,g,es) EXCEPT !.epochs["C"]=es["C"]+1]
 ELSE ReferenceSig(q,g,es)
(* 未建立proof却错误填入当前签名，会把空值当成可用的证明。 *)
EmptySignature(q,g,es) ==
 IF Fault="empty-is-current" THEN ReferenceSig(q,g,es)
 ELSE [generation|->0,epochs|->[a \in Actors|->0]]
(* 控制/恢复错误地重置计数器；旧捕获值遂来自新环境的未来。 *)
AdvanceEpoch(es,a) == [es EXCEPT ![a]=IF Fault="actor-epoch-rollback" THEN 0 ELSE 2]
RestartGeneration(g) == IF Fault="restart-generation-rollback" THEN 0 ELSE 2
Matches(s,q,g,es) == s=ReferenceSig(q,g,es)
NoFuture(s,q,g,es) ==
 /\ s.generation \in 0..g
 /\ s.epochs \in [Actors->0..2]
 /\ \A a \in Actors:
      IF a \in Dependencies(q) THEN s.epochs[a]<=es[a] ELSE s.epochs[a]=0
VARIABLES request, currentGeneration, currentEpochs, stored
vars == <<request,currentGeneration,currentEpochs,stored>>
Init ==
 /\ request \in Requests
 /\ currentGeneration \in 1..2
 /\ currentEpochs \in [Actors->1..2]
 /\ stored \in [generation:0..currentGeneration,epochs:[Actors->0..2]]
 /\ NoFuture(stored,request,currentGeneration,currentEpochs)
(* 输入点已是本函数检查的合法终态；不在此声明业务进展或死锁。 *)
Next == UNCHANGED vars
Spec == Init /\ [][Next]_vars
CaptureMatches == Matches(Sig(request,currentGeneration,currentEpochs),
                           request,currentGeneration,currentEpochs)
EmptyStale == ~Matches(EmptySignature(request,currentGeneration,currentEpochs),
                      request,currentGeneration,currentEpochs)
ActorProjection ==
 \A a \in Actors:currentEpochs[a]=1 =>
   LET after==AdvanceEpoch(currentEpochs,a)
       projected==IF Fault="skip-actor" THEN Matches(stored,request,currentGeneration,currentEpochs)
                  ELSE IF a \in Dependencies(request) THEN FALSE
                  ELSE Matches(stored,request,currentGeneration,currentEpochs)
   IN Matches(stored,request,currentGeneration,after)=projected
RestartProjection ==
 currentGeneration=1 =>
  Matches(stored,request,RestartGeneration(currentGeneration),currentEpochs)=
    (IF Fault="skip-restart" THEN Matches(stored,request,1,currentEpochs) ELSE FALSE)
CaptureInDomain == NoFuture(Sig(request,currentGeneration,currentEpochs),
                            request,currentGeneration,currentEpochs)
ActorDomainClosed ==
 \A a \in Actors:currentEpochs[a]=1 =>
   NoFuture(stored,request,currentGeneration,AdvanceEpoch(currentEpochs,a))
RestartDomainClosed ==
 currentGeneration=1 => NoFuture(stored,request,RestartGeneration(currentGeneration),currentEpochs)
=============================================================================
