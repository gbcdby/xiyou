------------------------ MODULE MovementCommands ------------------------
EXTENDS Naturals, FiniteSets
CONSTANT Fault, Scenario, MaxCommands
VARIABLES epoch, clientEpoch, localSeq, issued, commands, pending, ackReady, acked,
          receipts, originals, effects, replayed, highWater, currentSeq,
          active, activeEpoch, status, dropped, lostAck, retried,
          rejectedAfterStop, retryHandled, retryHighWater,
          ackRetry, issuedAfterStop, rejectedOldEpoch, running, crashed, recovered, changed, ended
vars == <<epoch,clientEpoch,localSeq,issued,commands,pending,ackReady,acked,
          receipts,originals,effects,replayed,highWater,currentSeq,active,activeEpoch,
          status,dropped,lostAck,retried,rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
Ids == 1..MaxCommands
Kind(c) == IF c = 3 THEN "stop" ELSE "move"
Goal(c) == IF c = 1 THEN "alpha" ELSE IF c = 2 THEN "beta" ELSE "gamma"
Maximum(s) == CHOOSE m \in s: \A n \in s: n <= m
AcceptedNow == {c \in Ids: receipts[c] = "accepted" /\ commands[c].epoch = epoch}
LatestSeq == Maximum({0} \cup {commands[c].seq: c \in AcceptedNow})
LatestIsStop == \E c \in AcceptedNow: commands[c].seq = LatestSeq /\ Kind(c) = "stop"
Init ==
  /\ epoch = 0 /\ clientEpoch = 0 /\ localSeq = 0 /\ issued = 0
  /\ commands = [c \in Ids |-> [epoch |-> 0, seq |-> 0]]
  /\ pending = {} /\ ackReady = {} /\ acked = {} /\ replayed = {}
  /\ receipts = [c \in Ids |-> "none"] /\ originals = receipts
  /\ effects = [c \in Ids |-> 0] /\ highWater = 0 /\ currentSeq = 0
  /\ active = "none" /\ activeEpoch = 0 /\ status = "idle"
  /\ dropped = 0 /\ lostAck = 0 /\ retried = 0 /\ rejectedAfterStop = {} /\ retryHandled = 0 /\ retryHighWater = 0
  \* 三项见证观察只记录当步事实；block-*仅用于阻断对应因果链的对照配置。
  /\ ackRetry = [lostBeforeRetry |-> FALSE, receipt |-> "none", effect |-> 0,
                  handled |-> FALSE, returned |-> "none", effectUnchanged |-> FALSE]
  /\ issuedAfterStop = FALSE /\ rejectedOldEpoch = {}
  /\ running = TRUE /\ crashed = FALSE /\ recovered = FALSE /\ changed = FALSE /\ ended = FALSE

\* 发出顺序由唯一控制源分配；发送不意味着已在服务端处理。
Issue ==
  /\ ~ended /\ issued < MaxCommands
  /\ ~(Fault = "block-new-after-stop" /\ issued+1 = 4 /\ LatestIsStop /\ status = "stopped")
  /\ issued' = issued + 1 /\ localSeq' = localSeq + 1
  /\ issuedAfterStop' = IF issued+1 = 4 THEN LatestIsStop /\ status = "stopped" ELSE issuedAfterStop
  /\ commands' = [commands EXCEPT ![issued+1] = [epoch |-> clientEpoch, seq |-> localSeq+1]]
  /\ pending' = pending \cup {issued+1}
  /\ UNCHANGED <<epoch,clientEpoch,ackReady,acked,receipts,originals,effects,replayed,
                  highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
\* 先发出的请求可以在路上丢失；后发出的请求仍能到达并提交。
Drop(c) ==
  /\ ~ended /\ c \in pending /\ dropped = 0
  /\ pending' = pending \ {c} /\ dropped' = c
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,ackReady,acked,receipts,originals,
                  effects,replayed,highWater,currentSeq,active,activeEpoch,status,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
\* 同一动作ID、同一原始epoch/命令seq重发，不分配新序号。
Retry(c) ==
  /\ ~ended /\ c \in 1..issued /\ c \notin acked /\ c \notin pending /\ retried = 0
  /\ (Fault # "block-ack-retry" \/ lostAck # c)
  /\ pending' = pending \cup {c} /\ retried' = c
  /\ retryHighWater' = highWater
  /\ ackRetry' = [lostBeforeRetry |-> lostAck = c, receipt |-> receipts[c], effect |-> effects[c],
                   handled |-> FALSE, returned |-> "none", effectUnchanged |-> FALSE]
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,ackReady,acked,receipts,originals,
                  effects,replayed,highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,
                  rejectedAfterStop,retryHandled,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
Handle(c) ==
  LET first == receipts[c] = "none"
      sameEpoch == commands[c].epoch = epoch
      newer == commands[c].seq > highWater
      allowed == (sameEpoch \/ Fault = "epoch") /\ (newer \/ Fault = "late")
      apply == (first /\ allowed) \/ (~first /\ Fault = "replay" /\ receipts[c] = "accepted")
      fence == apply /\ ~(Kind(c) = "stop" /\ Fault = "stop-no-fence")
      result == IF allowed THEN "accepted" ELSE "rejected"
      returned == IF first THEN result ELSE receipts[c]
      effectAfter == effects[c] + (IF apply THEN 1 ELSE 0)
  IN /\ ~ended /\ running /\ c \in pending
     /\ (Fault # "block-old-epoch-handle" \/ sameEpoch)
     /\ pending' = pending \ {c} /\ ackReady' = ackReady \cup {c}
     /\ receipts' = IF first THEN [receipts EXCEPT ![c] = result] ELSE receipts
     /\ originals' = IF first THEN [originals EXCEPT ![c] = result] ELSE originals
     /\ effects' = IF apply THEN [effects EXCEPT ![c] = @ + 1] ELSE effects
     /\ replayed' = IF first THEN replayed ELSE replayed \cup {c}
     /\ retryHandled' = IF retried = c THEN c ELSE retryHandled
     /\ ackRetry' = IF retried = c
                       THEN [ackRetry EXCEPT !.handled = TRUE, !.returned = returned,
                              !.effectUnchanged = (effectAfter = ackRetry.effect)]
                       ELSE ackRetry
     /\ rejectedOldEpoch' = IF first /\ ~sameEpoch /\ ~allowed
                              THEN rejectedOldEpoch \cup {c} ELSE rejectedOldEpoch
     /\ highWater' = IF fence THEN commands[c].seq ELSE highWater
     /\ currentSeq' = IF fence THEN commands[c].seq ELSE currentSeq
     /\ active' = IF apply THEN IF Kind(c) = "stop" THEN "none" ELSE Goal(c) ELSE active
     /\ activeEpoch' = IF apply THEN commands[c].epoch ELSE activeEpoch
     /\ status' = IF apply THEN IF Kind(c) = "stop" THEN "stopped" ELSE "moving" ELSE status
     /\ rejectedAfterStop' = IF first /\ sameEpoch /\ ~allowed /\ LatestIsStop
                              THEN rejectedAfterStop \cup {c} ELSE rejectedAfterStop
     /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,acked,dropped,lostAck,retried,retryHighWater,issuedAfterStop,
                     running,crashed,recovered,changed,ended>>
Ack(c) ==
  /\ ~ended /\ c \in ackReady /\ ackReady' = ackReady \ {c} /\ acked' = acked \cup {c}
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,pending,receipts,originals,effects,
                  replayed,highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
LoseAck(c) ==
  /\ ~ended /\ c \in ackReady /\ lostAck = 0
  /\ ackReady' = ackReady \ {c} /\ lostAck' = c
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,pending,acked,receipts,originals,effects,
                  replayed,highWater,currentSeq,active,activeEpoch,status,dropped,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
ChangeControl ==
  /\ ~ended /\ Scenario = "control" /\ ~changed /\ running
  /\ epoch' = epoch + 1 /\ changed' = TRUE
  /\ highWater' = 0 /\ currentSeq' = 0 /\ active' = "none" /\ status' = "idle"
  /\ UNCHANGED <<clientEpoch,localSeq,issued,commands,pending,ackReady,acked,receipts,originals,
                  effects,replayed,activeEpoch,dropped,lostAck,retried,rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,
                  running,crashed,recovered,ended>>
Crash ==
  /\ ~ended /\ Scenario = "recovery" /\ ~crashed /\ running
  /\ running' = FALSE /\ crashed' = TRUE /\ ackReady' = {}
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,pending,acked,receipts,originals,effects,
                  replayed,highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,recovered,changed,ended>>
Recover ==
  /\ ~ended /\ ~running /\ ~recovered
  /\ running' = TRUE /\ recovered' = TRUE
  /\ epoch' = IF Fault = "reset-water" THEN epoch ELSE epoch + 1
  /\ highWater' = 0 /\ currentSeq' = 0 /\ active' = "none" /\ status' = "idle"
  /\ UNCHANGED <<clientEpoch,localSeq,issued,commands,pending,ackReady,acked,receipts,originals,
                  effects,replayed,activeEpoch,dropped,lostAck,retried,rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,
                  crashed,changed,ended>>
BindNewEpoch ==
  /\ ~ended /\ running /\ clientEpoch # epoch
  /\ clientEpoch' = epoch /\ localSeq' = 0
  /\ UNCHANGED <<epoch,issued,commands,pending,ackReady,acked,receipts,originals,effects,replayed,
                  highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
Finish ==
  /\ ~ended /\ ended' = TRUE
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,pending,ackReady,acked,receipts,originals,
                  effects,replayed,highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed>>
BreakType ==
  /\ Fault = "type" /\ localSeq = 0 /\ localSeq' = MaxCommands + 1
  /\ UNCHANGED <<epoch,clientEpoch,issued,commands,pending,ackReady,acked,receipts,originals,
                  effects,replayed,highWater,currentSeq,active,activeEpoch,status,dropped,lostAck,retried,
                  rejectedAfterStop,retryHandled,retryHighWater,ackRetry,issuedAfterStop,rejectedOldEpoch,running,crashed,recovered,changed,ended>>
Done == ended /\ UNCHANGED vars
Next == Issue \/ (\E c \in Ids: Drop(c) \/ Retry(c) \/ Handle(c) \/ Ack(c) \/ LoseAck(c))
        \/ ChangeControl \/ Crash \/ Recover \/ BindNewEpoch \/ Finish \/ BreakType \/ Done
Spec == Init /\ [][Next]_vars
TypeOK == epoch \in 0..1 /\ clientEpoch \in 0..1 /\ localSeq \in 0..MaxCommands
          /\ issued \in 0..MaxCommands
          /\ commands \in [Ids -> [epoch:0..1,seq:0..MaxCommands]]
          /\ pending \subseteq Ids /\ ackReady \subseteq Ids /\ acked \subseteq Ids /\ replayed \subseteq Ids
          /\ receipts \in [Ids -> {"none","accepted","rejected"}] /\ originals \in [Ids -> {"none","accepted","rejected"}]
          /\ effects \in [Ids -> 0..2] /\ highWater \in 0..MaxCommands /\ currentSeq \in 0..MaxCommands
          /\ active \in {"none","alpha","beta","gamma"} /\ activeEpoch \in 0..1
          /\ status \in {"idle","moving","stopped"} /\ rejectedAfterStop \subseteq Ids
          /\ retryHighWater \in 0..MaxCommands /\ retryHandled \in 0..MaxCommands /\ dropped \in 0..MaxCommands /\ lostAck \in 0..MaxCommands /\ retried \in 0..MaxCommands
          /\ issuedAfterStop \in BOOLEAN /\ rejectedOldEpoch \subseteq Ids
          /\ ackRetry \in [lostBeforeRetry:BOOLEAN, receipt:{"none","accepted","rejected"}, effect:0..2,
                            handled:BOOLEAN, returned:{"none","accepted","rejected"}, effectUnchanged:BOOLEAN]
          /\ running \in BOOLEAN /\ crashed \in BOOLEAN /\ recovered \in BOOLEAN /\ changed \in BOOLEAN /\ ended \in BOOLEAN
CommandOrder == highWater = LatestSeq /\ currentSeq = LatestSeq
StopFence == LatestIsStop => status = "stopped" /\ active = "none"
ReceiptStable == receipts = originals /\ (\A c \in Ids: effects[c] <= 1)
EpochFence == active # "none" => activeEpoch = epoch
NoOutOfOrderWitness == ~(receipts[2] = "accepted" /\ receipts[1] = "rejected"
                         /\ commands[1].epoch = epoch /\ commands[2].epoch = epoch /\ active = "beta")
NoUnknownRetryWitness == ~(dropped = 1 /\ retried = 1 /\ retryHandled = 1 /\ retryHighWater = commands[2].seq /\ receipts[1] = "rejected" /\ receipts[2] = "accepted" /\ active = "beta")
NoStopRejectWitness == ~(1 \in rejectedAfterStop)
NoAckRetryWitness == ~(retried = 1 /\ retryHandled = 1 /\ ackRetry.lostBeforeRetry
                      /\ ackRetry.handled /\ ackRetry.receipt = "accepted"
                      /\ ackRetry.returned = ackRetry.receipt /\ ackRetry.returned = originals[1]
                      /\ ackRetry.effect = 1 /\ ackRetry.effectUnchanged /\ effects[1] = 1
                      /\ 1 \in replayed)
NoNewAfterStopWitness == ~(MaxCommands = 4 /\ issuedAfterStop /\ receipts[3] = "accepted" /\ receipts[4] = "accepted" /\ active = "gamma")
NoOldEpochRejectedWitness == ~(1 \in rejectedOldEpoch /\ epoch = 1 /\ receipts[1] = "rejected" /\ commands[1].epoch = 0)
NoNewEpochAcceptedWitness == ~(epoch = 1 /\ AcceptedNow # {})
NoRestartPreservesReceiptWitness == ~(recovered /\ receipts[1] = "accepted" /\ commands[1].epoch = 0 /\ effects[1] = 1)
=============================================================================
