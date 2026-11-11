------------------------------ MODULE Fallback ------------------------------
EXTENDS Naturals, Sequences, FiniteSets

(* 原 Decision 与独立 fallback 在同一 Session 状态图中交错。
   Fault 仅用于逐目标缺陷；Probe 仅记录指定可达见证。 *)
CONSTANTS Fault, Probe
VARIABLES d, v
vars == <<d, v>>
Phases == {"Running", "Finished", "Aborted"}
Settled == {"Committed", "Rejected", "Expired", "Cancelled"}
Failed == {"Rejected", "Expired"}
FallbackKey == "d1:fallback"
Keys == {FallbackKey, "d1:fallback:retry"}
DecisionDeadline == 2
SessionDeadline == 3
EmptyReceipt == [status |-> "None", payload |-> "wait", reason |-> "none", eventSeq |-> 0]
Count(kind) == Cardinality({i \in 1..Len(d.effects): d.effects[i].kind = kind})
HasReceipt(key) == d.receipts[key].status # "None"
Observe(tag) == v.witness \/ (Probe # "none" /\ Probe = tag)
Due == d.phase = "Running" /\ d.now = SessionDeadline

Init ==
 /\ d = [phase |-> "Running", epoch |-> 0, allowed |-> TRUE, now |-> 0,
          status |-> "Pending", sealed |-> "None", originalReceipt |-> "None",
          queued |-> FALSE, queuedFrom |-> "None", fallbackEpoch |-> 0,
          receipts |-> [key \in Keys |-> EmptyReceipt],
          effects |-> <<>>, events |-> <<>>, outbox |-> {}, terminalEffects |-> 0,
          nextId |-> "none"]
 /\ v = [up |-> TRUE, crashes |-> 0, callback |-> "none", handled |-> FALSE,
          stage |-> "Idle", attempts |-> 0, key |-> FallbackKey,
          cachedValid |-> FALSE, conflictSeen |-> FALSE, repeatedOriginal |-> FALSE,
          witness |-> FALSE]

Seal(db, result) == [db EXCEPT !.status = result,
                       !.sealed = IF @ = "None" THEN result ELSE @,
                       !.originalReceipt = result]
End(db, ending) ==
 LET stopped == [db EXCEPT !.phase = ending, !.terminalEffects = Len(db.effects)]
 IN IF db.status = "Pending" THEN Seal(stopped, "Cancelled") ELSE stopped

Effect(kind, key) ==
 [kind |-> kind, key |-> key, payload |-> "wait", at |-> d.now,
  requestEpoch |-> 0, currentEpoch |-> d.epoch, allowedAt |-> d.allowed,
  phaseAt |-> d.phase, decisionAt |-> d.status]
AppendEffect(db, effect) ==
 LET changed == [db EXCEPT !.effects = Append(@, effect)]
 IN IF Fault = "split_bundle" /\ effect.kind = "fallback" THEN changed
    ELSE [changed EXCEPT !.events = Append(@, effect.key),
                         !.outbox = @ \cup {Len(db.events) + 1}]

OriginalFresh ==
 /\ d.status = "Pending" /\ d.epoch = 0 /\ d.allowed
 /\ d.phase = "Running" /\ d.now < DecisionDeadline
OriginalFence ==
 /\ d.status = "Pending"
 /\ (d.epoch = 0 \/ Fault = "original_epoch")
 /\ (d.allowed \/ Fault = "original_permission")
 /\ (d.now < DecisionDeadline \/ Fault = "original_deadline")
 /\ d.phase = "Running"

Callback(kind) ==
 /\ v.up /\ v.callback = "none"
 /\ v' = [v EXCEPT !.callback = kind]
 /\ UNCHANGED d

SubmitOriginal ==
 /\ v.up /\ v.callback # "none" /\ ~v.handled
 /\ IF d.status # "Pending" THEN
      /\ UNCHANGED d
      /\ v' = [v EXCEPT !.handled = TRUE,
                !.witness = Observe(IF Count("fallback") > 0 THEN "late-original-after-fallback"
                                     ELSE "settled-original-read")]
    ELSE IF Due THEN
      /\ d' = End(d, "Finished")
      /\ v' = [v EXCEPT !.handled = TRUE, !.witness = Observe("original-session-expired")]
    ELSE IF v.callback = "valid" /\ OriginalFence THEN
      /\ d' = Seal(AppendEffect(d, Effect("original", "d1:submit")), "Committed")
      /\ v' = [v EXCEPT !.handled = TRUE, !.witness = Observe("original-committed")]
    ELSE
      /\ d' = Seal(d, "Rejected")
      /\ v' = [v EXCEPT !.handled = TRUE,
                !.witness = Observe(IF v.callback = "invalid-json" THEN "invalid-json-rejected"
                                     ELSE IF v.callback = "no-tool" THEN "no-tool-rejected"
                                     ELSE "stale-original-rejected")]

Tick ==
 /\ d.now < SessionDeadline
 /\ d' = [d EXCEPT !.now = @ + 1]
 /\ UNCHANGED v

Expire ==
 /\ v.up /\ d.status = "Pending" /\ d.now >= DecisionDeadline
 /\ Fault # "no_timeout"
 /\ d' = IF Due THEN End(d, "Finished") ELSE Seal(d, "Expired")
 /\ v' = [v EXCEPT !.witness = Observe("decision-expired")]

Cancel ==
 /\ v.up /\ d.status = "Pending"
 /\ d' = IF Due THEN End(d, "Finished") ELSE Seal(d, "Cancelled")
 /\ UNCHANGED v

ChangeEpoch ==
 /\ v.up /\ d.phase = "Running" /\ d.epoch = 0
 /\ d' = IF Due THEN End(d, "Finished") ELSE [d EXCEPT !.epoch = 1]
 /\ UNCHANGED v

RevokePermission ==
 /\ v.up /\ d.phase = "Running" /\ d.allowed
 /\ d' = IF Due THEN End(d, "Finished") ELSE [d EXCEPT !.allowed = FALSE]
 /\ UNCHANGED v

Finish(ending) ==
 /\ v.up /\ d.phase = "Running"
 /\ d' = End(d, IF Due THEN "Finished" ELSE ending)
 /\ UNCHANGED v

(* 队列为已收束决定的持久处理记录；本步骤不赋予写权限，也不创建世界效果。
   即使处理延迟至终局之后，后续提交仍要保存拒绝结果而不能重新执行。 *)
QueueFallback ==
 /\ v.up /\ ~d.queued /\ Fault # "no_queue"
 /\ (d.status \in Failed \/ Fault = "early_queue")
 /\ d' = [d EXCEPT !.queued = TRUE, !.queuedFrom = d.status, !.fallbackEpoch = 0]
 /\ UNCHANGED v

ReceiveFallback ==
 /\ v.up /\ d.queued /\ v.stage \in {"Idle", "Done"} /\ v.attempts < 2
 /\ (Fault # "lost_receipt" \/ v.attempts = 0 \/ v.crashes = 1)
 /\ v' = [v EXCEPT !.stage = "Received", !.attempts = @ + 1,
           !.key = IF Fault = "unstable_key" /\ v.attempts = 1
                   THEN "d1:fallback:retry" ELSE FallbackKey,
           !.cachedValid = FALSE]
 /\ UNCHANGED d

FallbackFresh ==
 /\ d.queued /\ d.queuedFrom \in Failed /\ d.status = d.queuedFrom
 /\ d.fallbackEpoch = d.epoch /\ d.allowed /\ d.phase = "Running"
 /\ d.now < SessionDeadline
FallbackFence ==
 /\ d.queued /\ d.queuedFrom \in Failed /\ d.status = d.queuedFrom
 /\ (d.fallbackEpoch = d.epoch \/ Fault = "fallback_epoch")
 /\ (d.allowed \/ Fault = "fallback_permission")
 /\ (d.phase = "Running" \/ Fault = "fallback_terminal")
 /\ (d.now < SessionDeadline \/ Fault = "fallback_deadline")

ValidateFallback ==
 /\ v.up /\ v.stage = "Received"
 /\ v' = [v EXCEPT !.stage = "Validated", !.cachedValid = FallbackFresh]
 /\ UNCHANGED d

FallbackResult(db, result, reason) ==
 [db EXCEPT !.receipts[v.key] = [status |-> result, payload |-> "wait", reason |-> reason,
                              eventSeq |-> IF result = "Accepted" THEN Len(db.events) ELSE 0]]

CommitFallback ==
 /\ v.up /\ v.stage = "Validated" /\ Fault # "no_fallback_commit"
 /\ IF HasReceipt(v.key) THEN
      /\ UNCHANGED d
      /\ v' = [v EXCEPT !.stage = "Done",
                !.witness = Observe(IF d.receipts[v.key].status # "Accepted" THEN "rejected-receipt-read"
                                     ELSE IF d.phase # "Running" THEN "terminal-receipt-read"
                                     ELSE IF Probe = "crash-retry-fallback" /\ v.crashes = 1 THEN "crash-retry-fallback"
                                     ELSE "fallback-repeat")]
    ELSE IF Due /\ Fault # "fallback_deadline" THEN
      /\ d' = FallbackResult(End(d, "Finished"), "Rejected", "SESSION_NOT_RUNNING")
      /\ v' = [v EXCEPT !.stage = "Done", !.witness = Observe("fallback-session-deadline")]
    ELSE IF FallbackFence THEN
      /\ LET changed == AppendEffect(d, Effect("fallback", v.key))
             saved == IF Fault = "lost_receipt" THEN changed
                      ELSE FallbackResult(changed, "Accepted", "none")
         IN d' = IF Fault = "revive_decision" THEN [saved EXCEPT !.status = "Pending"] ELSE saved
      /\ v' = [v EXCEPT !.stage = "Done", !.witness = Observe(IF Probe = "fallback-from-expired" /\ d.queuedFrom = "Expired" THEN "fallback-from-expired"
                                     ELSE IF Probe = "fallback-from-rejected" /\ d.queuedFrom = "Rejected" THEN "fallback-from-rejected"
                                     ELSE "fallback-accepted")]
    ELSE
      /\ LET reason == IF d.phase # "Running" THEN "SESSION_NOT_RUNNING"
                        ELSE IF d.fallbackEpoch # d.epoch THEN "STALE_CONTROL"
                        ELSE IF ~d.allowed THEN "TOOL_NOT_ALLOWED" ELSE "DECISION_SETTLED"
         IN /\ d' = FallbackResult(d, "Rejected", reason)
            /\ v' = [v EXCEPT !.stage = "Done",
                      !.witness = Observe(IF reason = "SESSION_NOT_RUNNING" /\ v.cachedValid THEN "fallback-terminal-rejected"
                                           ELSE IF reason = "STALE_CONTROL" /\ v.cachedValid THEN "fallback-epoch-rejected"
                                           ELSE IF reason = "TOOL_NOT_ALLOWED" /\ v.cachedValid THEN "fallback-permission-rejected"
                                           ELSE "fallback-other-rejected")]

ConflictFallback ==
 /\ v.up /\ HasReceipt(FallbackKey) /\ ~v.conflictSeen
 /\ d' = IF Fault = "payload_overwrite"
          THEN [d EXCEPT !.receipts[FallbackKey].payload = "consume"] ELSE d
 /\ v' = [v EXCEPT !.conflictSeen = TRUE, !.witness = Observe("payload-conflict-rejected")]

RepeatOriginal ==
 /\ v.up /\ d.status \in Settled /\ v.handled /\ ~v.repeatedOriginal
 /\ v' = [v EXCEPT !.repeatedOriginal = TRUE, !.witness = Observe("original-repeat")]
 /\ UNCHANGED d

NewDecisionId ==
 /\ v.up /\ d.phase = "Running" /\ d.status \in Settled /\ d.nextId = "none"
 /\ HasReceipt(FallbackKey)
 /\ d' = IF Due THEN End(d, "Finished")
          ELSE [d EXCEPT !.nextId = IF Fault = "reuse_decision_id" THEN "d1" ELSE "d2"]
 /\ v' = [v EXCEPT !.witness = Observe(IF ~Due THEN "fresh-replan-id" ELSE "replan-terminal")]

Crash ==
 /\ v.up /\ v.crashes = 0
 /\ (Fault # "lost_receipt" \/ Count("fallback") = 1)
 /\ v' = [v EXCEPT !.up = FALSE, !.crashes = 1, !.stage = "Idle", !.cachedValid = FALSE,
           !.callback = "none", !.handled = FALSE,
           !.witness = Observe(IF Count("fallback") > 0 THEN "crash-after-fallback" ELSE "crash-before-fallback")]
 /\ UNCHANGED d

Recover ==
 /\ ~v.up /\ v' = [v EXCEPT !.up = TRUE]
 /\ UNCHANGED d

TypeFault ==
 /\ Fault = "type" /\ d.epoch = 0
 /\ d' = [d EXCEPT !.epoch = 2]
 /\ UNCHANGED v

Done ==
 /\ d.phase # "Running" \/ (d.status \in Settled /\ (d.status \notin Failed \/ HasReceipt(FallbackKey)))
 /\ UNCHANGED vars

Next ==
 /\ Fault # "deadlock"
 /\ \/ \E kind \in {"valid", "invalid-json", "no-tool"}: Callback(kind)
     \/ SubmitOriginal \/ Tick \/ Expire \/ Cancel \/ ChangeEpoch \/ RevokePermission
     \/ \E ending \in {"Finished", "Aborted"}: Finish(ending)
     \/ QueueFallback \/ ReceiveFallback \/ ValidateFallback \/ CommitFallback
     \/ ConflictFallback \/ RepeatOriginal \/ NewDecisionId
     \/ Crash \/ Recover \/ TypeFault \/ Done
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(Tick) /\ WF_vars(Expire) /\ WF_vars(SubmitOriginal)
                 /\ WF_vars(Recover) /\ WF_vars(QueueFallback)
                 /\ WF_vars(ReceiveFallback) /\ WF_vars(ValidateFallback) /\ WF_vars(CommitFallback)

TypeOK ==
 /\ d.phase \in Phases /\ d.epoch \in 0..1 /\ d.allowed \in BOOLEAN
 /\ d.now \in 0..SessionDeadline /\ d.status \in {"Pending"} \cup Settled
 /\ d.sealed \in {"None"} \cup Settled /\ d.originalReceipt \in {"None"} \cup Settled
 /\ d.queued \in BOOLEAN /\ d.queuedFrom \in {"None", "Pending"} \cup Settled
 /\ d.fallbackEpoch \in 0..1 /\ d.nextId \in {"none", "d1", "d2"}
 /\ d.receipts \in [Keys -> [status: {"None", "Accepted", "Rejected"}, payload: {"wait", "consume"},
                     reason: {"none", "SESSION_NOT_RUNNING", "STALE_CONTROL", "TOOL_NOT_ALLOWED", "DECISION_SETTLED"}, eventSeq: 0..3]]
 /\ v.up \in BOOLEAN /\ v.crashes \in 0..1 /\ v.stage \in {"Idle", "Received", "Validated", "Done"}
 /\ v.callback \in {"none", "valid", "invalid-json", "no-tool"} /\ v.handled \in BOOLEAN
 /\ v.attempts \in 0..2 /\ v.key \in Keys /\ v.cachedValid \in BOOLEAN /\ v.witness \in BOOLEAN
 /\ v.conflictSeen \in BOOLEAN /\ v.repeatedOriginal \in BOOLEAN

StableReasonKey ==
 /\ \A key \in Keys: HasReceipt(key) => key = FallbackKey
 /\ v.stage # "Idle" => v.key = FallbackKey
 /\ \A i \in 1..Len(d.effects): d.effects[i].kind = "fallback" => d.effects[i].key = FallbackKey
AtMostOneEffect == Count("original") <= 1 /\ Count("fallback") <= 1
ReceiptPayloadBinding == \A key \in Keys: HasReceipt(key) => d.receipts[key].payload = "wait"
AtomicCommitBundle ==
 /\ d.events = [i \in 1..Len(d.effects) |-> d.effects[i].key]
 /\ d.outbox = 1..Len(d.events)
 /\ (Count("original") = 1) <=> (d.originalReceipt = "Committed")
 /\ \A key \in Keys:
      (Cardinality({i \in 1..Len(d.effects): d.effects[i].key = key}) = 1)
        <=> (d.receipts[key].status = "Accepted")
FallbackAfterSettlement ==
 d.queued => d.queuedFrom \in Failed /\ d.sealed = d.queuedFrom
CurrentEpochOnly == \A i \in 1..Len(d.effects):
 d.effects[i].kind = "fallback" => d.effects[i].requestEpoch = d.effects[i].currentEpoch
CurrentToolPermission == \A i \in 1..Len(d.effects):
 d.effects[i].kind = "fallback" => d.effects[i].allowedAt /\ d.effects[i].payload = "wait"
TerminalBlocksNewEffects ==
 /\ d.phase # "Running" => Len(d.effects) = d.terminalEffects
 /\ \A i \in 1..Len(d.effects): d.effects[i].phaseAt = "Running" /\ d.effects[i].at < SessionDeadline
NoDecisionRevival ==
 /\ d.sealed # "None" => d.status = d.sealed /\ d.originalReceipt = d.sealed
 /\ d.nextId # "d1"
FreshDecisionOnly == \A i \in 1..Len(d.effects):
 LET e == d.effects[i]
 IN e.kind = "original" => e.decisionAt = "Pending" /\ e.requestEpoch = e.currentEpoch
                           /\ e.allowedAt /\ e.at < DecisionDeadline /\ e.phaseAt = "Running"
DecisionResolvesOrExpires == (d.status = "Pending") ~> (d.status \in Settled)
FallbackResolves == (d.status \in Failed) ~> HasReceipt(FallbackKey)
NotReached == ~v.witness
=============================================================================
