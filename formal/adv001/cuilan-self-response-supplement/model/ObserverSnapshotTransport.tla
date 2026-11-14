------------------------- MODULE ObserverSnapshotTransport -------------------------
EXTENDS Naturals, FiniteSets
(* 参数化传输：body是完整且已按observer过滤的快照，不读取其业务字段。
   <<observer,seq,view>> 是该完整payload的注入标签；同一slot也可有不同body。
   此抽象保留整体替换/equality，不能证明生产序列缺口或具体DTO序列化。 *)
CONSTANTS Fault, Probe
Players == {"p1","p2"}
Msgs == Players \X (0..2) \X (1..2)
Body(m) == <<m[1],m[2],m[3],"complete-observer-snapshot">>
VARIABLES server, views, emitted, cache, applied, history, e
vars == <<server,views,emitted,cache,applied,history,e>>
Init ==
 /\ server=0 /\ views=[p \in Players|->1]
 /\ emitted={<<p,0,1>>:p \in Players}
 /\ applied=[p \in Players|-><<p,0,1>>] /\ cache=[p \in Players|->Body(<<p,0,1>>)]
 /\ history=FALSE /\ e=[wrongObserver|->FALSE,oldView|->FALSE,oldSeq|->FALSE,receiptWrite|->FALSE,witness|->FALSE]
ChangeWorld ==
 /\ server<2 /\ server'=server+1
 /\ emitted'=IF Fault="miss-same-slot" THEN emitted ELSE emitted \cup {<<p,server+1,views[p]>>:p \in Players}
 /\ UNCHANGED <<views,cache,applied,history,e>>
NewView(p) ==
 /\ views[p]=1 /\ views'=[views EXCEPT ![p]=2]
 /\ emitted'=emitted \cup {<<p,server,2>>}
 /\ UNCHANGED <<server,cache,applied,history,e>>
Deliver(p,m) ==
 /\ m \in emitted
 /\ LET own==m[1]=p
        current==m[3]=views[p]
        fresh==m[2]>=applied[p][2]
        accept==(own \/ Fault="wrong-observer") /\ (current \/ Fault="old-view") /\ (fresh \/ Fault="old-seq")
    IN /\ applied'=IF accept THEN [applied EXCEPT ![p]=m] ELSE applied
       /\ cache'=IF accept /\ Fault#"partial-payload" THEN [cache EXCEPT ![p]=Body(m)] ELSE cache
       /\ e'=[e EXCEPT !.wrongObserver=@ \/ (accept /\ ~own),!.oldView=@ \/ (accept /\ ~current),
                 !.oldSeq=@ \/ (accept /\ ~fresh),
                 !.witness=@ \/ (Probe="both-observers-current" /\ accept /\ m[2]=2 /\ m[3]=2 /\
                    (\E other \in Players \ {p}:applied[other]= <<other,2,2>>))]
 /\ UNCHANGED <<server,views,emitted,history>>
DeliverLatest(p) == Deliver(p,<<p,server,views[p]>>)
OldAccepted(p) ==
 /\ history'=TRUE
 /\ cache'=IF Fault="receipt-overwrite" THEN [cache EXCEPT ![p]=Body(<<p,0,1>>)] ELSE cache
 /\ e'=[e EXCEPT !.receiptWrite=@ \/ (Fault="receipt-overwrite" /\ cache'#cache),
        !.witness=@ \/ (Probe="late-old-accepted" /\ applied[p][2]=2)]
 /\ UNCHANGED <<server,views,emitted,applied>>
TypeFault == /\ Fault="type" /\ server'=3 /\ UNCHANGED <<views,emitted,cache,applied,history,e>>
Next == ChangeWorld \/ (\E p \in Players:NewView(p) \/ OldAccepted(p)) \/
        (\E p \in Players,m \in emitted:Deliver(p,m)) \/ TypeFault
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ \A p \in Players:WF_vars(DeliverLatest(p))
TypeOK == server \in 0..2 /\ views \in [Players->1..2] /\ emitted \subseteq Msgs
ObserverBound == ~e.wrongObserver
ViewBound == ~e.oldView
NoRollback == ~e.oldSeq
WholeSnapshot == \A p \in Players:cache[p]=Body(applied[p])
ReceiptReadOnly == ~e.receiptWrite
EventuallyCurrent == <>[](\A p \in Players:applied[p]= <<p,server,views[p]>> /\ cache[p]=Body(applied[p]))
NoTransportWitness == ~e.witness
=============================================================================
