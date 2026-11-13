-------------------------- MODULE RecoveryWake --------------------------
EXTENDS Naturals, Sequences, FiniteSets

(* A3 恢复与语义水位。单角色抽象复用 #27 的公平调度与原请求幂等前提。
   Plan 是有限外部工作集；每项是一个真实提交事务，通知可乱序并重复一次。
   pause-resume 在一个事务内保留两个有序 clock，初始事实与通知严格分开。
   Fault 仅隔离负对照；不作状态裁剪。 *)
CONSTANTS Event1, Event2, Event3, Event4, EventCount, InitialPaused, HasReceipt, Budget, MaxFailures, Manual, Fault, Probe
VARIABLES w, a, old, seen, evidence
vars == <<w, a, old, seen, evidence>>

Plan == SubSeq(<<Event1,Event2,Event3,Event4>>,1,EventCount)
N == Len(Plan)
Seqs == 1..(2*N)
Kinds == {"resume", "clock", "pause", "pause-resume", "observation",
          "foreign-observation", "move", "revoke", "grant", "end"}
RecoveryPhases == {"BeforeRead", "DuringRead", "AfterReturn", "NeedSubmit", "ReceiptReturned"}
NormalPhases == {"ContextRead", "ContextHeld", "Reserved", "Inferring"}
Blocked == {"Unknown", "Unavailable", "BudgetExhausted"}
Phases == RecoveryPhases \cup NormalPhases \cup Blocked \cup {"Idle"}
Original == [raw |-> "original-raw", digest |-> "original-digest", nonce |-> "original-nonce",
             movementSeq |-> 1, receiptKey |-> "d1:submit"]
MaxSet(s) == IF s = {} THEN 0 ELSE CHOOSE x \in s: \A y \in s: y <= x
CurrentSeq == IF w.log = <<>> THEN 0 ELSE w.log[Len(w.log)].last
AllSemantic == UNION {w.log[i].semantic: i \in 1..Len(w.log)}
ReserveReady == w.running /\ w.allowed /\ a.reservations < Budget
Ready == ReserveReady /\ ~w.paused
AllDelivered == \A i \in 1..Len(w.log): seen[i] > 0
EnvFinished == Len(w.log) = N \/ ~w.running
Clock(seq, pause) == [seq |-> seq, kind |-> "clock", paused |-> pause, relevant |-> FALSE]
OtherEvent(seq, kind, relevant) == [seq |-> seq, kind |-> kind, paused |-> FALSE, relevant |-> relevant]

MakeTx(kind) ==
 LET first == CurrentSeq + 1
     evs == CASE kind = "pause-resume" -> <<Clock(first, TRUE), Clock(first+1, FALSE)>>
              [] kind = "resume" -> <<Clock(first, FALSE)>>
              [] kind = "pause" -> <<Clock(first, TRUE)>>
              [] kind = "clock" -> <<Clock(first, w.paused)>>
              [] OTHER -> <<OtherEvent(first, kind, kind = "observation")>>
     semantic == CASE kind = "pause-resume" -> {first+1}
                   [] kind = "resume" /\ w.paused -> {first}
                   [] kind \in {"observation","revoke","grant"} -> {first}
                   [] OTHER -> {}
 IN [kind |-> kind, before |-> w.paused, events |-> evs,
     semantic |-> semantic, last |-> CurrentSeq+Len(evs)]

(* 机制按私有的事务前态与本批有序 clock 折叠；不使用恢复快照猜测。 *)
NotifySemantic(tx) ==
 {tx.events[i].seq: i \in {j \in 1..Len(tx.events):
    LET event == tx.events[j]
        before == IF j=1 THEN
                    IF Fault="old25c" THEN a.cachedPause=1 ELSE tx.before
                  ELSE tx.events[j-1].paused
    IN ((event.kind="observation" /\ event.relevant) \/ event.kind \in {"revoke","grant"})
       \/ (event.kind="clock" /\ ~event.paused /\
             (before=TRUE \/ Fault="ordinary"))}}

Init ==
 /\ Plan \in Seq(Kinds) /\ N > 0
 /\ w = [running |-> TRUE, paused |-> InitialPaused, allowed |-> TRUE,
          epoch |-> 0, log |-> <<>>]
 /\ a = [phase |-> "BeforeRead", pending |-> 0, last |-> 0, dirty |-> "none",
          cachedPause |-> 0, readPause |-> FALSE,
          context |-> 0, contextEpoch |-> 0, trigger |-> 0,
          manualCause |-> FALSE, calls |-> 0, reservations |-> 0, retries |-> 0,
          cooldown |-> FALSE, ended |-> FALSE]
 /\ old = [receipt |-> IF HasReceipt THEN "accepted" ELSE "none",
            effects |-> IF HasReceipt THEN 1 ELSE 0, settled |-> FALSE,
            failures |-> 0, requests |-> {}, late |-> FALSE]
 /\ seen = [i \in 1..N |-> 0]
 /\ evidence = [required |-> {}, covered |-> {}, coveredWater |-> 0,
                 badRecoveryPlan |-> FALSE, badCause |-> FALSE,
                 badGate |-> FALSE, badConsume |-> FALSE,
                 manualUsed |-> FALSE, manualPendingSeq |-> 0, timing |-> {}, beforeSeq |-> 0,
                 duringSeq |-> 0, receiptSeq |-> 0,
                 contextRaceSeq |-> 0, retainedRace |-> FALSE,
                 duplicateAfterConsume |-> FALSE, batchSeen |-> FALSE,
                 blockedPending |-> FALSE, terminalClean |-> FALSE, preparedThenPaused |-> FALSE]

Commit ==
 /\ Len(w.log) < N /\ w.running
 /\ LET kind == Plan[Len(w.log)+1]
        tx == MakeTx(kind)
    IN w' = [w EXCEPT !.log = Append(@, tx),
              !.paused = CASE kind="resume" \/ kind="pause-resume" -> FALSE
                            [] kind="pause" -> TRUE [] OTHER -> @,
              !.allowed = CASE kind="revoke" -> FALSE [] kind="grant" -> TRUE [] OTHER -> @,
              !.epoch = IF kind \in {"revoke","grant"} THEN @+1 ELSE @,
              !.running = IF kind="end" THEN FALSE ELSE @]
 /\ UNCHANGED <<a, old, seen, evidence>>

Deliver(i) ==
 /\ i \in 1..Len(w.log) /\ seen[i] < 2
 /\ LET tx == w.log[i]
        incoming == NotifySemantic(tx)
        fresh == IF Fault="duplicate" THEN incoming ELSE {s \in incoming: s>a.last}
        high == MaxSet(fresh)
        stop == tx.kind="end"
        enabled == ~a.ended /\ ~stop
        pending == IF enabled THEN MaxSet({a.pending,high}) ELSE 0
        clocks == {j \in 1..Len(tx.events): tx.events[j].kind="clock"}
        lastClock == IF clocks={} THEN a.cachedPause ELSE IF tx.events[MaxSet(clocks)].paused THEN 1 ELSE 2
    IN /\ a' = [a EXCEPT !.pending = pending,
                  !.last = MaxSet({a.last,high}),
                  !.dirty = IF stop THEN "none"
                            ELSE IF enabled /\ high>0 /\ a.phase \in Blocked THEN "semantic"
                            ELSE @,
                  !.cachedPause = lastClock,
                  !.ended = @ \/ (Probe="terminal" /\ stop /\ a.pending>0)]
       /\ evidence' = [evidence EXCEPT
             !.required = @ \cup (IF enabled THEN tx.semantic ELSE {}),
             !.timing = @ \cup (IF FALSE THEN {a.phase} ELSE {}),
             !.beforeSeq = IF Probe="before-read" /\ tx.kind=Event1 /\ enabled /\ tx.semantic#{} /\ a.phase="BeforeRead"
                           THEN MaxSet(tx.semantic) ELSE @,
             !.duringSeq = IF Probe="during-read" /\ tx.kind=Event1 /\ enabled /\ tx.semantic#{} /\ a.phase="DuringRead"
                           THEN MaxSet(tx.semantic) ELSE @,
             !.receiptSeq = IF Probe="receipt" /\ tx.kind=Event1 /\ enabled /\ tx.semantic#{} /\ a.phase \in {"AfterReturn","NeedSubmit","ReceiptReturned"}
                            THEN MaxSet(tx.semantic) ELSE @,
             !.contextRaceSeq = IF Probe \in {"context-race","reserve-race"} /\ enabled /\
                 (IF Probe="reserve-race" THEN a.phase="Reserved" ELSE a.phase="ContextHeld") /\ MaxSet(tx.semantic)>a.context
                                THEN MaxSet(tx.semantic) ELSE @,
             !.duplicateAfterConsume = @ \/ (Probe="duplicate" /\ seen[i]>0 /\ tx.semantic#{} /\ tx.semantic \subseteq evidence.covered),
             !.batchSeen = @ \/ (Probe="batch" /\ tx.kind="pause-resume"),
             !.terminalClean = @ \/ (Probe="terminal" /\ stop /\ a.pending>0)]
 /\ seen' = [seen EXCEPT ![i] = @+1]
 /\ UNCHANGED <<w,old>>

RecoveryRead ==
 /\ a.phase="BeforeRead"
 /\ Fault#"old25c" \/ Probe#"before-read-only" \/ seen[1]>0
 /\ a' = [a EXCEPT !.phase="DuringRead", !.readPause=w.paused]
 /\ UNCHANGED <<w,old,seen,evidence>>

RecoveryReturn ==
 /\ a.phase="DuringRead"
 /\ LET compensate == Fault="old25c" /\ a.readPause /\ a.cachedPause=2
        resumed == MaxSet(evidence.required)
    IN a' = [a EXCEPT !.phase="AfterReturn",
              !.pending=IF compensate THEN MaxSet({a.pending,resumed}) ELSE @,
              !.cachedPause=IF a.cachedPause=0 THEN IF a.readPause THEN 1 ELSE 2 ELSE @]
 /\ UNCHANGED <<w,old,seen,evidence>>

LookupReceipt ==
 /\ a.phase="AfterReturn" /\ w.allowed
 /\ a' = [a EXCEPT !.phase=IF old.receipt="none" THEN "NeedSubmit" ELSE "ReceiptReturned"]
 /\ UNCHANGED <<w,old,seen,evidence>>

(* 迟到原提交与原键重试共用一个幂等边界；不假设“查询无记录”能排除在途提交。 *)
LateOriginalCommit ==
 /\ ~HasReceipt /\ ~old.late /\ old.receipt="none" /\ ~old.settled
 /\ w.running /\ ~w.paused /\ w.allowed /\ w.epoch=0
 /\ old' = [old EXCEPT !.receipt="accepted", !.effects=@+1, !.late=TRUE]
 /\ UNCHANGED <<w,a,seen,evidence>>

SubmitOriginal ==
 /\ a.phase="NeedSubmit" /\ w.allowed
 /\ LET tuple == IF Fault="identity" THEN [Original EXCEPT !.nonce="new-nonce"] ELSE Original
        allowed == w.running /\ ~w.paused /\ w.allowed /\ w.epoch=0
        existing == old.receipt#"none"
    IN old' = [old EXCEPT !.requests=@ \cup {tuple},
                 !.receipt=IF existing THEN @ ELSE IF allowed THEN "accepted" ELSE "rejected",
                 !.effects=IF (allowed /\ ~existing) \/ (Fault="repeat-effect" /\ existing)
                           THEN @+1 ELSE @]
 /\ a' = [a EXCEPT !.phase="ReceiptReturned"]
 /\ UNCHANGED <<w,seen,evidence>>

FinishOld ==
 /\ a.phase="ReceiptReturned" /\ w.allowed
 /\ old' = [old EXCEPT !.settled=TRUE]
 /\ a' = [a EXCEPT !.phase="Idle", !.retries=0,
            !.dirty=IF @="auto" \/ @="semantic" THEN "none" ELSE @,
            !.pending=IF Fault="recovery-consume" THEN 0 ELSE @]
 /\ evidence' = [evidence EXCEPT !.badConsume=@ \/ (Fault="recovery-consume" /\ a.pending>0)]
 /\ UNCHANGED <<w,seen>>

RecoveryUnknown ==
 /\ a.phase \in RecoveryPhases /\ old.failures < MaxFailures
 /\ old' = [old EXCEPT !.failures=@+1,
              !.receipt=IF Fault="unknown-reject" THEN "rejected" ELSE @,
              !.settled=IF Fault="unknown-reject" THEN TRUE ELSE @]
 /\ a' = [a EXCEPT !.phase="Unknown", !.cooldown=TRUE,
            !.dirty=IF a.retries<3 \/ (Fault="overretry" /\ a.retries<4) THEN "auto" ELSE "none"]
 /\ UNCHANGED <<w,seen,evidence>>

RecoveryDenied ==
 /\ a.phase \in RecoveryPhases /\ ~w.allowed
 /\ a' = [a EXCEPT !.phase="Unavailable", !.dirty="none"]
 /\ evidence' = [evidence EXCEPT !.blockedPending=@ \/ (Probe="blocked" /\ a.pending>0)]
 /\ UNCHANGED <<w,old,seen>>

RestartRecovery ==
 /\ a.phase \in Blocked /\ ~old.settled /\ ~a.ended /\ ~a.cooldown
 /\ a.dirty#"none" \/ (Fault="pending-spin" /\ a.pending>0 /\ a.retries<4)
 /\ a' = [a EXCEPT !.phase="BeforeRead", !.dirty="none",
            !.retries=IF a.dirty="auto" \/ a.dirty="none" THEN @+1 ELSE @]
 /\ UNCHANGED <<w,old,seen,evidence>>

ExplicitRecovery ==
 /\ Manual /\ ~evidence.manualUsed /\ a.phase \in Blocked /\ ~old.settled
 /\ a' = [a EXCEPT !.phase="BeforeRead", !.dirty="none"]
 /\ evidence' = [evidence EXCEPT !.manualUsed=TRUE,
                 !.manualPendingSeq=IF Probe="explicit" THEN a.pending ELSE @]
 /\ UNCHANGED <<w,old,seen>>

Elapse ==
 /\ a.cooldown
 /\ a' = [a EXCEPT !.cooldown=FALSE]
 /\ UNCHANGED <<w,old,seen,evidence>>

StartNormal ==
 /\ a.phase="Idle" /\ old.settled /\ ~a.ended /\ ~a.cooldown
 /\ a.pending>0 \/ a.dirty="manual"
 /\ a' = [a EXCEPT !.phase="ContextRead", !.trigger=a.pending,
            !.manualCause=a.dirty="manual", !.dirty="none"]
 /\ UNCHANGED <<w,old,seen,evidence>>

RecheckNormal ==
 /\ a.phase \in Blocked /\ old.settled /\ a.dirty#"none" /\ ~a.ended
 /\ a' = [a EXCEPT !.phase="Idle"]
 /\ UNCHANGED <<w,old,seen,evidence>>

ReadContext ==
 /\ a.phase="ContextRead" /\ Ready /\ ~a.ended
 /\ a' = [a EXCEPT !.phase="ContextHeld", !.context=CurrentSeq, !.contextEpoch=w.epoch]
 /\ UNCHANGED <<w,old,seen,evidence>>

(* 准备、reserve提交、reserve返回后的消费分为三步。
   暂停检查在准备 context；已准备后的暂停不取消推理。
   当前授权/epoch/运行态/预算在 reserve 提交点校验，不能把它夸大为返回时重验。
   已提交后可以有新的通知；消费始终只确认 context.baseSeq 以内的语义。
   calls 是编排器通过预留后进入调用分支的次数，不是外部供应商实际网络计数。 *)
ReserveNormal ==
 /\ a.phase="ContextHeld"
 /\ (ReserveReady /\ ~a.ended /\ a.contextEpoch=w.epoch) \/ Fault="gate"
 /\ a.reservations < Budget+1
 /\ a' = [a EXCEPT !.phase="Reserved", !.reservations=@+1]
 /\ evidence' = [evidence EXCEPT !.badGate=@ \/ ~(ReserveReady /\ ~a.ended /\ a.contextEpoch=w.epoch)]
 /\ UNCHANGED <<w,old,seen>>

AdmitNormal ==
 /\ a.phase="Reserved"
 /\ a.calls < Budget+1
 /\ a' = [a EXCEPT !.phase="Inferring", !.calls=@+1,
            !.last=MaxSet({a.last,a.context}),
            !.pending=IF Fault="clear-newer" \/ a.pending<=a.context THEN 0 ELSE @]
 /\ evidence' = [evidence EXCEPT
          !.covered=@ \cup {s \in AllSemantic: s<=a.context},
          !.coveredWater=MaxSet({@,a.context}),
          !.badRecoveryPlan=@ \/ ~old.settled,
          !.badCause=@ \/ (~a.manualCause /\
                (a.trigger=0 \/ a.trigger \notin AllSemantic \/ a.trigger<=evidence.coveredWater)),
          !.preparedThenPaused=@ \/ (Probe="prepared-pause" /\ w.paused),
          !.retainedRace=@ \/ (Probe \in {"context-race","reserve-race"} /\ evidence.contextRaceSeq>a.context /\ a.pending>=evidence.contextRaceSeq /\ Fault#"clear-newer")]
 /\ UNCHANGED <<w,old,seen>>

NormalDenied ==
 /\ a.phase \in {"ContextRead","ContextHeld"}
 /\ (a.phase="ContextRead" /\ ~Ready) \/ a.ended
       \/ (a.phase="ContextHeld" /\ (~ReserveReady \/ a.contextEpoch#w.epoch))
 /\ a' = [a EXCEPT !.phase=IF a.ended THEN "Idle"
                  ELSE IF a.reservations>=Budget THEN "BudgetExhausted"
                  ELSE IF ~w.allowed \/ (a.phase="ContextRead" /\ w.paused) THEN "Unavailable"
                  ELSE "Idle",
            !.dirty=IF a.reservations>=Budget THEN "none" ELSE @]
 /\ evidence' = [evidence EXCEPT !.blockedPending=@ \/ (Probe="blocked" /\ a.pending>0)]
 /\ UNCHANGED <<w,old,seen>>

FinishNormal ==
 /\ a.phase="Inferring"
 /\ a' = [a EXCEPT !.phase="Idle", !.cooldown=TRUE]
 /\ UNCHANGED <<w,old,seen,evidence>>

BadRecoveryPlan ==
 /\ Fault="recovery-plan" /\ a.phase="ReceiptReturned" /\ ~old.settled
 /\ a' = [a EXCEPT !.calls=@+1]
 /\ evidence' = [evidence EXCEPT !.badRecoveryPlan=TRUE]
 /\ UNCHANGED <<w,old,seen>>

BadType ==
 /\ Fault="type" /\ a.last<=2*N
 /\ a' = [a EXCEPT !.last=2*N+1]
 /\ UNCHANGED <<w,old,seen,evidence>>

Rest ==
 /\ EnvFinished /\ AllDelivered
 /\ ((a.phase="Idle" /\ (a.ended \/ (a.pending=0 /\ a.dirty="none")))
    \/ (a.phase \in Blocked /\ (a.dirty="none" \/ a.ended)))
 /\ UNCHANGED vars

Next == Commit \/ (\E i \in 1..N: Deliver(i)) \/ RecoveryRead \/ RecoveryReturn
        \/ LookupReceipt \/ LateOriginalCommit \/ SubmitOriginal \/ FinishOld
        \/ RecoveryUnknown \/ RecoveryDenied \/ RestartRecovery \/ ExplicitRecovery
        \/ Elapse \/ StartNormal \/ RecheckNormal \/ ReadContext \/ ReserveNormal \/ AdmitNormal
        \/ NormalDenied \/ FinishNormal \/ BadRecoveryPlan \/ BadType \/ Rest

Spec == Init /\ [][Next]_vars
FirstDeliver(i) == seen[i]=0 /\ Deliver(i)
LiveSpec == Spec
 /\ WF_vars(Commit) /\ (\A i \in 1..N: WF_vars(FirstDeliver(i)))
 /\ WF_vars(RecoveryRead) /\ WF_vars(RecoveryReturn) /\ WF_vars(LookupReceipt)
 /\ WF_vars(SubmitOriginal) /\ WF_vars(FinishOld) /\ WF_vars(RecoveryDenied)
 /\ WF_vars(RestartRecovery) /\ WF_vars(Elapse) /\ WF_vars(StartNormal)
 /\ WF_vars(RecheckNormal) /\ WF_vars(ReadContext) /\ WF_vars(ReserveNormal) /\ WF_vars(AdmitNormal)
 /\ WF_vars(NormalDenied) /\ WF_vars(FinishNormal)

TypeOK ==
 /\ w.running \in BOOLEAN /\ w.paused \in BOOLEAN /\ w.allowed \in BOOLEAN
 /\ w.epoch \in 0..N /\ Len(w.log)<=N
 /\ a.phase \in Phases /\ a.pending \in 0..(2*N) /\ a.last \in 0..(2*N)
 /\ a.context \in 0..(2*N) /\ a.calls \in 0..(Budget+1) /\ a.reservations \in 0..(Budget+1) /\ a.retries \in 0..4
 /\ a.dirty \in {"none","auto","semantic","manual"}
 /\ seen \in [1..N -> 0..2] /\ old.failures \in 0..MaxFailures
 /\ old.receipt \in {"none","accepted","rejected"} /\ old.effects \in 0..2
 /\ evidence.required \subseteq Seqs /\ evidence.covered \subseteq Seqs
OriginalRequestPreserved == old.requests \subseteq {Original}
OldEffectAtMostOnce == old.effects<=1
RecoveryDoesNotPlan == ~evidence.badRecoveryPlan
UnknownKeepsOriginalOutcome == (HasReceipt => old.receipt="accepted")
                         /\ (a.phase="Unknown" => ~old.settled)
PendingSemanticPreserved == w.running /\ ~a.ended =>
             evidence.required \subseteq (evidence.covered \cup (1..a.pending))
PlannedForFreshCause == ~evidence.badCause
AuthorizedAdmission == ~evidence.badGate /\ a.calls<=a.reservations /\ a.reservations<=Budget
AutomaticRetryBound == a.retries<=3
OnlyContextConsumes == ~evidence.badConsume

(* 先收束原请求是显式前提；永久 Unknown/耗尽而无新触发时不虚构进展。
   Ready 为当前剩余预算、非终态、未暂停、当前授权；最终稳定具备才承诺。 *)
SemanticProgress ==
 (<>[]Ready /\ <>old.settled) =>
   (\A s \in Seqs: (s \in evidence.required ~> s \in evidence.covered))

Witness == CASE Probe="before-read" -> evidence.beforeSeq>0 /\ old.settled /\ evidence.beforeSeq \in evidence.covered
 [] Probe="during-read" -> evidence.duringSeq>0 /\ old.settled /\ evidence.duringSeq \in evidence.covered
 [] Probe="receipt" -> evidence.receiptSeq>0 /\ old.settled /\ evidence.receiptSeq \in evidence.covered
 [] Probe \in {"context-race","reserve-race"} -> evidence.retainedRace /\ evidence.contextRaceSeq \in evidence.covered /\ a.calls>=2
 [] Probe="duplicate" -> evidence.duplicateAfterConsume
 [] Probe="batch" -> evidence.batchSeen /\ 2 \in evidence.covered
 [] Probe="retry-bound" -> a.phase="Unknown" /\ a.retries=3 /\ a.dirty="none" /\ a.pending>0 /\ a.calls=0
 [] Probe="explicit" -> evidence.manualUsed /\ evidence.manualPendingSeq>0 /\ old.settled
                          /\ evidence.manualPendingSeq \in evidence.covered
 [] Probe="blocked" -> evidence.blockedPending
 [] Probe="terminal" -> evidence.terminalClean /\ a.pending=0 /\ a.dirty="none" /\ a.ended
 [] Probe="prepared-pause" -> evidence.preparedThenPaused
 [] Probe="pure-recovery" -> old.settled /\ a.phase="Idle" /\ a.calls=0 /\ evidence.required={}
 [] OTHER -> FALSE
NoWitness == ~Witness
=============================================================================
