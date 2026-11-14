---------------------------- MODULE ReturnSnapshotCut ----------------------------
EXTENDS SharedControlEffects, ReturnSnapshotOperators
(* 从同一合法proposed初态及同一权威动作构造可达切面，不手填持物结果。
   缺少全世界/全历史客户端组合；view/可见性/current revision是有限接口参数。 *)
VARIABLES views, ownerVisible, revisions
snapshotVars == <<vars,views,ownerVisible,revisions>>
Source == [stage|->stage,proof|->proof,grants|->grants,slot|->slot,holder|->holder,
 acquired|->acquired,taken|->taken,completed|->completed,requester|->[q \in Requests|->Requester(q)]]
Now(p) == Snapshot(Source,p,views[p],ownerVisible[p],revisions,Fault)
SnapshotInit == Init /\ views=[p \in Players|->1] /\ ownerVisible \in [Players->BOOLEAN] /\ revisions=[i \in Items|->1]
WorldWork == (\E q \in Requests:Accept(q) \/ Stop(q))
 \/ (\E q \in Requests,i \in Items:Take(q,i)) \/ (\E p \in Purposes:NewRequest(p))
 \/ (\E i \in Items,t \in {"owner","origin"}:Return(i,t)) \/ (\E i \in Items:OwnerRepositions(i))
 \/ (\E q \in Requests,op \in {"accept","apply"} \cup Items:Replay(q,op))
WorldStep == WorldWork /\ UNCHANGED <<views,ownerVisible,revisions>>
Refresh(p) == /\ views[p]=1 /\ views'=[views EXCEPT ![p]=2] /\ UNCHANGED <<vars,ownerVisible,revisions>>
Visibility(p) == /\ ownerVisible'=[ownerVisible EXCEPT ![p]=~@] /\ UNCHANGED <<vars,views,revisions>>
Revise(i) == /\ revisions[i]=1 /\ revisions'=[revisions EXCEPT ![i]=2] /\ UNCHANGED <<vars,views,ownerVisible>>
SnapshotNext == WorldStep \/ (\E p \in Players:Refresh(p) \/ Visibility(p)) \/ (\E i \in Items:Revise(i))
SnapshotSpec == SnapshotInit /\ [][SnapshotNext]_snapshotVars
SnapshotType == \A p \in Players:SnapshotTyped(Source,Now(p))
ReturnCompleteness == \A p \in Players:CompleteReturns(Source,Now(p),p)
ObserverIsolation == \A p \in Players:PrivateToObserver(Source,Now(p),p)
AcquisitionIdentity == \A p \in Players:OriginalRows(Source,Now(p))
CurrentReferences == \A p \in Players:FreshRows(Now(p),p,views[p],ownerVisible[p],revisions)
ReturnTargets == \A p \in Players:NarrowTargets(Now(p))
CompleteObservable == \A p \in Players:FullTuple(Source,Now(p),p)
Mixed == holder["parcel"]="p1" /\ acquired["parcel"]= <<"private_items",1>> /\
         holder["letter"]="p2" /\ acquired["letter"]= <<"private_items",2>> /\
         <<"private_items",1>> \notin grants /\ <<"private_items",2>> \in grants
NoReturnWitness == CASE Probe="mixed-holders" -> ~Mixed
 [] Probe="mixed-new-view-null" -> ~(Mixed /\ views["p1"]=2 /\ views["p2"]=2 /\ ~ownerVisible["p1"])
 [] Probe="same-slot-two-items" -> ~(slot["private_items"]=1 /\ holder["parcel"]="p1" /\ holder["letter"]="p1")
 [] Probe="restored-not-delivered" -> ~(holder["parcel"]="origin" /\ acquired["parcel"]= <<"private_items",1>> /\
     "parcel" \in taken[<<"private_items",1>>] /\ "parcel" \notin completed[<<"private_items",1>>])
 [] OTHER -> TRUE
=============================================================================
