------------------------- MODULE PersonalConsent -------------------------
EXTENDS Naturals, FiniteSets
(* CS-R1 §11–15。初态是两个已经合法送达的 proposed 请求；
   公开提议 CAS 单独由 PersonalCAS 检查。本模型不假定任意旁观者会离开。
   一用途旧/新两请求，另一用途一请求；Focus 交换后覆盖两用途替换。
   每个请求最多一次 response/cancel/withdraw 首次提交及任意历史 Receipt 读取。
   原始请求/basis 在 Prepare 后不改；首次效果与 Receipt 为同一原子动作。 *)
CONSTANTS Focus, FirstChoice, OtherChoice, NewRequester, Event, Fault, Probe
Purposes == {"appearance","private_items"}
Players == {"p1","p2"}
Ids == 1..3
OtherPurpose == CHOOSE p \in Purposes: p#Focus
Purpose(i) == IF i=3 THEN OtherPurpose ELSE Focus
Owner(i) == IF i=3 THEN "p2" ELSE IF i=2 THEN NewRequester ELSE "p1"
Choice(i) == IF i=3 THEN OtherChoice ELSE FirstChoice
VARIABLES w, r, current, version, e
vars == <<w,r,current,version,e>>
EmptyBasis == [cv|->0,lv|->0,ownerEpoch|->0,playerEpoch|->0,source|->0,local|->0]
Record(i,present,cv,oe,pe,source) ==
 [exists|->present,status|->IF present THEN "proposed" ELSE "absent",
  ownerDecision|->IF present THEN "proposed" ELSE "absent",
  life|->IF present THEN "open" ELSE "absent",lv|->IF present THEN 1 ELSE 0,
  cv|->cv,scope|->i,bindOwner|->oe,bindPlayer|->pe,bindSource|->source,
  proofOwner|->0,proofPlayer|->0,proofSource|->0,proofScope|->0,
  grant|->FALSE,notice|->FALSE,reason|->"none",lastRequest|->i,
  response|->"unprepared",choice|->Choice(i),rb|->EmptyBasis,rr|->"none",responseCount|->0,
  withdraw|->"unprepared",wb|->EmptyBasis,wr|->"none",withdrawCount|->0,
  cancel|->"unprepared",cb|->EmptyBasis,cr|->"none"]
Init ==
 /\ w=[ownerEpoch|->1,epochs|->[p \in Players|->1],source|->1,local|->0,
       auth|->TRUE,paused|->FALSE,terminal|->FALSE,eventDone|->FALSE,resumed|->FALSE]
 /\ r=[i \in Ids|->Record(i,i#2,IF i=2 THEN 0 ELSE 1,1,1,1)]
 /\ current=[p \in Purposes|->IF p=Focus THEN 1 ELSE 3]
 /\ version=[p \in Purposes|->1]
 /\ e=[safe|->TRUE,history|->TRUE,replay|->FALSE,replayChanged|->FALSE,
       rejectedOld|->FALSE,cancelBefore|->FALSE,acceptBefore|->FALSE,withdrawAfterEpoch|->FALSE,
       badBasis|->FALSE,thirdParty|->FALSE,rejectedResponse|->FALSE,rejectedWithdraw|->FALSE]
Available == w.auth /\ ~w.paused /\ ~w.terminal
Basis(i) == [cv|->r[i].cv,lv|->r[i].lv,ownerEpoch|->w.ownerEpoch,
             playerEpoch|->w.epochs[Owner(i)],source|->w.source,local|->w.local]
CurrentChoice(i) == IF Event="local" /\ w.local=1 /\ Purpose(i)=Focus THEN "deferred" ELSE Choice(i)
ProposalValid(i) == r[i].bindOwner=w.ownerEpoch /\ r[i].bindPlayer=w.epochs[Owner(i)]
                     /\ r[i].bindSource=w.source
ResponseValid(i) ==
 /\ Available /\ r[i].exists /\ r[i].status="proposed" /\ r[i].life="open"
 /\ current[Purpose(i)]=i /\ ProposalValid(i)
 /\ r[i].rb=Basis(i)
WithdrawEligible(i) ==
 /\ Available /\ r[i].exists /\ r[i].status="accepted" /\ r[i].life="open"
 /\ current[Purpose(i)]=i /\ r[i].notice
WithdrawDependencies(i) ==
 /\ r[i].wb.cv=r[i].cv /\ r[i].wb.lv=r[i].lv
 /\ r[i].wb.ownerEpoch=w.ownerEpoch /\ r[i].wb.source=w.source
 /\ (Fault#"old-participant-epoch" \/ r[i].proofPlayer=w.epochs[Owner(i)])
PrepareResponse(i) ==
 /\ Available /\ r[i].exists /\ r[i].status="proposed" /\ r[i].life="open"
 /\ r[i].response="unprepared" /\ ProposalValid(i)
 /\ r'=[r EXCEPT ![i].response="ready",![i].rb=Basis(i),![i].choice=CurrentChoice(i)]
 /\ UNCHANGED <<w,current,version,e>>
CommitResponse(i) ==
 /\ r[i].response="ready"
 /\ LET good==ResponseValid(i)
        target==IF Fault="wrong-request" THEN current[Purpose(i)] ELSE i
        ok==good \/ (Fault="wrong-request" /\ Available /\ r[target].status="proposed")
            \/ (Fault="stale-basis" /\ Available /\ r[i].status="proposed" /\ r[i].life="open" /\ current[Purpose(i)]=i)
        accept==r[i].choice="accepted"
        nr==[r EXCEPT ![i].response="done",![i].rr=IF ok THEN "Accepted" ELSE "Rejected"]
    IN /\ r'=IF ok THEN [nr EXCEPT
             ![target].status=r[i].choice,![target].ownerDecision=r[i].choice,
             ![target].life=IF accept THEN "open" ELSE "closed",
             ![target].cv=version[Purpose(target)]+1,![target].lv=@+1,
             ![target].grant=accept,![target].lastRequest=i,
             ![target].proofOwner=IF accept THEN w.ownerEpoch ELSE 0,
             ![target].proofPlayer=IF accept THEN w.epochs[Owner(i)] ELSE 0,
             ![target].proofSource=IF accept THEN w.source ELSE 0,
             ![target].proofScope=IF accept /\ Fault#"wrong-scope" THEN r[i].scope ELSE 0,
             ![target].responseCount=@+1]
           ELSE nr
       /\ version'=IF ok THEN [version EXCEPT ![Purpose(target)]=@+1] ELSE version
       /\ e'=[e EXCEPT !.rejectedOld=@ \/ (~ok /\ current[Purpose(i)]#i),
                  !.cancelBefore=@ \/ (~ok /\ r[i].life="cancelled"),!.badBasis=@ \/ (ok /\ ~good),
                  !.rejectedResponse=@ \/ (~ok /\ current[Purpose(i)]#i)]
 /\ UNCHANGED <<w,current>>
PrepareCancel(i) ==
 /\ r[i].exists /\ r[i].life="open" /\ r[i].cancel="unprepared"
 /\ r'=[r EXCEPT ![i].cancel="ready",![i].cb=Basis(i)]
 /\ UNCHANGED <<w,current,version,e>>
CommitCancel(i) ==
 /\ r[i].cancel="ready"
 /\ LET good==Available /\ r[i].life="open" /\ current[Purpose(i)]=i
                /\ r[i].cb.cv=r[i].cv /\ r[i].cb.lv=r[i].lv
        nr==[r EXCEPT ![i].cancel="done",![i].cr=IF good THEN "Accepted" ELSE "Rejected"]
    IN /\ r'=IF good THEN [nr EXCEPT ![i].life="cancelled",![i].lv=@+1,
                 ![i].reason="requester_cancelled",![i].grant=FALSE,
                 ![i].status=IF Fault="cancel-as-withdraw" THEN "withdrawn" ELSE @]
           ELSE nr
       /\ e'=[e EXCEPT !.acceptBefore=@ \/ (good /\ r[i].status="accepted")]
 /\ UNCHANGED <<w,current,version>>
Replace ==
 /\ Available /\ ~r[2].exists
 /\ (Owner(2)=Owner(1) \/ (~r[1].grant /\ r[1].status#"proposed") \/ r[1].life#"open"
        \/ Fault="third-party")
 /\ r'=[r EXCEPT ![1].life="superseded",![1].lv=@+1,![1].grant=FALSE,
               ![1].reason="replaced",![2]=Record(2,TRUE,version[Focus]+1,w.ownerEpoch,w.epochs[Owner(2)],w.source)]
 /\ current'=[current EXCEPT ![Focus]=2]
 /\ version'=[version EXCEPT ![Focus]=@+1]
 /\ e'=[e EXCEPT !.thirdParty=@ \/ (Owner(2)#Owner(1) /\ r[1].life="open" /\
                           (r[1].grant \/ r[1].status="proposed"))]
 /\ UNCHANGED w
PrepareWithdraw(i) ==
 /\ WithdrawEligible(i) /\ r[i].withdraw="unprepared"
 /\ (Fault#"old-participant-epoch" \/ r[i].proofPlayer=w.epochs[Owner(i)])
 /\ r'=[r EXCEPT ![i].withdraw="ready",![i].wb=Basis(i)]
 /\ UNCHANGED <<w,current,version,e>>
CommitWithdraw(i) ==
 /\ r[i].withdraw="ready"
 /\ LET target==IF Fault="wrong-withdraw" THEN current[Purpose(i)] ELSE i
        good==WithdrawEligible(i) /\ WithdrawDependencies(i)
        ok==good \/ (Fault="wrong-withdraw" /\ Available /\ r[target].status="accepted")
        nr==[r EXCEPT ![i].withdraw="done",![i].wr=IF ok THEN "Accepted" ELSE "Rejected"]
    IN /\ r'=IF ok THEN [nr EXCEPT ![target].status="withdrawn",![target].ownerDecision="withdrawn",
              ![target].life="closed",![target].reason="owner_withdrew",![target].grant=FALSE,
              ![target].lv=@+1,![target].cv=version[Purpose(target)]+1,
              ![target].lastRequest=i,![target].withdrawCount=@+1] ELSE nr
       /\ version'=IF ok THEN [version EXCEPT ![Purpose(target)]=@+1] ELSE version
       /\ e'=[e EXCEPT !.rejectedOld=@ \/ (~ok /\ current[Purpose(i)]#i),
            !.withdrawAfterEpoch=@ \/ (ok /\ r[i].proofPlayer#w.epochs[Owner(i)]),
            !.rejectedWithdraw=@ \/ (~ok /\ current[Purpose(i)]#i)]
 /\ UNCHANGED <<w,current>>
External ==
 /\ ~w.eventDone /\ Event#"none"
 /\ LET invalidate==Event \in {"requester-epoch","owner-epoch","source","revoke","terminal"}
        affected(i)==r[i].exists /\ r[i].life="open" /\
            (Event#"requester-epoch" \/ Owner(i)="p1")
    IN /\ w'=[w EXCEPT !.eventDone=TRUE,
             !.ownerEpoch=IF Event="owner-epoch" THEN 2 ELSE @,
             !.epochs=IF Event="requester-epoch" THEN [@ EXCEPT !["p1"]=2] ELSE @,
             !.source=IF Event="source" THEN 2 ELSE @,
             !.local=IF Event="local" THEN 1 ELSE @,
             !.auth=IF Event="revoke" THEN FALSE ELSE @,
             !.paused=Event="pause",!.terminal=Event="terminal"]
       /\ r'=IF invalidate THEN [i \in Ids |->
             IF affected(i) THEN [r[i] EXCEPT !.grant=IF Fault="skip-invalidation" THEN @ ELSE FALSE,!.lv=@+1,
               !.life=IF Event="terminal" \/ r[i].status="proposed" THEN "closed" ELSE @,
               !.notice=r[i].status="accepted",!.reason="binding_invalidated"] ELSE r[i]] ELSE r
       /\ e'=IF Fault="rollback" /\ invalidate THEN [e EXCEPT !.safe=FALSE,!.history=FALSE] ELSE e
 /\ UNCHANGED <<current,version>>
Resume ==
 /\ w.eventDone /\ ~w.resumed /\ Event \in {"pause","revoke"}
 /\ w'=[w EXCEPT !.resumed=TRUE,!.paused=FALSE,!.auth=TRUE]
 /\ UNCHANGED <<r,current,version,e>>
Replay(i) ==
 /\ r[i].rr="Accepted"
 /\ LET bad==Fault="receipt-reactivates" /\ ~r[i].grant /\ Choice(i)="accepted"
    IN /\ r'=IF bad THEN [r EXCEPT ![i].grant=TRUE]
              ELSE IF Fault="repeat-effect" THEN [r EXCEPT ![i].responseCount=@+1] ELSE r
       /\ e'=[e EXCEPT !.replay=TRUE,!.replayChanged=@ \/ bad]
 /\ UNCHANGED <<w,current,version>>
TypeFault == /\ Fault="type" /\ r'= [r EXCEPT ![1].cv=99]
             /\ UNCHANGED <<w,current,version,e>>
Work == (\E i \in Ids: PrepareResponse(i) \/ CommitResponse(i) \/ PrepareCancel(i) \/
               CommitCancel(i) \/ PrepareWithdraw(i) \/ CommitWithdraw(i)) \/ Replace \/ External \/ Resume
Idle == /\ ~ENABLED Work /\ UNCHANGED vars
Next == Work \/ (\E i \in Ids: Replay(i)) \/ TypeFault \/ Idle
Spec == Init /\ [][Next]_vars
TypeOK == /\ current \in [Purposes -> Ids] /\ version \in [Purposes -> 1..10]
          /\ \A i \in Ids: r[i].cv \in 0..10 /\ r[i].lv \in 0..10
            /\ r[i].status \in {"absent","proposed","accepted","declined","deferred","withdrawn"}
OwnDecisionOnly == \A i \in Ids: r[i].status=r[i].ownerDecision
PurposeRequestIsolation == \A i \in Ids: r[i].lastRequest=i
ScopeBinding == \A i \in Ids: r[i].grant => r[i].proofScope=r[i].scope
ActiveRequiresCurrent == \A i \in Ids: r[i].grant =>
 /\ current[Purpose(i)]=i /\ r[i].status="accepted" /\ r[i].life="open"
 /\ r[i].proofOwner=w.ownerEpoch /\ r[i].proofPlayer=w.epochs[Owner(i)]
 /\ r[i].proofSource=w.source /\ w.auth /\ ~w.terminal
ReceiptDoesNotReactivate == ~e.replayChanged
EffectAtMostOnce == \A i \in Ids: r[i].responseCount<=1 /\ r[i].withdrawCount<=1
DecisionBasisRechecked == ~e.badBasis
NoThirdPartyReplacement == ~e.thirdParty
OwnerCanCloseInvalidated == \A i \in Ids:
 (WithdrawEligible(i) /\ r[i].withdraw="unprepared") => ENABLED PrepareWithdraw(i)
SafetyAndHistoryDurable == e.safe /\ e.history
NoWitness == CASE Probe="both-accepted" -> ~(r[1].status="accepted" /\ r[3].status="accepted")
 [] Probe="cancel-before" -> ~e.cancelBefore
 [] Probe="accept-before" -> ~e.acceptBefore
 [] Probe="stale-new" -> ~(r[2].exists /\ e.rejectedOld)
 [] Probe="stale-response" -> ~e.rejectedResponse
 [] Probe="stale-withdraw" -> ~e.rejectedWithdraw
 [] Probe="c2-after-epoch" -> ~e.withdrawAfterEpoch
 [] Probe="replay-closed" -> ~(e.replay /\ r[1].rr="Accepted" /\ ~r[1].grant)
 [] Probe="declined" -> ~(r[1].status="declined" /\ r[3].status="declined")
 [] Probe="deferred" -> ~(r[1].status="deferred" /\ r[3].status="deferred")
 [] OTHER -> TRUE
=============================================================================
