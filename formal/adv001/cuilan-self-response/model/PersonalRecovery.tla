------------------------- MODULE PersonalRecovery -------------------------
EXTENDS Naturals, Sequences, FiniteSets
(* 一个 scene 控制器、两用途语义、一个旧/新请求窗口。
   task 是已经由当前领域状态允许评估的语义步骤，不在此模型决定 accept。
   首次提交前超时、COMMIT 后返回丢失、旧 Receipt 优先、重启、通知重复乱序分别建模。
   源码的精确水位算法仍由旧 SceneRequest 负责；本模型只扩充两用途义务。
   epoch 恢复后新 basis 的合法性依赖 PersonalConsent；不把旧 proposed 自动变 accept。
   活性公平性只针对稳定运行下的内部工作/持久通知，不强迫玩家/NPC 让路。 *)
CONSTANTS Focus, MaxIntents, FailuresBefore, FailuresAfter, AllowRestart, Fault, Probe
Purposes == {"appearance","private_items"}
OtherPurpose == CHOOSE p \in Purposes: p#Focus
Tasks == 1..3
Purpose(t) == IF t=2 THEN OtherPurpose ELSE Focus
Ids == 1..MaxIntents
NoneReceipt == [status|->"none",task|->0,epoch|->0]
VARIABLES w,d,a,delivered,e
vars == <<w,d,a,delivered,e>>
InitialPending == [p \in Purposes|->IF p=Focus THEN 1 ELSE 2]
Init ==
 /\ w=[current|->InitialPending,epoch|->1,running|->TRUE,newInput|->FALSE,restarted|->FALSE]
 /\ d=[requests|-><<>>,originals|-><<>>,receipts|->[i \in Ids|->NoneReceipt],
       originalReceipts|->[i \in Ids|->NoneReceipt],outcomes|->[i \in Ids|->"none"],
       effects|->[t \in Tasks|->0],finished|->{}]
 /\ a=[phase|->"idle",id|->0,pending|->InitialPending,
       known|->InitialPending,retries|->0,before|->0,after|->0,reply|->NoneReceipt,manual|->FALSE]
 /\ delivered=0
 /\ e=[lostCommitted|->FALSE,lostUncommitted|->FALSE,recovered|->FALSE,
       newWhileUnknown|->FALSE,badReceipt|->FALSE,changedOriginal|->FALSE]
Unsettled == {i \in 1..Len(d.requests): d.outcomes[i]="none"}
TaskOf(i) == d.requests[i].task
Need(p) == a.known[p]=w.current[p] /\ a.known[p] \notin d.finished
Candidates == {p \in Purposes: a.pending[p]=w.current[p] /\ Need(p)}
ReserveWanted == a.phase="idle" /\ w.running /\ Candidates#{}
FreshTask(p) == a.pending[p]
Reserve(p) ==
 /\ ReserveWanted /\ p \in Candidates /\ Len(d.requests)<MaxIntents
 /\ (Unsettled={} \/ Fault="unknown-new-id")
 /\ LET id==Len(d.requests)+1
        req==[id|->id,task|->FreshTask(p),purpose|->p,epoch|->w.epoch,
               raw|-><<FreshTask(p),w.epoch,id>>,previous|->IF Len(d.requests)=0 THEN 0 ELSE Len(d.requests)]
    IN /\ d'=[d EXCEPT !.requests=Append(@,req),!.originals=Append(@,req)]
       /\ a'=[a EXCEPT !.id=id,!.phase="submit",!.retries=0,!.manual=FALSE]
 /\ UNCHANGED <<w,delivered,e>>
Commit ==
 /\ a.phase="submit"
 /\ LET id==a.id
        req==d.requests[id]
        prior==d.receipts[id]
        valid==w.running /\ req.epoch=w.epoch /\ req.task=w.current[req.purpose]
        result==IF prior.status#"none" THEN prior
          ELSE [status|->IF valid THEN "Accepted" ELSE "Rejected",task|->req.task,epoch|->w.epoch]
        addEffect==(prior.status="none" /\ valid) \/
                     (Fault="repeat-effect" /\ prior.status="Accepted")
    IN /\ d'=[d EXCEPT !.receipts[id]=result,!.originalReceipts[id]=IF prior.status="none" THEN result ELSE @,
              !.effects[req.task]=IF addEffect THEN @+1 ELSE @]
       /\ a'=[a EXCEPT !.phase="reply",!.reply=result]
 /\ UNCHANGED <<w,delivered,e>>
LoseBefore ==
 /\ a.phase="submit" /\ a.before<FailuresBefore /\ d.receipts[a.id].status="none"
 /\ a'=[a EXCEPT !.phase="unknown",!.before=@+1]
 /\ e'=[e EXCEPT !.lostUncommitted=TRUE]
 /\ UNCHANGED <<w,d,delivered>>
LoseAfter ==
 /\ a.phase="reply" /\ a.after<FailuresAfter
 /\ a'=[a EXCEPT !.phase="unknown",!.after=@+1]
 /\ e'=[e EXCEPT !.lostCommitted=TRUE]
 /\ UNCHANGED <<w,d,delivered>>
Recover ==
 /\ a.phase="unknown" /\ ~a.manual
 /\ LET prior==d.receipts[a.id]
        req==d.requests[a.id]
        wrong==Fault="receipt-after-validation" /\ prior.status="Accepted" /\ req.epoch#w.epoch
        rewritten==Fault="rewrite-original" /\ prior.status="none" /\ req.epoch#w.epoch
    IN /\ a'=[a EXCEPT !.phase=IF prior.status#"none" THEN "reply"
                  ELSE IF a.retries<3 THEN "submit" ELSE "unknown",
              !.reply=IF wrong THEN [prior EXCEPT !.status="Rejected"] ELSE prior,
              !.retries=IF prior.status="none" /\ a.retries<3 THEN @+1 ELSE @,
              !.manual=prior.status="none" /\ a.retries=3,
              !.pending=IF Fault="recovery-drops-other" THEN [p \in Purposes|->0] ELSE @]
       /\ d'=IF rewritten THEN [d EXCEPT !.requests[a.id]=[req EXCEPT !.epoch=w.epoch,
                    !.raw= <<req.task,w.epoch,req.id>>]] ELSE d
       /\ e'=[e EXCEPT !.recovered=TRUE,!.badReceipt=@ \/ wrong,!.changedOriginal=@ \/ rewritten]
 /\ UNCHANGED <<w,delivered>>
Consume ==
 /\ a.phase="reply"
 /\ LET req==d.requests[a.id]
        p==req.purpose
        retryNeeded==a.reply.status="Rejected" /\ req.epoch#w.epoch /\ req.task=w.current[p]
        nextPending==[a.pending EXCEPT ![p]=IF @=req.task /\ ~retryNeeded THEN 0 ELSE @]
    IN /\ d'=[d EXCEPT !.outcomes[a.id]=a.reply.status,
               !.finished=IF a.reply.status="Accepted" \/ ~retryNeeded THEN @ \cup {req.task} ELSE @]
       /\ a'=[a EXCEPT !.phase="idle",!.reply=NoneReceipt,
             !.pending=IF Fault="consume-all" THEN [x \in Purposes|->0] ELSE nextPending]
 /\ UNCHANGED <<w,delivered,e>>
NewInput ==
 /\ ~w.newInput
 /\ w'=[w EXCEPT !.newInput=TRUE,!.current[Focus]=3]
 /\ e'=[e EXCEPT !.newWhileUnknown=@ \/ a.phase="unknown"]
 /\ UNCHANGED <<d,a,delivered>>
Deliver ==
 /\ w.newInput /\ delivered<2
 /\ delivered'=delivered+1
 /\ a'=[a EXCEPT !.known[Focus]=3,
           !.pending[Focus]=IF 3 \in d.finished THEN @ ELSE 3]
 /\ UNCHANGED <<w,d,e>>
Restart ==
 /\ AllowRestart /\ ~w.restarted
 /\ w'=[w EXCEPT !.restarted=TRUE,!.epoch=2,!.running=FALSE]
 /\ a'=[a EXCEPT !.phase=IF Unsettled={} THEN "idle" ELSE "unknown",
           !.pending=[p \in Purposes|->IF a.known[p] \notin d.finished THEN a.known[p] ELSE 0]]
 /\ UNCHANGED <<d,delivered,e>>
Resume == /\ ~w.running /\ w.restarted
          /\ w'=[w EXCEPT !.running=TRUE]
          /\ UNCHANGED <<d,a,delivered,e>>
UnknownNewIdentity ==
 /\ Fault="unknown-new-id" /\ a.phase="unknown" /\ Len(d.requests)<MaxIntents
 /\ a'=[a EXCEPT !.phase="idle"]
 /\ UNCHANGED <<w,d,delivered,e>>
ReplayOriginal(i) ==
 /\ i \in 1..Len(d.requests) /\ d.receipts[i].status#"none"
 /\ d'=IF Fault="repeat-effect" /\ d.receipts[i].status="Accepted"
       THEN [d EXCEPT !.effects[TaskOf(i)]=@+1] ELSE d
 /\ UNCHANGED <<w,a,delivered,e>>
TypeFault == /\ Fault="type" /\ a'=[a EXCEPT !.retries=4]
             /\ UNCHANGED <<w,d,delivered,e>>
Work == (\E p \in Purposes: Reserve(p)) \/ Commit \/ LoseBefore \/ LoseAfter \/ Recover \/ Consume \/
        NewInput \/ Deliver \/ Restart \/ Resume \/ UnknownNewIdentity
Idle == /\ ~ENABLED Work /\ UNCHANGED vars
Next == Work \/ (\E i \in 1..Len(d.requests): ReplayOriginal(i)) \/ TypeFault \/ Idle
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(Commit) /\ WF_vars(Recover) /\ WF_vars(Consume)
      /\ WF_vars(Deliver) /\ WF_vars(Resume) /\ \A p \in Purposes: WF_vars(Reserve(p))
TypeOK == /\ a.retries \in 0..3 /\ a.id \in 0..MaxIntents
          /\ a.phase \in {"idle","submit","reply","unknown"}
          /\ d.effects \in [Tasks -> 0..MaxIntents]
SingleUnsettled == Cardinality(Unsettled)<=1
OriginalIdentityStable == d.requests=d.originals /\ ~e.changedOriginal
ReceiptStable == d.receipts=d.originalReceipts /\ ~e.badReceipt
EffectAtMostOnce == \A t \in Tasks: d.effects[t]<=1
PendingPurposesPreserved == \A p \in Purposes:
 Need(p) => a.pending[p]=w.current[p] \/
   (\E i \in Unsettled: d.requests[i].task=w.current[p])
CapacitySufficient == ReserveWanted => Len(d.requests)<MaxIntents
BothPurposesProgress == \A p \in Purposes:
 (a.known[p]=w.current[p]) ~> (w.current[p] \in d.finished \/ a.known[p]#w.current[p])
NoWitness == CASE Probe="both-complete" -> ~(1 \in d.finished /\ 2 \in d.finished)
 [] Probe="unknown-before" -> ~e.lostUncommitted
 [] Probe="unknown-after" -> ~e.lostCommitted
 [] Probe="new-while-unknown" -> ~e.newWhileUnknown
 [] Probe="restart-recovered" -> ~(w.restarted /\ e.recovered /\ Unsettled={})
 [] Probe="retry-exhausted" -> ~a.manual
 [] OTHER -> TRUE
=============================================================================
