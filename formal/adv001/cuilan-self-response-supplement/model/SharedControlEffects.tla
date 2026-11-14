--------------------------- MODULE SharedControlEffects ---------------------------
EXTENDS Naturals, FiniteSets
(* CS-R2补证：两用途与逐物世界保留；控制依赖按每份不可变proof捕获。
   初态是合法proposed，不是accepted故障切面。Accept代表通过其余域守卫的本人提交。
   UI历史/精确几何不在本层；动作保持同一权威原子提交要求。 *)
CONSTANTS ChangedActor, Fault, Probe
Purposes == {"appearance","private_items"}
Players == {"p1","p2"}
Actors == Players \cup {"C","W"}
Items == {"parcel","letter"}
Requests == Purposes \X (1..2)
None == <<"none",0>>
Requester(q) == IF q[2]=1 THEN "p1" ELSE "p2"
Dependencies(q) == {"C",Requester(q)} \cup IF q[1]="appearance" THEN {"W"} ELSE {}
EmptySignature == [generation|->0,epochs|->[a \in Actors|->0]]
VARIABLES stage, binding, proof, grants, slot, execution, holder, acquired, originalAcquired,
          taken, completed, disguise, used, epochs, generation, phase, restarted, e
vars == <<stage,binding,proof,grants,slot,execution,holder,acquired,originalAcquired,
          taken,completed,disguise,used,epochs,generation,phase,restarted,e>>
Signature(q) == [generation|->generation,
                epochs|->[a \in Actors|->IF a \in Dependencies(q) THEN epochs[a] ELSE 0]]
Available == phase="running"
Current(q) == q \in grants /\ stage[q]="accepted" /\ slot[q[1]]=q[2] /\ proof[q]=Signature(q)
CanUse(q) == Current(q) \/ (Fault="stale-use" /\ stage[q]="accepted")
HeldAt(h,q) == {i \in Items:h[i]=Requester(q) /\ acquired[i]=q}
Held(q) == HeldAt(holder,q)
StoppedModes(gs,h,oldModes) == [q \in Requests|->
 IF q \in gs THEN IF HeldAt(h,q)#{} THEN "return_only" ELSE "ended" ELSE oldModes[q]]
Init ==
 /\ stage=[q \in Requests|->IF q[2]=1 THEN "proposed" ELSE "absent"]
 /\ epochs=[a \in Actors|->1] /\ generation=1 /\ phase="running" /\ restarted=FALSE
 /\ binding=[q \in Requests|->IF q[2]=1 THEN Signature(q) ELSE EmptySignature]
 /\ proof=[q \in Requests|->EmptySignature] /\ grants={}
 /\ slot=[p \in Purposes|->1] /\ execution=[q \in Requests|->"none"]
 /\ holder=[i \in Items|->"origin"] /\ acquired=[i \in Items|->None] /\ originalAcquired=acquired
 /\ taken=[q \in Requests|->{}] /\ completed=[q \in Requests|->{}]
 /\ disguise=None /\ used={}
 /\ e=[badUse|->FALSE,retake|->FALSE,lostRemaining|->FALSE,controlMoved|->FALSE,
       unrelatedChanged|->FALSE,proofChanged|->FALSE,resumeChanged|->FALSE,receiptChanged|->FALSE,
       witness|->FALSE]
Accept(q) ==
 /\ Available /\ stage[q]="proposed" /\ slot[q[1]]=q[2] /\ binding[q]=Signature(q)
 /\ LET done==IF q[1]="private_items" THEN {i \in Items:holder[i]="owner"} ELSE {}
    IN /\ stage'=[stage EXCEPT ![q]="accepted"]
       /\ proof'=[proof EXCEPT ![q]=binding[q]]
       /\ grants'=IF q[1]="private_items" /\ done=Items THEN grants ELSE grants \cup {q}
       /\ execution'=[execution EXCEPT ![q]=IF q[1]="private_items" /\ done=Items THEN "ended" ELSE "ready"]
       /\ completed'=[completed EXCEPT ![q]=done]
 /\ UNCHANGED <<binding,slot,holder,acquired,originalAcquired,taken,disguise,used,epochs,generation,phase,restarted,e>>
Apply(q) ==
 /\ Available /\ q[1]="appearance" /\ CanUse(q) /\ q \notin used /\ disguise=None
 /\ disguise'=q /\ used'=used \cup {q}
 /\ execution'=[execution EXCEPT ![q]="active"]
 /\ e'=[e EXCEPT !.badUse=@ \/ ~Current(q)]
 /\ UNCHANGED <<stage,binding,proof,grants,slot,holder,acquired,originalAcquired,taken,completed,
                 epochs,generation,phase,restarted>>
Take(q,i) ==
 /\ Available /\ q[1]="private_items" /\ CanUse(q) /\ holder[i]="origin"
 /\ ((i \notin taken[q] /\ i \notin completed[q]) \/ Fault="retake")
 /\ holder'=[holder EXCEPT ![i]=Requester(q)]
 /\ acquired'=[acquired EXCEPT ![i]=q] /\ originalAcquired'=[originalAcquired EXCEPT ![i]=q]
 /\ taken'=[taken EXCEPT ![q]=@ \cup {i}]
 /\ execution'=[execution EXCEPT ![q]="active"]
 /\ e'=[e EXCEPT !.badUse=@ \/ ~Current(q),!.retake=@ \/ i \in taken[q] \/ i \in completed[q]]
 /\ UNCHANGED <<stage,binding,proof,grants,slot,completed,disguise,used,epochs,generation,phase,restarted>>
Stop(q) ==
 /\ Available /\ (q \in grants \/ stage[q]="proposed")
 /\ grants'=grants \ {q}
 /\ stage'=[stage EXCEPT ![q]=IF @="proposed" THEN "closed" ELSE @]
 /\ execution'=IF Fault="split-private" /\ q[1]="private_items" THEN execution
                ELSE StoppedModes({q},holder,execution)
 /\ disguise'=IF disguise=q /\ Fault#"split-appearance" THEN None ELSE disguise
 /\ UNCHANGED <<binding,proof,slot,holder,acquired,originalAcquired,taken,completed,used,
                 epochs,generation,phase,restarted,e>>
NewRequest(p) ==
 /\ Available /\ stage[<<p,2>>]="absent" /\ stage[<<p,1>>]#"proposed" /\ <<p,1>> \notin grants
 /\ stage'=[stage EXCEPT ![<<p,2>>]="proposed"] /\ slot'=[slot EXCEPT ![p]=2]
 /\ binding'=[binding EXCEPT ![<<p,2>>]=Signature(<<p,2>>)]
 /\ acquired'=IF Fault="reassign-acquisition" /\ p="private_items" THEN
       [i \in Items|->IF holder[i] \in Players THEN <<p,2>> ELSE acquired[i]] ELSE acquired
 /\ UNCHANGED <<proof,grants,execution,holder,originalAcquired,taken,completed,disguise,used,
                 epochs,generation,phase,restarted,e>>
Return(i,target) ==
 /\ Available /\ holder[i] \in Players /\ acquired[i]#None /\ target \in {"owner","origin"}
 /\ LET q==acquired[i]
        nh==[holder EXCEPT ![i]=target]
        nc==[x \in Requests|->IF target="owner" /\ x[1]="private_items" /\ stage[x]="accepted"
                                THEN completed[x] \cup {i} ELSE completed[x]]
        stop=={x \in grants: x[1]="private_items" /\
                   (nc[x]=Items \/ (Fault="first-closes-all" /\ target="owner"))}
        nm==[x \in Requests|->IF x \in stop \/ (x=q /\ q \notin grants /\ HeldAt(nh,q)={})
                                 THEN "ended" ELSE execution[x]]
    IN /\ holder'=nh /\ completed'=nc /\ grants'=grants \ stop /\ execution'=nm
       /\ e'=[e EXCEPT !.lostRemaining=@ \/ (q \in grants /\ nc[q]#Items /\ q \in stop)]
 /\ UNCHANGED <<stage,binding,proof,slot,acquired,originalAcquired,taken,disguise,used,
                 epochs,generation,phase,restarted>>
OwnerRepositions(i) ==
 /\ Available /\ holder[i]="owner" /\ holder'=[holder EXCEPT ![i]="origin"]
 /\ UNCHANGED <<stage,binding,proof,grants,slot,execution,acquired,originalAcquired,taken,completed,
                 disguise,used,epochs,generation,phase,restarted,e>>
ActorChange(a) ==
 /\ phase#"terminal" /\ epochs[a]=1 /\ (ChangedActor="any" \/ ChangedActor=a)
 /\ LET affected=={q \in Requests:stage[q]#"absent" /\ a \in Dependencies(q)}
        actual==IF Fault="overinvalidate" THEN {q \in Requests:stage[q]#"absent"}
                ELSE IF Fault="miss-performer" /\ a="W" THEN {}
                ELSE IF Fault="miss-subject" /\ a="C" THEN {} ELSE affected
        ng==IF Fault="refresh-proof" THEN grants ELSE grants \ actual
        nh==IF Fault="control-moves-item" THEN [i \in Items|->IF holder[i] \in Players THEN "origin" ELSE holder[i]] ELSE holder
        np==IF Fault="refresh-proof" THEN [q \in Requests|->IF q \in affected /\ stage[q]="accepted"
                  THEN [proof[q] EXCEPT !.epochs[a]=2] ELSE proof[q]] ELSE proof
    IN /\ epochs'=[epochs EXCEPT ![a]=2]
       /\ grants'=ng /\ holder'=nh /\ proof'=np
       /\ stage'=[q \in Requests|->IF q \in actual /\ stage[q]="proposed" THEN "closed" ELSE stage[q]]
       /\ execution'=IF Fault="split-private" THEN execution ELSE StoppedModes(actual,holder,execution)
       /\ disguise'=IF disguise \in actual /\ Fault#"split-appearance" /\ Fault#"refresh-proof" THEN None ELSE disguise
       /\ e'=[e EXCEPT !.unrelatedChanged=@ \/ (\E q \in grants \ affected:q \notin ng),
               !.proofChanged=@ \/ np#proof,!.controlMoved=@ \/ nh#holder,
               !.witness=@ \/ (Probe="selective-preserved" /\ (grants \ affected)#{} /\
                                  (grants \cap affected)#{} /\ ng=grants \ affected)]
 /\ UNCHANGED <<binding,slot,acquired,originalAcquired,taken,completed,used,generation,phase,restarted>>
Restart ==
 /\ phase#"terminal" /\ ~restarted
 /\ generation'=2 /\ restarted'=TRUE /\ phase'="paused"
 /\ grants'={}
 /\ stage'=[q \in Requests|->IF stage[q]="proposed" THEN "closed" ELSE stage[q]]
 /\ execution'=IF Fault="split-private" THEN execution ELSE StoppedModes({q \in Requests:stage[q]#"absent"},holder,execution)
 /\ disguise'=IF Fault="split-appearance" THEN disguise ELSE None
 /\ e'=[e EXCEPT !.witness=@ \/ (Probe="restart-dual" /\ disguise#None /\ (\E i \in Items:holder[i] \in Players))]
 /\ UNCHANGED <<binding,proof,slot,holder,acquired,originalAcquired,taken,completed,used,epochs>>
Resume ==
 /\ phase="paused" /\ phase'="running"
 /\ grants'=IF Fault="resume-reactivates" THEN {q \in Requests:stage[q]="accepted"} ELSE grants
 /\ e'=[e EXCEPT !.resumeChanged=@ \/ (Fault="resume-reactivates" /\ grants'#grants)]
 /\ UNCHANGED <<stage,binding,proof,slot,execution,holder,acquired,originalAcquired,taken,completed,
                 disguise,used,epochs,generation,restarted>>
Terminal ==
 /\ phase#"terminal" /\ phase'="terminal"
 /\ grants'=IF Fault="terminal-residue" THEN grants ELSE {}
 /\ stage'=[q \in Requests|->IF stage[q]="proposed" THEN "closed" ELSE stage[q]]
 /\ execution'=StoppedModes({q \in Requests:stage[q]#"absent"},holder,execution)
 /\ disguise'=IF Fault="terminal-residue" THEN disguise ELSE None
 /\ e'=[e EXCEPT !.witness=@ \/ (Probe="terminal-dual" /\ disguise#None /\ (\E i \in Items:holder[i] \in Players))]
 /\ UNCHANGED <<binding,proof,slot,holder,acquired,originalAcquired,taken,completed,used,epochs,generation,restarted>>
ReceiptExists(q,op) ==
 IF op="accept" THEN stage[q]="accepted"
 ELSE IF op="apply" THEN q \in used ELSE op \in taken[q]
Replay(q,op) ==
 /\ ReceiptExists(q,op)
 /\ grants'=IF Fault="receipt-reactivates" THEN grants \cup {q} ELSE grants
 /\ e'=[e EXCEPT !.receiptChanged=@ \/ grants'#grants,
          !.witness=@ \/ (Probe="late-old-take" /\ q= <<"private_items",1>> /\ op \in Items /\ slot[q[1]]=2)]
 /\ UNCHANGED <<stage,binding,proof,slot,execution,holder,acquired,originalAcquired,taken,completed,
                 disguise,used,epochs,generation,phase,restarted>>
RejectOldFirst ==
 /\ Probe="old-first-rejected" /\ Available
 /\ \E q \in Requests: stage[q]="accepted" /\ ~Current(q) /\
        ((q[1]="appearance" /\ q \notin used) \/ (q[1]="private_items" /\ taken[q]={}))
 /\ e'=[e EXCEPT !.witness=TRUE]
 /\ UNCHANGED <<stage,binding,proof,grants,slot,execution,holder,acquired,originalAcquired,taken,completed,
                 disguise,used,epochs,generation,phase,restarted>>
TypeFault == /\ Fault="type" /\ holder'=[holder EXCEPT !["parcel"]="duplicate"]
 /\ UNCHANGED <<stage,binding,proof,grants,slot,execution,acquired,originalAcquired,taken,completed,
                 disguise,used,epochs,generation,phase,restarted,e>>
Work == (\E q \in Requests:Accept(q) \/ Apply(q) \/ Stop(q))
 \/ (\E q \in Requests,i \in Items:Take(q,i))
 \/ (\E p \in Purposes:NewRequest(p))
 \/ (\E i \in Items,t \in {"owner","origin"}:Return(i,t))
 \/ (\E i \in Items:OwnerRepositions(i))
 \/ (\E a \in Actors:ActorChange(a)) \/ Restart \/ Resume \/ Terminal \/ RejectOldFirst
Idle == /\ ~ENABLED Work /\ UNCHANGED vars
Next == Work \/ (\E q \in Requests,op \in {"accept","apply"} \cup Items:Replay(q,op)) \/ TypeFault \/ Idle
Spec == Init /\ [][Next]_vars
TypeOK == holder \in [Items->{"origin","owner","p1","p2"}] /\ grants \subseteq Requests /\
          epochs \in [Actors->1..2] /\ generation \in 1..2 /\ phase \in {"running","paused","terminal"} /\
          acquired \in [Items->Requests \cup {None}] /\ taken \in [Requests->SUBSET Items] /\ completed \in [Requests->SUBSET Items]
GrantCurrent == \A q \in grants:Current(q) /\ phase#"terminal"
AtomicEffects == (disguise#None => Current(disguise) /\ phase="running") /\
 (\A q \in Requests:(q[1]="private_items" /\ Held(q)#{} /\ q \notin grants) => execution[q]="return_only")
ControlFrames == ~e.unrelatedChanged /\ ~e.proofChanged
AuthorityUse == ~e.badUse
QuotaCorrect == ~e.retake /\ ~e.lostRemaining
CustodyStable == acquired=originalAcquired /\ ~e.controlMoved
AcquisitionEvidence == \A i \in Items: holder[i] \in Players =>
 acquired[i] \in Requests /\ acquired[i][1]="private_items" /\
 Requester(acquired[i])=holder[i] /\ stage[acquired[i]]="accepted" /\ i \in taken[acquired[i]]
ResumptionReadOnly == ~e.resumeChanged
ReceiptReadOnly == ~e.receiptChanged
TerminalClosed == phase="terminal" => grants={} /\ disguise=None
NoWitness == IF Probe="two-actors-after-use" THEN
 ~(used#{} /\ (\E q \in Requests:taken[q]#{}) /\ Cardinality({a \in Actors:epochs[a]=2})>=2)
 ELSE ~e.witness
=============================================================================
