--------------------------- MODULE SceneFollow ---------------------------
EXTENDS Naturals, Sequences, FiniteSets

(* 有限集合/段抽象，不计算连续几何。shape 表示独立的整条实际路径事实。
   B 优先，C13 真值只来自本人，原许可暂停后必须新 proposed。
   接受/步进/确认各自为权威原子动作；确认准备与提交可以交错。 *)
CONSTANTS Route, InitialPosition, MaxPlans, Environment, Fault, Probe
VARIABLES w, r, callbacks, e
vars == <<w,r,callbacks,e>>
Court == {"branch","overlap","exit","public","entry","front"}
Road == {"road","roadexit","tea"}
Positions == Court \cup Road \cup {"outside"}
B == {"branch","overlap","exit","front"}
U == {"overlap","exit","public","entry"}
Scene(p) == IF p \in Court THEN "court" ELSE IF p \in Road THEN "road" ELSE "outside"
ActualExit(p) == p="exit"
Active == {"accepted","following","arrived"}
Available == w.running /\ ~w.paused
Itinerary(p) == IF Scene(p)="court" THEN IF Route="tea" THEN <<"court","road">> ELSE <<"court">>
                ELSE IF Route="front" THEN <<"road","court">> ELSE <<"road">>
NeedExit(p) == Route="tea" /\ p \in B
RequiredSources(p) == IF Route="front" THEN IF Scene(p)="road" THEN {"front","tea"} ELSE {"front"}
                     ELSE IF p \in B THEN {"front","tea"} ELSE {"tea"}
AuthorityCurrent == r.subjectEpoch=w.subjectEpoch /\ r.leaderEpoch=w.leaderEpoch /\ r.map=w.map
                    /\ r.cv=w.cv /\ r.pv=w.pv
BindingCurrent == AuthorityCurrent /\ w.consent="accepted" /\ r.link.gen=r.gen
                  /\ r.link.cv=w.cv /\ r.link.pv=w.pv
Permitted(p,stage,exitDone) ==
 /\ stage \in 1..Len(r.itinerary) /\ Scene(p)=r.itinerary[stage]
 /\ IF Scene(p)="court" THEN
       IF Route="front" \/ (r.exitRequired /\ ~exitDone) THEN p \in Court ELSE p \in U
     ELSE p \in Road
Crossing(p) == Scene(p)#Scene(w.position)
NextStage(p) == r.stage + (IF Crossing(p) THEN 1 ELSE 0)
EntryCurrent(p) == ~Crossing(p) \/
  ((w.position="entry" /\ p="road") \/ (w.position="roadexit" /\ p="public"))
OrderCurrent(p) ==
 /\ NextStage(p)<=Len(r.itinerary)
 /\ Permitted(p,NextStage(p),r.exitDone)
 /\ EntryCurrent(p)
 /\ (~Crossing(p) \/ ~r.exitRequired \/ r.exitDone)
WholeSafe(p,shape) == OrderCurrent(p) /\ shape="clear"
Goal == IF Route="tea" THEN "tea" ELSE "front"
GoodTarget == IF r.exitRequired /\ ~r.exitDone THEN "exit"
              ELSE IF Scene(w.position)="court" /\ Route="tea" THEN
                 IF w.position="entry" THEN "road" ELSE "entry"
              ELSE IF Scene(w.position)="road" /\ Route="front" THEN
                 IF w.position="roadexit" THEN "public" ELSE "roadexit"
              ELSE Goal

Init ==
 /\ \E p \in IF InitialPosition="mixed" THEN {"branch","overlap","exit","public","road"} ELSE {InitialPosition}:
      w=[position|->p,running|->TRUE,paused|->FALSE,subjectEpoch|->0,leaderEpoch|->0,map|->0,
         cv|->0,pv|->0,consent|->"none",safe|->FALSE]
 /\ r=[gen|->0,status|->"none",start|->w.position,originB|->FALSE,sources|->{},
       exitRequired|->FALSE,exitDone|->FALSE,stage|->1,itinerary|->Itinerary(w.position),
       subjectEpoch|->0,leaderEpoch|->0,map|->0,cv|->0,pv|->0,
       preparedCV|->0,preparedPV|->0,leaderReady|->FALSE,
       link|->[gen|->0,cv|->0,pv|->0]]
 /\ callbacks={}
 /\ e=[exited|->{},pausedPlans|->{},createdCallbacks|->{},everSafe|->FALSE,
       changed|->FALSE,resumed|->FALSE,badMove|->FALSE,badPath|->FALSE,
       badSettlement|->FALSE,badRebind|->FALSE,badStage|->FALSE,badArrived|->FALSE,
       ahead|->FALSE,overlapAfterExit|->FALSE,reproposed|->FALSE,acceptedCount|->0]

Propose ==
 /\ Available /\ ~w.safe /\ r.gen<MaxPlans
 /\ Environment#"cooperative" \/ r.gen=0
 /\ LET b==IF Fault="u-first" THEN w.position \in B /\ w.position \notin U ELSE w.position \in B
        needed==Route="tea" /\ b
        done==IF Fault="carry-exit" /\ r.gen>0 THEN r.exitDone ELSE needed /\ ActualExit(w.position)
        source==IF Route="tea" /\ ~b THEN {"tea"} ELSE RequiredSources(w.position)
        cv==w.cv+1
        pv==w.pv+1
        gen==r.gen+1
    IN /\ r'=[gen|->gen,status|->"proposed",start|->w.position,originB|->b,sources|->source,
               exitRequired|->needed,exitDone|->done,stage|->1,itinerary|->Itinerary(w.position),
               subjectEpoch|->w.subjectEpoch,leaderEpoch|->w.leaderEpoch,map|->w.map,cv|->cv,pv|->pv,
               preparedCV|->cv,preparedPV|->pv,leaderReady|->FALSE,link|->[gen|->0,cv|->0,pv|->0]]
       /\ w'=[w EXCEPT !.cv=cv,!.pv=pv,!.consent="proposed"]
       /\ e'=[e EXCEPT !.exited=IF needed /\ ActualExit(w.position) THEN @ \cup {gen} ELSE @,
                  !.reproposed=@ \/ (r.gen>0 /\ r.exitDone /\ ~ActualExit(w.position) /\ w.position \in B)]
 /\ UNCHANGED callbacks

Accept ==
 /\ Available /\ r.status="proposed" /\ AuthorityCurrent
 /\ LET cv==w.cv+1
        pv==w.pv+1
    IN /\ w'=[w EXCEPT !.cv=cv,!.pv=pv,!.consent="accepted"]
       /\ r'=[r EXCEPT !.status="accepted",!.cv=cv,!.pv=pv,
                   !.link=[gen|->r.gen,cv|->cv,pv|->pv]]
       /\ e'=[e EXCEPT !.acceptedCount=@+1]
 /\ UNCHANGED callbacks

LeaderReady ==
 /\ Available /\ r.status \in {"accepted","following"} /\ ~r.leaderReady
 /\ r'=[r EXCEPT !.leaderReady=TRUE,
              !.exitDone=IF Fault="leader-exit" /\ r.exitRequired THEN TRUE ELSE @]
 /\ e'=[e EXCEPT !.ahead=@ \/ (r.exitRequired /\ ~r.exitDone /\ ~ActualExit(w.position))]
 /\ UNCHANGED <<w,callbacks>>

Advance(p,shape) ==
 /\ r.status \in {"accepted","following"} /\ r.leaderReady
 /\ p \in Positions /\ shape \in {"clear","middle-outside","wrong-exit"}
 /\ Environment#"cooperative" \/ (p=GoodTarget /\ shape="clear")
 /\ LET gate==Available /\ BindingCurrent
        path==IF Fault="endpoint-only" THEN OrderCurrent(p) ELSE WholeSafe(p,shape)
        allowed==(gate \/ Fault="stale-binding") /\ path
        moved==allowed \/ Fault="move-before-check"
        actual==gate /\ WholeSafe(p,shape)
        exited==r.exitRequired /\ ~r.exitDone /\ p="exit"
        stage==IF NextStage(p)<=Len(r.itinerary) THEN NextStage(p) ELSE r.stage
        pv==IF moved THEN w.pv ELSE w.pv+1
    IN /\ w'=[w EXCEPT !.position=IF moved THEN p ELSE @,!.pv=pv]
       /\ r'=[r EXCEPT !.status=IF moved THEN IF p=Goal THEN "arrived" ELSE "following" ELSE "paused",
                  !.pv=pv,!.leaderReady=FALSE,!.stage=IF moved THEN stage ELSE @,
                  !.exitDone=IF moved /\ exited THEN TRUE ELSE @]
       /\ e'=[e EXCEPT !.badMove=@ \/ (moved /\ ~gate),!.badPath=@ \/ (moved /\ ~WholeSafe(p,shape)),
                  !.badStage=@ \/ (moved /\ ~OrderCurrent(p)),
                  !.exited=IF moved /\ actual /\ exited THEN @ \cup {r.gen} ELSE @,
                  !.pausedPlans=IF ~moved THEN @ \cup {r.gen} ELSE @,
                  !.overlapAfterExit=@ \/ (moved /\ r.exitDone /\ p="overlap")]
 /\ UNCHANGED callbacks

Invalidate(k) ==
 /\ Environment="adversarial" /\ ~e.changed /\ w.running /\ r.gen>0
 /\ k \in {"subject","leader","map","pause","end","withdraw"}
 /\ w'=[w EXCEPT !.subjectEpoch=IF k="subject" THEN @+1 ELSE @,
           !.leaderEpoch=IF k="leader" THEN @+1 ELSE @,!.map=IF k="map" THEN @+1 ELSE @,
           !.paused=IF k="pause" THEN TRUE ELSE @,!.running=IF k="end" THEN FALSE ELSE @,
           !.cv=IF k="withdraw" THEN @+1 ELSE @,
           !.consent=IF k="withdraw" THEN "withdrawn" ELSE @]
 /\ e'=[e EXCEPT !.changed=TRUE]
 /\ UNCHANGED <<r,callbacks>>

Fence ==
 /\ r.status \in (Active \cup {"proposed"})
 /\ ~Available \/ ~AuthorityCurrent \/ (r.status \in Active /\ ~BindingCurrent)
 /\ r'=[r EXCEPT !.status="paused",!.pv=w.pv+1,!.leaderReady=FALSE]
 /\ w'=[w EXCEPT !.pv=@+1]
 /\ e'=[e EXCEPT !.pausedPlans=@ \cup {r.gen}]
 /\ UNCHANGED callbacks

Resume ==
 /\ w.paused /\ ~e.resumed
 /\ w'=[w EXCEPT !.paused=FALSE]
 /\ r'=[r EXCEPT !.status=IF Fault="auto-resume" /\ r.status="paused" THEN "following" ELSE @]
 /\ e'=[e EXCEPT !.resumed=TRUE]
 /\ UNCHANGED callbacks

PrepareConfirmation ==
 /\ Available /\ BindingCurrent /\ r.status="arrived" /\ w.position=Goal
 /\ r.gen \notin e.createdCallbacks
 /\ callbacks'=callbacks \cup {[gen|->r.gen,cv|->w.cv,pv|->w.pv,subjectEpoch|->w.subjectEpoch,
                                leaderEpoch|->w.leaderEpoch,map|->w.map]}
 /\ e'=[e EXCEPT !.createdCallbacks=@ \cup {r.gen}]
 /\ UNCHANGED <<w,r>>

CheckArrivedLeader(shape) ==
 /\ Environment="adversarial" /\ r.status="arrived" /\ Available
 /\ shape \in {"clear","middle-outside","wrong-exit"}
 /\ LET stopped==shape#"clear" /\ Fault#"arrived-skip"
    IN /\ r'=[r EXCEPT !.status=IF stopped THEN "paused" ELSE @,
                  !.pv=IF stopped THEN w.pv+1 ELSE @]
       /\ w'=[w EXCEPT !.pv=IF stopped THEN @+1 ELSE @]
       /\ e'=[e EXCEPT !.pausedPlans=IF stopped THEN @ \cup {r.gen} ELSE @,
                  !.badArrived=@ \/ (shape#"clear" /\ ~stopped)]
 /\ UNCHANGED callbacks

Confirm(c) ==
 /\ c \in callbacks
 /\ LET valid==Available /\ BindingCurrent /\ r.status="arrived" /\ w.position=Goal
                /\ c.gen=r.gen /\ c.cv=w.cv /\ c.pv=w.pv
                /\ c.subjectEpoch=w.subjectEpoch /\ c.leaderEpoch=w.leaderEpoch /\ c.map=w.map
        accepted==valid \/ Fault="stale-confirm"
    IN /\ w'=[w EXCEPT !.safe=@ \/ accepted]
       /\ r'=[r EXCEPT !.status=IF accepted THEN "settled" ELSE @]
       /\ e'=[e EXCEPT !.everSafe=@ \/ accepted,!.badSettlement=@ \/ (accepted /\ ~valid)]
 /\ callbacks'=callbacks \ {c}

Rest ==
 /\ ~w.running \/ r.status \in {"paused","settled","arrived"}
 /\ UNCHANGED vars
Next == Propose \/ Accept \/ LeaderReady \/ (\E p \in Positions, s \in {"clear","middle-outside","wrong-exit"}: Advance(p,s))
        \/ (\E k \in {"subject","leader","map","pause","end","withdraw"}: Invalidate(k))
        \/ Fence \/ Resume \/ PrepareConfirmation \/ (\E c \in callbacks: Confirm(c))
        \/ (\E s \in {"clear","middle-outside","wrong-exit"}: CheckArrivedLeader(s)) \/ Rest
Spec == Init /\ [][Next]_vars
AdvanceAny == \E p \in Positions, s \in {"clear","middle-outside","wrong-exit"}: Advance(p,s)
ConfirmAny == \E c \in callbacks: Confirm(c)
LiveSpec == Spec /\ WF_vars(Propose) /\ WF_vars(Accept) /\ WF_vars(LeaderReady)
 /\ WF_vars(AdvanceAny) /\ WF_vars(PrepareConfirmation) /\ WF_vars(ConfirmAny)

TypeOK == w.position \in Positions /\ r.gen \in 0..MaxPlans
 /\ r.status \in {"none","proposed","accepted","following","paused","arrived","settled"}
 /\ r.stage \in 1..Len(r.itinerary) /\ w.safe \in BOOLEAN
 /\ w.subjectEpoch \in 0..1 /\ w.leaderEpoch \in 0..1 /\ w.map \in 0..1
OriginAndSources == r.gen>0 => r.originB=(r.start \in B) /\ r.sources=RequiredSources(r.start)
ExitBySubject == r.exitDone => r.gen \in e.exited
WholePathFence == ~e.badPath
CurrentExecutionFence == ~e.badMove /\ ~e.badStage
PausedNeedsProposal == r.gen \in e.pausedPlans => r.status \notin Active
SettlementCurrent == ~e.badSettlement
ArrivalStillGuarded == ~e.badArrived
SafetyDurable == e.everSafe => w.safe
RouteProgress == <>w.safe
Witness == CASE Probe="route" -> w.safe
 [] Probe="reproposal" -> e.reproposed /\ r.gen=2 /\ ~r.exitDone /\ r.status="proposed"
 [] Probe="overlap" -> e.overlapAfterExit
 [] Probe="leader-first" -> e.ahead /\ r.gen \in e.exited
 [] OTHER -> FALSE
NoWitness == ~Witness
=============================================================================
