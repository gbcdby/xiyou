------------------------------ MODULE Core ------------------------------
EXTENDS Naturals, Integers, Sequences, FiniteSets

(* 新的有限核心模型；不是旧 31766d6c 候选的恢复副本。
   d 保存权威持久状态；v 保存请求管线、客户端所知结果及外部探针观察。
   Profile 选择范围，Pattern 选择有限请求集；Fault 只供隔离负对照。 *)
CONSTANTS Profile, Pattern, Scenario, Fault, Probe
VARIABLES d, v
vars == <<d, v>>
Keys == {1, 2}
Items == IF Profile = "ownership" THEN {1, 2} ELSE {1}
Actors == {1, 2}
ControlEnabled == Profile # "ownership"
ActiveKeys == IF Scenario \in {"receipt", "payload", "control",
                   "ai-epoch", "ai-generation", "ai-revision", "ai-unrelated",
                   "ai-cancel", "ai-invalid", "ai-package", "ai-expiry", "ai-terminal"}
              THEN {1} ELSE Keys
RetryEnabled == Scenario \in {"receipt", "payload", "combined"}
FailureEnabled == Scenario \in {"receipt", "combined"}
AIEnabled == ControlEnabled /\ Scenario # "control"
(* 一 tick = 10 秒；跳过守卫真值不变的空闲区间，保留 30/10/1200 秒期限。 *)
Deadline == 120
GraceTicks == 3
DecisionTicks == 1
TimeCuts == {Deadline - DecisionTicks, Deadline}
            \cup (IF ControlEnabled THEN {Deadline - GraceTicks} ELSE {})
            \cup (IF d.mode = "Grace" THEN {d.graceDeadline} ELSE {})
            \cup (IF d.aiStatus = "Pending" THEN {d.aiDeadline} ELSE {})
LaterCuts == {t \in TimeCuts : t > d.now /\ t <= Deadline}
NextTime == CHOOSE t \in LaterCuts : \A other \in LaterCuts : t <= other
EmptyReceipt == [status |-> "None", payload |-> 0, first |-> 0, last |-> 0]
Settled == {"Committed", "Rejected", "Expired", "Cancelled"}
Stages == {"Idle", "Received", "Validated", "EffectOnly", "Reply", "Done"}
Open == d.phase = "Running" /\ d.now < Deadline
Due == d.phase = "Running" /\ d.now = Deadline
Kind(k) == CASE Pattern = "competition" -> "take"
                [] Pattern = "ending" /\ k = 2 -> "finish"
                [] OTHER -> "claim"
Base(k) == IF Pattern = "future" /\ k = 1 THEN 1 ELSE 0
Count(seq, key) == Cardinality({i \in 1..Len(seq) : seq[i].key = key})
HumanEpoch(k) == IF k = 1 /\ ControlEnabled THEN d.epoch ELSE 0
HumanConnection(k) == IF k = 1 /\ ControlEnabled THEN d.connection ELSE k
HumanMode(k) == IF k = 1 /\ ControlEnabled THEN d.mode ELSE "Human"
HumanFresh(k) == HumanMode(k) = "Human" /\ HumanEpoch(k) = 0
                   /\ HumanConnection(k) = k
OwnFresh(k) == Kind(k) # "take"
                \/ (d.revision[d.item[k]] = 0 /\ d.owner[d.item[k]] = 0)
FreshAI == d.aiStatus = "Pending" /\ d.phase = "Running"
           /\ d.now < Deadline /\ d.now < d.aiDeadline
           /\ d.mode = "Proxy" /\ d.aiEpoch = d.epoch
           /\ d.aiGeneration = d.generation
           /\ d.aiRevision = d.revision[1]
AIAllowed ==
 /\ (d.aiStatus = "Pending" \/ Fault = "decision_status")
 /\ (d.phase = "Running" \/ Fault = "ai_terminal")
 /\ (d.now < Deadline \/ Fault = "ai_terminal")
 /\ (d.now < d.aiDeadline \/ Fault = "decision_deadline")
 /\ (d.mode = "Proxy" \/ Fault = "old_proxy")
 /\ (d.aiEpoch = d.epoch \/ Fault \in {"decision_epoch", "old_proxy"})
 /\ (d.aiGeneration = d.generation \/ Fault = "decision_generation")
 /\ (d.aiRevision = d.revision[1] \/ Fault = "decision_revision")

Tag(name) == v.witness \/ Probe = name
Progress(name) ==
 IF Probe = "effect-crash-handoff-retry" THEN
   CASE v.progress = 0 /\ name = "effect-one" -> 1
     [] v.progress = 1 /\ name = "item-conflict-two" -> 2
     [] v.progress = 2 /\ name = "ack-lost" -> 3
     [] v.progress = 3 /\ name = "crash-after-effect" -> 4
     [] v.progress = 4 /\ name = "proxy" -> 5
     [] v.progress = 5 /\ name = "decision-pending" -> 6
     [] v.progress = 6 /\ name = "returned" -> 7
     [] v.progress = 7 /\ name = "same-receipt" -> 8
     [] v.progress = 8 /\ name = "epoch-late-ai" -> 9
     [] OTHER -> v.progress
 ELSE IF Probe = "effect-crash-retry-negative" THEN
   CASE v.progress = 0 /\ name = "effect-one" -> 1
     [] v.progress = 1 /\ name = "crash-after-effect" -> 2
     [] v.progress = 2 /\ name = "effect-two" -> 3
     [] OTHER -> v.progress
 ELSE IF Probe = "partial-bundle-crash" THEN
   CASE v.progress = 0 /\ name = "effect-one" -> 1
     [] v.progress = 1 /\ name = "crash-after-effect" -> 2
     [] OTHER -> v.progress
 ELSE IF Probe = "early-ack-crash" THEN
   CASE v.progress = 0 /\ name = "early-ack" -> 1
     [] v.progress = 1 /\ name = "crash-before-effect" -> 2
     [] OTHER -> v.progress
 ELSE v.progress

Init ==
 \E assignment \in (IF Pattern = "competition" THEN [Keys -> Items]
                     ELSE {[k \in Keys |-> 1]}) :
 /\ d = [phase |-> "Running", now |-> 0, item |-> assignment,
          owner |-> [i \in Items |-> 0], holders |-> [i \in Items |-> {0}],
          revision |-> [i \in Items |-> 0],
          effects |-> [k \in Keys |-> 0], commits |-> <<>>,
          receipts |-> [k \in Keys |-> EmptyReceipt],
          boundPayload |-> [k \in Keys |-> -1],
          events |-> <<>>, outbox |-> <<>>, head |-> 0,
          terminalSeq |-> 0, terminalAction |-> 0,
          mode |-> "Human", epoch |-> 0, connection |-> 1,
          handoffStep |-> 0, graceDeadline |-> 0, controls |-> <<>>,
          nonceWrites |-> 0, nonceEpoch |-> 0,
          generation |-> 0, aiStatus |-> "Idle", aiSealed |-> "None",
          aiEpoch |-> 0, aiGeneration |-> 0, aiRevision |-> 0,
          aiDeadline |-> 0, aiBadPackage |-> FALSE,
          aiEffects |-> 0, aiReceipt |-> "None", aiCommit |-> <<>>]
 /\ v = [up |-> TRUE, crashed |-> FALSE, stable |-> FALSE, lost |-> FALSE,
          stage |-> [k \in Keys |-> "Idle"],
          payload |-> [k \in Keys |-> 0], response |-> [k \in Keys |-> "None"],
          changed |-> [k \in Keys |-> FALSE], retried |-> [k \in Keys |-> FALSE], resolved |-> {},
          acceptedAcks |-> {}, published |-> {}, callbackSeen |-> FALSE,
          heldSeen |-> FALSE, oldDisconnectSeen |-> FALSE, nonceRetried |-> FALSE,
          unrelated |-> FALSE, revised |-> FALSE, epochRevoked |-> FALSE,
          witness |-> FALSE, progress |-> 0]

NewEvents(kind, key, n) ==
 [j \in 1..n |->
   [seq |-> IF Fault = "sequence_gap" THEN d.head + j + 1
            ELSE IF Fault = "sequence_repeat" /\ d.head > 0
                 THEN d.head ELSE d.head + j,
    kind |-> IF kind = "finish" /\ j = n /\ n = 2 THEN "finished" ELSE kind,
    key |-> key, at |-> d.now]]
AppendEvents(db, kind, key, n) ==
 LET ev == NewEvents(kind, key, n)
 IN [db EXCEPT !.events = @ \o ev,
                !.outbox = @ \o ev,
                !.head = IF Fault = "sequence_gap" THEN d.head + n + 1
                         ELSE IF Fault = "sequence_repeat" /\ d.head > 0
                              THEN d.head ELSE d.head + n]
End(db, phase) ==
 LET result == AppendEvents(db, IF Due THEN "deadline" ELSE "aborted", 0, 1)
 IN [result EXCEPT !.phase = phase, !.terminalSeq = Len(result.events)]
WriteReceipt(db, k, result, first, last) ==
 [db EXCEPT !.receipts[k] = [status |-> result, payload |-> v.payload[k],
                            first |-> first, last |-> last],
            !.boundPayload[k] = IF @ = -1 THEN v.payload[k] ELSE @]
HumanRecord(k) ==
 [key |-> k, kind |-> Kind(k), item |-> d.item[k], base |-> 0,
  destination |-> k, payload |-> v.payload[k], baseSeq |-> Base(k),
  headBefore |-> d.head, revisionBefore |-> d.revision[d.item[k]],
  ownerBefore |-> d.owner[d.item[k]], epoch |-> HumanEpoch(k),
  connection |-> HumanConnection(k), mode |-> HumanMode(k),
  at |-> d.now, phase |-> d.phase]
CommitEffect(k) ==
 LET base == [d EXCEPT !.effects[k] = @ + 1,
                        !.commits = Append(@, HumanRecord(k)),
                        !.owner[d.item[k]] = IF Kind(k) = "take" THEN k ELSE @,
                        !.holders[d.item[k]] = IF Kind(k) # "take" THEN @
                           ELSE IF Fault = "duplicate_owner" THEN @ \cup {k}
                           ELSE {k},
                        !.revision[d.item[k]] = IF Kind(k) = "take" THEN @ + 1 ELSE @]
     amount == IF Kind(k) = "finish" /\ Fault # "split_terminal" THEN 2 ELSE 1
     changed == IF Fault = "split_bundle" THEN base
                ELSE AppendEvents(base, Kind(k), k, amount)
     ended == IF Kind(k) = "finish"
              THEN [changed EXCEPT !.phase = "Finished",
                    !.terminalSeq = Len(changed.events), !.terminalAction = k]
              ELSE changed
 IN IF Fault = "split_receipt" THEN ended
    ELSE WriteReceipt(ended, k, "Accepted", d.head + 1, d.head + amount)

Receive(k) ==
 /\ k \in ActiveKeys /\ v.up /\ v.stage[k] = "Idle"
 /\ (Fault # "no_retry" \/ ~v.crashed)
 /\ v' = [v EXCEPT !.stage[k] = "Received"]
 /\ UNCHANGED d
Validate(k) ==
 /\ v.up /\ v.stage[k] = "Received"
 /\ v' = [v EXCEPT !.stage[k] = "Validated",
                   !.progress = IF Fault = "early_ack" THEN Progress("early-ack") ELSE @,
                   !.acceptedAcks = IF Fault = "early_ack" THEN @ \cup {k} ELSE @]
 /\ UNCHANGED d
Commit(k) ==
 /\ v.up /\ v.stage[k] = "Validated"
 /\ IF d.receipts[k].status # "None" THEN
      /\ d' = IF d.receipts[k].payload # v.payload[k] /\ Fault = "payload_overwrite"
              THEN [d EXCEPT !.receipts[k].payload = v.payload[k]] ELSE d
      /\ v' = [v EXCEPT !.stage[k] = "Reply",
                !.response[k] = IF d.receipts[k].payload = v.payload[k]
                                  \/ Fault = "payload_overwrite"
                                THEN d.receipts[k].status ELSE "Conflict",
                !.witness = Tag(IF d.receipts[k].payload = v.payload[k]
                                  THEN "same-receipt" ELSE "payload-conflict"),
                !.progress = IF k = 1 /\ v.payload[k] = 0
                             THEN Progress("same-receipt") ELSE @]
    ELSE IF Due THEN
      /\ d' = WriteReceipt(End(d, "Finished"), k, "Rejected", 0, 0)
      /\ v' = [v EXCEPT !.stage[k] = "Reply", !.response[k] = "Rejected",
                         !.witness = Tag("deadline-reject")]
    ELSE IF (Open \/ Fault = "post_terminal")
            /\ (HumanFresh(k) \/ Fault = "old_human")
            /\ (OwnFresh(k) \/ Fault = "stale_item")
            /\ (Base(k) <= d.head \/ Fault = "future_base")
            /\ d.effects[k] < 2 THEN
      /\ d' = CommitEffect(k)
      /\ v' = [v EXCEPT !.stage[k] = IF Fault = "split_receipt" THEN "EffectOnly" ELSE "Reply",
                !.response[k] = "Accepted",
                !.witness = Tag(IF Kind(k) = "finish" THEN "manual-ending"
                                ELSE IF Kind(k) = "take" THEN "take-success"
                                ELSE "claim-success"),
                !.progress = IF k = 1 THEN Progress(IF d.effects[k] = 0
                                                    THEN "effect-one" ELSE "effect-two")
                             ELSE @]
    ELSE
      /\ d' = WriteReceipt(d, k, "Rejected", 0, 0)
      /\ v' = [v EXCEPT !.stage[k] = "Reply", !.response[k] = "Rejected",
                 !.progress = IF k = 2 /\ Open /\ HumanFresh(k) /\ ~OwnFresh(k)
                              THEN Progress("item-conflict-two") ELSE @,
                 !.witness = Tag(IF ~Open THEN "terminal-reject"
                                  ELSE IF ~HumanFresh(k) THEN "control-reject"
                                  ELSE IF ~OwnFresh(k) THEN "item-conflict"
                                  ELSE "future-reject")]
FlushReceipt(k) ==
 /\ v.up /\ v.stage[k] = "EffectOnly"
 /\ d' = WriteReceipt(d, k, "Accepted", d.head, d.head)
 /\ v' = [v EXCEPT !.stage[k] = "Reply"]
Reply(k) ==
 /\ v.up /\ v.stage[k] = "Reply"
 /\ v' = [v EXCEPT !.stage[k] = "Done", !.resolved = @ \cup {k},
          !.response[k] = "None",
          !.acceptedAcks = IF v.response[k] = "Accepted" THEN @ \cup {k} ELSE @,
          !.witness = Tag("reply-delivered")]
 /\ UNCHANGED d
DropAck(k) ==
 /\ FailureEnabled /\ k = 1
 /\ v.up /\ ~v.stable /\ ~v.lost /\ v.stage[k] = "Reply"
 /\ v' = [v EXCEPT !.lost = TRUE, !.stage[k] = "Idle",
          !.progress = IF k = 1 /\ d.effects[k] > 0 THEN Progress("ack-lost") ELSE @,
          !.witness = Tag("ack-lost")]
 /\ UNCHANGED d
ChangePayload(k) ==
 /\ Scenario = "payload" /\ v.up /\ k \in v.resolved
 /\ ~v.changed[k] /\ v.stage[k] = "Done"
 /\ v' = [v EXCEPT !.payload[k] = 1, !.changed[k] = TRUE, !.stage[k] = "Idle"]
 /\ UNCHANGED d
Retry(k) ==
 /\ RetryEnabled /\ v.up /\ k \in ActiveKeys /\ v.stage[k] = "Done"
 /\ ~v.retried[k]
 /\ v' = [v EXCEPT !.stage[k] = "Idle", !.retried[k] = TRUE]
 /\ UNCHANGED d
Crash ==
 /\ FailureEnabled /\ v.up /\ ~v.stable /\ ~v.crashed
 /\ v' = [v EXCEPT !.up = FALSE, !.crashed = TRUE,
          !.stage = [k \in Keys |-> IF v.stage[k] = "Done" THEN "Done" ELSE "Idle"],
          !.response = [k \in Keys |-> "None"],
          !.progress = IF d.effects[1] > 0 THEN Progress("crash-after-effect")
                        ELSE Progress("crash-before-effect"),
          !.witness = Tag(IF d.effects[1] + d.effects[2] = 0
                          THEN "crash-before-commit" ELSE "crash-after-commit")]
 /\ UNCHANGED d
Recover ==
 /\ ~v.up
 /\ v' = [v EXCEPT !.up = TRUE, !.witness = Tag("recovered")]
 /\ UNCHANGED d
Stabilize == /\ ~v.stable /\ v' = [v EXCEPT !.stable = TRUE] /\ UNCHANGED d
Publish ==
 /\ Scenario = "publication" /\ v.up /\ \E i \in (1..Len(d.outbox)) \ v.published :
      /\ v' = [v EXCEPT !.published = @ \cup {i}, !.witness = Tag("published")]
      /\ UNCHANGED d

ControlRecord(kind, suppliedEpoch, suppliedConnection) ==
 [kind |-> kind, suppliedEpoch |-> suppliedEpoch, suppliedConnection |-> suppliedConnection,
  priorEpoch |-> d.epoch, priorConnection |-> d.connection,
  priorMode |-> d.mode, at |-> d.now, priorPhase |-> d.phase]
Disconnect ==
 /\ ControlEnabled /\ v.up /\ d.handoffStep = 0
 /\ (Open \/ (Fault = "deadline_control" /\ Due))
 /\ LET changed == [d EXCEPT !.mode = "Grace", !.epoch = @ + 1, !.connection = 0,
                     !.graceDeadline = d.now + GraceTicks, !.handoffStep = 1,
                     !.controls = Append(@, ControlRecord("disconnect", d.epoch, d.connection))]
    IN d' = AppendEvents(changed, "control", 0, 1)
 /\ v' = [v EXCEPT !.witness = Tag("grace")]
Proxy ==
 /\ ControlEnabled /\ v.up /\ Open /\ d.handoffStep = 1
 /\ d.now >= d.graceDeadline
 /\ LET changed == [d EXCEPT !.mode = "Proxy", !.epoch = @ + 1,
                     !.handoffStep = 2,
                     !.controls = Append(@, ControlRecord("proxy", d.epoch, 0))]
    IN d' = AppendEvents(changed, "control", 0, 1)
 /\ v' = [v EXCEPT !.witness = Tag("proxy"), !.progress = Progress("proxy")]
ReturnHuman ==
 /\ ControlEnabled /\ Scenario \in {"control", "combined", "ai-epoch"}
 /\ v.up /\ Open /\ d.handoffStep \in {1,2}
 /\ LET changed == [d EXCEPT !.mode = "Human", !.epoch = @ + 1, !.connection = 3,
                     !.handoffStep = 3, !.nonceWrites = 1, !.nonceEpoch = d.epoch + 1,
                     !.controls = Append(@, ControlRecord("return", d.epoch, 3))]
    IN d' = AppendEvents(changed, "control", 0, 1)
 /\ v' = [v EXCEPT !.witness = Tag("returned"), !.progress = Progress("returned")]
Take ==
 /\ ControlEnabled /\ Scenario = "control" /\ v.up /\ Open /\ d.handoffStep = 0
 /\ LET changed == [d EXCEPT !.mode = "Human", !.epoch = @ + 1, !.connection = 3,
                     !.handoffStep = 3, !.nonceWrites = 1, !.nonceEpoch = d.epoch + 1,
                     !.controls = Append(@, ControlRecord("take", d.epoch, 3))]
    IN d' = AppendEvents(changed, "control", 0, 1)
 /\ v' = [v EXCEPT !.witness = Tag("explicit-take")]
ResumeHeld ==
 /\ ControlEnabled /\ Scenario = "control" /\ v.up /\ Open /\ d.handoffStep = 0 /\ ~v.heldSeen
 /\ v' = [v EXCEPT !.heldSeen = TRUE, !.witness = Tag("resume-held")]
 /\ UNCHANGED d
RetryControl ==
 /\ ControlEnabled /\ Scenario = "control" /\ v.up /\ d.nonceWrites > 0 /\ ~v.nonceRetried
 /\ d' = IF Fault = "control_nonce" /\ Open
         THEN [d EXCEPT !.nonceWrites = @ + 1, !.epoch = @ + 1] ELSE d
 /\ v' = [v EXCEPT !.nonceRetried = TRUE, !.witness = Tag("control-nonce-retry")]
StaleDisconnect ==
 /\ ControlEnabled /\ Scenario = "control" /\ v.up /\ Open /\ d.handoffStep = 3 /\ ~v.oldDisconnectSeen
 /\ LET changed == [d EXCEPT !.mode = "Grace", !.connection = 0,
                     !.epoch = @ + 1,
                     !.controls = Append(@, ControlRecord("disconnect", 0, 1))]
    IN d' = IF Fault = "stale_disconnect" THEN AppendEvents(changed, "control", 0, 1) ELSE d
 /\ v' = [v EXCEPT !.oldDisconnectSeen = TRUE, !.witness = Tag("old-disconnect-rejected")]

PrepareAI(bad) ==
 /\ AIEnabled /\ (Scenario = "ai-package" \/ ~bad)
 /\ v.up /\ Open /\ d.mode = "Proxy" /\ d.aiStatus = "Idle"
 /\ d' = [d EXCEPT !.aiStatus = "Pending", !.aiEpoch = d.epoch,
          !.aiGeneration = d.generation, !.aiRevision = d.revision[1],
          !.aiDeadline = d.now + DecisionTicks, !.aiBadPackage = bad]
 /\ v' = [v EXCEPT !.witness = Tag("decision-pending"),
                    !.progress = Progress("decision-pending")]
(* 权威 epoch 单独失效是保守抽象：允许待处理行尚未清理，但提交资格已改变。
   它不新增公共控制命令，也不宣称业务一定可达这种中间持久形态。 *)
RevokeEpoch ==
 /\ Scenario = "ai-epoch" /\ v.up /\ Open /\ d.aiStatus = "Pending" /\ ~v.epochRevoked
 /\ d' = [d EXCEPT !.epoch = @ + 1]
 /\ v' = [v EXCEPT !.epochRevoked = TRUE]
NewGeneration ==
 /\ Scenario = "ai-generation" /\ v.up /\ Open /\ d.aiStatus = "Pending" /\ d.generation = 0
 /\ d' = [d EXCEPT !.generation = 1]
 /\ UNCHANGED v
ReviseRelated ==
 /\ Scenario = "ai-revision" /\ v.up /\ Open /\ d.aiStatus = "Pending" /\ ~v.revised
 /\ d' = AppendEvents([d EXCEPT !.revision[1] = @ + 1], "related", 0, 1)
 /\ v' = [v EXCEPT !.revised = TRUE]
Unrelated ==
 /\ Scenario \in {"future", "ai-unrelated"} /\ v.up /\ Open /\ ~v.unrelated
 /\ d' = AppendEvents(d, "unrelated", 0, 1)
 /\ v' = [v EXCEPT !.unrelated = TRUE]
CancelAI ==
 /\ Scenario = "ai-cancel" /\ v.up /\ d.aiStatus = "Pending"
 /\ d' = [d EXCEPT !.aiStatus = "Cancelled", !.aiSealed = "Cancelled", !.aiReceipt = "Cancelled"]
 /\ v' = [v EXCEPT !.witness = Tag("decision-cancelled")]
AIRecord ==
 [key |-> 3, mode |-> d.mode, capturedEpoch |-> d.aiEpoch, epoch |-> d.epoch,
  capturedGeneration |-> d.aiGeneration, generation |-> d.generation,
  capturedRevision |-> d.aiRevision, revision |-> d.revision[1],
  at |-> d.now, deadline |-> d.aiDeadline, phase |-> d.phase,
  status |-> d.aiStatus, badPackage |-> d.aiBadPackage]
CallbackAI ==
 /\ ControlEnabled /\ v.up /\ d.aiStatus # "Idle" /\ ~v.callbackSeen
 /\ IF AIAllowed /\ (~d.aiBadPackage \/ Fault = "partial_ai") THEN
      /\ d' = AppendEvents([d EXCEPT !.aiEffects = @ + 1,
                     !.aiCommit = Append(@, AIRecord),
                     !.aiStatus = "Committed",
                     !.aiSealed = IF @ = "None" THEN "Committed" ELSE @,
                     !.aiReceipt = "Committed"], "ai", 3, 1)
      /\ v' = [v EXCEPT !.callbackSeen = TRUE,
                 !.witness = Tag(IF v.unrelated THEN "ai-after-unrelated" ELSE "ai-committed")]
    ELSE
      /\ d' = IF d.aiStatus = "Pending"
              THEN [d EXCEPT !.aiStatus = "Rejected", !.aiSealed = "Rejected",
                       !.aiReceipt = "Rejected"] ELSE d
      /\ v' = [v EXCEPT !.callbackSeen = TRUE,
            !.progress = IF d.aiEpoch # d.epoch \/ d.mode # "Proxy"
                          THEN Progress("epoch-late-ai") ELSE @,
            !.witness = Tag(IF d.phase # "Running" THEN "terminal-late-ai"
                         ELSE IF d.aiEpoch # d.epoch \/ d.mode # "Proxy" THEN "epoch-late-ai"
                         ELSE IF d.aiGeneration # d.generation THEN "generation-late-ai"
                         ELSE IF d.now >= d.aiDeadline THEN "deadline-late-ai"
                         ELSE IF d.aiRevision # d.revision[1] THEN "revision-late-ai"
                         ELSE IF d.aiBadPackage THEN "atomic-package-rejected"
                         ELSE "settled-ai-read")]
ExpireAI ==
 /\ ControlEnabled /\ v.up /\ d.aiStatus = "Pending"
 /\ d.now >= d.aiDeadline /\ Fault # "no_timeout"
 /\ d' = [d EXCEPT !.aiStatus = "Expired", !.aiSealed = "Expired", !.aiReceipt = "Expired"]
 /\ v' = [v EXCEPT !.witness = Tag("decision-expired")]
InvalidAI ==
 /\ Scenario = "ai-invalid" /\ v.up /\ d.aiStatus = "Pending"
 /\ d' = [d EXCEPT !.aiStatus = "Rejected", !.aiSealed = "Rejected", !.aiReceipt = "Rejected"]
 /\ v' = [v EXCEPT !.witness = Tag("invalid-ai-rejected")]
Tick == /\ d.now < Deadline /\ d' = [d EXCEPT !.now = NextTime] /\ UNCHANGED v
DeadlineClose ==
 /\ v.up /\ Due
 /\ d' = End(d, "Finished")
 /\ v' = [v EXCEPT !.witness = Tag("deadline-ended")]
Abort ==
 /\ Scenario \in {"ending", "ai-terminal"} /\ v.up /\ Open
 /\ d' = End(d, "Aborted")
 /\ v' = [v EXCEPT !.witness = Tag("aborted")]
BadType ==
 /\ Fault = "type" /\ d.phase = "Running"
 /\ d' = [d EXCEPT !.epoch = 7]
 /\ UNCHANGED v
Done ==
 /\ d.phase \in {"Finished","Aborted"}
    \/ (v.resolved = ActiveKeys /\ (d.aiStatus = "Idle" \/ d.aiStatus \in Settled))
 /\ UNCHANGED vars
Actions ==
 \/ \E k \in Keys : Receive(k) \/ Validate(k) \/ Commit(k) \/ FlushReceipt(k)
                    \/ Reply(k) \/ DropAck(k) \/ ChangePayload(k) \/ Retry(k)
 \/ Crash \/ Recover \/ Stabilize \/ Publish
 \/ Disconnect \/ Proxy \/ ReturnHuman \/ Take \/ ResumeHeld \/ RetryControl \/ StaleDisconnect
 \/ (\E bad \in BOOLEAN : PrepareAI(bad))
 \/ RevokeEpoch \/ NewGeneration \/ ReviseRelated \/ Unrelated
 \/ CancelAI \/ CallbackAI \/ ExpireAI \/ InvalidAI
 \/ Tick \/ DeadlineClose \/ Abort \/ BadType \/ Done
Next == IF Fault = "deadlock" /\ v.stage[1] = "Received" THEN FALSE ELSE Actions
Spec == Init /\ [][Next]_vars
LiveSpec ==
 /\ Spec
 /\ WF_vars(Stabilize) /\ WF_vars(Recover) /\ WF_vars(Tick) /\ WF_vars(DeadlineClose)
 /\ \A k \in Keys : WF_vars(Receive(k)) /\ WF_vars(Validate(k))
       /\ WF_vars(Commit(k)) /\ WF_vars(Reply(k)) /\ WF_vars(FlushReceipt(k))
 /\ WF_vars(ExpireAI)

TypeOK ==
 /\ d.phase \in {"Running", "Finished", "Aborted"}
 /\ d.now \in 0..Deadline
 /\ d.owner \in [Items -> (Actors \cup {0})]
 /\ d.holders \in [Items -> SUBSET (Actors \cup {0})]
 /\ d.revision \in [Items -> 0..4]
 /\ d.effects \in [Keys -> 0..2]
 /\ d.receipts \in [Keys -> [status : {"None","Accepted","Rejected"}, payload : {0,1},
                            first : 0..20, last : 0..20]]
 /\ d.boundPayload \in [Keys -> {-1,0,1}]
 /\ d.head \in 0..20 /\ Len(d.events) <= 20
 /\ d.mode \in {"Human", "Grace", "Proxy"} /\ d.epoch \in 0..6
 /\ d.connection \in {0,1,3} /\ d.handoffStep \in 0..3
 /\ d.aiStatus \in ({"Idle","Pending"} \cup Settled)
 /\ d.aiEffects \in 0..1 /\ d.generation \in {0,1}
 /\ v.stage \in [Keys -> Stages] /\ v.resolved \subseteq Keys
 /\ v.acceptedAcks \subseteq Keys /\ v.published \subseteq 1..Len(d.outbox)
 /\ v.payload \in [Keys -> {0,1}] /\ v.changed \in [Keys -> BOOLEAN]
 /\ v.up \in BOOLEAN /\ v.stable \in BOOLEAN /\ v.crashed \in BOOLEAN
 /\ v.witness \in BOOLEAN /\ v.progress \in 0..9
SingleEffectiveOwner ==
 /\ \A i \in Items : d.holders[i] = {d.owner[i]}
 /\ \A a,b \in 1..Len(d.commits) :
      (d.commits[a].kind = "take" /\ d.commits[b].kind = "take"
       /\ d.commits[a].item = d.commits[b].item /\ d.commits[a].base = d.commits[b].base)
       => d.commits[a].key = d.commits[b].key
AtMostOneEffect == \A k \in Keys : d.effects[k] <= 1
ReceiptPayloadBinding ==
 \A k \in Keys : d.receipts[k].status # "None"
                  => d.receipts[k].payload = d.boundPayload[k]
AtomicCommitBundle ==
 /\ d.events = d.outbox
 /\ \A k \in Keys :
       /\ d.effects[k] = Count(d.commits,k)
       /\ (d.effects[k] > 0) = (d.receipts[k].status = "Accepted")
       /\ IF d.receipts[k].status = "Accepted"
          THEN /\ d.receipts[k].last <= Len(d.events)
               /\ d.receipts[k].first > 0
               /\ \A i \in d.receipts[k].first..d.receipts[k].last : d.events[i].key = k
          ELSE TRUE
 /\ IF d.terminalAction # 0
    THEN /\ d.receipts[d.terminalAction].last - d.receipts[d.terminalAction].first = 1
         /\ d.events[d.receipts[d.terminalAction].last].kind = "finished"
    ELSE TRUE
 /\ d.aiEffects = Len(d.aiCommit)
 /\ (d.aiEffects > 0) = (d.aiReceipt = "Committed")
 /\ \A i \in 1..Len(d.aiCommit) : ~d.aiCommit[i].badPackage
AckRequiresCommit ==
 \A k \in v.acceptedAcks : d.receipts[k].status = "Accepted" /\ d.effects[k] = 1
NoDualControl ==
 /\ \A i \in 1..Len(d.commits) :
       d.commits[i].mode = "Human" /\ d.commits[i].epoch = 0
       /\ d.commits[i].connection = d.commits[i].key
 /\ \A i \in 1..Len(d.controls) :
       d.controls[i].kind = "disconnect" =>
         d.controls[i].suppliedEpoch = d.controls[i].priorEpoch
         /\ d.controls[i].suppliedConnection = d.controls[i].priorConnection
 /\ \A i \in 1..Len(d.aiCommit) :
       d.aiCommit[i].mode = "Proxy" /\ d.aiCommit[i].capturedEpoch = d.aiCommit[i].epoch
ControlNonceIdempotent == d.nonceWrites <= 1
FreshDecisionOnly ==
 \A i \in 1..Len(d.aiCommit) :
   LET c == d.aiCommit[i]
   IN /\ c.status = "Pending" /\ c.phase = "Running" /\ c.at < Deadline
      /\ c.at < c.deadline /\ c.capturedEpoch = c.epoch
      /\ c.capturedGeneration = c.generation /\ c.capturedRevision = c.revision
      /\ c.mode = "Proxy"
TerminalBlocksNewEffects ==
 /\ (d.terminalSeq = 0 \/ Len(d.events) = d.terminalSeq)
 /\ \A i \in 1..Len(d.events) :
       d.events[i].at < Deadline \/ d.events[i].kind = "deadline"
 /\ \A i \in 1..Len(d.controls) :
       d.controls[i].at < Deadline /\ d.controls[i].priorPhase = "Running"
ContinuousCommittedSequence ==
 d.head = Len(d.events) /\ \A i \in 1..Len(d.events) : d.events[i].seq = i
PreconditionDiscipline ==
 \A i \in 1..Len(d.commits) :
   LET c == d.commits[i]
   IN c.baseSeq <= c.headBefore
      /\ (c.kind = "take" => c.revisionBefore = 0 /\ c.ownerBefore = 0)
DecisionSettlesOnce ==
 d.aiSealed = "None" \/ d.aiStatus = d.aiSealed
AdmittedRequestResolves == <>(v.resolved = ActiveKeys)
DecisionResolvesOrExpires == (d.aiStatus = "Pending") ~> (d.aiStatus \in Settled)
WitnessAbsent ==
 /\ ~v.witness
 /\ ~(Probe = "effect-crash-handoff-retry" /\ v.progress = 9)
 /\ ~(Probe = "effect-crash-retry-negative" /\ v.progress = 3)
 /\ ~(Probe \in {"partial-bundle-crash", "early-ack-crash"} /\ v.progress = 2)
=============================================================================
