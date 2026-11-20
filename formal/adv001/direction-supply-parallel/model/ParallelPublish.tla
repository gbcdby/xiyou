--------------------------- MODULE ParallelPublish ---------------------------
EXTENDS Naturals, Integers, FiniteSets
CONSTANTS Fault, Budget, Scenario
VARIABLE s
vars == <<s>>
Peers == 1..2
Records == 1..2
Keys == {<<p,v>>: p \in Peers,v \in 0..1}
CurrentKey(p) == <<p,s.view[p]>>
EmptyJob == [phase|->"unused",view|->0,rowHead|->0,through|->0]
EmptyCert == [settled|->FALSE,pendingClear|->FALSE,covered|->FALSE,clean|->FALSE]
CanMutate == s.writer="none" /\ s.readers={}
Current(p) == p \in s.live /\ p \notin s.closing /\ p \notin s.pending
  /\ s.jobs[p].view=s.view[p] /\ s.view[p]=s.persistent[p]
Covered(p,r) == p \in s.live /\ p \notin s.closing
  /\ s.sent[CurrentKey(p)]>=r
AllCovered(r) == \A p \in s.live \ s.closing: Covered(p,r)
CapturedCovered(r) == \A p \in s.selected \cap (s.live \ s.closing): Covered(p,r)
AllSettled == s.active={} /\ s.settled=s.selected
Clean == s.record \notin s.failedRecords /\ s.record \notin s.blockedRecords
ProgressAllowed ==
  /\ (Clean \/ Fault="ignore-failure")
  /\ (s.pending={} \/ Fault="ignore-pending")
  /\ (IF Fault="stale-views" THEN CapturedCovered(s.record) ELSE AllCovered(s.record))
NewViewAllowed == Scenario \in {"install","all"}
FailureAllowed == Scenario \in {"failure","all"}
JoinAllowed == Scenario \in {"join","all"}
CloseAllowed == Scenario \in {"failure","all"}

\* Pending 是仍存在的安装候选的保守抽象，不依赖 current/sent 的资格重算。
\* 初始每个已安装 view 的 snapshot 已真实入队；两条 outbox 行分别为 1/2。
Init == s = [record|->1,phase|->"idle",publisher|->TRUE,
  selected|->{},active|->{},settled|->{},readers|->{},writer|->"none",
  jobs|->[p \in Peers |-> EmptyJob],
  live|->IF Scenario \in {"join","all"} THEN {1} ELSE Peers,closing|->{},pending|->{},
  view|->[p \in Peers |->0],persistent|->[p \in Peers |->0],
  sent|->[k \in Keys |-> IF k[2]=0 /\ ~(Scenario \in {"join","all"} /\ k[1]=2) THEN 0 ELSE -1],
  proof|->[k \in Keys |-> IF k[2]=0 /\ ~(Scenario \in {"join","all"} /\ k[1]=2) THEN 0 ELSE -1],
  baseline|->[p \in Peers |->0],mutation|->"unused",joined|->FALSE,head|->2,
  failedRecords|->{},failureKinds|->{},blockedRecords|->{},published|->{},
  certs|->[r \in Records |->EmptyCert],commitRows|->{},
  txRows|->{},deliveries|->{},skipped|->{},closedWhileActive|->FALSE]

BeginRecord ==
  /\ s.phase="idle" /\ s.record \in Records
  /\ s'=[s EXCEPT !.phase="fanout",!.selected=s.live \ s.closing,
            !.active={},!.settled={},!.jobs=[p \in Peers |->EmptyJob],
            !.blockedRecords=IF s.pending#{} THEN @ \cup {s.record} ELSE @]

StartPeer(p) ==
  /\ s.phase="fanout" /\ p \in s.selected /\ s.jobs[p].phase="unused"
  /\ (Cardinality(s.active)<Budget \/ Fault="unbounded")
  /\ s'=[s EXCEPT !.active=@ \cup {p},
            !.jobs[p]=[phase|->"waiting",view|->s.view[p],rowHead|->0,through|->0]]

SkipCovered(p) ==
  /\ p \in s.active /\ s.jobs[p].phase="waiting" /\ Covered(p,s.record)
  /\ s'=[s EXCEPT !.jobs[p].phase="result"]

AcquireRead(p) ==
  /\ p \in s.active /\ s.jobs[p].phase="waiting" /\ Current(p)
  /\ s.writer="none" /\ s.sent[CurrentKey(p)]>=0
  /\ s.sent[CurrentKey(p)]<s.record
  /\ s'=[s EXCEPT !.readers=@ \cup {p},!.jobs[p].phase="reading",
            !.jobs[p].rowHead=s.head]

Read(p) ==
  /\ p \in s.readers /\ s.jobs[p].phase="reading"
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.jobs[p].phase="candidate",
            !.jobs[p].through=s.record]

Send(p) ==
  LET j == s.jobs[p]
      oldKey == <<p,j.view>>
      key == CurrentKey(p)
      delivery == [peer|->p,binding|->j.view,current|->s.view[p],durable|->s.persistent[p],
                   closed|->p \in s.closing,pending|->p \in s.pending,live|->p \in s.live,
                   through|->j.through,rowHead|->j.rowHead]
  IN /\ p \in s.active /\ j.phase="candidate"
     /\ (Current(p) \/ (Fault="stale-binding" /\ j.view#s.view[p])
          \/ (Fault="closed-send" /\ p \in s.closing))
     /\ s'=[s EXCEPT !.jobs[p].phase="result",!.sent[key]=j.through,
               !.proof[oldKey]=IF Fault="fake-proof" THEN @ ELSE j.through,
               !.deliveries=@ \cup {delivery}]

ReadFailure(p) ==
  /\ FailureAllowed /\ p \in s.readers
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.jobs[p].phase="result",
            !.failedRecords=@ \cup {s.record},!.failureKinds=@ \cup {"read"},!.live=@ \ {p}]

SendFailure(p) ==
  /\ FailureAllowed /\ p \in s.active /\ s.jobs[p].phase="candidate"
  /\ s'=[s EXCEPT !.jobs[p].phase="result",!.failedRecords=@ \cup {s.record},
            !.failureKinds=@ \cup {"send"},!.live=@ \ {p}]

Discard(p) ==
  /\ p \in s.active /\ s.jobs[p].phase \in {"waiting","candidate"}
  /\ (~Current(p) \/ s.sent[CurrentKey(p)]<0)
  /\ s'=[s EXCEPT !.jobs[p].phase="result",!.blockedRecords=@ \cup {s.record}]

Settle(p) ==
  /\ p \in s.active /\ s.jobs[p].phase="result"
  /\ s'=[s EXCEPT !.active=@ \ {p},!.settled=@ \cup {p},!.jobs[p].phase="settled"]

\* 新持久 binding 及其 pending 必须取得同一会话排他锁后建立。
BeginInstall ==
  /\ NewViewAllowed /\ s.mutation="unused" /\ 2 \in s.live
  /\ (CanMutate \/ (Fault="writer-overlap" /\ s.writer="none"))
  /\ s'=[s EXCEPT !.writer="control",!.pending=@ \cup {2},!.mutation="writing"]

CommitInstall ==
  /\ s.writer="control" /\ s.mutation="writing"
  /\ s'=[s EXCEPT !.writer="none",!.persistent[2]=1,!.mutation="committed",!.head=3]

InstallView ==
  /\ s.mutation="committed" /\ 2 \notin s.closing
  /\ (CanMutate \/ Fault="install-without-lock")
  /\ s'=[s EXCEPT !.view[2]=1,!.baseline[2]=s.head,
            !.pending=@ \ {2},!.mutation="installed"]

JoinView ==
  /\ JoinAllowed /\ ~s.joined /\ 2 \notin s.live /\ 2 \notin s.closing
  /\ (CanMutate \/ Fault="join-without-lock")
  /\ s'=[s EXCEPT !.live=@ \cup {2},!.joined=TRUE,!.baseline[2]=s.head]

Snapshot(p) ==
  LET key == CurrentKey(p)
  IN /\ p \in s.live \ s.closing /\ p \notin s.pending
     /\ s.view[p]=s.persistent[p] /\ s.sent[key]=-1
     /\ s'=[s EXCEPT !.sent[key]=s.baseline[p],!.proof[key]=s.baseline[p]]

Close(p) ==
  /\ CloseAllowed /\ p \notin s.closing
  /\ s'=[s EXCEPT !.closing=@ \cup {p},!.live=@ \ {p},!.pending=@ \ {p},
            !.closedWhileActive=@ \/ p \in s.active]

BeginProgress ==
  /\ s.phase="fanout" /\ CanMutate
  /\ (AllSettled \/ Fault="early-progress")
  /\ s'=[s EXCEPT !.phase="locked",!.writer="progress"]

CheckProgress ==
  /\ s.phase="locked" /\ s.writer="progress" /\ ProgressAllowed
  /\ s'=[s EXCEPT !.phase="checked"]

BlockProgress ==
  /\ s.phase="locked" /\ s.writer="progress" /\ ~ProgressAllowed
  /\ s'=[s EXCEPT !.phase="idle",!.writer="none",!.record=@+1,
            !.skipped=@ \cup {s.record}]

UpdateRow ==
  /\ s.phase="checked" /\ s.writer="progress"
  /\ s'=[s EXCEPT !.phase="updated",!.txRows=IF Fault="batch-progress" THEN Records ELSE {s.record}]

CommitRow ==
  LET cert == [settled|->AllSettled,pendingClear|->s.pending={},covered|->AllCovered(s.record),clean|->Clean]
  IN /\ s.phase="updated" /\ s.writer="progress"
     /\ s'=[s EXCEPT !.published=@ \cup s.txRows,
               !.certs=[r \in Records |->IF r \in s.txRows THEN cert ELSE s.certs[r]],
               !.commitRows=@ \cup {[target|->s.record,rows|->s.txRows]},
               !.phase="idle",!.writer="none",!.record=@+1,!.txRows={}]

\* SQL/COMMIT 失败可保留本行 Pending；已成功发送的 peer 水位不回退。
ProgressFailure ==
  /\ FailureAllowed /\ s.phase \in {"locked","checked","updated"}
  /\ s'=[s EXCEPT !.phase="idle",!.writer="none",!.record=@+1,!.txRows={},!.skipped=@ \cup {s.record}]

FinishPublisher ==
  /\ s.record=3 /\ s.phase="idle" /\ s.active={} /\ s.readers={}
  /\ s'=[s EXCEPT !.phase="done",!.publisher=FALSE]

FailFast ==
  /\ ((Fault="early-release" /\ s.failedRecords#{}) \/ (Fault="close-release" /\ s.closing#{}))
  /\ \E p \in s.active: s.jobs[p].phase \in {"waiting","reading","candidate"}
  /\ s'=[s EXCEPT !.publisher=FALSE]
UnlockedPending ==
  /\ Fault="pending-after-check" /\ s.phase \in {"checked","updated"}
  /\ s'=[s EXCEPT !.pending=@ \cup {2}]
BadType == /\ Fault="type" /\ s'=[s EXCEPT !.record=0]
Next == BeginRecord \/ (\E p \in Peers: StartPeer(p) \/ SkipCovered(p) \/ AcquireRead(p)
  \/ Read(p) \/ Send(p) \/ ReadFailure(p) \/ SendFailure(p) \/ Discard(p) \/ Settle(p)
  \/ Snapshot(p) \/ Close(p)) \/ BeginInstall \/ CommitInstall \/ InstallView \/ JoinView
  \/ BeginProgress \/ CheckProgress \/ BlockProgress \/ UpdateRow \/ CommitRow
  \/ ProgressFailure \/ FinishPublisher \/ FailFast \/ UnlockedPending \/ BadType
Spec == Init /\ [][Next]_vars

TypeOK == s.record \in 1..3 /\ s.phase \in {"idle","fanout","locked","checked","updated","done"}
  /\ s.publisher \in BOOLEAN /\ s.selected \subseteq Peers /\ s.active \subseteq Peers
  /\ s.settled \subseteq Peers /\ s.readers \subseteq Peers
  /\ s.writer \in {"none","control","progress"}
  /\ s.jobs \in [Peers -> [phase:{"unused","waiting","reading","candidate","result","settled"},view:0..1,rowHead:0..3,through:0..2]]
  /\ s.live \subseteq Peers /\ s.closing \subseteq Peers /\ s.pending \subseteq Peers
  /\ s.view \in [Peers ->0..1] /\ s.persistent \in [Peers ->0..1]
  /\ s.sent \in [Keys ->-1..3] /\ s.proof \in [Keys ->-1..3] /\ s.baseline \in [Peers ->0..3]
  /\ s.mutation \in {"unused","writing","committed","installed"} /\ s.joined \in BOOLEAN
  /\ s.head \in 2..3 /\ s.failedRecords \subseteq Records /\ s.blockedRecords \subseteq Records
  /\ s.failureKinds \subseteq {"read","send"}
  /\ s.published \subseteq Records /\ s.txRows \subseteq Records /\ s.skipped \subseteq Records
  /\ s.certs \in [Records ->[settled:BOOLEAN,pendingClear:BOOLEAN,covered:BOOLEAN,clean:BOOLEAN]]
  /\ s.commitRows \subseteq [target:Records,rows:SUBSET Records]
  /\ s.deliveries \subseteq [peer:Peers,binding:0..1,current:0..1,durable:0..1,closed:BOOLEAN,pending:BOOLEAN,live:BOOLEAN,through:0..2,rowHead:0..3]
  /\ s.closedWhileActive \in BOOLEAN
PeerBudget == Cardinality(s.active)<=Budget
LockExclusion == s.writer#"none" => s.readers={}
SettledBeforeProgress == s.phase \in {"locked","checked","updated"} => AllSettled
NoLeakedTasks == ~s.publisher => s.active={} /\ s.readers={}
PendingPreventsPublish == \A r \in s.published: s.certs[r].pendingClear
CurrentViewsCovered == \A r \in s.published: s.certs[r].covered
FailureKeepsPending == \A r \in s.published: s.certs[r].clean
ExactRowCommit == \A c \in s.commitRows: c.rows={c.target}
SentProof == \A k \in Keys: s.sent[k]<=s.proof[k]
NoStaleSend == \A d \in s.deliveries: d.binding=d.current /\ d.binding=d.durable /\ ~d.closed /\ ~d.pending /\ d.live
FixedReadHead == \A d \in s.deliveries: d.through<=d.rowHead
NotTwoReaders == Cardinality(s.readers)<2
NotPublishedBoth == s.published#Records
NotIndependentRows == ~(s.published={1} /\ 2 \notin s.published /\ s.record=2)
NotFailureRetained == ~(1 \in s.failedRecords /\ 1 \in s.skipped /\ 1 \notin s.published
  /\ s.sent[<<1,0>>]>=1 /\ s.sent[<<2,0>>]<1)
NotReadFailureRetained == NotFailureRetained \/ s.failureKinds#{"read"}
NotSendFailureRetained == NotFailureRetained \/ s.failureKinds#{"send"}
NotPendingBlocked == ~(s.pending#{} /\ 1 \in s.skipped /\ 1 \notin s.published)
NotNewViewBlocked == ~(s.view[2]=1 /\ s.sent[CurrentKey(2)]=-1 /\ 1 \in s.skipped /\ 1 \notin s.published)
NotJoinBlocked == ~(s.joined /\ 2 \notin s.selected /\ 1 \in s.skipped /\ 1 \notin s.published)
NotClosedSettled == ~(s.closedWhileActive /\ ~s.publisher /\ s.active={})
=============================================================================
