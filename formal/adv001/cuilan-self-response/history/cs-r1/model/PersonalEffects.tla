------------------------- MODULE PersonalEffects -------------------------
EXTENDS Naturals, FiniteSets
(* 初态为每用途一份已合法接受、尚未使用的安排；建立 proof 的义务由
   PersonalConsent 单独检查，二者没有做组合精化证明。各用途再容纳一份新请求。
   两件私物真实位置/取得记录保留，当前请求槽不等于物件级归还能力。
   ProjectionMode=current-only 仅探索 CS-R1 §14.2 的字面缺口，不算正确实现。
   客户端抽象仅检查已确认投影与历史 Receipt 分开；未对应生产 UI 逐字段算法。 *)
CONSTANTS UsePurpose, ProjectionMode, Fault, Probe, EnableEnvironment
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
VARIABLES r, slot, holder, acquired, originalAcquired, disguise, w, ui, e
vars == <<r,slot,holder,acquired,originalAcquired,disguise,w,ui,e>>
Held(q) == {i \in Items: holder[i]=Owner(q) /\ acquired[i]=q}
Usable(q) == r[q].exists /\ r[q].status="accepted" /\ r[q].life="open" /\
             r[q].grant /\ slot[q[1]]=q[2] /\ r[q].proof=w.epoch
UseGuard(q) == Usable(q) \/ (Fault="old-capability" /\ r[q].status="accepted")
Available == w.running /\ ~w.paused
ActiveView == [p \in Purposes|->r[<<p,slot[p]>>].grant]
VisibleReturns == IF ProjectionMode="current-only" THEN
   {i \in Items: holder[i] \in Players /\ acquired[i]= <<"private_items",slot["private_items"]>>}
 ELSE {i \in Items: holder[i] \in Players /\ acquired[i]#None}
Init ==
 /\ r=[q \in Requests|->Record(q)]
 /\ slot=[p \in Purposes|->1]
 /\ holder=[i \in Items|->"origin"]
 /\ acquired=[i \in Items|->None]
 /\ originalAcquired=acquired
 /\ disguise=None
 /\ w=[epoch|->1,running|->TRUE,paused|->FALSE,restarted|->FALSE,resumed|->FALSE,seq|->0]
 /\ ui=[seq|->0,slot|->slot,active|->[p \in Purposes|->TRUE],
        confirmedSlot|->slot,confirmedActive|->[p \in Purposes|->TRUE],history|->{}]
 /\ e=[safe|->TRUE,identityKnown|->FALSE,everKnown|->FALSE,
       replayChanged|->FALSE,badTake|->FALSE,returnedClosed|->FALSE,restored|->FALSE,
       lateOld|->FALSE,stoppedActive|->FALSE]
StopRecord(q,kind) == [r[q] EXCEPT !.grant=FALSE,
 !.life=IF kind="invalidated" \/ kind="disclosed" THEN "open"
        ELSE IF kind="cancelled" THEN "cancelled" ELSE "closed",
 !.status=IF kind="withdrawn" THEN "withdrawn" ELSE @,
 !.execution=IF Fault="split-private" /\ q[1]="private_items" THEN @
             ELSE IF Held(q)#{} THEN "return_only" ELSE "ended",!.reason=kind]
Apply(q) ==
 /\ InScope(q) /\ q[1]="appearance" /\ Available /\ UseGuard(q) /\ ~r[q].used
 /\ disguise=None
 /\ disguise'=q
 /\ r'=[r EXCEPT ![q].execution="active",![q].used=TRUE]
 /\ w'=[w EXCEPT !.seq=@+1]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,ui,e>>
Take(q,i,p) ==
 /\ InScope(q) /\ Available /\ UseGuard(q) /\ holder[i]="origin"
 /\ (q[1]="private_items" \/ Fault="cross-purpose")
 /\ (p=Owner(q) \/ Fault="wrong-taker")
 /\ holder'=[holder EXCEPT ![i]=p]
 /\ acquired'=[acquired EXCEPT ![i]=q]
 /\ originalAcquired'=[originalAcquired EXCEPT ![i]=q]
 /\ r'=[r EXCEPT ![q].execution="active"]
 /\ w'=[w EXCEPT !.seq=@+1]
 /\ e'=[e EXCEPT !.badTake=@ \/ q[1]#"private_items" \/ p#Owner(q) \/ ~Usable(q)]
 /\ UNCHANGED <<slot,disguise,ui>>
Stop(q,kind) ==
 /\ InScope(q) /\ r[q].exists /\ r[q].grant
 /\ kind \in {"cancelled","withdrawn","invalidated","disclosed","ended"}
 /\ ((kind#"disclosed" /\ kind#"ended") \/ q[1]="appearance")
 /\ r'=[r EXCEPT ![q]=StopRecord(q,kind)]
 /\ disguise'=IF disguise=q /\ Fault#"split-stop" THEN None ELSE disguise
 /\ w'=[w EXCEPT !.seq=@+1]
 /\ e'=[e EXCEPT !.stoppedActive=@ \/ disguise=q,
       !.identityKnown=@ \/ kind="disclosed",!.everKnown=@ \/ kind="disclosed",
       !.safe=IF Fault="rollback" THEN FALSE ELSE @]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,ui>>
FinishSplit ==
 /\ Fault="split-stop" /\ disguise#None /\ ~r[disguise].grant
 /\ disguise'=None
 /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,w,ui,e>>
NewRequest(p) ==
 /\ Available /\ (UsePurpose="both" \/ UsePurpose=p)
 /\ ~r[<<p,2>>].exists /\ ~r[<<p,1>>].grant
 /\ r'=[r EXCEPT ![<<p,1>>].life="superseded",
       ![<<p,2>>]=[Record(<<p,2>>) EXCEPT !.exists=TRUE,!.status="proposed",!.life="open",!.proof=w.epoch]]
 /\ slot'=[slot EXCEPT ![p]=2]
 /\ acquired'=IF Fault="reassign-custody" /\ p="private_items" THEN
          [i \in Items|->IF holder[i] \in Players THEN <<p,2>> ELSE acquired[i]] ELSE acquired
 /\ w'=[w EXCEPT !.seq=@+1]
 /\ UNCHANGED <<holder,originalAcquired,disguise,ui,e>>
AcceptNew(p) ==
 /\ Available /\ r[<<p,2>>].status="proposed" /\ r[<<p,2>>].proof=w.epoch
 /\ LET complete==p="private_items" /\ (\A i \in Items: holder[i]="owner")
    IN /\ r'=[r EXCEPT ![<<p,2>>].status="accepted",![<<p,2>>].grant=~complete,
               ![<<p,2>>].execution=IF complete THEN "ended" ELSE "ready",
               ![<<p,2>>].life=IF complete THEN "closed" ELSE "open",![<<p,2>>].receipt=TRUE]
 /\ w'=[w EXCEPT !.seq=@+1]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,disguise,ui,e>>
ReturnRule(i,target) ==
 /\ Available /\ holder[i] \in Players /\ acquired[i]#None
 /\ (target \in {"owner","origin"} \/ Fault="public-return")
 /\ (target#"origin" \/ ~r[acquired[i]].grant)
 /\ (Fault#"return-needs-active" \/ Usable(acquired[i]))
 /\ LET q==acquired[i]
        nextHolder==[holder EXCEPT ![i]=target]
        allAtOwner==\A j \in Items: nextHolder[j]="owner"
    IN /\ holder'=nextHolder
       /\ r'=[x \in Requests|->
          IF x[1]="private_items" /\ r[x].exists /\ r[x].status="accepted" /\
            ((x=q /\ Held(x)={i}) \/ allAtOwner)
          THEN [r[x] EXCEPT !.execution=IF allAtOwner \/ ~r[x].grant THEN "ended" ELSE @,
             !.grant=IF allAtOwner THEN FALSE ELSE @,
             !.life=IF allAtOwner THEN "closed" ELSE @,
             !.reason=IF allAtOwner THEN "fulfilled" ELSE @]
          ELSE r[x]]
       /\ e'=[e EXCEPT !.returnedClosed=@ \/ (target="owner" /\ ~r[q].grant),
                      !.restored=@ \/ target="origin"]
 /\ w'=[w EXCEPT !.seq=@+1]
 /\ UNCHANGED <<slot,acquired,originalAcquired,disguise,ui>>
NormalReturn(i,target) == /\ i \in VisibleReturns /\ ReturnRule(i,target)
Restart ==
 /\ EnableEnvironment /\ ~w.restarted /\ w.running
 /\ w'=[w EXCEPT !.restarted=TRUE,!.epoch=2,!.paused=TRUE,!.seq=@+1]
 /\ r'=[q \in Requests|->IF r[q].exists /\ r[q].life="open"
                 THEN StopRecord(q,"invalidated") ELSE r[q]]
 /\ disguise'=IF Fault="split-stop" THEN disguise ELSE None
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,ui,e>>
Resume == /\ w.paused /\ ~w.resumed
          /\ w'=[w EXCEPT !.paused=FALSE,!.resumed=TRUE]
          /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,disguise,ui,e>>
Terminal ==
 /\ EnableEnvironment /\ w.running
 /\ w'=[w EXCEPT !.running=FALSE,!.seq=@+1]
 /\ r'=[q \in Requests|->IF r[q].exists THEN
                  [StopRecord(q,"session_ended") EXCEPT !.life="closed"] ELSE r[q]]
 /\ disguise'=None
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,ui,e>>
DeliverProjection ==
 /\ ui.seq<w.seq
 /\ ui'=[ui EXCEPT !.seq=w.seq,!.slot=slot,!.active=ActiveView,
                    !.confirmedSlot=slot,!.confirmedActive=ActiveView]
 /\ UNCHANGED <<r,slot,holder,acquired,originalAcquired,disguise,w,e>>
Replay(q) ==
 /\ r[q].receipt
 /\ LET bad==Fault="receipt-reactivates" /\ ~r[q].grant
        badUI==Fault="ui-receipt-overwrite"
    IN /\ r'=IF bad THEN [r EXCEPT ![q].grant=TRUE] ELSE r
       /\ ui'=[ui EXCEPT !.history=@ \cup {q},
              !.active=IF badUI THEN [@ EXCEPT ![q[1]]=TRUE] ELSE @,
              !.slot=IF badUI THEN [@ EXCEPT ![q[1]]=q[2]] ELSE @]
       /\ e'=[e EXCEPT !.replayChanged=@ \/ bad,
              !.lateOld=@ \/ (q[2]=1 /\ slot[q[1]]=2 /\ ui.slot[q[1]]=2 /\ ~r[q].grant)]
 /\ UNCHANGED <<slot,holder,acquired,originalAcquired,disguise,w>>
TypeFault == /\ Fault="type" /\ holder'=[holder EXCEPT !["parcel"]="copied"]
             /\ UNCHANGED <<r,slot,acquired,originalAcquired,disguise,w,ui,e>>
Work == (\E q \in Requests: Apply(q) \/ (\E k \in {"cancelled","withdrawn","invalidated","disclosed","ended"}: Stop(q,k)))
     \/ (\E q \in Requests,i \in Items,p \in Players: Take(q,i,p))
     \/ (\E p \in Purposes: NewRequest(p) \/ AcceptNew(p))
     \/ (\E i \in Items,t \in {"owner","origin","public"}: NormalReturn(i,t))
     \/ Restart \/ Resume \/ Terminal \/ DeliverProjection \/ FinishSplit
Idle == /\ ~ENABLED Work /\ UNCHANGED vars
Next == Work \/ (\E q \in Requests: Replay(q)) \/ TypeFault \/ Idle
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ \A i \in Items: WF_vars(NormalReturn(i,"owner"))
TypeOK == /\ holder \in [Items -> {"origin","owner","p1","p2","public"}]
          /\ acquired \in [Items -> Requests \cup {None}] /\ disguise \in Requests \cup {None}
          /\ w.seq \in 0..40
AtomicAppearanceStop == disguise#None => Usable(disguise)
AtomicPrivateStop == \A q \in Requests:
 (q[1]="private_items" /\ Held(q)#{} /\ ~r[q].grant) => r[q].execution="return_only"
PurposeAndTakerAuthorized == ~e.badTake
CustodyProvenance == acquired=originalAcquired
PrivateOwnerOnly == \A i \in Items: holder[i]#"public"
RestitutionEnabled == \A i \in Items:
 (Available /\ holder[i] \in Players /\ acquired[i]#None) => ENABLED ReturnRule(i,"owner")
ReturnEntryRetained == \A i \in Items:
 (holder[i] \in Players /\ acquired[i]#None) => i \in VisibleReturns
ReceiptNeverReactivates == ~e.replayChanged
ConfirmedProjectionOnly == ui.active=ui.confirmedActive /\ ui.slot=ui.confirmedSlot
SafetyAndKnowledgeDurable == e.safe /\ (e.everKnown => e.identityKnown)
CooperativeReturns == \A i \in Items:
 (Available /\ holder[i] \in Players) ~> (holder[i]="owner" \/ holder[i]="origin" \/ ~w.running)
NoWitness == CASE Probe="old-return" -> e.returnedClosed=FALSE
 [] Probe="old-return-new-slot" -> ~(e.returnedClosed /\ slot["private_items"]=2)
 [] Probe="new-slot-old-custody" -> ~(slot["private_items"]=2 /\ (\E i \in Items: holder[i]="p1"))
 [] Probe="late-old-receipt" -> ~e.lateOld
 [] Probe="appearance-stopped" -> ~e.stoppedActive
 [] Probe="restart-new" -> ~(w.restarted /\ w.resumed /\ (\E p \in Purposes: slot[p]=2 /\ r[<<p,2>>].grant))
 [] Probe="restored-origin" -> ~e.restored
 [] OTHER -> TRUE
=============================================================================
