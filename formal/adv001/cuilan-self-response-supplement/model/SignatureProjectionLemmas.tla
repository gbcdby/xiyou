---------------------- MODULE SignatureProjectionLemmas ----------------------
EXTENDS Naturals, FiniteSets
(* 直接有限输入域检查，不是从业务初态开始的可达图。
   stored可比真实捕获域更宽：逐坐标不来自未来即可。Init域是假设的归纳前件，
   不是过滤业务可达图的CONSTRAINT；旧共享模型仍单独保留。
   等价引理只适用generation/epoch单调1->2，无回绕、无ABA。 *)
CONSTANT Fault
Purposes == {"appearance","private_items"}
Players == {"p1","p2"}
Actors == Players \cup {"C","W"}
Requests == Purposes \X (1..2)
Requester(q) == IF q[2]=1 THEN "p1" ELSE "p2"
Dependencies(q) == {"C",Requester(q)} \cup IF q[1]="appearance" THEN {"W"} ELSE {}
Sig(q,g,es) == [generation|->g,
               epochs|->[a \in Actors|->IF a \in Dependencies(q) THEN es[a] ELSE 0]]
Matches(s,q,g,es) == s=Sig(q,g,es)
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
EmptyStale == ~Matches([generation|->0,epochs|->[a \in Actors|->0]],
                      request,currentGeneration,currentEpochs)
ActorProjection ==
 \A a \in Actors:currentEpochs[a]=1 =>
   LET after==[currentEpochs EXCEPT ![a]=2]
       projected==IF Fault="skip-actor" THEN Matches(stored,request,currentGeneration,currentEpochs)
                  ELSE IF a \in Dependencies(request) THEN FALSE
                  ELSE Matches(stored,request,currentGeneration,currentEpochs)
   IN Matches(stored,request,currentGeneration,after)=projected
RestartProjection ==
 currentGeneration=1 =>
  Matches(stored,request,2,currentEpochs)=
    (IF Fault="skip-restart" THEN Matches(stored,request,1,currentEpochs) ELSE FALSE)
CaptureInDomain == NoFuture(Sig(request,currentGeneration,currentEpochs),
                            request,currentGeneration,currentEpochs)
ActorDomainClosed ==
 \A a \in Actors:currentEpochs[a]=1 =>
   NoFuture(stored,request,currentGeneration,[currentEpochs EXCEPT ![a]=2])
RestartDomainClosed ==
 currentGeneration=1 => NoFuture(stored,request,2,currentEpochs)
=============================================================================
