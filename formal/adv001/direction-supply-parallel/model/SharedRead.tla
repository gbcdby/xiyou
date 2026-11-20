----------------------------- MODULE SharedRead -----------------------------
EXTENDS Naturals, Integers, FiniteSets
CONSTANTS Fault, Eligible, OldCursor
VARIABLE s
vars == <<s>>
Peers == 1..2
Minimum(a,b) == IF a<b THEN a ELSE b
EmptyJob == [phase|->"unused", mode|->"none", requested|->1,
             binding|->0, authorized|->FALSE, rowHead|->0, through|->0,
             ceiling|->1]

\* 两个真实 handle 各一次调用。初始已发送头为 1，已有 head=2，
\* 一次 world 提交可增加至 3；一次 control 提交可改变持久授权。
\* Acquire 到 Finish 都持有行锁；Return 是 COMMIT 后的返回边界。
Init == s = [head|->2, binding|->0, readers|->{}, writer|->"none",
             writerDone|->FALSE, writerKind|->"none",
             jobs|->[p \in Peers |-> EmptyJob], results|->{},
             readFailed|->FALSE, staleRejected|->FALSE]

Acquire(p) ==
  LET mode == IF p \in Eligible \/ Fault="ordinary-share" THEN "share" ELSE "exclusive"
      wanted == IF OldCursor /\ p=1 THEN 0 ELSE 1
  IN /\ s.jobs[p].phase="unused" /\ s.writer="none"
     /\ (IF mode="share" THEN \A q \in s.readers: s.jobs[q].mode="share" ELSE s.readers={})
     /\ s'=[s EXCEPT !.readers=@ \cup {p},
               !.jobs[p]=[phase|->"locked",mode|->mode,requested|->wanted,
                           binding|->0,authorized|->FALSE,rowHead|->s.head,
                           through|->0,ceiling|->1]]

Authorize(p) ==
  /\ p \in s.readers /\ s.jobs[p].phase="locked"
  /\ (s.jobs[p].binding=s.binding \/ Fault="stale-authorization")
  /\ s'=[s EXCEPT !.jobs[p].phase="authorized", !.jobs[p].authorized=TRUE]

RejectAuthorization(p) ==
  /\ p \in s.readers /\ s.jobs[p].phase="locked"
  /\ s.jobs[p].binding#s.binding
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.jobs[p].phase="failed",!.staleRejected=TRUE]

ReadFailure(p) ==
  /\ p \in s.readers
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.jobs[p].phase="failed",!.readFailed=TRUE]

Build(p) ==
  LET j == s.jobs[p]
      cap == IF j.requested<j.ceiling /\ Fault#"old-cursor" THEN j.ceiling ELSE j.rowHead
  IN /\ p \in s.readers /\ j.phase="authorized"
     /\ s'=[s EXCEPT !.jobs[p].phase="candidate", !.jobs[p].through=Minimum(j.rowHead,cap)]

Finish(p) ==
  /\ p \in s.readers /\ s.jobs[p].phase="candidate"
  /\ s'=[s EXCEPT !.readers=@ \ {p},!.jobs[p].phase="committed"]

Return(p) ==
  LET j == s.jobs[p]
      t == IF Fault="live-head" THEN s.head ELSE j.through
      result == [peer|->p,binding|->j.binding,authorized|->j.authorized,
                 rowHead|->j.rowHead,through|->t,from|->j.requested,
                 ceiling|->j.ceiling]
  IN /\ j.phase="committed"
     /\ s'=[s EXCEPT !.jobs[p].phase="returned",!.results=@ \cup {result}]

BeginWrite(k) ==
  /\ k \in {"world","control"} /\ ~s.writerDone /\ s.writer="none"
  /\ (s.readers={} \/ Fault="writer-overlap")
  /\ s'=[s EXCEPT !.writer=k,!.writerKind=k]

CommitWrite ==
  /\ s.writer \in {"world","control"}
  /\ s'=[s EXCEPT !.head=IF s.writer="world" THEN 3 ELSE @,
           !.binding=IF s.writer="control" THEN 1 ELSE @,
           !.writer="none",!.writerDone=TRUE]

BadType == /\ Fault="type" /\ s'=[s EXCEPT !.head=-1]
Next == (\E p \in Peers: Acquire(p) \/ Authorize(p) \/ RejectAuthorization(p)
                         \/ ReadFailure(p) \/ Build(p) \/ Finish(p) \/ Return(p))
        \/ (\E k \in {"world","control"}: BeginWrite(k)) \/ CommitWrite \/ BadType
Spec == Init /\ [][Next]_vars

TypeOK == s.head \in 2..3 /\ s.binding \in 0..1 /\ s.readers \subseteq Peers
  /\ s.writer \in {"none","world","control"} /\ s.writerDone \in BOOLEAN
  /\ s.writerKind \in {"none","world","control"}
  /\ s.jobs \in [Peers -> [phase:{"unused","locked","authorized","candidate","committed","returned","failed"},
       mode:{"none","share","exclusive"},requested:0..1,binding:0..1,
       authorized:BOOLEAN,rowHead:0..3,through:0..3,ceiling:{1}]]
  /\ s.results \subseteq [peer:Peers,binding:0..1,authorized:BOOLEAN,rowHead:0..3,through:0..3,from:0..1,ceiling:{1}]
  /\ s.readFailed \in BOOLEAN /\ s.staleRejected \in BOOLEAN
LockExclusion == (s.writer#"none" => s.readers={})
  /\ (\A p \in s.readers: s.jobs[p].mode="exclusive" => s.readers={p})
EligibleSharedOnly == \A p \in Peers: s.jobs[p].mode="share" => p \in Eligible
AuthorizedBinding == \A p \in s.readers: s.jobs[p].authorized => s.jobs[p].binding=s.binding
FixedAuthorizedHead == (\A r \in s.results: r.authorized /\ r.through<=r.rowHead)
OldCursorCeiling == \A r \in s.results: r.from<r.ceiling => r.through<=r.ceiling
NotConcurrentShared == Cardinality(s.readers)<2
NotReadThenWrite == ~(s.writerDone /\ s.writerKind="world" /\ s.results#{})
NotStaleRejected == ~s.staleRejected
NotReadFailure == ~s.readFailed
=============================================================================
