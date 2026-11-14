-------------------------- MODULE SceneRequest --------------------------
EXTENDS Naturals, Sequences, FiniteSets

(* 单 scene actor 的授权评估、原持久请求与私有语义水位。
   basis 始终完整保存；Projection 仅选择本动作应比较的依赖。
   Start 捕获调用入口已接收语义；Evaluate 是稍后的 Session 事务；
   Consume 是返回后的唯一确认点，三者可与通知提交和投递交错。
   Receipt 原子 observedSeq 与恢复副本分开保存；旧拒绝等待只确认入口水位。
   Fault 选择隔离负控。旧 9b 的 withdraw 对 incidental 资格过度绑定。 *)
CONSTANTS Flow, Event1, Event2, EventCount, Window, InitialDependency,
          MaxRequests, MaxFailures, AllowCrash, Fault, Probe
VARIABLES w, d, a, notices, seen, e
vars == <<w,d,a,notices,seen,e>>
Plan == SubSeq(<<Event1,Event2>>,1,EventCount)
Ids == 1..MaxRequests
NoticeIds == 1..(EventCount+MaxRequests)
Max2(x,y) == IF x>y THEN x ELSE y
PendingIds == {i \in 1..Len(d.requests): d.outcome[i]="none"}
First(s) == CHOOSE i \in s: \A j \in s: i<=j
Available == w.auth /\ w.running /\ ~w.paused
Choice == IF ~Available \/ (w.done /\ Flow#"repeatable") THEN "none"
          ELSE IF Flow="withdraw" THEN "withdraw"
          ELSE IF Flow="response" THEN IF w.dep THEN "accept" ELSE "defer"
          ELSE IF w.dep THEN Flow ELSE "none"
Basis == [common|->w.common,dep|->w.dep,inc|->w.inc,cv|->w.cv,pv|->w.pv,seq|->w.seq]
DecisionProjection(b) == [common|->b.common,cv|->b.cv,pv|->b.pv,
                         dep|->IF Flow="withdraw" THEN TRUE ELSE b.dep]
Projection(b) == [common|->IF Fault="drop-common" THEN 0 ELSE b.common,cv|->b.cv,pv|->b.pv,
                  dep|->IF Flow="withdraw" THEN TRUE ELSE b.dep,
                  inc|->IF Fault="old9b" THEN b.inc ELSE FALSE,
                  seq|->IF Fault="global-seq" THEN b.seq ELSE 0]
Current(r) == Available /\ r.action=Choice /\ Projection(r.basis)=Projection(Basis)
AuthoritativeCurrent(r) == Available /\ r.action=Choice /\ DecisionProjection(r.basis)=DecisionProjection(Basis)
InputSignal == IF Fault="global-signal" THEN w.seq ELSE a.semantic
NewSignalAfterRejection(i) == d.outcome[i]="Rejected" /\ InputSignal>d.outcomeSeq[i]
KnownResult == IF Len(d.requests)=0 THEN FALSE
              ELSE LET i==Len(d.requests) IN
                d.outcome[i]#"none" /\ (d.outcome[i]="Accepted" \/
                  (Projection(d.requests[i].basis)=Projection(Basis) /\
                   (Fault="cached-rejection" \/ ~NewSignalAfterRejection(i))))
Request(i) == [id|->i,raw|-><<"original-raw",i>>,digest|-><<"original-digest",i>>,nonce|->i,
               movementSeq|->i,action|->Choice,basis|->Basis,step|->"current-step",
               previous|->IF Fault="wrong-parent" THEN 0 ELSE i-1,attempt|->i]
Queued == a.bootstrap \/ a.pending>a.last \/ (Fault="duplicate" /\ a.pending>0)
RealSignals == {notices[i].seq: i \in {j \in 1..Len(notices): notices[j].required}}
LateInputWindows == {"resume-before-read","resume-late-notice"}
HeldSubmitWindows == {"prepared","pause-submit","rejected-unknown"} \cup LateInputWindows
Notice(kind,required,relevant,seq) ==
 [kind|->kind,required|->required,relevant|->relevant,seq|->seq,actor|->"self"]

Init ==
 /\ EventCount \in 0..2 /\ MaxRequests>0
 /\ w=[auth|->TRUE,running|->TRUE,paused|->FALSE,common|->0,dep|->InitialDependency,
       inc|->FALSE,done|->FALSE,seq|->0,cv|->0,pv|->0,external|->0]
 /\ d=[requests|-><<>>,originals|-><<>>,receipts|->[i \in Ids|->"none"],
       originalsReceipt|->[i \in Ids|->"none"],outcome|->[i \in Ids|->"none"],
       receiptSeq|->[i \in Ids|->0],originalSeq|->[i \in Ids|->0],outcomeSeq|->[i \in Ids|->0],
       effects|->0,completed|->FALSE,link|->[id|->0,cv|->0,pv|->0]]
 /\ a=[phase|->"BeforeRecovery",id|->0,through|->0,kind|->"none",last|->0,pending|->0,
       bootstrap|->TRUE,needsRecovery|->TRUE,retries|->0,failures|->0,
       manual|->FALSE,crashed|->FALSE,terminal|->FALSE,reply|->"none",finishing|->FALSE,
       semantic|->0,consumeThrough|->0,waiting|->FALSE,callBootstrap|->TRUE]
 /\ notices = <<>> /\ seen=[i \in NoticeIds|->0]
 /\ e=[covered|->0,required|->{},evaluations|->0,settled|->FALSE,
       badReplay|->FALSE,badRead|->FALSE,badCommit|->FALSE,badCreate|->FALSE,
       badConsume|->FALSE,badLink|->FALSE,badCause|->FALSE,hitBound|->FALSE,
       replayed|->FALSE,sceneCosts|->0,npcCosts|->0,lateKept|->FALSE,
       crashPending|->FALSE,automatic|->0,badAttempt|->FALSE,badNarrow|->FALSE,
       badInput|->FALSE,cacheWait|->FALSE,lateWaited|->FALSE,inputLag|->FALSE,
       recoveredRejected|->FALSE,lostRejectedReply|->FALSE]

External ==
 /\ w.external<EventCount /\ w.running
 /\ (Window \notin HeldSubmitWindows \/ w.external>0 \/ a.phase="ReadySubmit")
 /\ (Window#"pause-submit" \/ w.external#1 \/ (a.phase="Idle" /\ d.outcome[1]="Rejected"))
 /\ (Window \notin LateInputWindows \/ w.external#1 \/
       (a.crashed /\ a.phase="BeforeEval" /\ d.outcome[1]="Rejected"))
 /\ (Window#"rejected-unknown" \/ w.external#1 \/
       (a.phase="BeforeRecovery" /\ a.failures=1 /\ d.receipts[1]="Rejected" /\ d.outcome[1]="none"))
 /\ (Window#"eval-return" \/ w.external>0 \/ a.phase="EvalReturn")
 /\ (Window#"recovery" \/ w.external>0 \/ a.phase="RecoveryReturn")
 /\ LET k==Plan[w.external+1]
        required==k \in {"common","revoke","grant","end","signal"}
                   \/ (k="dependency" /\ Flow#"withdraw") \/ (k="resume" /\ w.paused)
        relevant==IF Fault="miss-wake" /\ k \in {"common","dependency"} THEN FALSE
                  ELSE required \/ (Fault="ordinary" /\ k="noise")
    IN /\ w'=[w EXCEPT !.external=@+1,!.seq=@+1,
               !.common=IF k="common" THEN @+1 ELSE @,
               !.dep=IF k="dependency" THEN ~@ ELSE @,
               !.inc=IF k="incidental" THEN ~@ ELSE @,
               !.paused=CASE k="pause"->TRUE [] k="resume"->FALSE [] OTHER->@,
               !.auth=CASE k="revoke"->FALSE [] k="grant"->TRUE [] OTHER->@,
               !.running=IF k="end" THEN FALSE ELSE @]
       /\ notices'=Append(notices,Notice(k,required,relevant,w.seq+1))
 /\ UNCHANGED <<d,a,seen,e>>

Deliver(i) ==
 /\ i \in 1..Len(notices) /\ seen[i]<2
 /\ Window#"resume-late-notice" \/ i#2 \/ e.cacheWait
 /\ LET n==notices[i]
        stop==n.kind="end"
        fresh==n.relevant /\ ~a.terminal /\ (n.seq>a.last \/ Fault="duplicate")
    IN /\ a'=[a EXCEPT !.pending=IF stop \/ a.terminal THEN 0
                       ELSE IF fresh THEN Max2(@,n.seq) ELSE @,
                 !.terminal=@ \/ stop,!.bootstrap=IF stop THEN FALSE ELSE @]
       /\ e'=[e EXCEPT !.required=IF n.required THEN @ \cup {n.seq} ELSE @]
 /\ seen'=[seen EXCEPT ![i]=@+1]
 /\ UNCHANGED <<w,d,notices>>

Start ==
 /\ a.phase="Idle" /\ ~a.terminal /\ (a.needsRecovery \/ Queued)
 /\ a'=[a EXCEPT !.phase=IF a.needsRecovery THEN "BeforeRecovery" ELSE "BeforeEval",!.finishing=FALSE,
             !.semantic=IF a.needsRecovery THEN @ ELSE a.pending,
             !.callBootstrap=IF a.needsRecovery THEN @ ELSE a.bootstrap]
 /\ UNCHANGED <<w,d,notices,seen,e>>

RecoveryRead ==
 /\ a.phase="BeforeRecovery" /\ (w.auth \/ Fault="read-auth")
 /\ Window#"rejected-unknown" \/ d.receipts[1]#"Rejected" \/ d.outcome[1]#"none"
      \/ (w.external=2 /\ seen[2]>0)
 /\ LET i==IF PendingIds#{} THEN First(PendingIds) ELSE Len(d.requests)
        prior==IF i=0 THEN "none" ELSE d.receipts[i]
        wrong==IF i=0 THEN FALSE ELSE Fault="receipt-order" /\ prior#"none" /\ ~Current(d.requests[i])
    IN /\ d'=[d EXCEPT !.outcome=IF i#0 /\ prior#"none" THEN [@ EXCEPT ![i]=prior] ELSE @,
               !.outcomeSeq=IF i#0 /\ prior#"none" THEN
                 [@ EXCEPT ![i]=IF Fault="recovery-seq" THEN w.seq ELSE d.receiptSeq[i]] ELSE @]
       /\ a'=[a EXCEPT !.phase="RecoveryReturn",!.id=i,
                 !.kind=IF i#0 /\ prior="none" THEN "pending" ELSE "settled",
                 !.reply=IF wrong THEN "Rejected" ELSE prior,
                 !.pending=IF Fault="recovery-consume" THEN 0 ELSE @]
       /\ e'=[e EXCEPT !.badRead=@ \/ ~w.auth,!.badReplay=@ \/ wrong,
                 !.recoveredRejected=@ \/ (i#0 /\ prior="Rejected" /\ a.pending>d.receiptSeq[i]),
                 !.badConsume=@ \/ (Fault="recovery-consume" /\ a.pending>0)]
 /\ UNCHANGED <<w,notices,seen>>

RecoveryReturn ==
 /\ a.phase="RecoveryReturn"
 /\ Window#"recovery" \/ EventCount=0 \/ w.external>0
 /\ a'=[a EXCEPT !.phase=IF a.kind="pending" THEN "ReadySubmit" ELSE "Idle",
            !.needsRecovery=a.kind="pending",!.finishing=FALSE,
            !.retries=IF a.finishing /\ a.kind="settled" THEN 0 ELSE @]
 /\ e'=[e EXCEPT !.settled=@ \/ (a.id>0 /\ a.kind="settled")]
 /\ UNCHANGED <<w,d,notices,seen>>

Evaluate ==
 /\ a.phase="BeforeEval" /\ w.auth
 /\ Window \notin LateInputWindows \/ ~a.crashed \/
      (w.external=2 /\ (Window#"resume-before-read" \/ seen[2]>0))
 /\ LET unresolved==PendingIds#{} /\ Fault#"skip-recovery"
        known==(d.completed \/ KnownResult) /\ ~(Fault="volatile-dedup" /\ a.crashed)
        make==~unresolved /\ Choice#"none" /\ ~known
        bound==make /\ Len(d.requests)>=MaxRequests
        created==make /\ ~bound
        i==Len(d.requests)+1
        old==Len(d.requests)
        waiting==IF old=0 THEN FALSE ELSE
          ~unresolved /\ Choice#"none" /\ d.outcome[old]="Rejected" /\ KnownResult
        consumeWater==IF waiting /\ Fault \notin {"cached-rejection","wide-consume"} THEN a.semantic ELSE w.seq
        legitNext==IF old=0 THEN TRUE ELSE
          d.outcome[old]="Rejected" /\
          (DecisionProjection(d.requests[old].basis)#DecisionProjection(Basis) \/
           (a.semantic>d.receiptSeq[old] /\ a.semantic \in e.required))
    IN /\ a'=[a EXCEPT !.phase=IF unresolved THEN "BeforeRecovery" ELSE "EvalReturn",
                !.needsRecovery=unresolved,!.kind=IF created THEN "prepared" ELSE "idle",
                !.id=IF created THEN i ELSE 0,!.through=w.seq,
                !.consumeThrough=consumeWater,!.waiting=waiting]
       /\ d'=[d EXCEPT !.requests=IF created THEN Append(@,Request(i)) ELSE @,
                !.originals=IF created THEN Append(@,Request(i)) ELSE @]
       /\ e'=[e EXCEPT !.hitBound=@ \/ bound,
                !.badCreate=@ \/ (created /\ PendingIds#{}),
                !.badAttempt=@ \/ (created /\ ~legitNext),
                !.badCause=@ \/ (~unresolved /\ ~a.callBootstrap /\ (a.semantic \notin RealSignals \/ a.semantic<=a.last)),
                !.badInput=@ \/ (a.semantic>w.seq \/ (a.semantic#0 /\ a.semantic \notin e.required)),
                !.cacheWait=@ \/ waiting,
                !.inputLag=@ \/ (waiting /\ a.pending>a.semantic),
                !.sceneCosts=IF Fault="scene-budget" THEN 1 ELSE @]
 /\ UNCHANGED <<w,notices,seen>>

Consume ==
 /\ a.phase="EvalReturn"
 /\ Window#"eval-return" \/ EventCount=0 \/ w.external>0
 /\ a'=[a EXCEPT !.last=Max2(@,IF Fault="wide-last" THEN a.through ELSE a.consumeThrough),
            !.pending=IF Fault="clear-newer" \/ a.pending<=a.consumeThrough THEN 0 ELSE @,
            !.bootstrap=FALSE,!.phase=IF a.kind="prepared" THEN "ReadySubmit" ELSE "Idle",
            !.retries=IF a.kind="idle" THEN 0 ELSE @]
 /\ e'=[e EXCEPT !.covered=Max2(@,a.consumeThrough),!.evaluations=@+1,
            !.lateKept=@ \/ (a.pending>a.consumeThrough /\ Fault#"clear-newer"),
            !.badNarrow=@ \/ (a.waiting /\ (a.consumeThrough>a.semantic \/
                            (Fault="wide-last" /\ a.through>Max2(a.last,a.semantic)))),
            !.lateWaited=@ \/ (a.waiting /\ a.through>a.semantic /\ seen[2]=0 /\ w.external=2)]
 /\ UNCHANGED <<w,d,notices,seen>>

Submit ==
 /\ a.phase="ReadySubmit" /\ a.id \in 1..Len(d.requests) /\ w.auth
 /\ Window \notin HeldSubmitWindows \/ EventCount=0 \/ w.external>0
 /\ Window \notin HeldSubmitWindows \/ EventCount=0 \/ seen[1]>0
 /\ LET r==d.requests[a.id]
        prior==d.receipts[a.id]
        repeat==prior#"none" /\ Fault="repeat-effect"
        fresh==prior="none" \/ repeat
        accepted==fresh /\ (Current(r) \/ repeat \/ Fault="stale-basis")
        outcome==IF accepted THEN "Accepted" ELSE "Rejected"
        reply==IF prior#"none" /\ ~repeat THEN
                  IF Fault="receipt-order" /\ ~Current(r) THEN "Rejected" ELSE prior
               ELSE outcome
        newcv==w.cv+1
        newpv==w.pv+1
        linkcv==IF Fault="old-version" THEN r.basis.cv ELSE newcv
        linkpv==IF Fault="old-version" THEN r.basis.pv ELSE newpv
        observed==w.seq+(IF accepted THEN 1 ELSE 0)
    IN /\ d'=[d EXCEPT !.receipts=IF fresh THEN [@ EXCEPT ![a.id]=outcome] ELSE @,
                !.originalsReceipt=IF prior="none" THEN [@ EXCEPT ![a.id]=outcome] ELSE @,
                !.receiptSeq=IF fresh THEN [@ EXCEPT ![a.id]=observed] ELSE @,
                !.originalSeq=IF prior="none" THEN [@ EXCEPT ![a.id]=observed] ELSE @,
                !.effects=IF accepted THEN @+1 ELSE @,
                !.completed=@ \/ accepted,
                !.link=IF accepted /\ Flow="response" THEN [id|->a.id,cv|->linkcv,pv|->linkpv] ELSE @]
       /\ w'=[w EXCEPT !.done=@ \/ accepted,
                !.cv=IF accepted THEN newcv ELSE @,!.pv=IF accepted THEN newpv ELSE @,
                !.seq=IF accepted THEN @+1 ELSE @]
       /\ a'=[a EXCEPT !.phase="SubmitReturn",!.reply=reply,!.needsRecovery=TRUE]
       /\ notices'=IF accepted THEN Append(notices,Notice("effect",TRUE,TRUE,w.seq+1)) ELSE notices
       /\ e'=[e EXCEPT !.badReplay=@ \/ (prior#"none" /\ reply#prior),
                 !.badCommit=@ \/ (accepted /\ ~AuthoritativeCurrent(r) /\ ~repeat),
                 !.badLink=@ \/ (accepted /\ Flow="response" /\ (linkcv#newcv \/ linkpv#newpv))]
 /\ UNCHANGED seen

SubmitReturn ==
 /\ a.phase="SubmitReturn"
 /\ Window#"rejected-unknown" \/ a.failures>0 \/ d.receipts[1]#"Rejected"
 /\ a'=[a EXCEPT !.phase="BeforeRecovery",!.finishing=TRUE]
 /\ UNCHANGED <<w,d,notices,seen,e>>

Unknown ==
 /\ a.phase \in {"BeforeRecovery","RecoveryReturn","BeforeEval","EvalReturn","ReadySubmit","SubmitReturn"}
 /\ a.failures<MaxFailures /\ ~a.terminal
 /\ Window#"rejected-unknown" \/ (a.phase="SubmitReturn" /\ d.receipts[1]="Rejected" /\ d.outcome[1]="none")
 /\ a'=[a EXCEPT !.phase="Unknown",!.needsRecovery=TRUE,!.failures=@+1,!.finishing=FALSE]
 /\ e'=[e EXCEPT !.lostRejectedReply=@ \/ (a.phase="SubmitReturn" /\ d.receipts[1]="Rejected" /\ d.outcome[1]="none")]
 /\ UNCHANGED <<w,d,notices,seen>>

Retry ==
 /\ a.phase="Unknown" /\ ~a.terminal
 /\ a.retries<3 \/ (Fault="pending-spin" /\ a.pending>0 /\ a.retries<4)
 /\ a'=[a EXCEPT !.phase="BeforeRecovery",!.retries=@+1]
 /\ e'=[e EXCEPT !.automatic=@+1]
 /\ UNCHANGED <<w,d,notices,seen>>

Explicit ==
 /\ a.phase \in {"Unknown","Unavailable","Idle"} /\ ~a.manual
 /\ a'=[a EXCEPT !.phase="BeforeRecovery",!.needsRecovery=TRUE,!.manual=TRUE,!.retries=0,!.finishing=FALSE]
 /\ UNCHANGED <<w,d,notices,seen,e>>

Denied ==
 /\ a.phase \in {"BeforeRecovery","BeforeEval","ReadySubmit"} /\ ~w.auth
 /\ a'=[a EXCEPT !.phase="Unavailable"]
 /\ UNCHANGED <<w,d,notices,seen,e>>

Crash ==
 /\ AllowCrash /\ ~a.crashed /\ ~a.terminal
 /\ Window \notin LateInputWindows \/ (a.phase="Idle" /\ d.outcome[1]="Rejected" /\ w.external=1)
 /\ a'=[a EXCEPT !.phase="BeforeRecovery",!.needsRecovery=TRUE,!.bootstrap=TRUE,
             !.pending=0,!.last=0,!.retries=0,!.crashed=TRUE,!.finishing=FALSE]
 /\ d'=[d EXCEPT !.completed=IF Fault="volatile-dedup" THEN FALSE ELSE @,
             !.requests=IF Fault="rewrite" /\ Len(@)>0 THEN [@ EXCEPT ![1].raw = <<"rewritten-raw",1>>] ELSE @]
 /\ e'=[e EXCEPT !.crashPending=@ \/ (a.pending>e.covered)]
 /\ UNCHANGED <<w,notices,seen>>

SkipOriginal ==
 /\ Fault="skip-recovery" /\ a.phase="BeforeRecovery" /\ PendingIds#{}
 /\ Available /\ a.pending>a.last
 /\ a'=[a EXCEPT !.phase="BeforeEval",!.semantic=a.pending,!.callBootstrap=a.bootstrap]
 /\ UNCHANGED <<w,d,notices,seen,e>>

Replay ==
 /\ a.phase="Idle" /\ Len(d.requests)>0 /\ ~e.replayed
 /\ d.receipts[1]#"none"
 /\ a'=[a EXCEPT !.id=1,!.phase="ReadySubmit"]
 /\ e'=[e EXCEPT !.replayed=TRUE]
 /\ UNCHANGED <<w,d,notices,seen>>

AutonomousReact ==
 /\ Probe="indirect" /\ e.npcCosts=0
 /\ \E i \in 1..Len(notices): notices[i].kind="effect" /\ seen[i]>0
 /\ e'=[e EXCEPT !.npcCosts=1]
 /\ UNCHANGED <<w,d,a,notices,seen>>

Rest ==
 /\ w.external=EventCount \/ ~w.running
 /\ \A i \in 1..Len(notices): seen[i]>0
 /\ (a.phase="Idle" /\ (a.terminal \/ (~Queued /\ ~a.needsRecovery)))
     \/ a.phase="Unavailable" \/ (a.phase="Unknown" /\ (a.retries>=3 \/ a.terminal))
 /\ UNCHANGED vars
Next == External \/ (\E i \in NoticeIds: Deliver(i)) \/ Start \/ RecoveryRead \/ RecoveryReturn
        \/ Evaluate \/ Consume \/ Submit \/ SubmitReturn \/ Unknown \/ Retry \/ Explicit \/ Denied
        \/ Crash \/ SkipOriginal \/ Replay \/ AutonomousReact \/ Rest
Spec == Init /\ [][Next]_vars
FirstDeliver(i) == seen[i]=0 /\ Deliver(i)
LiveSpec == Spec /\ WF_vars(External) /\ (\A i \in NoticeIds: WF_vars(FirstDeliver(i)))
 /\ WF_vars(Start) /\ WF_vars(RecoveryRead) /\ WF_vars(RecoveryReturn)
 /\ WF_vars(Evaluate) /\ WF_vars(Consume) /\ WF_vars(Submit) /\ WF_vars(SubmitReturn)
 /\ WF_vars(Retry) /\ WF_vars(Denied)
 /\ (IF Window \in LateInputWindows THEN WF_vars(Crash) ELSE TRUE)

TypeOK == a.phase \in {"Idle","BeforeRecovery","RecoveryReturn","BeforeEval","EvalReturn","ReadySubmit","SubmitReturn","Unknown","Unavailable"}
 /\ Len(d.requests)<=MaxRequests /\ a.pending \in 0..(EventCount+MaxRequests)
 /\ a.last \in 0..(EventCount+MaxRequests) /\ a.retries \in 0..4
 /\ seen \in [NoticeIds -> 0..2] /\ d.effects \in 0..MaxRequests
 /\ d.completed \in BOOLEAN /\ w.external \in 0..EventCount
 /\ a.semantic \in 0..(EventCount+MaxRequests) /\ a.consumeThrough \in 0..(EventCount+MaxRequests)
 /\ d.receiptSeq \in [Ids -> 0..(EventCount+MaxRequests)]
RequestImmutable == d.requests=d.originals
ReceiptStable == d.receipts=d.originalsReceipt /\ ~e.badReplay /\ ~e.badRead
ReceiptWatermarkStable == d.receiptSeq=d.originalSeq /\
  (\A i \in Ids: d.outcome[i]#"none" => d.outcomeSeq[i]=d.receiptSeq[i])
AttemptLinked == \A i \in 1..Len(d.requests): d.requests[i].previous=i-1 /\ d.requests[i].attempt=i
RejectedAttemptAuthorized == ~e.badAttempt
RejectedWaitKeepsInputBoundary == ~e.badNarrow
TrustedPrepareInput == ~e.badInput
EffectOnce == d.effects<=1
CurrentChoiceAtCommit == ~e.badCommit
ExecutionLinkCurrent == ~e.badLink
SingleUnsettled == Cardinality(PendingIds)<=1 /\ ~e.badCreate
SemanticRetained == w.running /\ ~a.terminal /\ ~a.bootstrap =>
                   e.required \subseteq 1..Max2(e.covered,a.pending)
RecoveryNoConsumption == ~e.badConsume
FreshEvaluationCause == ~e.badCause
RetryBound == a.retries<=3
SceneBudgetSeparate == e.sceneCosts=0
CapacitySufficient == ~e.hitBound
DecisionProgress == (<>[]Available /\ (MaxFailures<=3)) => <>w.done
SemanticProgress == (<>[]Available /\ (MaxFailures<=3)) =>
                   (\A s \in NoticeIds: s \in e.required ~> s<=e.covered)
Witness == CASE Probe="late" -> e.lateKept /\ e.covered>=1 /\ e.evaluations>=2
 [] Probe="replay" -> e.replayed /\ e.settled /\ d.effects=1 /\ ~e.badReplay
 [] Probe="restart" -> a.crashed /\ e.settled /\ d.effects=1
 [] Probe="indirect" -> e.npcCosts=1 /\ e.sceneCosts=0
 [] Probe="retry" -> a.phase="Unknown" /\ a.retries=3 /\ a.pending>0
 [] Probe="captured-late" -> e.inputLag /\ Len(d.requests)=2 /\ d.effects=1 /\ d.receipts[1]="Rejected"
 [] Probe="late-delivery" -> e.lateWaited /\ Len(d.requests)=2 /\ d.effects=1 /\ d.receipts[1]="Rejected"
 [] Probe="rejected-recovered" -> e.lostRejectedReply /\ e.recoveredRejected /\ Len(d.requests)=2 /\ d.effects=1
 [] OTHER -> FALSE
NoWitness == ~Witness
=============================================================================
