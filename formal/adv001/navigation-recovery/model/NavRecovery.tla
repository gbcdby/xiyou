---------------------------- MODULE NavRecovery ----------------------------
EXTENDS Naturals, Integers, FiniteSets, TLC

\* 一至两个点击计划。0 是旧控制周期留下的公开 movement，1/2 是原首段身份。
\* 几何、公开投影有序应用、Receipt 真伪和同 epoch 唯一输入源为继承前提。
CONSTANTS Fault, Adversarial, MaxQueues, OldSeq, ForceUnknown
VARIABLES historySeq, s, v, c, e
vars == <<historySeq, s, v, c, e>>
Ids == 1..MaxQueues
Moves == 0..MaxQueues
FirstSeq(i) == 2*i-1
MoveSeq(i) == IF i=0 THEN historySeq ELSE FirstSeq(i)
MapKey(i) == IF Fault \in {"old-sequence", "map-sequence"}
             THEN MoveSeq(i) ELSE 10+i
ClientKey(i) == IF Fault="old-sequence" THEN MoveSeq(i) ELSE 10+i
Public(t) == [high |-> t.high, active |-> t.active, motion |-> t.motion,
              rev |-> t.rev, valid |-> t.valid, paused |-> t.paused]

Init ==
  /\ historySeq \in (IF OldSeq=0 THEN {1,5} ELSE {OldSeq})
  /\ s = [done |-> [i \in Ids |-> "none"], high |-> 0,
          active |-> 0, motion |-> "arrived", rev |-> 0,
          valid |-> TRUE, paused |-> FALSE, pauseStage |-> 0, newer |-> FALSE,
          pulse |-> FALSE]
  /\ v = Public(s)
  /\ c = [created |-> 1, q |-> 1, bound |-> 0, drain |-> FALSE,
          known |-> [i \in Ids |-> "pending"],
          received |-> [i \in Ids |-> 0], unknown |-> {}, recovered |-> {},
          mapKey |-> 0, display |-> 0, emitted |-> {},
          visualMsgs |-> [i \in Moves |-> 0]]
  /\ e = [cancelled |-> {}, sent |-> [i \in Ids |-> 0], goodVisual |-> {},
          badSend |-> FALSE, earlyUnknown |-> FALSE,
          completedEarly |-> FALSE, lateCancelled |-> FALSE]

\* 服务端产生确定原结果；ID、命令号和结果持久且不因查询/原样重试改变。
CommitAccepted(i) ==
  /\ i<=c.created /\ s.done[i]="none" /\ s.valid /\ FirstSeq(i)>s.high
  /\ s' = [s EXCEPT !.done[i]="Accepted", !.high=FirstSeq(i),
            !.active=i, !.motion="moving", !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
CommitRejected(i) ==
  /\ i<=c.created /\ s.done[i]="none"
  /\ (Adversarial \/ ~s.valid \/ FirstSeq(i)<=s.high)
  /\ s' = [s EXCEPT !.done[i]="Rejected",
            !.high=IF FirstSeq(i)>@ THEN FirstSeq(i) ELSE @, !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
Commit(i) == CommitAccepted(i) \/ CommitRejected(i)
Arrive ==
  /\ s.active \in Ids /\ s.motion="moving"
  /\ s' = [s EXCEPT !.motion="arrived", !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
Block ==
  /\ Adversarial /\ s.active \in Ids /\ s.motion="moving"
  /\ s' = [s EXCEPT !.motion="blocked", !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
AdvanceHighWater ==
  /\ Adversarial /\ ~s.newer
  /\ s' = [s EXCEPT !.high=2*MaxQueues+1, !.newer=TRUE, !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
Invalidate ==
  /\ Adversarial /\ s.valid
  /\ s' = [s EXCEPT !.valid=FALSE, !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
Pause ==
  /\ s.pauseStage=0
  /\ s' = [s EXCEPT !.pauseStage=1, !.paused=TRUE, !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
Resume ==
  /\ s.pauseStage=1
  /\ s' = [s EXCEPT !.pauseStage=2, !.paused=FALSE, !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>
OrdinaryPulse ==
  /\ ~s.pulse
  /\ s'=[s EXCEPT !.pulse=TRUE, !.rev=@+1]
  /\ UNCHANGED <<historySeq,v,c,e>>

\* 只接纳新水位快照；旧/重复批次不使公开视图回退，此处是 SpatialView 前提。
Snapshot ==
  /\ s.rev>v.rev
  /\ v'=Public(s)
  /\ c'=[c EXCEPT !.drain=TRUE]
  /\ UNCHANGED <<historySeq,s,e>>
Unknown(i) ==
  /\ i<=c.created /\ c.known[i]="pending" /\ i \notin c.unknown
  /\ c'=[c EXCEPT !.known[i]="unknown", !.unknown=@ \cup {i}]
  /\ UNCHANGED <<historySeq,s,v,e>>
RecoverOriginal(i) ==
  /\ c.known[i]="unknown" /\ i \notin c.recovered
  /\ c'=[c EXCEPT !.recovered=@ \cup {i}]
  /\ UNCHANGED <<historySeq,s,v,e>>
Receipt(i) ==
  /\ s.done[i]#"none" /\ c.received[i]<2
  /\ (~ForceUnknown \/ i \in c.recovered)
  /\ (c.known[i]#"unknown" \/ i \in c.recovered)
  /\ LET matching == c.q=i
         revive == Fault="revive-cancelled" /\ c.q=0 /\
                   i \in e.cancelled /\ s.done[i]="Accepted"
     IN c'=[c EXCEPT !.known[i]=s.done[i], !.received[i]=@+1, !.drain=TRUE,
            !.q=IF matching /\ s.done[i]="Rejected" THEN 0
                 ELSE IF revive THEN i ELSE @,
            !.bound=IF (matching \/ revive) /\ s.done[i]="Accepted" THEN i
                     ELSE IF matching /\ s.done[i]="Rejected" THEN 0 ELSE @]
  /\ e'=[e EXCEPT !.lateCancelled=@ \/ (i \in e.cancelled)]
  /\ UNCHANGED <<historySeq,s,v>>

\* 显示端按公开当前 arrived 计划及实际显示结束发事件。
\* 重复副本最多两份；Map 的真实 ID 去重与客户端缓存分别建模。
Draw ==
  /\ v.motion="arrived" /\ v.active \notin c.emitted
  /\ c.mapKey # MapKey(v.active)
  /\ \E copies \in 1..2:
       c'=[c EXCEPT !.mapKey=MapKey(v.active), !.emitted=@ \cup {v.active},
                    !.visualMsgs[v.active]=copies]
  /\ UNCHANGED <<historySeq,s,v,e>>
Visual(i) ==
  /\ c.visualMsgs[i]>0
  /\ LET matches == v.motion="arrived" /\
                    (IF Fault="old-sequence"
                     THEN MoveSeq(i)=MoveSeq(v.active) ELSE i=v.active)
         store == matches /\
                  (IF Fault="drop-early-visual"
                   THEN IF v.active \in Ids THEN c.known[v.active]="Accepted" ELSE FALSE
                   ELSE TRUE)
     IN c'=[c EXCEPT !.visualMsgs[i]=@-1,
                      !.display=IF store THEN ClientKey(i) ELSE @,
                      !.drain=IF store THEN TRUE ELSE @]
  /\ e'=[e EXCEPT
          !.goodVisual=IF i=v.active /\ v.motion="arrived" THEN @ \cup {i} ELSE @,
          !.earlyUnknown=@ \/ (i=1 /\ v.active=1 /\ v.motion="arrived" /\
                               c.known[1]="unknown")]
  /\ UNCHANGED <<historySeq,s,v>>

\* 同步队列步骤抽象为独立动作，允许更多取消/通知交错；活性要求它被调度。
CancelNeeded ==
  /\ c.q \in Ids
  /\ (~v.valid \/
      IF Fault="old-sequence"
      THEN MoveSeq(v.active)>FirstSeq(c.q) \/
           (MoveSeq(v.active)=FirstSeq(c.q) /\ v.motion="blocked")
      ELSE v.high>FirstSeq(c.q) \/
           (v.high=FirstSeq(c.q) /\ c.bound=c.q /\ v.active=c.q /\
             (MoveSeq(v.active)#FirstSeq(c.q) \/ v.motion="blocked")))
Ready ==
  /\ c.q \in Ids /\ v.valid /\ ~v.paused /\ v.motion="arrived"
  /\ IF Fault="old-sequence"
     THEN MoveSeq(v.active)=FirstSeq(c.q) /\ c.display=ClientKey(v.active)
     ELSE v.high=FirstSeq(c.q) /\ c.bound=c.q /\ v.active=c.q /\
          c.display=ClientKey(v.active)
IndependentGate(i) ==
  /\ c.known[i]="Accepted" /\ s.done[i]="Accepted"
  /\ v.high=FirstSeq(i) /\ v.active=i /\ v.motion="arrived"
  /\ i \in e.goodVisual /\ v.valid /\ ~v.paused /\ i \notin e.cancelled
DrainCancel ==
  /\ c.drain /\ CancelNeeded
  /\ c'=[c EXCEPT !.q=0, !.bound=0, !.drain=FALSE]
  /\ e'=[e EXCEPT !.cancelled=@ \cup {c.q}]
  /\ UNCHANGED <<historySeq,s,v>>
DrainSend ==
  /\ c.drain /\ ~CancelNeeded /\ Ready /\ e.sent[c.q]<2
  /\ c'=[c EXCEPT !.q=IF Fault="keep-after-send" THEN @ ELSE 0,
                  !.bound=IF Fault="keep-after-send" THEN @ ELSE 0, !.drain=FALSE]
  /\ e'=[e EXCEPT !.sent[c.q]=@+1,
          !.badSend=@ \/ ~IndependentGate(c.q),
          !.completedEarly=@ \/ (c.q=1 /\ e.earlyUnknown /\ 1 \in c.recovered)]
  /\ UNCHANGED <<historySeq,s,v>>
DrainWait ==
  /\ c.drain /\ ~CancelNeeded /\ ~Ready
  /\ c'=[c EXCEPT !.drain=FALSE]
  /\ UNCHANGED <<historySeq,s,v,e>>
Drain == DrainCancel \/ DrainSend \/ DrainWait
CancelLocal ==
  /\ Adversarial /\ c.q \in Ids
  /\ c'=[c EXCEPT !.q=0, !.bound=0, !.drain=FALSE]
  /\ e'=[e EXCEPT !.cancelled=@ \cup {c.q}]
  /\ UNCHANGED <<historySeq,s,v>>
Replace ==
  /\ Adversarial /\ c.created<MaxQueues /\ v.valid
  /\ c'=[c EXCEPT !.created=@+1, !.q=c.created+1, !.bound=0, !.drain=FALSE]
  /\ e'=[e EXCEPT !.cancelled=IF c.q \in Ids THEN @ \cup {c.q} ELSE @]
  /\ UNCHANGED <<historySeq,s,v>>
Idle ==
  /\ \A i \in 1..c.created: c.known[i] \in {"Accepted","Rejected"}
  /\ s.motion#"moving"
  /\ \A i \in Moves: c.visualMsgs[i]=0
  /\ UNCHANGED vars

Next == (\E i \in Ids: Commit(i) \/ Unknown(i) \/ RecoverOriginal(i) \/ Receipt(i))
        \/ (\E i \in Moves: Visual(i))
        \/ Arrive \/ Block \/ AdvanceHighWater \/ Invalidate \/ Pause \/ Resume
        \/ OrdinaryPulse
        \/ Snapshot \/ Draw \/ Drain \/ CancelLocal \/ Replace \/ Idle
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(Arrive) /\ WF_vars(Resume) /\ WF_vars(Snapshot)
            /\ WF_vars(Draw) /\ WF_vars(Drain)
            /\ (\A i \in Ids: WF_vars(Commit(i)) /\ WF_vars(Unknown(i)) /\
                 WF_vars(RecoverOriginal(i)) /\ WF_vars(Receipt(i)))
            /\ (\A i \in Moves: WF_vars(Visual(i)))

TypeOK ==
  /\ historySeq \in {1,5} /\ MaxQueues \in {1,2}
  /\ s.done \in [Ids -> {"none","Accepted","Rejected"}]
  /\ s.high \in 0..(2*MaxQueues+1) /\ s.active \in Moves
  /\ s.motion \in {"arrived","moving","blocked"} /\ s.rev \in 0..12
  /\ s.valid \in BOOLEAN /\ s.paused \in BOOLEAN /\ s.pauseStage \in 0..2
  /\ s.newer \in BOOLEAN /\ s.pulse \in BOOLEAN
  /\ v.high \in 0..(2*MaxQueues+1) /\ v.active \in Moves
  /\ v.motion \in {"arrived","moving","blocked"} /\ v.rev \in 0..12
  /\ v.valid \in BOOLEAN /\ v.paused \in BOOLEAN
  /\ c.created \in Ids /\ c.q \in Moves /\ c.bound \in Moves
  /\ c.drain \in BOOLEAN
  /\ c.known \in [Ids -> {"pending","unknown","Accepted","Rejected"}]
  /\ c.received \in [Ids -> 0..2] /\ c.unknown \subseteq Ids
  /\ c.recovered \subseteq Ids /\ c.emitted \subseteq Moves
  /\ c.mapKey \in 0..12 /\ c.display \in 0..12
  /\ c.visualMsgs \in [Moves -> 0..2]
  /\ e.cancelled \subseteq Ids /\ e.sent \in [Ids -> 0..2]
  /\ e.goodVisual \subseteq Moves /\ e.badSend \in BOOLEAN
  /\ e.earlyUnknown \in BOOLEAN /\ e.completedEarly \in BOOLEAN
  /\ e.lateCancelled \in BOOLEAN
NoPrematureCrossing == ~e.badSend
AtMostOneContinuation == \A i \in Ids: e.sent[i]<=1
NoCancelledRevival == c.q=0 \/ c.q \notin e.cancelled
ReceiptBound == c.bound=0 \/ c.known[c.bound]="Accepted"
ContinuationProgress == <> (e.sent[1]=1)
NoEarlyUnknownWitness == ~e.completedEarly
=============================================================================
