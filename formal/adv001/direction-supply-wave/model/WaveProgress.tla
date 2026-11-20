---------------------------- MODULE WaveProgress ----------------------------
EXTENDS Naturals, Integers, FiniteSets, Sequences
CONSTANTS Fault, Scenario, Budget, MaxHead, InitialSent, PageSize, RecordCount
VARIABLE s
vars == <<s>>
Peers == 1..2
Rows == 1..RecordCount
ExpectedAttempts == IF RecordCount=1 THEN <<1>> ELSE <<1,2>>
Keys == {<<p,v>> : p \in Peers, v \in 0..1}
Min(a,b) == IF a<b THEN a ELSE b
Max(a,b) == IF a>b THEN a ELSE b
Key(p) == <<p,s.view[p]>>
EmptyJob == [phase|->"unused",view|->0,rowHead|->0,through|->0,cursor|->0,calls|->0]
ActivePeers == s.live \ s.closing
ValidPeer(p) == p \in ActivePeers /\ p \notin s.pending /\ s.full[p]
Current(p) == ValidPeer(p) /\ s.jobs[p].view=s.view[p]
Covered(r) == \A p \in ActivePeers: s.full[p] /\ s.sent[Key(p)]>=r
ReadyRow == s.next \in Rows /\ s.pending={} /\ Covered(s.next)
CanMutate == s.writer="none" /\ s.readers={}
NeedWave == s.demandPending /\ \E p \in ActivePeers: s.sent[Key(p)]<s.demand
StartKey == <<s.demand,s.ready,s.view,s.sent>>
LaneFree(p) == p#1 \/ s.rpc \in {"none","done"}
JobsDone == \A p \in s.selected: s.jobs[p].phase \in {"settled","skipped"}
Unstarted == {p \in s.selected: s.jobs[p].phase="unused"}
FailureOn == Scenario="failure"

\* 切点：两条旧行已存在；InitialSent=2 表示旧前缀已有可信证明。
\* 单独分页配置从 sent=1 开始。旧 RPC 配置从其 SQL 已结束、证明尚未返回开始。
Init == s=[owner|->1,stop|->"none",head|->2,demand|->2,demandPending|->InitialSent<2,
  ready|->0,next|->1,draining|->FALSE,attempts|-><<>>,published|->{},actual|->{},commits|->{},
  gphase|->"none",gslots|->{},target|->0,txRows|->{},checkOK|->FALSE,
  admissions|->{},blocked|->{},writer|->"none",readers|->{},sqlOutstanding|->{},
  wave|->FALSE,wslots|->{},waveNo|->0,whead|->0,frozen|->0,selected|->{},group|->{},
  jobs|->[p \in Peers |->EmptyJob],waveAdvanced|->FALSE,starts|->{},repeated|->FALSE,
  owed|->FALSE,due|->FALSE,bypassed|->FALSE,gaveOwed|->FALSE,
  live|->IF Scenario="join" THEN {1} ELSE Peers,closing|->{},pending|->{},
  full|->[p \in Peers |->TRUE],view|->[p \in Peers |->0],mutation|->"unused",
  sent|->[k \in Keys |->IF k[2]=0 /\ ~(Scenario="join" /\ k[1]=2) THEN InitialSent ELSE 0],
  proof|->[k \in Keys |->IF k[2]=0 /\ ~(Scenario="join" /\ k[1]=2) THEN InitialSent ELSE 0],
  everSent|->[k \in Keys |->IF k[2]=0 /\ ~(Scenario="join" /\ k[1]=2) THEN InitialSent ELSE 0],
  deliveries|->{},discarded|->FALSE,discardedCandidate|->FALSE,failures|->{},failedResults|->{},overlap|->FALSE,
  commitDuringG|->FALSE,closedReading|->FALSE,
  newAfterStop|->FALSE,newWaveAfterDrain|->FALSE,groupAfterDrain|->FALSE,
  rpc|->IF Scenario="rpc" THEN "active" ELSE "none",rpcUsed|->FALSE,
  rpcCeiling|->InitialSent,rpcBinding|->0,rpcReturns|->{},rpcBypass|->FALSE]

\* 这里的世界 COMMIT 原子化了同一行排他事务；绝不能穿过 G 或读锁。
CommitWorld ==
  /\ s.owner=1 /\ s.head<MaxHead /\ CanMutate
  /\ s'=[s EXCEPT !.head=@+1,!.demand=s.head+1,!.demandPending=TRUE,
       !.commitDuringG=@ \/ s.gslots#{},
       !.owed=IF Fault="erase-owed" THEN FALSE ELSE @,
       !.whead=IF Fault="chase-wave" /\ s.wave THEN s.head+1 ELSE @]

StartWave ==
  /\ s.owner=1 /\ ~s.wave /\ (~s.draining \/ Fault="wave-after-drain") /\ NeedWave
  /\ (s.stop="none" \/ Fault="start-after-stop")
  /\ (~(s.owed /\ ReadyRow /\ s.gslots={}) \/ Fault="bypass-opportunity")
  /\ s'=[s EXCEPT !.wave=TRUE,!.waveNo=@+1,!.wslots={s.waveNo+1},
       !.whead=s.demand,!.frozen=s.demand,!.selected=ActivePeers,!.group={},
       !.jobs=[p \in Peers |->EmptyJob],!.waveAdvanced=FALSE,!.demandPending=FALSE,
       !.starts=@ \cup {StartKey},!.repeated=@ \/ StartKey \in s.starts,
       !.bypassed=@ \/ (s.owed /\ ReadyRow /\ s.gslots={}),
       !.overlap=@ \/ s.gslots#{},!.newAfterStop=@ \/ s.stop#"none",
       !.newWaveAfterDrain=@ \/ s.draining]

StartGroup ==
  LET group == IF Budget=2 \/ Fault="exceed-budget" THEN Unstarted
               ELSE {CHOOSE p \in Unstarted: \A q \in Unstarted: p<=q}
  IN /\ s.wave /\ s.group={} /\ Unstarted#{}
     /\ (s.stop="none" \/ Fault="start-after-stop")
     /\ s'=[s EXCEPT !.group=group,
          !.jobs=[p \in Peers |->IF p \in group THEN
            [s.jobs[p] EXCEPT !.phase="lane",!.calls=@+1] ELSE s.jobs[p]],
          !.newAfterStop=@ \/ s.stop#"none",!.groupAfterDrain=@ \/ s.draining]

\* lane 等待不代表 SQL 入列；旧 RPC 完成前本 handle 不可进入 sql。
EnterSQL(p) ==
  /\ p \in s.group /\ s.jobs[p].phase="lane" /\ ValidPeer(p)
  /\ s.sent[Key(p)]<s.whead /\ (LaneFree(p) \/ Fault="bypass-rpc")
  /\ s'=[s EXCEPT !.jobs[p].phase="sql",!.jobs[p].view=s.view[p],!.sqlOutstanding=@ \cup {p},
       !.jobs[p].cursor=s.sent[Key(p)],!.rpcBypass=@ \/ ~LaneFree(p)]

AlreadyCovered(p) ==
  /\ p \in s.group /\ s.jobs[p].phase="lane" /\ LaneFree(p)
  /\ ValidPeer(p) /\ s.sent[Key(p)]>=s.whead
  /\ s'=[s EXCEPT !.jobs[p].phase="result"]

AcquireRead(p) ==
  /\ s.jobs[p].phase="sql"
  /\ (s.writer="none" \/ Fault="read-through-lock")
  /\ s'=[s EXCEPT !.readers=@ \cup {p},!.jobs[p].phase="read",!.jobs[p].rowHead=s.head]

CompleteRead(p) ==
  /\ s.jobs[p].phase="read" /\ p \in s.readers /\ Current(p)
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.sqlOutstanding=@ \ {p},!.jobs[p].phase="candidate",
       !.jobs[p].through=Min(s.jobs[p].rowHead,s.jobs[p].cursor+PageSize)]

Send(p) ==
  LET j == s.jobs[p]
      through == IF Fault="hint-as-authority" THEN s.demand ELSE j.through
      key == <<p,j.view>>
      cert == [binding|->j.view,current|->s.view[p],valid|->ValidPeer(p),
               rowHead|->j.rowHead,through|->through]
  IN /\ j.phase="candidate"
     /\ (Current(p) \/ Fault="stale-send")
     /\ s'=[s EXCEPT !.jobs[p].phase="result",!.sent[key]=Max(@,through),
          !.proof[key]=IF Fault="fake-proof" THEN @ ELSE Max(@,through),
          !.everSent[key]=Max(@,through),!.deliveries=@ \cup {cert},
          !.waveAdvanced=@ \/ through>s.sent[key]]

Discard(p) ==
  /\ p \in s.group /\ s.jobs[p].phase \in {"lane","candidate"}
  /\ IF s.jobs[p].phase="lane" THEN LaneFree(p) /\ ~ValidPeer(p) ELSE ~Current(p)
  /\ s'=[s EXCEPT !.jobs[p].phase="result",!.discarded=TRUE,
       !.discardedCandidate=@ \/ s.jobs[p].phase="candidate"]

\* 已提交 SQL 不能被 stop/mixed 假装取消：仍需授锁并得到授权拒绝或真实错误。
RejectRead(p) ==
  /\ s.jobs[p].phase="read" /\ p \in s.readers /\ ~Current(p)
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.sqlOutstanding=@ \ {p},!.jobs[p].phase="result",!.discarded=TRUE]

ReadFailure ==
  LET key == <<2,s.jobs[2].view>>
      after == IF Fault="failure-as-success" THEN s.head ELSE s.sent[key]
  IN /\ FailureOn /\ s.jobs[2].phase \in {"sql","read"}
     /\ s'=[s EXCEPT !.jobs[2].phase="result",!.readers=@ \ {2},!.sqlOutstanding=@ \ {2},!.stop="error",
          !.failures=@ \cup {"read"},!.sent[key]=after,
          !.failedResults=@ \cup {[before|->s.sent[key],after|->after]}]

SendFailure ==
  /\ FailureOn /\ s.jobs[2].phase="candidate"
  /\ s'=[s EXCEPT !.jobs[2].phase="result",!.stop="error",!.closing=@ \cup {2},
       !.failures=@ \cup {"send"},
       !.failedResults=@ \cup {[before|->s.sent[Key(2)],after|->s.sent[Key(2)]]},
       !.sent=IF Fault="rollback-peer" THEN [k \in Keys |->0] ELSE @,
       !.published=IF Fault="rollback-commit" THEN {} ELSE @]

SettlePeer(p) ==
  /\ s.jobs[p].phase="result"
  /\ s'=[s EXCEPT !.jobs[p].phase="settled"]
FinishGroup ==
  /\ s.group#{} /\ \A p \in s.group: s.jobs[p].phase="settled"
  /\ s'=[s EXCEPT !.group={}]
SkipUnstarted ==
  /\ s.wave /\ s.stop#"none" /\ Unstarted#{}
  /\ s'=[s EXCEPT !.jobs=[p \in Peers |->IF p \in Unstarted THEN
       [s.jobs[p] EXCEPT !.phase="skipped"] ELSE s.jobs[p]]]

FinishWave ==
  LET opportunity == s.gslots={} /\ ReadyRow
      more == \E p \in ActivePeers: s.sent[Key(p)]<s.demand
  IN /\ s.wave /\ s.group={} /\ JobsDone
     /\ s'=[s EXCEPT !.wave=FALSE,!.wslots={},
          !.owed=@ \/ opportunity,!.due=@ \/ opportunity,
          !.demandPending=@ \/ (s.waveAdvanced /\ more) \/ Fault="busy-retry"]

\* G 入场证书只记录入场当时的既有波次；不是永久的全局无发送断言。
AdmitProgress ==
  LET r == IF Fault="reorder-rows" THEN 3-s.next ELSE s.next
      cert == [row|->r,settled|->~s.wave /\ s.group={},pendingClear|->s.pending={},covered|->Covered(r)]
  IN /\ s.owner=1 /\ (s.stop="none" \/ Fault="start-after-stop") /\ s.gslots={} /\ ReadyRow
     /\ (~s.wave \/ Fault="early-progress")
     /\ s'=[s EXCEPT !.gslots={r},!.target=r,!.gphase="queued",!.next=@+1,
          !.attempts=Append(@,r),!.admissions=@ \cup {cert},!.txRows={},
          !.gaveOwed=@ \/ s.due,!.owed=FALSE,!.due=FALSE,
          !.newAfterStop=@ \/ s.stop#"none"]

SkipRecord ==
  /\ s.owner=1 /\ s.stop="none" /\ s.gslots={} /\ ~s.wave /\ s.next \in Rows
  /\ ~ReadyRow /\ ~NeedWave
  /\ s'=[s EXCEPT !.attempts=Append(@,s.next),!.next=@+1,!.blocked=@ \cup {s.next},
       !.draining=s.next=RecordCount,
       !.owed=FALSE,!.due=FALSE]

AcquireProgress ==
  /\ s.gphase="queued" /\ s.writer="none"
  /\ (s.readers={} \/ Fault="progress-through-read")
  /\ s'=[s EXCEPT !.gphase="locked",!.writer="progress"]

CheckProgress ==
  /\ s.gphase="locked"
  /\ s'=[s EXCEPT !.gphase="checked",!.checkOK=
       ((s.pending={} \/ Fault="ignore-pending") /\ (Covered(s.target) \/ Fault="stale-coverage"))]

UpdateRow ==
  /\ s.gphase="checked" /\ s.checkOK
  /\ s'=[s EXCEPT !.gphase="updated",!.txRows=IF Fault="batch-update" THEN Rows ELSE {s.target},
       !.published=IF Fault="precommit-published" THEN @ \cup {s.target} ELSE @]

CommitRow ==
  LET cert == [row|->s.target,rows|->s.txRows,pendingClear|->s.pending={},covered|->Covered(s.target)]
  IN /\ s.gphase="updated" /\ s.writer="progress"
     /\ s'=[s EXCEPT !.gphase="committed",!.writer="none",!.published=@ \cup s.txRows,
          !.actual=@ \cup s.txRows,!.commits=@ \cup {cert},!.txRows={}]

CommitBlocked ==
  /\ s.gphase="checked" /\ ~s.checkOK
  /\ s'=[s EXCEPT !.gphase="committed",!.writer="none",!.blocked=@ \cup {s.target}]

ProgressFailure ==
  /\ FailureOn /\ s.gphase \in {"queued","locked","checked","updated"}
  /\ s'=[s EXCEPT !.gphase="failed",!.writer="none",!.txRows={},!.stop="error",
       !.failures=@ \cup {"progress"}]
CommitResponseLost ==
  /\ FailureOn /\ s.gphase="committed" /\ s.target \in s.actual
  /\ s'=[s EXCEPT !.gphase="failed",!.stop="error",!.failures=@ \cup {"unknown"},
       !.published=IF Fault="rollback-commit" THEN {} ELSE @]
SettleProgress ==
  /\ s.gphase \in {"committed","failed"}
  /\ s'=[s EXCEPT !.gphase="none",!.gslots={},!.draining=s.next=RecordCount+1]

\* 原安装候选抽象：pending/current 的持久变化通过排他切点；资格细节未建模。
BeginPending ==
  /\ Scenario="pending" /\ s.mutation="unused" /\ s.owner=1
  /\ (CanMutate \/ Fault="pending-after-check")
  /\ s'=[s EXCEPT !.pending={2},!.mutation="pending"]
InstallView ==
  /\ Scenario="pending" /\ s.mutation="pending" /\ CanMutate /\ 2 \notin s.closing
  /\ s'=[s EXCEPT !.pending={},!.view[2]=1,!.mutation="installed",!.ready=1,!.demandPending=TRUE]
ChangeView ==
  /\ Scenario="view" /\ s.mutation="unused" /\ s.owner=1 /\ CanMutate
  /\ s'=[s EXCEPT !.view[2]=1,!.mutation="changed",!.ready=1,!.demandPending=TRUE]
JoinView ==
  /\ Scenario="join" /\ s.mutation="unused" /\ s.owner=1
  /\ (CanMutate \/ Fault="join-after-check")
  /\ s'=[s EXCEPT !.live=@ \cup {2},!.mutation="joined",!.ready=1,!.demandPending=TRUE]
StopClose ==
  /\ Scenario="close" /\ s.stop="none" /\ s.owner=1
  /\ s'=[s EXCEPT !.stop="close",!.closing=Peers,
       !.closedReading=s.readers#{} /\ s.gslots#{}]
StopMixed ==
  /\ Scenario="mixed" /\ s.stop="none" /\ s.owner=1 /\ CanMutate
  /\ s'=[s EXCEPT !.stop="mixed",!.full[2]=FALSE]

\* RPC 是旧 lane 的外部工作；仅抽象一次在途及一次等候，不修改其优先级。
QueueRPC ==
  /\ Scenario="rpc" /\ s.rpc="done" /\ ~s.rpcUsed /\ s.jobs[1].phase \in {"sql","read","candidate"}
  /\ s'=[s EXCEPT !.rpc="queued",!.rpcUsed=TRUE]
ActivateRPC ==
  /\ s.rpc="queued" /\ s.jobs[1].phase \in {"result","settled","unused"}
  /\ s'=[s EXCEPT !.rpc="active",!.rpcCeiling=s.sent[Key(1)],!.rpcBinding=s.view[1]]
ReturnRPC ==
  LET returned == IF Fault="rpc-above-ceiling" THEN s.demand ELSE s.rpcCeiling
  IN /\ s.rpc="active"
     /\ s'=[s EXCEPT !.rpc="done",!.rpcReturns=@ \cup {[through|->returned,ceiling|->s.rpcCeiling]}]

FinishOwner ==
  /\ s.owner=1 /\ ~s.wave /\ s.gslots={} /\ (s.draining \/ s.stop#"none")
  /\ s'=[s EXCEPT !.owner=0]

\* 独立缺陷开关只制造错误实现语义；正常配置不启用这些动作。
BadOwner == /\ Fault="second-owner" /\ s.owner=1 /\ s'=[s EXCEPT !.owner=2]
BadProgress == /\ Fault="second-progress" /\ s.gslots#{} /\ s'=[s EXCEPT !.gslots=Rows]
BadWave == /\ Fault="second-wave" /\ s.wave /\ s'=[s EXCEPT !.wslots={1,2}]
BadRelease == /\ Fault="early-release" /\ s.stop#"none" /\ (s.wave \/ s.gslots#{})
  /\ s'=[s EXCEPT !.owner=0]
CancelSQL == /\ Fault="cancel-sql" /\ s.stop#"none"
  /\ \E p \in s.sqlOutstanding: s'=[s EXCEPT !.jobs[p].phase="result",!.readers=@ \ {p}]
RepeatPeer == /\ Fault="repeat-peer" /\ s.wave /\ s.group={}
  /\ \E p \in s.selected: s.jobs[p].phase="settled" /\
       s'=[s EXCEPT !.jobs[p].phase="unused"]
BadType == /\ Fault="type" /\ s'=[s EXCEPT !.next=0]

Next == CommitWorld \/ StartWave \/ StartGroup \/ FinishGroup \/ SkipUnstarted \/ FinishWave
  \/ (\E p \in Peers: EnterSQL(p) \/ AlreadyCovered(p) \/ AcquireRead(p) \/ CompleteRead(p)
      \/ Send(p) \/ Discard(p) \/ RejectRead(p) \/ SettlePeer(p))
  \/ ReadFailure \/ SendFailure \/ AdmitProgress \/ SkipRecord \/ AcquireProgress \/ CheckProgress
  \/ UpdateRow \/ CommitRow \/ CommitBlocked \/ ProgressFailure \/ CommitResponseLost \/ SettleProgress
  \/ BeginPending \/ InstallView \/ ChangeView \/ JoinView \/ StopClose \/ StopMixed
  \/ QueueRPC \/ ActivateRPC \/ ReturnRPC \/ FinishOwner
  \/ BadOwner \/ BadProgress \/ BadWave \/ BadRelease \/ CancelSQL \/ RepeatPeer \/ BadType
Spec == Init /\ [][Next]_vars

TypeOK == s.next \in 1..(RecordCount+1) /\ s.head \in 2..MaxHead /\ s.sent \in [Keys -> 0..MaxHead]
  /\ s.published \subseteq Rows /\ s.readers \subseteq Peers /\ s.stop \in {"none","error","close","mixed"}
SingleSlots == s.owner \in 0..1 /\ Cardinality(s.gslots)<=1 /\ Cardinality(s.wslots)<=1
PeerBudget == Cardinality(s.group)<=Budget
LockExclusion == s.writer="none" \/ s.readers={}
AdmissionSettled == \A c \in s.admissions: c.settled /\ c.pendingClear /\ c.covered
DrainedOwner == s.owner=0 => (~s.wave /\ s.gslots={} /\ s.group={} /\ s.readers={} /\ s.sqlOutstanding={})
NoSQLCancellation == \A p \in s.sqlOutstanding: s.jobs[p].phase \in {"sql","read"}
NoNewAfterStop == ~s.newAfterStop /\ ~s.newWaveAfterDrain
OrderedAttempts == s.attempts=SubSeq(ExpectedAttempts,1,Len(s.attempts))
ExactRowCommit == \A c \in s.commits: c.rows={c.row}
ActualCommitOnly == s.published=s.actual
PendingBlocks == \A c \in s.commits: c.pendingClear
CurrentCoverage == \A c \in s.commits: c.covered
SentProof == \A k \in Keys: s.sent[k]<=s.proof[k]
SuccessfulSentRetained == \A k \in Keys: s.sent[k]>=s.everSent[k]
FailureDoesNotAdvance == \A c \in s.failedResults: c.after=c.before
NoStaleSend == \A c \in s.deliveries: c.binding=c.current /\ c.valid
FixedAuthorizedHead == \A c \in s.deliveries: c.through<=c.rowHead
RPCBoundary == ~s.rpcBypass /\ \A c \in s.rpcReturns: c.through<=c.ceiling
FiniteWave == (~s.wave \/ s.whead=s.frozen) /\ \A p \in Peers: s.jobs[p].calls<=1
NoBusyRetry == ~s.repeated
ProgressOpportunity == (s.due=>s.owed) /\ ~s.bypassed

\* 否定可达状态作为 TLC 见证：rc=12 表示见证存在，不是产品错误。
NotQueuedOverlap == ~(s.wave /\ s.gslots#{} /\ s.commitDuringG /\ s.demand>=3 /\ s.jobs[2].phase="lane")
NotReadBehindRPC == ~(s.rpc="active" /\ s.jobs[1].phase="lane" /\ s.jobs[2].phase="sql" /\ s.gslots#{})
NotReadWaitingOnProgress == ~(s.writer="progress" /\ s.jobs[2].phase="sql" /\ s.readers={})
NotCommittedWhileWave == ~(1 \in s.published /\ s.wave /\ s.target=1 /\ s.gslots#{})
NotCompletedOverlap == ~(s.owner=0 /\ s.overlap /\ s.commitDuringG /\ s.published=Rows)
NotFailureDrained == ~(s.owner=0 /\ s.overlap /\ 1 \in s.actual /\ "send" \in s.failures
  /\ s.sent[<<1,0>>]>InitialSent)
NotReadFailureDrained == ~(s.owner=0 /\ s.overlap /\ "read" \in s.failures)
NotUnknownRetained == ~(s.owner=0 /\ "unknown" \in s.failures /\ 1 \in s.published)
NotClosedDrained == ~(s.owner=0 /\ s.overlap /\ s.closedReading /\ s.stop="close")
NotMixedDrained == ~(s.owner=0 /\ s.overlap /\ s.stop="mixed")
NotPendingBlocked == ~(s.blocked#{} /\ s.pending#{})
NotViewDiscarded == ~(s.discardedCandidate /\ s.view[2]=1 /\ s.sent[<<2,1>>]=0)
NotOpportunityGiven == ~(s.gaveOwed /\ s.head=4)
NotPagination == ~(s.waveNo>=2 /\ s.gaveOwed)
NotFinalGroupAfterDrain == ~s.groupAfterDrain
NotStoppedSQLWait == ~(s.stop="close" /\ s.writer="progress" /\ s.sqlOutstanding#{})
=============================================================================
