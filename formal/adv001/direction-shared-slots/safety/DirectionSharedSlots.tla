-------------------------- MODULE DirectionSharedSlots --------------------------
EXTENDS Naturals, Integers, FiniteSets, TLC

(***************************************************************************
 D66-DS2 r2 设计候选；执行状态 NOT_RUN。一个 tick 表示 100ms。
 分开表示两层状态：实例所属回调 entry 与全会话原请求 ledger 身份。
 本目录只用于安全性质：seen 投影为常量空集；禁止用于 Never 可达性探针。
 仅一个 controlEpoch；绑定更换不重置原 movementCommandSeq 来源。
 Tick 不强制派发定时器或回调。deadline 是固定原到期时刻，不是硬实时保证。
 只有局部 tick 检查本实例当前代次 local entry 是否已过期。
 配置中的有限请求、输入、实例和时间上限都是明确的探索界限。
***************************************************************************)
CONSTANTS MaxRequests, MaxTime, MaxInputs, MaxClears, ControllerCount, Fault
VARIABLE s
vars == <<s>>
Requests == 1..MaxRequests
Controllers == 1..ControllerCount
Directions == {"E", "S", "W"}
Results == {"accepted", "rejected", "unknown"}
Statuses == {"unused", "waiting", "unknown", "accepted", "rejected"}
Phases == {"none", "pending", "returned", "ready", "handled", "done"}
CounterBound == 8 * MaxRequests + 4 * MaxInputs + 4 * MaxClears + 4 * ControllerCount + 8
MaxOf(V) == IF V = {} THEN 0 ELSE CHOOSE x \in V : \A y \in V : y <= x
Cap2(n) == IF n > 2 THEN 2 ELSE n
InitialController == [generation |-> 0, intent |-> 0, vector |-> "none",
  sentIntent |-> 0, latest |-> 0, nextAt |-> 0, credits |-> 2,
  stopId |-> 0, resume |-> FALSE, stopped |-> TRUE, blocked |-> FALSE]
UnusedRequest == [kind |-> "unused", status |-> "unused", owner |-> 0,
  generation |-> 0, intent |-> 0, vector |-> "none", at |-> 0,
  deadline |-> 0, seq |-> 0, local |-> FALSE, phase |-> "none",
  result |-> "none", receipt |-> FALSE]
Moves(st) == {r \in Requests : st.req[r].kind = "move"}
UnresolvedMoves(st) == {r \in Moves(st) : st.req[r].status \in {"waiting", "unknown"}}
UnresolvedStops(st) == {r \in Requests : st.req[r].kind = "stop" /\ st.req[r].status \in {"waiting", "unknown"}}
Unknowns(st) == {r \in Requests : st.req[r].status = "unknown"}
Local(st,c) == {r \in Moves(st) : st.req[r].owner = c /\ st.req[r].local}
LocalExpired(st,c) == \E r \in Local(st,c) : st.req[r].generation = st.ctrl[c].generation /\ st.time >= st.req[r].deadline
NeedsStop(st) == MaxOf({st.req[r].seq : r \in Moves(st)}) >
  MaxOf({st.req[r].seq : r \in {q \in Requests : st.req[q].kind = "stop" /\ st.req[q].status # "rejected"}})
CurrentResume(st) == LET c == st.ctrl[st.current] IN c.stopId # 0 /\ c.resume /\ ~c.blocked
ReadyInput(st) == (Unknowns(st) = {} \/ Fault = "ignore-unknown") /\
  (UnresolvedStops(st) = {} \/ CurrentResume(st)) /\ ~st.mustBind
SessionAdmission(st) == (Unknowns(st) = {} \/ Fault = "ignore-unknown") /\
  UnresolvedStops(st) = {} /\ (Cardinality(UnresolvedMoves(st)) < 2 \/ Fault = "omit-global-guard")

ClearState(st,c) ==
  LET cc == st.ctrl[c]
      changed == [cc EXCEPT !.generation = @ + 1, !.intent = @ + 1,
        !.vector = "none", !.stopped = TRUE, !.resume = FALSE, !.blocked = FALSE]
      ns == [st EXCEPT !.ctrl[c] = changed]
  IN IF Fault = "reset-budget-on-clear" THEN [ns EXCEPT !.ctrl[c].credits = 2] ELSE ns
InstallState(st) ==
  LET cleared == ClearState(st,st.current)
  IN [cleared EXCEPT !.current = st.current + 1,
      !.ctrl[st.current + 1] = InitialController, !.mustBind = FALSE]
RenewState(st) == IF st.current < ControllerCount THEN InstallState(st)
  ELSE [ClearState(st,st.current) EXCEPT !.mustBind = TRUE]
UnknownWaiting(st) == [st EXCEPT !.req = [r \in Requests |->
  IF st.req[r].status = "waiting" THEN [st.req[r] EXCEPT !.status = "unknown"] ELSE st.req[r]]]
IssueStop(st,c) ==
  IF st.nextId > MaxRequests \/ UnresolvedStops(st) # {} THEN st
  ELSE LET id == st.nextId
           g == IF c = 0 THEN 0 ELSE st.ctrl[c].generation
           q == [kind |-> "stop", status |-> "waiting", owner |-> c,
             generation |-> g, intent |-> 0, vector |-> "none", at |-> st.time,
             deadline |-> st.time + 4, seq |-> id, local |-> FALSE,
             phase |-> "pending", result |-> "none", receipt |-> FALSE]
           ns == [st EXCEPT !.req[id] = q, !.nextId = @ + 1]
       IN IF c = 0 THEN ns ELSE [ns EXCEPT !.ctrl[c].stopId = id]
HaltState(st,c,bad) ==
  LET cc == st.ctrl[c]
      ns == [st EXCEPT !.ctrl[c] = [cc EXCEPT
        !.generation = @ + 1, !.intent = @ + 1, !.vector = "none",
        !.blocked = bad, !.resume = ~bad, !.stopped = TRUE]]
      frozen == IF bad THEN UnknownWaiting(ns) ELSE ns
  IN IF ~cc.stopped /\ cc.stopId = 0 THEN IssueStop(frozen,c) ELSE frozen
LedgerUnknown(st,r) ==
  LET ns == [st EXCEPT !.req[r].status = "unknown"]
      cleared == ClearState(ns,ns.current)
  IN IF st.req[r].kind = "move" /\ NeedsStop(cleared)
     THEN IssueStop(cleared,0) ELSE cleared
ApplyOutcome(st,r,outcome) ==
  IF st.req[r].status \in {"accepted", "rejected"} THEN st
  ELSE IF outcome = "unknown" THEN
    IF st.req[r].status = "unknown" THEN st ELSE LedgerUnknown(st,r)
  ELSE LET ns == [st EXCEPT !.req[r].status = outcome, !.req[r].receipt = TRUE]
       IN IF st.req[r].status = "unknown" THEN RenewState(ns) ELSE ns

(*** 独立转换观察器：不作为 Next 的准入条件，不裁剪可达状态。 ***)
Observe(old,ns,tag,id) ==
  LET sending == tag = "send"
      rq == IF id = 0 THEN UnusedRequest ELSE old.req[id]
      stale == id # 0 /\ rq.owner # 0 /\ rq.generation # old.ctrl[rq.owner].generation
      obsoleteReject == id # 0 /\ rq.kind = "move" /\ rq.result = "rejected" /\ rq.owner # 0 /\
        rq.generation = old.ctrl[rq.owner].generation /\
        (id # old.ctrl[rq.owner].latest \/ rq.intent # old.ctrl[rq.owner].intent)
      wrongReceipt == tag \in {"response", "query"} /\
        (\E r \in Requests : r < old.nextId /\ r # id /\ old.req[r].status # ns.req[r].status)
      wrongRelease == tag = "finally" /\
        (\E r \in Requests : r # id /\ old.req[r].local /\ ~ns.req[r].local)
      lostPending == tag \in {"clear", "bind"} /\
        (\E r \in Requests : old.req[r].local /\ ~ns.req[r].local)
      restored == tag # "input" /\ ns.ctrl[ns.current].vector # "none" /\
        (ns.current # old.current \/ old.ctrl[old.current].vector = "none")
      issues == (IF sending /\ ns.req[id].vector # old.ctrl[old.current].vector THEN {"stale-intent"} ELSE {}) \cup
        (IF sending /\ Unknowns(old) # {} THEN {"unknown-send"} ELSE {}) \cup
        (IF sending /\ UnresolvedStops(old) # {} THEN {"stop-send"} ELSE {}) \cup
        (IF sending /\ LocalExpired(old,old.current) THEN {"expired-send"} ELSE {}) \cup
        (IF tag = "handle" /\ stale /\ ns.ctrl[rq.owner] # old.ctrl[rq.owner] THEN {"stale-callback"} ELSE {}) \cup
        (IF tag = "handle" /\ obsoleteReject /\ ns.ctrl[rq.owner] # old.ctrl[rq.owner] THEN {"obsolete-reject"} ELSE {}) \cup
        (IF wrongReceipt THEN {"wrong-receipt"} ELSE {}) \cup
        (IF wrongRelease THEN {"wrong-release"} ELSE {}) \cup
        (IF lostPending THEN {"lost-pending"} ELSE {}) \cup
        (IF restored THEN {"resurrection"} ELSE {})
  IN [ns EXCEPT !.audit = old.audit \cup issues, !.seen = {}]
Step(ns,tag,id) == s' = Observe(s,ns,tag,id)

Init == s = [time |-> 0, current |-> 1, ctrl |-> [c \in Controllers |-> InitialController],
  req |-> [r \in Requests |-> UnusedRequest], nextId |-> 1, inputs |-> 0,
  clears |-> 0, mustBind |-> FALSE, audit |-> {}, seen |-> {}]
Input(d) ==
  /\ s.inputs < MaxInputs /\ ~s.mustBind
  /\ LET c == s.current
         cc == s.ctrl[c]
         valid == ReadyInput(s) /\ ~(cc.stopId # 0 /\ (~cc.resume \/ cc.blocked))
         base == IF ~ReadyInput(s) THEN ClearState(s,c)
                 ELSE IF ~valid \/ cc.vector = d THEN s
                 ELSE [s EXCEPT !.ctrl[c].vector = d, !.ctrl[c].intent = @ + 1,
                    !.ctrl[c].blocked = IF cc.stopId = 0 THEN FALSE ELSE @,
                    !.ctrl[c].stopped = IF cc.stopId = 0 THEN FALSE ELSE @]
     IN Step([base EXCEPT !.inputs = @ + 1],"input",0)
Release ==
  /\ s.inputs < MaxInputs /\ ~s.mustBind
  /\ LET c == s.current
         cc == s.ctrl[c]
         ns == IF cc.vector = "none" THEN s
               ELSE IF cc.stopId # 0 THEN [s EXCEPT !.ctrl[c].vector = "none", !.ctrl[c].intent = @ + 1]
               ELSE HaltState(s,c,FALSE)
     IN Step([ns EXCEPT !.inputs = @ + 1],"release",0)
Clear == /\ s.clears < MaxClears
         /\ Step([ClearState(s,s.current) EXCEPT !.clears = @ + 1],"clear",0)
Bind == /\ s.current < ControllerCount /\ Step(InstallState(s),"bind",0)
Tick == /\ s.time < MaxTime
        /\ Step([s EXCEPT !.time = @ + 1,
             !.ctrl = [c \in Controllers |-> [s.ctrl[c] EXCEPT !.credits = Cap2(@ + 1)]]],"tick",0)
CanSend == LET c == s.current
               cc == s.ctrl[c]
           IN ~s.mustBind /\ s.nextId <= MaxRequests /\ cc.vector # "none" /\ ~cc.blocked /\ cc.stopId = 0 /\
             Cardinality(Local(s,c)) < 2 /\ SessionAdmission(s) /\ cc.credits >= 1 /\ ~LocalExpired(s,c) /\
             (cc.sentIntent # cc.intent \/ s.time >= cc.nextAt \/ Fault = "ignore-cadence") /\
             (Fault # "old-serialization" \/ ~\E r \in Local(s,c) : s.req[r].generation = cc.generation /\ s.req[r].intent = cc.intent)
Send ==
  /\ CanSend
  /\ LET c == s.current
         cc == s.ctrl[c]
         id == s.nextId
         direction == IF Fault = "send-stale-intent" /\ cc.latest # 0 THEN s.req[cc.latest].vector ELSE cc.vector
         q == [kind |-> "move", status |-> "waiting", owner |-> c,
           generation |-> cc.generation, intent |-> cc.intent, vector |-> direction,
           at |-> s.time, deadline |-> s.time + 4, seq |-> id, local |-> TRUE,
           phase |-> "pending", result |-> "none", receipt |-> FALSE]
         ns == [s EXCEPT !.req[id] = q, !.nextId = @ + 1,
           !.ctrl[c].latest = id, !.ctrl[c].sentIntent = cc.intent,
           !.ctrl[c].nextAt = s.time + 1, !.ctrl[c].credits = @ - 1, !.ctrl[c].stopped = FALSE]
         changed == IF Fault = "reset-old-deadline" THEN [ns EXCEPT !.req = [r \in Requests |->
           IF r < id /\ ns.req[r].status = "waiting" THEN [ns.req[r] EXCEPT !.deadline = s.time + 4] ELSE ns.req[r]]]
           ELSE ns
     IN Step(changed,"send",id)
Response(r,outcome) ==
  /\ s.req[r].phase = "pending"
  /\ (s.req[r].status \notin {"accepted", "rejected"} \/ outcome = s.req[r].status \/ outcome = "unknown")
  /\ LET target == IF Fault = "wrong-receipt-id" /\ s.nextId > 2 THEN
                       IF r = 1 THEN 2 ELSE 1 ELSE r
         ns == ApplyOutcome(s,target,outcome)
     IN Step([ns EXCEPT !.req[r].phase = "returned"],"response",r)
Query(r,outcome) ==
  /\ s.req[r].status \in {"waiting", "unknown"} /\ outcome \in {"accepted", "rejected"}
  /\ Step(ApplyOutcome(s,r,outcome),"query",r)
Capture(r) ==
  /\ s.req[r].phase = "returned"
  /\ Step([s EXCEPT !.req[r].phase = "ready",
       !.req[r].result = IF s.req[r].status \in {"accepted", "rejected"} THEN s.req[r].status ELSE "unknown"],"capture",r)
Handle(r) ==
  /\ s.req[r].phase = "ready"
  /\ LET q == s.req[r]
         c == q.owner
         current == IF c = 0 THEN FALSE ELSE (q.generation = s.ctrl[c].generation \/ Fault = "ignore-generation")
         rejected == IF c = 0 THEN FALSE ELSE q.result = "rejected" /\
           (Fault = "halt-obsolete-reject" \/ (r = s.ctrl[c].latest /\ q.intent = s.ctrl[c].intent))
         ns == IF ~current THEN s
               ELSE IF q.kind = "move" /\ (q.result = "unknown" \/ rejected) THEN HaltState(s,c,TRUE)
               ELSE IF q.kind = "stop" /\ q.result # "accepted" THEN
                 UnknownWaiting([s EXCEPT !.ctrl[c].blocked = TRUE, !.ctrl[c].resume = FALSE, !.ctrl[c].vector = "none"])
               ELSE s
     IN Step([ns EXCEPT !.req[r].phase = "handled"],"handle",r)
Finally(r) ==
  /\ s.req[r].phase = "handled"
  /\ LET q == s.req[r]
         base == [s EXCEPT !.req[r].phase = "done", !.req[r].local = FALSE]
         ns == IF q.kind # "stop" \/ q.owner = 0 THEN base
               ELSE [base EXCEPT !.ctrl[q.owner].stopId = 0,
                 !.ctrl[q.owner].resume = IF q.generation = s.ctrl[q.owner].generation THEN FALSE ELSE @]
     IN Step(ns,"finally",r)
LedgerDeadline(r) == /\ s.req[r].status = "waiting" /\ s.time >= s.req[r].deadline
                     /\ Step(LedgerUnknown(s,r),"ledger-deadline",r)
LocalDeadline == /\ s.ctrl[s.current].vector # "none" /\ ~s.ctrl[s.current].blocked /\ s.ctrl[s.current].stopId = 0
                 /\ LocalExpired(s,s.current) /\ Step(HaltState(s,s.current,TRUE),"local-deadline",0)
StopDeadline(r) ==
  /\ s.req[r].kind = "stop" /\ s.req[r].owner # 0 /\ s.req[r].phase # "done"
  /\ s.time >= s.req[r].deadline /\ s.req[r].generation = s.ctrl[s.req[r].owner].generation
  /\ ~s.ctrl[s.req[r].owner].blocked
  /\ Step(UnknownWaiting([s EXCEPT !.ctrl[s.req[r].owner].blocked = TRUE,
       !.ctrl[s.req[r].owner].resume = FALSE, !.ctrl[s.req[r].owner].vector = "none"]),"stop-deadline",r)
Next == (\E d \in Directions : Input(d)) \/ Release \/ Clear \/ Bind \/ Tick \/ Send \/ LocalDeadline \/
  (\E r \in Requests : (\E o \in Results : Response(r,o)) \/
    (\E o \in {"accepted", "rejected"} : Query(r,o)) \/ Capture(r) \/ Handle(r) \/ Finally(r) \/ LedgerDeadline(r) \/ StopDeadline(r))
Spec == Init /\ [][Next]_vars

ControllerType == [generation : 0..CounterBound, intent : 0..CounterBound,
  vector : Directions \cup {"none"}, sentIntent : 0..CounterBound, latest : 0..MaxRequests,
  nextAt : 0..(MaxTime + 1), credits : 0..2, stopId : 0..MaxRequests,
  resume : BOOLEAN, stopped : BOOLEAN, blocked : BOOLEAN]
RequestType == [kind : {"unused", "move", "stop"}, status : Statuses,
  owner : 0..ControllerCount, generation : 0..CounterBound, intent : 0..CounterBound,
  vector : Directions \cup {"none"}, at : 0..MaxTime, deadline : 0..(MaxTime + 4),
  seq : 0..MaxRequests, local : BOOLEAN, phase : Phases, result : Results \cup {"none"}, receipt : BOOLEAN]
TypeOK == /\ s.time \in 0..MaxTime /\ s.current \in Controllers
          /\ s.ctrl \in [Controllers -> ControllerType] /\ s.req \in [Requests -> RequestType]
          /\ s.nextId \in 1..(MaxRequests + 1) /\ s.inputs \in 0..MaxInputs /\ s.clears \in 0..MaxClears
          /\ s.mustBind \in BOOLEAN /\ s.audit \subseteq {"stale-intent", "unknown-send", "stop-send", "expired-send",
               "stale-callback", "obsolete-reject", "wrong-receipt", "wrong-release", "lost-pending", "resurrection"}
          /\ s.seen \subseteq {"two-same", "full-latest", "latest-after-release", "cross-binding-full",
               "receipt-before-finally", "stop-with-two", "newer-accepted-older-unknown", "obsolete-reject-ignored", "old-finally"}
LocalMoveCapacity == \A c \in Controllers : Cardinality(Local(s,c)) <= 2
SessionMoveCapacity == Cardinality(UnresolvedMoves(s)) <= 2
SessionStopCapacity == Cardinality(UnresolvedStops(s)) <= 1
OriginalDeadline == \A r \in Requests : r < s.nextId => s.req[r].deadline = s.req[r].at + 4
OriginalIdentity == \A r \in Requests : r < s.nextId => s.req[r].kind # "unused" /\ s.req[r].seq = r
ReceiptOnlySettlement == \A r \in Requests : s.req[r].status \in {"accepted", "rejected"} => s.req[r].receipt
PerInstanceBudget == \A c \in Controllers : \A a,b \in 0..MaxTime : a <= b =>
  Cardinality({r \in Moves(s) : s.req[r].owner = c /\ a <= s.req[r].at /\ s.req[r].at <= b}) <= 2 + b - a
SameIntentCadence == \A a,b \in Moves(s) : a < b /\ s.req[a].owner = s.req[b].owner /\ s.req[a].intent = s.req[b].intent => s.req[b].at >= s.req[a].at + 1
StopSequenceCoverage == \A r \in Requests : s.req[r].kind = "stop" =>
  (\A m \in Moves(s) : m < r => s.req[m].seq < s.req[r].seq)
LatestIntentOnly == "stale-intent" \notin s.audit
UnknownFreezes == "unknown-send" \notin s.audit
PendingStopBlocks == "stop-send" \notin s.audit
LocalDeadlineFirst == "expired-send" \notin s.audit
OldCallbackIsolation == "stale-callback" \notin s.audit
ObsoleteRejectIgnored == "obsolete-reject" \notin s.audit
ReceiptIdentity == "wrong-receipt" \notin s.audit
CallbackOwnRelease == "wrong-release" \notin s.audit
ClearRetainsLocal == "lost-pending" \notin s.audit
NoCallbackResurrection == "resurrection" \notin s.audit
NeverTwoSame == "two-same" \notin s.seen
NeverLatestAfterRelease == "latest-after-release" \notin s.seen
NeverCrossBindingFull == "cross-binding-full" \notin s.seen
NeverReceiptBeforeFinally == "receipt-before-finally" \notin s.seen
NeverStopWithTwo == "stop-with-two" \notin s.seen
NeverNewerAcceptedOlderUnknown == "newer-accepted-older-unknown" \notin s.seen
NeverObsoleteRejectIgnored == "obsolete-reject-ignored" \notin s.seen
NeverOldFinally == "old-finally" \notin s.seen
================================================================================
