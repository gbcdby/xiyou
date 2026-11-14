-------------------------- MODULE PersonalProjection --------------------------
EXTENDS Naturals, FiniteSets
(* 完整权威快照接口的有限实例，不复制Vue/Socket实现。
   七个固定世界后态来自R2允许的交接序列：空手→取一件→取两件→先还一件→
   停旧许可→新槽→旧持物实际实收/放回。缓存仅接纳当前view且非回退seq。
   每份快照可任意迟到/重排/重复；旧Accepted始终可晚到。
   真正新风险是同slot/同grant但私物变化、旧槽归还、新view和收据不赋权。
   模型使用两个view抽象已有view/generation围栏；没有证明生产传输细节。 *)
CONSTANTS Outcome, Fault, Probe
Items == {"parcel","letter"}
Players == {"p1","p2"}
Indices == 0..6
Msgs == Indices \X (1..2)
HeldAt(n,i) == CASE n=0 -> "origin"
 [] n=1 -> IF i="parcel" THEN "p1" ELSE "origin"
 [] n=2 -> "p1"
 [] n \in 3..5 -> IF i="parcel" THEN "owner" ELSE "p1"
 [] OTHER -> IF i="parcel" \/ Outcome="owner" THEN "owner" ELSE "origin"
AcquiredAt(n,i) == IF n=0 \/ (n=1 /\ i="letter") THEN "none" ELSE "old-private"
TakenAt(n) == IF n=0 THEN {} ELSE IF n=1 THEN {"parcel"} ELSE Items
DoneAt(n) == IF n<3 THEN {} ELSE IF n<6 \/ Outcome="origin" THEN {"parcel"} ELSE Items
Truth(m) ==
 LET n==m[1]
     view==m[2]
     active==n<4 \/ (n=5) \/ (n=6 /\ Outcome="origin")
     slot==IF n<5 THEN "old-private" ELSE "new-private"
     rows(p)=={[item|->i,originalRequest|->"old-private",view|->view,
                  mode|->IF n<4 THEN "delivery_pending" ELSE "return_only"]:
                  i \in {x \in Items: HeldAt(n,x)=p}}
 IN [seq|->n,view|->view,slot|->slot,active|->active,
     holder|->[i \in Items|->HeldAt(n,i)],acquired|->[i \in Items|->AcquiredAt(n,i)],
     taken|->[q \in {"old-private","new-private"}|->IF q="old-private" THEN TakenAt(n) ELSE {}],
     completed|->[q \in {"old-private","new-private"}|->IF q="old-private" \/ n>=5 THEN DoneAt(n) ELSE {}],
     returns|->[p \in Players|->rows(p)]]
Snapshot(m) == LET t==Truth(m) IN
 IF Fault="current-only" /\ m[1]>=5 THEN [t EXCEPT !.returns=[p \in Players|->{}]]
 ELSE IF Fault="stale-view" THEN [t EXCEPT !.returns=
       [p \in Players|->{[x EXCEPT !.view=1]: x \in t.returns[p]}]] ELSE t
VARIABLES server, view, emitted, client, applied, history, e
vars == <<server,view,emitted,client,applied,history,e>>
Init ==
 /\ server=0 /\ view=1 /\ emitted={<<0,1>>}
 /\ client=Truth(<<0,1>>) /\ applied= <<0,1>> /\ history=FALSE
 /\ e=[badSeq|->FALSE,badView|->FALSE,lateOld|->FALSE,heldNewView|->FALSE]
Advance ==
 /\ server<6
 /\ server'=server+1
 /\ emitted'=emitted \cup {<<server+1,view>>}
 /\ UNCHANGED <<view,client,applied,history,e>>
NewView ==
 /\ view=1
 /\ view'=2 /\ emitted'=emitted \cup {<<server,2>>}
 /\ UNCHANGED <<server,client,applied,history,e>>
CanDeliver(m) == m \in emitted
Deliver(m) ==
 /\ CanDeliver(m)
 /\ LET validView==m[2]=view
        fresh==m[1]>=client.seq
        accept==(validView \/ Fault="accept-old-view") /\ (fresh \/ Fault="accept-old-seq")
    IN /\ client'=IF accept THEN Snapshot(m) ELSE client
       /\ applied'=IF accept THEN m ELSE applied
       /\ e'=[e EXCEPT !.badSeq=@ \/ (accept /\ ~fresh),!.badView=@ \/ (accept /\ ~validView),
            !.heldNewView=@ \/ (accept /\ m[1]=5 /\ m[2]=2 /\ Snapshot(m).returns["p1"]#{})]
 /\ UNCHANGED <<server,view,emitted,history>>
DeliverLatest == Deliver(<<server,view>>)
OldAccepted ==
 /\ history'=TRUE
 /\ client'=IF Fault="receipt-overwrite" THEN [client EXCEPT !.active=TRUE,!.slot="old-private"] ELSE client
 /\ e'=[e EXCEPT !.lateOld=@ \/ client.seq>=5]
 /\ UNCHANGED <<server,view,emitted,applied>>
TypeFault == /\ Fault="type" /\ server'=7 /\ UNCHANGED <<view,emitted,client,applied,history,e>>
Next == Advance \/ NewView \/ (\E m \in emitted: Deliver(m)) \/ OldAccepted \/ TypeFault
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(DeliverLatest)
TypeOK == server \in Indices /\ view \in 1..2 /\ emitted \subseteq Msgs
CompleteSnapshot == \A m \in emitted: Snapshot(m)=Truth(m)
NoRollback == ~e.badSeq
CurrentViewOnly == ~e.badView
ReceiptDoesNotChangeSnapshot == client=Snapshot(applied)
EventuallyCurrent == <>[](client=Truth(<<server,view>>))
NoWitness == CASE Probe="new-view-old-holding" -> ~e.heldNewView
 [] Probe="late-accepted" -> ~e.lateOld
 [] Probe="same-slot-change" -> ~(client.seq=2 /\ client.slot="old-private" /\ client.active /\ Cardinality(client.returns["p1"])=2)
 [] Probe="origin-not-delivered" -> ~(client.seq=6 /\ client.completed["old-private"]={"parcel"} /\ client.returns["p1"]={})
 [] OTHER -> TRUE
=============================================================================
