------------------------- MODULE StickyAdmission -------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Fault, Scenario, InitialMode, InitialRows
VARIABLE s
vars == <<s>>
Peers == {1,2}
FairRun == Scenario \in {"fair-finite","fair-overlap"}
ProbeScenario == Scenario \in {"probe-try","probe-wait"}
HasPending == s.rowsLeft>0
Idle == ~s.running
EffectiveMode == IF Fault="all-try" THEN "try" ELSE IF s.pendingBlocking THEN "wait" ELSE "try"
NoReaders == s.readers={}
CanGrant == s.writer="none" /\ NoReaders
IsClean == ~s.gActive /\ ~s.rollbackPending /\ ~s.releasePending /\ ~s.queuedWait

\* 有限调度抽象。fresh 记录生产 generation 自本轮开始后
\* 是否至少改变一次，包含最后 probe 的 await 窗口。
\* owedPending/claimedWait 是规范见证，不是拟新增的产品字段。
Init == s=[
  stopped|->FALSE,running|->FALSE,scheduled|->TRUE,dirty|->TRUE,
  pendingBlocking|->InitialMode="wait",includeLegacy|->FALSE,
  owedPending|->InitialMode="wait",owedLegacy|->FALSE,
  runMode|->"none",frozenMode|->"none",runLegacy|->FALSE,
  claimedWait|->FALSE,claimedLegacy|->FALSE,fresh|->FALSE,
  stage|->"idle",runtimeOwned|->FALSE,externalOwner|->Scenario="busy",
  readers|->{},readerEntered|->{},writer|->"none",otherUsed|->FALSE,
  gActive|->FALSE,queuedWait|->FALSE,rollbackPending|->FALSE,releasePending|->FALSE,
  rowsLeft|->InitialRows,actual|->0,persistedAttempts|->0,callPublished|->FALSE,
  coverage|->Scenario#"zero",installation|->FALSE,mutationUsed|->FALSE,
  admissionCovered|->FALSE,checkedCovered|->FALSE,
  arrivals|->{},pulseBit|->FALSE,probeTry|->FALSE,
  fastMissSeen|->FALSE,waitQueuedSeen|->FALSE,waitCommittedSeen|->FALSE,
  busySeen|->FALSE,freshWaitSeen|->FALSE,inheritSeen|->FALSE,
  inheritedOwed|->FALSE,probeTryNext|->FALSE,
  badRepeat|->FALSE,badCoverageCommit|->FALSE,badStopAdmission|->FALSE,
  missBefore|->0]

WaitAllowed ==
  FairRun \/ (Scenario \in {"normal","busy","error","legacy","close","probe-wait"}
    /\ "wait" \notin s.arrivals)
TryAllowed ==
  Scenario \in {"normal","carry-gap","probe-try","probe-wait"}
  /\ "try" \notin s.arrivals
  /\ (IF ProbeScenario THEN s.stage="probe" ELSE TRUE)
LegacyAllowed == Scenario="legacy" /\ "legacy" \notin s.arrivals

RequestWait ==
  /\ ~s.stopped /\ WaitAllowed
  /\ (IF Scenario="probe-wait" THEN s.stage="probe" ELSE TRUE)
  /\ s'=[s EXCEPT
       !.pendingBlocking=IF Fault="mode-from-capability" THEN @ ELSE TRUE,
       !.owedPending=TRUE,!.dirty=TRUE,!.scheduled=@ \/ ~s.running,
       !.fresh=@ \/ s.running,!.freshWaitSeen=@ \/ s.running,
       !.arrivals=@ \cup {"wait"},!.pulseBit=~@]
RequestTry ==
  /\ ~s.stopped /\ TryAllowed
  /\ s'=[s EXCEPT !.dirty=TRUE,!.scheduled=@ \/ ~s.running,
       !.pendingBlocking=IF Fault="try-clears-wait" THEN FALSE ELSE @,
       !.fresh=@ \/ s.running,!.arrivals=@ \cup {"try"},
       !.probeTry=@ \/ s.stage="probe"]
RequestLegacy ==
  /\ ~s.stopped /\ LegacyAllowed
  /\ s'=[s EXCEPT !.pendingBlocking=TRUE,!.includeLegacy=TRUE,
       !.owedPending=TRUE,!.owedLegacy=TRUE,!.dirty=TRUE,
       !.scheduled=@ \/ ~s.running,!.fresh=@ \/ s.running,
       !.arrivals=@ \cup {"legacy"},!.freshWaitSeen=@ \/ s.running]

StartRun ==
  /\ ~s.stopped /\ ~s.running /\ s.scheduled /\ s.dirty
  /\ s'=[s EXCEPT !.running=TRUE,!.scheduled=FALSE,!.stage="entry",
       !.runMode=EffectiveMode,!.frozenMode=EffectiveMode,
       !.runLegacy=s.includeLegacy,!.claimedWait=s.owedPending,
       !.claimedLegacy=s.owedLegacy,!.owedPending=FALSE,!.owedLegacy=FALSE,
       !.pendingBlocking=FALSE,!.includeLegacy=FALSE,!.dirty=FALSE,
       !.fresh=FALSE,!.callPublished=FALSE,!.inheritedOwed=FALSE,
       !.probeTryNext=@ \/ (s.probeTry /\ EffectiveMode="try")]
EnterRuntime ==
  /\ s.stage="entry" /\ ~s.stopped /\ ~s.externalOwner
  /\ s'=[s EXCEPT !.runtimeOwned=TRUE,!.stage="supply"]
RuntimeBusy ==
  /\ s.stage="entry" /\ ~s.stopped /\ s.externalOwner
  /\ s'=[s EXCEPT !.stage="busy",!.busySeen=TRUE]
ReleaseExternalOwner ==
  /\ s.externalOwner
  /\ s'=[s EXCEPT !.externalOwner=FALSE]

\* 这里将 W 抽象为有限的前置工作；其 G/W 重叠及详细的
\* 每 handle SQL/send 不变量仍由独立 WaveAdmission 模型检查。
FinishSupply ==
  /\ s.stage="supply"
  /\ s'=[s EXCEPT !.stage=IF s.stopped \/ ~HasPending \/ ~s.coverage \/ s.installation
                           THEN "return" ELSE "begin",
       !.gActive=~s.stopped /\ HasPending /\ s.coverage /\ ~s.installation,
       !.admissionCovered=s.coverage /\ ~s.installation]
BeginG ==
  /\ s.stage="begin"
  /\ s'=[s EXCEPT !.stage="sql"]
QueueWait ==
  /\ s.stage="sql" /\ s.runMode="wait"
  /\ s'=[s EXCEPT !.queuedWait=TRUE,!.stage="wait-lock",!.waitQueuedSeen=TRUE]
GrantWait ==
  /\ s.stage="wait-lock" /\ s.queuedWait /\ CanGrant
  /\ s'=[s EXCEPT !.queuedWait=FALSE,!.writer="progress",!.stage="check"]
GrantTry ==
  /\ s.stage="sql" /\ s.runMode="try" /\ CanGrant
  /\ s'=[s EXCEPT !.writer="progress",!.stage="check"]
RejectTry ==
  /\ s.stage="sql" /\ s.runMode="try" /\ ~CanGrant
  /\ s'=[s EXCEPT !.stage="rollback",!.rollbackPending=TRUE,!.releasePending=TRUE,
       !.fastMissSeen=TRUE,!.missBefore=s.actual]
RollbackMiss ==
  /\ s.stage="rollback"
  /\ s'=[s EXCEPT !.stage="release",!.rollbackPending=FALSE]
ReleaseMiss ==
  /\ s.stage="release"
  /\ s'=[s EXCEPT !.stage="return",!.releasePending=FALSE,!.gActive=FALSE]
CheckCoverage ==
  /\ s.stage="check" /\ s.writer="progress"
  /\ s'=[s EXCEPT !.stage="commit",
       !.checkedCovered=IF Fault="stale-coverage" THEN s.admissionCovered
                        ELSE s.coverage /\ ~s.installation]
CommitG ==
  /\ s.stage="commit" /\ s.writer="progress"
  /\ s'=[s EXCEPT !.stage="committed",!.writer="none",
       !.actual=IF s.checkedCovered THEN @+1 ELSE @,
       !.persistedAttempts=IF s.checkedCovered THEN @+1 ELSE @,
       !.rowsLeft=IF s.checkedCovered THEN @-1 ELSE @,
       !.callPublished=s.checkedCovered,
       !.waitCommittedSeen=@ \/ (s.runMode="wait" /\ s.checkedCovered),
       !.badCoverageCommit=@ \/ (s.checkedCovered /\ (~s.coverage \/ s.installation))]
ReleaseCommittedG ==
  /\ s.stage="committed"
  /\ s'=[s EXCEPT !.gActive=FALSE,!.stage="return"]
ReturnRuntime ==
  /\ s.stage="return" /\ IsClean
  /\ s'=[s EXCEPT !.runtimeOwned=FALSE,!.stage="probe"]

\* 最后 Pending 查询是独立 await；此处到来的请求仍计入 fresh。
FinishNormal ==
  LET dirtyNow == s.dirty \/ HasPending
      need == s.pendingBlocking \/ (dirtyNow /\ (s.callPublished \/ s.fresh \/ s.includeLegacy))
      inherit == need /\ ~s.fresh /\ s.runMode="wait"
      premature == Fault="inherit-before-repeat" /\ s.runMode="wait" /\ ~s.fresh /\ ~need
      carry == inherit \/ premature
      restored == s.pendingBlocking \/ (carry /\ Fault#"drop-wait-continuation")
      nextScheduled == ~s.stopped /\ (need \/ premature)
  IN /\ s.stage="probe"
     /\ s'=[s EXCEPT !.running=FALSE,!.stage="idle",
          !.dirty=IF s.stopped THEN FALSE ELSE dirtyNow,
          !.pendingBlocking=IF s.stopped THEN FALSE ELSE
              IF Fault="finish-clears-new-wait" THEN FALSE ELSE restored,
          !.owedPending=IF s.stopped THEN FALSE ELSE s.owedPending \/ inherit,
          !.inheritedOwed=~s.stopped /\ inherit,
          !.includeLegacy=IF s.stopped THEN FALSE ELSE @,
          !.owedLegacy=IF s.stopped THEN FALSE ELSE @,
          !.scheduled=nextScheduled,!.claimedWait=FALSE,!.claimedLegacy=FALSE,
          !.inheritSeen=@ \/ inherit,!.badRepeat=@ \/ premature]

FinishBusy ==
  LET waitBack == s.pendingBlocking \/ (s.runMode="wait")
      legacyBack == s.includeLegacy \/ s.runLegacy
      spin == Fault="busy-spin" /\ waitBack
  IN /\ s.stage="busy"
     /\ s'=[s EXCEPT !.running=FALSE,!.stage="idle",
          !.dirty=~s.stopped,!.scheduled=~s.stopped /\ spin,
          !.pendingBlocking=~s.stopped /\ (IF Fault="busy-consumes-wait" THEN FALSE ELSE waitBack),
          !.includeLegacy=~s.stopped /\ (IF Fault="busy-consumes-legacy" THEN FALSE ELSE legacyBack),
          !.owedPending=~s.stopped /\ (s.owedPending \/ s.claimedWait),
          !.owedLegacy=~s.stopped /\ (s.owedLegacy \/ s.claimedLegacy),
          !.claimedWait=FALSE,!.claimedLegacy=FALSE,!.badRepeat=@ \/ spin]

FailProbe ==
  /\ Scenario="error" /\ s.stage="probe"
  /\ s'=[s EXCEPT !.stage="error"]
FinishError ==
  LET freshBlocking == s.pendingBlocking
      waitBack == freshBlocking \/ (s.runMode="wait")
      repeat == IF Fault="error-spin" THEN waitBack ELSE freshBlocking
  IN /\ s.stage="error"
     /\ s'=[s EXCEPT !.running=FALSE,!.stage="idle",!.dirty=~s.stopped,
          !.pendingBlocking=~s.stopped /\ waitBack,
          !.includeLegacy=~s.stopped /\ (s.includeLegacy \/ s.runLegacy),
          !.owedPending=~s.stopped /\ (s.owedPending \/ s.claimedWait),
          !.owedLegacy=~s.stopped /\ (s.owedLegacy \/ s.claimedLegacy),
          !.scheduled=~s.stopped /\ repeat,
          !.claimedWait=FALSE,!.claimedLegacy=FALSE,
          !.badRepeat=@ \/ (repeat /\ ~freshBlocking)]

\* UPDATE 等待期间，后来兼容 SHARE 仍可进入；不假定写者优先。
\* fair-finite 限定每个 reader 最多取锁一次，另有一个其他 writer。
\* fair-overlap 允许有限 SHARE 事务反复重入，也允许全程无空锁间隙。
AcquireReader(p) ==
  /\ p \notin s.readers /\ s.writer="none"
  /\ (Scenario#"fair-finite" \/ p \notin s.readerEntered)
  /\ s'=[s EXCEPT !.readers=@ \cup {p},!.readerEntered=@ \cup {p}]
ReleaseReader(p) ==
  /\ p \in s.readers
  /\ s'=[s EXCEPT !.readers=@ \ {p}]
AcquireOtherWriter ==
  /\ ~s.otherUsed /\ CanGrant
  /\ s'=[s EXCEPT !.otherUsed=TRUE,!.writer="other"]
ReleaseOtherWriter ==
  /\ s.writer="other"
  /\ s'=[s EXCEPT !.writer="none"]
ChangeInstallation ==
  /\ Scenario="pending" /\ ~s.mutationUsed /\ s.writer="none"
  /\ s'=[s EXCEPT !.mutationUsed=TRUE,!.installation=TRUE,!.coverage=FALSE]

Stop ==
  /\ Scenario="close" /\ ~s.stopped
  /\ s'=[s EXCEPT !.stopped=TRUE,!.scheduled=FALSE,!.dirty=FALSE,
       !.pendingBlocking=FALSE,!.includeLegacy=FALSE,
       !.owedPending=FALSE,!.owedLegacy=FALSE,!.inheritedOwed=FALSE]
FinishStoppedEntry ==
  /\ s.stopped /\ s.stage="entry" /\ ~s.runtimeOwned
  /\ s'=[s EXCEPT !.running=FALSE,!.stage="idle",!.claimedWait=FALSE,!.claimedLegacy=FALSE]

Internal == StartRun \/ EnterRuntime \/ RuntimeBusy \/ FinishSupply \/ BeginG
  \/ QueueWait \/ GrantWait \/ GrantTry \/ RejectTry \/ RollbackMiss \/ ReleaseMiss
  \/ CheckCoverage \/ CommitG \/ ReleaseCommittedG \/ ReturnRuntime
  \/ FinishNormal \/ FinishBusy \/ FinishError \/ FinishStoppedEntry
Next == Internal \/ RequestWait \/ RequestTry \/ RequestLegacy \/ FailProbe
  \/ (\E p \in Peers: AcquireReader(p) \/ ReleaseReader(p))
  \/ AcquireOtherWriter \/ ReleaseOtherWriter \/ ReleaseExternalOwner
  \/ ChangeInstallation \/ Stop
Spec == Init /\ [][Next]_vars
FairSpec == Spec /\ WF_vars(Internal) /\ WF_vars(RequestWait)
  /\ (\A p \in Peers: WF_vars(ReleaseReader(p)))
  /\ WF_vars(ReleaseOtherWriter) /\ WF_vars(ReleaseExternalOwner)

TypeOK == s.rowsLeft \in 0..InitialRows /\ s.actual \in 0..InitialRows
  /\ s.readers \subseteq Peers /\ s.writer \in {"none","progress","other"}
  /\ s.runMode \in {"none","try","wait"}
  /\ s.stage \in {"idle","entry","busy","supply","begin","sql","wait-lock",
       "check","commit","committed","rollback","release","return","probe","error"}
OwnerUnique == ~(s.runtimeOwned /\ s.externalOwner)
LockExclusion == s.writer="none" \/ s.readers={}
FrozenMode == s.running => s.runMode=s.frozenMode
PendingWaitRetained == ~s.stopped /\ s.owedPending => s.pendingBlocking
ClaimedWaitMode == ~s.stopped /\ s.running /\ s.claimedWait => s.runMode="wait"
CapabilityRetained == ~s.stopped /\ s.owedLegacy => s.includeLegacy
ClaimedCapability == s.running /\ s.claimedLegacy => s.runLegacy
WaitContinuation == ~s.stopped /\ s.inheritedOwed => s.pendingBlocking
NoRestoreDrivenRepeat == ~s.badRepeat
CurrentCoverage == ~s.badCoverageCommit
ActualCommitOnly == s.actual+ s.rowsLeft=InitialRows /\ s.persistedAttempts=s.actual
MissEffectFree == s.stage \in {"rollback","release"} => s.actual=s.missBefore
CleanupOwnsSlot == (s.rollbackPending \/ s.releasePending) => s.gActive /\ s.runtimeOwned /\ s.running
DrainedOwner == ~s.runtimeOwned => IsClean
StoppedOwnerDrained == s.stopped /\ ~s.running => ~s.runtimeOwned /\ IsClean
WaitGetsOpportunity == (s.owedPending /\ HasPending /\ ~s.stopped) ~> (s.waitQueuedSeen \/ ~HasPending)
EventuallyPublished == <>(s.rowsLeft=0)

\* 否定见证：性质违反说明目标状态可达，不表示产品 FAIL。
NotFallbackCommit == ~(s.fastMissSeen /\ s.freshWaitSeen /\ s.waitQueuedSeen /\ s.waitCommittedSeen)
NotBusyRecovered == ~(s.busySeen /\ s.waitCommittedSeen)
NotInheritedWait == ~(s.inheritSeen /\ s.running /\ s.runMode="wait")
NotProbeTryNext == ~(s.probeTryNext /\ s.running /\ s.runMode="try")
NotCloseDrained == ~(s.stopped /\ ~s.running /\ ~s.runtimeOwned /\ s.waitQueuedSeen)
NotFreshErrorRepeat == ~(s.stage="idle" /\ s.scheduled /\ s.freshWaitSeen /\ s.pendingBlocking /\ Scenario="error")
=============================================================================
