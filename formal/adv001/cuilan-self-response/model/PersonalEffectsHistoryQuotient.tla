------------------------- MODULE PersonalEffectsHistoryQuotient -------------------------
EXTENDS Naturals, FiniteSets
(* 当前模块绑定 CS-R2；CS-R1原字节及2个超时保留于history/cs-r1。
   初态为每用途一份已合法接受的 single_use、尚未使用的安排；建立 proof 的义务由
   PersonalConsent 单独检查，二者没有做组合精化证明。各用途再容纳一份新请求。
   两件私物真实位置/取得记录保留，当前请求槽不等于物件级归还能力。
   ProjectionMode=current-only 仅探索 CS-R1 §14.2 的字面缺口，不算正确实现。
   客户端抽象仅检查已确认投影与历史 Receipt 分开；未对应生产 UI 逐字段算法。 *)
CONSTANTS UsePurpose, ProjectionMode, Fault, Probe, EnableEnvironment
(* #62：仅规范化r.reason、四个仅供Probe的e位及ui.receiptSeen。
   完整ui.observed/ui.confirmed、Observable、NormalReturn守卫、旧新身份与公平性原样保留。
   不适用于Probe见证配置；原见证字节/结果仍保留。 *)
ASSUME Probe="none"
Purposes == {"appearance","private_items"}
Players == {"p1","p2"}
Items == {"parcel","letter"}
Requests == Purposes \X (1..2)
None == <<"none",0>>
Owner(q) == IF q[1]="private_items" THEN IF q[2]=1 THEN "p1" ELSE "p2"
            ELSE IF q[2]=1 THEN "p2" ELSE "p1"
InScope(q) == UsePurpose="both" \/ UsePurpose=q[1]
Record(q) == [exists|->q[2]=1,status|->IF q[2]=1 THEN "accepted" ELSE "absent",
   life|->IF q[2]=1 THEN "open" ELSE "absent",grant|->q[2]=1,
   execution|->IF q[2]=1 THEN "ready" ELSE "none",proof|->1,reason|->"none",
   used|->FALSE,receipt|->q[2]=1]
VARIABLES r, slot, holder, acquired, originalAcquired, taken, completed, disguise, w, ui, e
vars == <<r,slot,holder,acquired,originalAcquired,taken,completed,disguise,w,ui,e>>
Held(q) == {i \in Items: holder[i]=Owner(q) /\ acquired[i]=q}
Usable(q) == r[q].exists /\ r[q].status="accepted" /\ r[q].life="open" /\
             r[q].grant /\ slot[q[1]]=q[2] /\ r[q].proof=w.epoch
UseGuard(q) == Usable(q) \/ (Fault="old-capability" /\ r[q].status="accepted")
Available == w.running /\ ~w.paused
ActiveView == [p \in Purposes|->r[<<p,slot[p]>>].grant]
VisibleReturns(p) == IF Fault="history-trims-return" /\ ~w.historyAvailable THEN {} ELSE
 IF ProjectionMode="current-only" THEN
   {i \in Items: holder[i]=p /\ acquired[i]= <<"private_items",slot["private_items"]>>}
 ELSE {i \in Items: (holder[i]=p \/ (Fault="leak-return" /\ holder[i] \in Players)) /\ acquired[i]#None}
ReturnContext(p,i) == [originalRequest|->acquired[i],item|->i,
                      view|->IF Fault="stale-return-view" THEN 1 ELSE w.views[p],
                      mode|->IF Usable(acquired[i]) THEN "delivery_pending" ELSE "return_only"]
ReturnView == [p \in Players|->{ReturnContext(p,i):i \in VisibleReturns(p)}]
Observable == [slot|->slot,active|->ActiveView,holder|->holder,acquired|->acquired,
               taken|->taken,completed|->completed,returns|->ReturnView]
Init ==
 /\ r=[q \in Requests|->Record(q)]
 /\ slot=[p \in Purposes|->1]
 /\ holder=[i \in Items|->"origin"]
 /\ acquired=[i \in Items|->None]
 /\ originalAcquired=acquired
 /\ taken=[q \in Requests|->{}]
 /\ completed=[q \in Requests|->{}]
 /\ disguise=None
 /\ w=[epoch|->1,running|->TRUE,paused|->FALSE,restarted|->FALSE,resumed|->FALSE,ownerRepositioned|->{},
       views|->[p \in Players|->1],historyAvailable|->TRUE]
 /\ ui=[observed|->Observable,confirmed|->Observable,receiptSeen|->FALSE]
 /\ e=[safe|->TRUE,identityKnown|->FALSE,everKnown|->FALSE,
       replayChanged|->FALSE,badTake|->FALSE,returnedClosed|->FALSE,restored|->FALSE,
       lateOld|->FALSE,stoppedActive|->FALSE,repeatedItem|->FALSE,badReturnHistory|->FALSE,lostRemaining|->FALSE]
StopRecord(q,kind) == [r[q] EXCEPT !.grant=FALSE,
 !.life=IF kind="invalidated" \/ kind="disclosed" THEN "open"
        ELSE IF kind="cancelled" THEN "cancelled" ELSE "closed",
 !.status=IF kind="withdrawn" THEN "withdrawn" ELSE @,
 !.execution=IF Fault="split-private" /\ q[1]="private_items" THEN @
             ELSE IF Held(q)#{} THEN "return_only" ELSE "ended",!.reason="none"]
Apply(q) ==
 /\ InScope(q) /\ q[1]="appearance" /\ Available /\ UseGuard(q) /\ ~r[q].used
 /\ disguise=None
 /\ disguise'=q
 /\ r'=[r EXCEPT ![q].execution="active",![q].used=TRUE]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,taken,completed,w,ui,e>>
Take(q,i,p) ==
 /\ InScope(q) /\ Available /\ UseGuard(q) /\ holder[i]="origin"
 /\ (q[1]="private_items" \/ Fault="cross-purpose")
 /\ (p=Owner(q) \/ Fault="wrong-taker")
 /\ ((i \notin completed[q] /\ i \notin taken[q]) \/ Fault="retake-completed")
 /\ holder'=[holder EXCEPT ![i]=p]
 /\ acquired'=[acquired EXCEPT ![i]=q]
 /\ originalAcquired'=[originalAcquired EXCEPT ![i]=q]
 /\ taken'=[taken EXCEPT ![q]=@ \cup {i}]
 /\ r'=[r EXCEPT ![q].execution="active"]
 /\ e'=[e EXCEPT !.badTake=@ \/ q[1]#"private_items" \/ p#Owner(q) \/ ~Usable(q),
                 !.repeatedItem=@ \/ i \in completed[q] \/ i \in taken[q]]
 /\ UNCHANGED <<slot,completed,disguise,w,ui>>
Stop(q,kind) ==
 /\ InScope(q) /\ r[q].exists /\ r[q].grant
 /\ kind \in {"cancelled","withdrawn","invalidated","disclosed","ended"}
 /\ ((kind#"disclosed" /\ kind#"ended") \/ q[1]="appearance")
 /\ r'=[r EXCEPT ![q]=StopRecord(q,kind)]
 /\ disguise'=IF disguise=q /\ Fault#"split-stop" THEN None ELSE disguise
 /\ e'=[e EXCEPT !.stoppedActive=FALSE,
       !.identityKnown=@ \/ kind="disclosed",!.everKnown=@ \/ kind="disclosed",
       !.safe=IF Fault="rollback" THEN FALSE ELSE @]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,taken,completed,w,ui>>
FinishSplit ==
 /\ Fault="split-stop" /\ disguise#None /\ ~r[disguise].grant
 /\ disguise'=None
 /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,taken,completed,w,ui,e>>
NewRequest(p) ==
 /\ Available /\ (UsePurpose="both" \/ UsePurpose=p)
 /\ ~r[<<p,2>>].exists /\ ~r[<<p,1>>].grant
 /\ r'=[r EXCEPT ![<<p,1>>].life="superseded",
       ![<<p,2>>]=[Record(<<p,2>>) EXCEPT !.exists=TRUE,!.status="proposed",!.life="open",!.proof=w.epoch]]
 /\ slot'=[slot EXCEPT ![p]=2]
 /\ acquired'=IF Fault="reassign-custody" /\ p="private_items" THEN
          [i \in Items|->IF holder[i] \in Players THEN <<p,2>> ELSE acquired[i]] ELSE acquired
 /\ UNCHANGED <<holder,originalAcquired,taken,completed,disguise,w,ui,e>>
AcceptNew(p) ==
 /\ Available /\ r[<<p,2>>].status="proposed" /\ r[<<p,2>>].proof=w.epoch
 /\ LET complete==p="private_items" /\ (\A i \in Items: holder[i]="owner")
    IN /\ r'=[r EXCEPT ![<<p,2>>].status="accepted",![<<p,2>>].grant=~complete,
               ![<<p,2>>].execution=IF complete THEN "ended" ELSE "ready",
               ![<<p,2>>].life=IF complete THEN "closed" ELSE "open",![<<p,2>>].receipt=TRUE]
 /\ completed'=IF p="private_items" THEN
       [completed EXCEPT ![<<p,2>>]={i \in Items: holder[i]="owner"}] ELSE completed
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,taken,disguise,w,ui,e>>
ReturnRule(i,target) ==
 /\ Available /\ holder[i] \in Players /\ acquired[i]#None
 /\ (target \in {"owner","origin"} \/ Fault="public-return")
 /\ (Fault#"return-needs-active" \/ Usable(acquired[i]))
 /\ LET q==acquired[i]
        nextHolder==[holder EXCEPT ![i]=target]
        newCompleted==[x \in Requests|->IF target="owner" /\ x[1]="private_items" /\
                          (x=q \/ (r[x].exists /\ r[x].status="accepted"))
                          THEN completed[x] \cup {i} ELSE completed[x]]
        nextRequests==[x \in Requests|->
          IF x[1]="private_items" /\ r[x].exists /\
            ((x=q /\ Held(x)={i} /\ ~r[x].grant) \/
              (r[x].grant /\ (newCompleted[x]=Items \/ (Fault="first-item-closes-all" /\ target="owner"))))
          THEN [r[x] EXCEPT !.execution="ended",!.grant=FALSE,
             !.life=IF r[x].grant \/ Fault="return-rewrites-history" THEN "closed" ELSE @,
             !.reason="none"]
          ELSE r[x]]
    IN /\ holder'=nextHolder
       /\ completed'=newCompleted
       /\ r'=nextRequests
       /\ e'=[e EXCEPT !.returnedClosed=FALSE,
                      !.restored=FALSE,
                      !.badReturnHistory=@ \/ (Fault="return-rewrites-history" /\ ~r[q].grant /\ Held(q)={i}),
                      !.lostRemaining=@ \/ (r[q].grant /\ newCompleted[q]#Items /\ ~nextRequests[q].grant)]
 /\ UNCHANGED <<slot,acquired,originalAcquired,taken,disguise,w,ui>>
NormalReturn(i,target) ==
 /\ holder[i] \in Players
 /\ ReturnContext(holder[i],i) \in ui.observed.returns[holder[i]]
 /\ ReturnRule(i,target)
OwnerRepositions(i) ==
 /\ Available /\ holder[i]="owner" /\ i \notin w.ownerRepositioned
 /\ holder'=[holder EXCEPT ![i]="origin"]
 /\ w'=[w EXCEPT !.ownerRepositioned=@ \cup {i}]
 /\ UNCHANGED <<r,slot,acquired,originalAcquired,taken,completed,disguise,ui,e>>
RefreshView(p) ==
 /\ w.views[p]=1
 /\ w'=[w EXCEPT !.views[p]=2]
 /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,taken,completed,disguise,ui,e>>
PruneHistory ==
 /\ w.historyAvailable
 /\ w'=[w EXCEPT !.historyAvailable=FALSE]
 /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,taken,completed,disguise,ui,e>>
Restart ==
 /\ EnableEnvironment /\ ~w.restarted /\ w.running
 /\ w'=[w EXCEPT !.restarted=TRUE,!.epoch=2,!.paused=TRUE]
 /\ r'=[q \in Requests|->IF r[q].exists /\ r[q].life="open"
                 THEN [StopRecord(q,"invalidated") EXCEPT !.life=IF r[q].status="proposed" THEN "closed" ELSE @]
                 ELSE r[q]]
 /\ disguise'=IF Fault="split-stop" THEN disguise ELSE None
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,taken,completed,ui,e>>
Resume == /\ w.paused /\ ~w.resumed
          /\ w'=[w EXCEPT !.paused=FALSE,!.resumed=TRUE]
          /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,taken,completed,disguise,ui,e>>
Terminal ==
 /\ EnableEnvironment /\ w.running
 /\ w'=[w EXCEPT !.running=FALSE]
 /\ r'=[q \in Requests|->IF r[q].exists /\ r[q].life="open" THEN
                  [StopRecord(q,"session_ended") EXCEPT !.life="closed"] ELSE r[q]]
 /\ disguise'=None
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,taken,completed,ui,e>>
DeliverProjection ==
 /\ IF Fault="miss-return-projection" THEN
       (ui.observed.slot#slot \/ ui.observed.active#ActiveView) ELSE ui.observed#Observable
 /\ ui'=[ui EXCEPT !.observed=Observable,!.confirmed=Observable]
 /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,taken,completed,disguise,w,e>>
Replay(q) ==
 /\ r[q].receipt
 /\ LET bad==Fault="receipt-reactivates" /\ ~r[q].grant
        badUI==Fault="ui-receipt-overwrite"
    IN /\ r'=IF bad THEN [r EXCEPT ![q].grant=TRUE] ELSE r
       /\ ui'=[ui EXCEPT !.receiptSeen=FALSE,
              !.observed.active=IF badUI THEN [@ EXCEPT ![q[1]]=TRUE] ELSE @,
              !.observed.slot=IF badUI THEN [@ EXCEPT ![q[1]]=q[2]] ELSE @]
       /\ e'=[e EXCEPT !.replayChanged=@ \/ bad,
              !.lateOld=FALSE]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,taken,completed,disguise,w>>
TypeFault == /\ Fault="type" /\ holder'=[holder EXCEPT !["parcel"]="copied"]
             /\ UNCHANGED <<r,slot,acquired,originalAcquired,taken,completed,disguise,w,ui,e>>
Work == (\E q \in Requests: Apply(q) \/ (\E k \in {"cancelled","withdrawn","invalidated","disclosed","ended"}: Stop(q,k)))
     \/ (\E q \in Requests,i \in Items,p \in Players: Take(q,i,p))
     \/ (\E p \in Purposes: NewRequest(p) \/ AcceptNew(p))
     \/ (\E i \in Items,t \in {"owner","origin","public"}: NormalReturn(i,t))
     \/ (\E i \in Items: OwnerRepositions(i))
     \/ (\E p \in Players: RefreshView(p)) \/ PruneHistory
     \/ Restart \/ Resume \/ Terminal \/ DeliverProjection \/ FinishSplit
Idle == /\ ~ENABLED Work /\ UNCHANGED vars
Next == Work \/ (\E q \in Requests: Replay(q)) \/ TypeFault \/ Idle
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(DeliverProjection) /\ \A i \in Items: WF_vars(NormalReturn(i,"owner"))
TypeOK == /\ holder \in [Items -> {"origin","owner","p1","p2","public"}]
          /\ acquired \in [Items -> Requests \cup {None}] /\ disguise \in Requests \cup {None}
          /\ completed \in [Requests -> SUBSET Items]
          /\ taken \in [Requests -> SUBSET Items]
AtomicAppearanceStop == disguise#None => Usable(disguise)
AtomicPrivateStop == \A q \in Requests:
 (q[1]="private_items" /\ Held(q)#{} /\ ~r[q].grant) => r[q].execution="return_only"
PurposeAndTakerAuthorized == ~e.badTake
CustodyProvenance == acquired=originalAcquired
CompletedItemNotRetaken == ~e.repeatedItem
ReturnPreservesClosureCause == ~e.badReturnHistory
RemainingItemEntitlement == ~e.lostRemaining
PrivateOwnerOnly == \A i \in Items: holder[i]#"public"
RestitutionEnabled == \A i \in Items:
 (Available /\ holder[i] \in Players /\ acquired[i]#None) => ENABLED ReturnRule(i,"owner")
ReturnEntryRetained == \A i \in Items:
 (holder[i] \in Players /\ acquired[i]#None) => i \in VisibleReturns(holder[i])
ReturnContextPrivate == \A p \in Players: \A i \in VisibleReturns(p): holder[i]=p
CurrentReturnReference == \A p \in Players: \A i \in VisibleReturns(p): ReturnContext(p,i).view=w.views[p]
ReceiptNeverReactivates == ~e.replayChanged
ConfirmedProjectionOnly == ui.observed=ui.confirmed
SafetyAndKnowledgeDurable == e.safe /\ (e.everKnown => e.identityKnown)
CooperativeReturns == \A i \in Items:
 (Available /\ holder[i] \in Players) ~> (holder[i]="owner" \/ holder[i]="origin" \/ ~w.running)
ProjectionEventuallyCurrent == <>[](ui.observed=Observable)
NoWitness == CASE Probe="old-return" -> e.returnedClosed=FALSE
 [] Probe="old-return-new-slot" -> ~(e.returnedClosed /\ slot["private_items"]=2)
 [] Probe="new-slot-old-custody" -> ~(slot["private_items"]=2 /\ (\E i \in Items: holder[i]="p1"))
 [] Probe="late-old-receipt" -> ~e.lateOld
 [] Probe="appearance-stopped" -> ~e.stoppedActive
 [] Probe="restart-new" -> ~(w.restarted /\ w.resumed /\ (\E p \in Purposes: slot[p]=2 /\ r[<<p,2>>].grant))
 [] Probe="restored-origin" -> ~e.restored
 [] Probe="first-return-second-held" ->
       ~("parcel" \in completed[<<"private_items",1>>] /\ holder["letter"]="p1" /\ r[<<"private_items",1>>].grant)
 [] Probe="new-grant-retake" ->
       ~("parcel" \in completed[<<"private_items",1>>] /\ acquired["parcel"]= <<"private_items",2>> /\ holder["parcel"]="p2")
 [] Probe="old-return-refresh-prune" ->
       ~(slot["private_items"]=2 /\ w.views["p1"]=2 /\ ~w.historyAvailable /\
         (\E i \in Items: holder[i]="p1" /\ ReturnContext("p1",i) \in ui.observed.returns["p1"]))
 [] OTHER -> TRUE
=============================================================================
