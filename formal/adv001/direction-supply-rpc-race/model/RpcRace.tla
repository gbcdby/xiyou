--------------------------- MODULE RpcRace ---------------------------
EXTENDS Naturals, Integers, FiniteSets, Sequences
CONSTANTS Fault, Scenario, PredKind, InitialSent, Requested, FullCap, MaxHead, PageSize

\* publisher配置中1=初始W0，3=随后冻结W1；不同时活动。前置RPC配置不启用owner组合。
\* 2=原RPC，4=一次外部fresh恢复RPC，5=新link一次供给。
\* 每个整数代表完整事务前缀；PageSize是有限页抽象，不替代生产256边界测试。
VARIABLE s
vars == <<s>>
Ids == 1..5
Keys == {<<l,v>>: l \in 0..1,v \in 0..1}
Events == {<<k,n>>: k \in Keys,n \in 1..MaxHead}
K0 == <<0,0>>
Minimum(a,b) == IF a<b THEN a ELSE b
Maximum(a,b) == IF a>b THEN a ELSE b
LivePhases == {"sql","reading","built","candidate","result","covered"}
Active(l) == {j \in Ids: s.jobs[j].key[1]=l /\ s.jobs[j].phase \in LivePhases}
Waiting(l) == {j \in Ids: s.jobs[j].key[1]=l /\ s.jobs[j].phase="queued" /\ s.jobs[j].kind="rpc"}
Current(j) == s.jobs[j].key=s.key /\ ~s.closing /\ ~s.pending
Sent == s.sent[s.key]
EmptyJob == [kind|->"none",key|->K0,requested|->0,admitted|->0,pred|->0,predKind|->"none",
  phase|->"unused",mode|->"none",from|->0,through|->0,q|->0,readSent|->0,validR|->FALSE,
  currentRead|->FALSE,full|->FALSE,target|->0]
NewJob(kind,key,r,a,p,pk,phase,target) == [EmptyJob EXCEPT !.kind=kind,!.key=key,
  !.requested=r,!.admitted=a,!.pred=p,!.predKind=pk,!.phase=phase,!.target=target,!.full=FullCap]
Predecessor(l) == IF Active(l)={} THEN 0 ELSE CHOOSE j \in Active(l): TRUE
PredName(p) == IF p=0 THEN "none" ELSE s.jobs[p].kind
Race(j) == s.jobs[j].kind="rpc" /\ (s.jobs[j].full \/ Fault="force-full") /\ Current(j)
  /\ (s.jobs[j].requested=s.jobs[j].admitted \/ Fault="upgrade-old")
  /\ (s.jobs[j].predKind="push" \/ Fault="upgrade-rpc")
  /\ s.jobs[j].pred#0 /\ Sent>s.jobs[j].admitted
Packet(j,f,t) == [job|->j,key|->s.jobs[j].key,kind|->IF s.jobs[j].kind="rpc" THEN "ack" ELSE "push",from|->f,through|->t]
Deliverable == {i \in 1..Len(s.wire): \A n \in 1..(i-1): s.wire[n].key[1]#s.wire[i].key[1]}
RemoveAt(q,i) == SubSeq(q,1,i-1) \o SubSeq(q,i+1,Len(q))
ValidPacket(p) == p.key=s.key /\ ~s.closing
ApplyOK(p) == ValidPacket(p) /\ p.from=s.client
Duplicate(p) == ValidPacket(p) /\ p.through<=s.client
Bump(p) == [e \in Events |->s.applied[e]+IF e[1]=p.key /\ e[2]>p.from /\ e[2]<=p.through
  THEN IF Fault="double-apply" THEN 2 ELSE 1 ELSE 0]
\* 原固定P只含启动前已提交的两行，之后新head绝不被补入P。
GTarget == s.gindex
Covered(t) == s.closing \/ (~s.pending /\ Sent>=t)

Init ==
  s=[key|->K0,head|->2,closing|->FALSE,pending|->FALSE,authorized|->TRUE,mutation|->FALSE,
    installed|->[k \in Keys |->IF Scenario="lower" /\ k=K0 THEN 1 ELSE 0],
    baseline|->[k \in Keys |->IF Scenario="lower" /\ k=K0 THEN 1 ELSE 0],
    sent|->[k \in Keys |->IF k=K0 THEN InitialSent ELSE 0],
    proof|->[k \in Keys |->IF k=K0 THEN InitialSent ELSE 0],
    jobs|->[j \in Ids |->IF j=1 THEN NewJob(PredKind,K0,InitialSent,InitialSent,0,"none","sql",2) ELSE EmptyJob],
    readers|->{},writer|->FALSE,wire|-><<>>,deferred|-><<>>,deliveries|->{},reads|->{},
    client|->1,applied|->[e \in Events |->IF e[1]=K0 /\ e[2]=1 /\ Scenario#"lower" THEN 1 ELSE 0],
    applicationLog|->{},unforcedGap|->FALSE,rejectedPush|->FALSE,rejectedAck|->FALSE,
    ignoredAck|->FALSE,lateOld|->FALSE,newLinkAdvanced|->FALSE,demand|->FALSE,recoveryUsed|->FALSE,externalFreshUsed|->FALSE,
    failUsed|->FALSE,staleDiscard|->FALSE,owner|->IF PredKind="push" THEN "running" ELSE "detached",gindex|->0,gphase|->"none",
    gcheck|->FALSE,gcommits|->{},gadmissions|->{},actualRows|->{},publishedRows|->{},
    badCancel|->FALSE,newAfterStop|->FALSE,bypassed|->FALSE]

CommitWorld == /\ s.head<MaxHead /\ ~s.writer /\ s.readers={}
  /\ s'=[s EXCEPT !.head=@+1]

RequestPrimary ==
  LET p==Predecessor(s.key[1])
  IN /\ s.jobs[2].phase="unused" /\ s.jobs[1].phase#"settled" /\ ~s.closing
     /\ Waiting(s.key[1])={}
     /\ s'=[s EXCEPT !.jobs[2]=NewJob("rpc",s.key,Requested,Sent,p,PredName(p),
          IF p=0 \/ Fault="parallel-lane" THEN "sql" ELSE "queued",0)]

RequestRecovery ==
  LET p==Predecessor(s.key[1])
  IN /\ s.demand /\ ~s.recoveryUsed /\ s.jobs[2].phase="settled" /\ ~s.closing
     /\ Waiting(s.key[1])={}
     /\ s'=[s EXCEPT !.jobs[4]=NewJob("rpc",s.key,s.client,Sent,p,PredName(p),
          IF p=0 THEN "sql" ELSE "queued",0),!.demand=FALSE,!.recoveryUsed=TRUE]

\* 原sync catch不创建fresh。一次外部心跳/显式需求是独立、可永不执行的环境动作。
ExternalFresh ==
  /\ Scenario="timeout" /\ s.ignoredAck /\ ~s.externalFreshUsed /\ ~s.closing
  /\ s'=[s EXCEPT !.demand=TRUE,!.externalFreshUsed=TRUE]

QueueWave ==
  /\ s.owner="running" /\ s.gindex=1 /\ s.head=MaxHead /\ Sent<MaxHead
  /\ s.jobs[3].phase="unused" /\ (~s.closing \/ Fault="start-after-stop")
  /\ s'=[s EXCEPT !.jobs[3]=NewJob("push",s.key,Sent,Sent,0,"none","queued",MaxHead),
       !.newAfterStop=@ \/ s.closing]

Start(j) ==
  /\ s.jobs[j].phase="queued" /\ Active(s.jobs[j].key[1])={}
  /\ (s.jobs[j].kind="rpc" \/ Waiting(s.jobs[j].key[1])={} \/ Fault="bypass-rpc")
  /\ s'=[s EXCEPT !.jobs[j].phase="sql",!.bypassed=@ \/ (s.jobs[j].kind="push" /\ Waiting(s.jobs[j].key[1])#{}),
       !.jobs[j].requested=IF s.jobs[j].kind="push" /\ Current(j) THEN Sent ELSE @]

CoveredWave ==
  /\ s.jobs[3].phase="sql" /\ Current(3) /\ Sent>=s.jobs[3].target
  /\ s'=[s EXCEPT !.jobs[3].phase="covered",!.jobs[3].mode="covered"]

Acquire(j) ==
  /\ s.jobs[j].phase="sql" /\ (j#3 \/ ~Current(j) \/ Sent<s.jobs[j].target)
  /\ (~s.writer \/ Fault="read-through-writer")
  /\ s'=[s EXCEPT !.jobs[j].phase="reading",!.jobs[j].q=s.head,!.readers=@ \cup {j}]

Build(j) ==
  LET valid==s.authorized /\ Current(j) /\ s.jobs[j].requested>=s.installed[s.jobs[j].key]
            /\ s.jobs[j].requested<=s.jobs[j].q /\ s.jobs[j].requested<=Sent
      race==Race(j)
      mode==IF race THEN "race" ELSE IF s.jobs[j].kind="rpc" /\ s.jobs[j].requested<Sent THEN "history" ELSE "normal"
      f==IF race THEN IF Fault="head-start" THEN s.jobs[j].q ELSE IF Fault="partial-overlap" THEN s.jobs[j].requested ELSE Sent
          ELSE IF s.jobs[j].kind="push" THEN Sent ELSE s.jobs[j].requested
      ceiling==IF mode="history" THEN Sent ELSE s.jobs[j].q
      t==IF Fault="partial-overlap" /\ race THEN s.jobs[j].q ELSE Minimum(f+PageSize,ceiling)
      cert==[job|->j,key|->s.jobs[j].key,kind|->s.jobs[j].kind,mode|->mode,
        r|->s.jobs[j].requested,a|->s.jobs[j].admitted,pred|->s.jobs[j].pred,pk|->s.jobs[j].predKind,
        sent|->Sent,from|->f,through|->t,q|->s.jobs[j].q,validR|->valid,current|->Current(j),full|->s.jobs[j].full]
  IN /\ s.jobs[j].phase="reading" /\ j \in s.readers
     /\ (valid \/ Fault="skip-original")
     /\ s'=[s EXCEPT !.jobs[j].phase="built",!.jobs[j].mode=mode,!.jobs[j].from=f,!.jobs[j].through=t,
          !.jobs[j].readSent=Sent,!.jobs[j].validR=valid,!.jobs[j].currentRead=Current(j),!.reads=@ \cup {cert}]

Reject(j) ==
  /\ s.jobs[j].phase="reading" /\ j \in s.readers
  /\ (~Current(j) \/ ~s.authorized \/ s.jobs[j].requested<s.installed[s.jobs[j].key]
       \/ s.jobs[j].requested>s.jobs[j].q \/ s.jobs[j].requested>Sent)
  /\ s'=[s EXCEPT !.jobs[j].phase="result",!.readers=@ \ {j},!.staleDiscard=@ \/ ~Current(j)]

CommitRead(j) ==
  /\ s.jobs[j].phase="built" /\ j \in s.readers
  /\ s'=[s EXCEPT !.jobs[j].phase="candidate",!.readers=@ \ {j}]

ReadUnknown(j) ==
  /\ Scenario="failure" /\ s.jobs[j].phase="built" /\ ~s.failUsed
  /\ s'=[s EXCEPT !.jobs[j].phase="result",!.readers=@ \ {j},!.failUsed=TRUE]

Send(j) ==
  LET f==s.jobs[j].from
      t==IF Fault="head-after-read" THEN s.head ELSE s.jobs[j].through
      k==IF Fault="stale-send" THEN s.key ELSE s.jobs[j].key
      contiguous==f=s.sent[k] \/ (f<s.sent[k] /\ t<=s.sent[k])
      packet==Packet(j,f,t)
      real==Fault#"fake-proof"
      cert==[job|->j,key|->s.jobs[j].key,current|->s.key,from|->f,through|->t,
        before|->s.sent[k],q|->s.jobs[j].q,valid|->Current(j),real|->real]
  IN /\ s.jobs[j].phase="candidate"
     /\ (Current(j) \/ Fault="stale-send")
     /\ (contiguous \/ Fault \in {"partial-overlap","head-start","stale-send"})
     /\ s'=[s EXCEPT !.jobs[j].phase="result",!.deliveries=@ \cup {cert},
          !.wire=IF real THEN Append(@,packet) ELSE @,
          !.proof[k]=IF real /\ f=@ THEN Maximum(@,t) ELSE @,
          !.sent[k]=IF f=@ \/ Fault \in {"partial-overlap","head-start","stale-send"} THEN Maximum(@,t) ELSE @,
          !.installed[k]=IF Fault="overwrite-installed" THEN Maximum(@,t) ELSE @]

Discard(j) ==
  /\ s.jobs[j].phase="candidate" /\ ~Current(j)
  /\ s'=[s EXCEPT !.jobs[j].phase="result",!.staleDiscard=TRUE]

SendFailure(j) ==
  /\ Scenario="failure" /\ s.jobs[j].phase="candidate" /\ ~s.failUsed
  /\ s'=[s EXCEPT !.jobs[j].phase="result",!.closing=TRUE,!.failUsed=TRUE]

Settle(j) == /\ s.jobs[j].phase \in {"result","covered"}
  /\ s'=[s EXCEPT !.jobs[j].phase="settled"]

Receive(i) ==
  LET p==s.wire[i]
      reject==Scenario="reject" /\ p.job=1 /\ p.kind="push" /\ ~s.rejectedPush /\ ValidPacket(p)
      timeout==Scenario="timeout" /\ p.kind="ack" /\ ~s.ignoredAck /\ ValidPacket(p)
      postpone==Fault="defer-consumer" /\ p.job=1 /\ ValidPacket(p)
      apply==~reject /\ ~timeout /\ ~postpone /\ (ApplyOK(p) \/ (Fault="skip-gap" /\ ValidPacket(p))) /\ p.through>s.client
      gap==ValidPacket(p) /\ ~Duplicate(p) /\ p.from#s.client
      cert==[job|->p.job,key|->p.key,current|->s.key,from|->p.from,before|->s.client,through|->p.through]
  IN /\ i \in Deliverable
     /\ s'=[s EXCEPT !.wire=RemoveAt(@,i),
          !.deferred=IF postpone THEN Append(@,p) ELSE @,
          !.client=IF apply THEN p.through ELSE @,
          !.applied=IF apply THEN Bump(p) ELSE @,
          !.applicationLog=IF apply THEN @ \cup {cert} ELSE @,
          !.rejectedPush=@ \/ reject,
          !.rejectedAck=@ \/ (p.kind="ack" /\ gap /\ ~apply),
          !.ignoredAck=@ \/ timeout,
          !.demand=@ \/ reject \/ (timeout /\ Fault="timeout-self-demand") \/ (p.kind="push" /\ gap),
          !.unforcedGap=@ \/ (gap /\ ~s.rejectedPush /\ ~s.ignoredAck /\ InitialSent=1),
          !.lateOld=@ \/ (p.key#s.key /\ s.newLinkAdvanced),
          !.newLinkAdvanced=@ \/ (apply /\ p.key[1]=1 /\ p.through>s.baseline[p.key])]

Deferred ==
  LET p==Head(s.deferred)
      apply==ApplyOK(p) /\ p.through>s.client
  IN /\ Len(s.deferred)>0
     /\ s'=[s EXCEPT !.deferred=Tail(@),!.client=IF apply THEN p.through ELSE @,
          !.applied=IF apply THEN Bump(p) ELSE @]

Rebind ==
  /\ Scenario="identity" /\ ~s.mutation /\ ~s.writer /\ s.readers={}
  /\ \E k \in {<<0,1>>,<<1,0>>}:
       s'=[s EXCEPT !.key=k,!.mutation=TRUE,!.installed[k]=s.head,!.baseline[k]=s.head,
          !.sent[k]=s.head,!.proof[k]=s.head,!.client=s.head,
          !.applied=[e \in Events |->IF e[1]=k THEN 0 ELSE s.applied[e]]]

NewLinkSupply ==
  /\ Scenario="identity" /\ s.key[1]=1 /\ s.jobs[5].phase="unused" /\ Sent<s.head
  /\ Active(s.key[1])={} /\ Waiting(s.key[1])={}
  /\ s'=[s EXCEPT !.jobs[5]=NewJob("push",s.key,Sent,Sent,0,"none","sql",s.head)]

Revoke == /\ Scenario="failure" /\ s.authorized /\ ~s.writer /\ s.readers={}
  /\ s'=[s EXCEPT !.authorized=FALSE]
Close == /\ Scenario="failure" /\ ~s.closing
  /\ s'=[s EXCEPT !.closing=TRUE]
BeginPending == /\ Scenario="identity" /\ ~s.pending /\ ~s.mutation /\ ~s.writer /\ s.readers={}
  /\ s'=[s EXCEPT !.pending=TRUE,!.mutation=TRUE]

AdmitG ==
  LET n==s.gindex+1
      settled==s.jobs[3].phase \in {"unused","settled"}
      target==n
      cert==[row|->n,waveSettled|->settled,oldGSettled|->s.gphase \in {"none","settled"},
        covered|->Covered(target),pendingClear|->~s.pending]
  IN /\ s.owner="running" /\ s.gindex<2 /\ s.gphase \in {"none","settled"}
     /\ s.jobs[1].phase="settled" /\ ~s.closing
     /\ (settled \/ Fault="early-g") /\ Covered(target)
     /\ s'=[s EXCEPT !.gindex=n,!.gphase="queued",!.gadmissions=@ \cup {cert}]

AcquireG == /\ s.gphase="queued" /\ ~s.writer /\ (s.readers={} \/ Fault="writer-through-read")
  /\ s'=[s EXCEPT !.gphase="locked",!.writer=TRUE]
CheckG == /\ s.gphase="locked"
  /\ s'=[s EXCEPT !.gphase="checked",!.gcheck=(Covered(GTarget) /\ ~s.pending) \/ Fault="unchecked-g"]
UpdateG == /\ s.gphase="checked" /\ s.gcheck
  /\ s'=[s EXCEPT !.gphase="updated"]
CommitG ==
  LET cert==[row|->s.gindex,covered|->Covered(GTarget),pendingClear|->~s.pending]
  IN /\ s.gphase="updated" /\ s.writer
     /\ s'=[s EXCEPT !.gphase="committed",!.writer=FALSE,!.gcommits=@ \cup {cert},
          !.actualRows=@ \cup {s.gindex},!.publishedRows=@ \cup {s.gindex}]
BlockedG == /\ s.gphase="checked" /\ ~s.gcheck
  /\ s'=[s EXCEPT !.gphase="committed",!.writer=FALSE]
SettleG == /\ s.gphase="committed"
  /\ s'=[s EXCEPT !.gphase="settled"]

FinishOwner ==
  /\ s.owner="running" /\ (s.gindex=2 \/ s.closing)
  /\ ((s.jobs[1].phase="settled" /\ s.gphase \in {"none","settled"} /\ s.jobs[3].phase \in {"unused","settled"}) \/ Fault="early-owner")
  /\ s'=[s EXCEPT !.owner="done"]

CancelSQL == /\ Fault="cancel-sql" /\ s.closing
  /\ \E j \in Ids: s.jobs[j].phase \in {"reading","built"} /\
       s'=[s EXCEPT !.jobs[j].phase="result",!.badCancel=TRUE]
BadType == /\ Fault="type" /\ s'=[s EXCEPT !.head=0]

Next == CommitWorld \/ RequestPrimary \/ RequestRecovery \/ ExternalFresh \/ QueueWave
  \/ (\E j \in Ids: Start(j) \/ Acquire(j) \/ Build(j) \/ Reject(j) \/ CommitRead(j)
      \/ ReadUnknown(j) \/ Send(j) \/ Discard(j) \/ SendFailure(j) \/ Settle(j))
  \/ CoveredWave \/ (\E i \in 1..Len(s.wire): Receive(i)) \/ Deferred
  \/ Rebind \/ NewLinkSupply \/ Revoke \/ Close \/ BeginPending
  \/ AdmitG \/ AcquireG \/ CheckG \/ UpdateG \/ CommitG \/ BlockedG \/ SettleG \/ FinishOwner
  \/ CancelSQL \/ BadType
Spec == Init /\ [][Next]_vars

TypeOK == s.key \in Keys /\ s.head \in 2..MaxHead /\ s.client \in 0..MaxHead
  /\ s.sent \in [Keys -> 0..MaxHead] /\ s.proof \in [Keys -> 0..MaxHead]
  /\ s.gindex \in 0..2 /\ s.readers \subseteq Ids /\ s.writer \in BOOLEAN
LaneDiscipline == ~s.bypassed /\ \A l \in 0..1: Cardinality(Active(l))<=1 /\ Cardinality(Waiting(l))<=1
OriginalAuthority == \A c \in s.reads: c.validR /\ c.current
RaceEligibility == \A c \in s.reads: c.mode="race" => c.r=c.a /\ c.pk="push" /\ c.full /\ c.sent>c.a
RaceOrigin == \A c \in s.reads: c.mode="race" =>
  \E d \in s.deliveries: d.job=c.pred /\ d.key=c.key /\ d.real /\ d.from=c.a /\ d.through=c.sent
ReadBoundary == \A c \in s.reads:
  c.through<=c.q /\ c.through>=c.from /\ c.through<=c.from+PageSize
  /\ (c.mode="race" => c.from=c.sent)
  /\ (c.mode="history" => c.from=c.r /\ c.through<=c.sent)
SentPrefix == \A k \in Keys: s.sent[k]=s.proof[k] /\ s.sent[k]>=s.installed[k]
InstalledSeparate == s.installed=s.baseline
NoStaleSend == \A d \in s.deliveries: d.valid /\ d.key=d.current
FixedAuthorizedHead == \A d \in s.deliveries: d.through<=d.q
ConsumerSafety == (\A a \in s.applicationLog: a.key=a.current /\ a.from=a.before)
  /\ \A e \in Events: s.applied[e]<=1
  /\ \A n \in 1..MaxHead: s.applied[<<s.key,n>>]=(IF n>s.baseline[s.key] /\ n<=s.client THEN 1 ELSE 0)
SynchronousConsumption == ~s.unforcedGap
LockExclusion == ~s.writer \/ s.readers={}
ProgressCut == (\A c \in s.gadmissions: c.waveSettled /\ c.oldGSettled /\ c.covered /\ c.pendingClear)
  /\ (\A c \in s.gcommits: c.covered /\ c.pendingClear) /\ s.actualRows=s.publishedRows
OwnerSettled == s.owner="done" => s.jobs[1].phase="settled" /\ s.gphase \in {"none","settled"} /\ s.jobs[3].phase \in {"unused","settled"}
NoCancellation == ~s.badCancel /\ \A j \in s.readers: s.jobs[j].phase \in {"reading","built"}
NoNewAfterStop == ~s.newAfterStop
NoTimeoutSelfWake == (s.ignoredAck /\ ~s.externalFreshUsed /\ ~s.rejectedPush) => ~s.demand /\ ~s.recoveryUsed

\* 见证使用否定终点；预期rc=12只说明存在该路径，不是活性证明。
NotRaceApplied == ~(s.jobs[2].mode="race" /\ s.jobs[2].phase="settled" /\ s.client=MaxHead)
NotHistoryApplied == ~(s.jobs[2].mode="history" /\ s.jobs[2].phase="settled" /\ s.client>1)
NotRPCPredecessor == ~(PredKind="rpc" /\ s.jobs[2].mode="history" /\ s.jobs[2].phase="settled")
NotRejectRecovered == ~(s.rejectedPush /\ s.rejectedAck /\ s.jobs[4].mode="history" /\ s.jobs[4].phase="settled"
  /\ s.client=MaxHead /\ \E a \in s.applicationLog: a.job=4 /\ a.through>a.before)
NotTimeoutRecovered == ~(s.ignoredAck /\ s.externalFreshUsed /\ s.jobs[4].mode="history" /\ s.jobs[4].phase="settled"
  /\ s.client=MaxHead /\ \E a \in s.applicationLog: a.job=4 /\ a.through>a.before)
NotTimeoutWaiting == ~(s.ignoredAck /\ ~s.externalFreshUsed /\ ~s.demand /\ ~s.recoveryUsed /\ s.client<Sent)
NotOldDiscard == ~(s.mutation /\ s.staleDiscard)
NotLateOld == ~s.lateOld
NotWaveCoveredGSettled == ~(s.jobs[2].mode="race" /\ s.jobs[2].through=MaxHead /\ s.jobs[3].phase="settled" /\ s.jobs[3].mode="covered"
  /\ s.owner="done" /\ s.publishedRows={1,2})
NotCommitBeforeSettle == ~(s.gphase="committed" /\ s.jobs[3].phase#"unused")
NotStopDrained == ~(s.closing /\ s.owner="done" /\ s.jobs[3].phase="settled")
=============================================================================
