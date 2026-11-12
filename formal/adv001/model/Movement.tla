--------------------------- MODULE Movement ---------------------------
EXTENDS Naturals, Integers, FiniteSets
CONSTANT Fault
VARIABLES epoch, generation, activeEpoch, position, goal, status, callbacks,
          arrived, online, sceneTime, badClock, disconnected, restarted, ended
vars == <<epoch, generation, activeEpoch, position, goal, status, callbacks,
          arrived, online, sceneTime, badClock, disconnected, restarted, ended>>
Statuses == {"idle", "accepted", "moving", "arrived", "cancelled"}
Message(g, e, p) == [generation |-> g, epoch |-> e, goal |-> p]
Init == /\ epoch = 0 /\ generation = 0 /\ activeEpoch = 0
        /\ position = 0 /\ goal = 2 /\ status = "idle" /\ callbacks = {}
        /\ arrived = [generation |-> 0, epoch |-> 0, current |-> TRUE, physical |-> TRUE]
        /\ online = 2 /\ sceneTime = 0 /\ badClock = FALSE
        /\ disconnected = FALSE /\ restarted = FALSE /\ ended = FALSE

Request(p) ==
  /\ ~ended /\ online = 2 /\ generation < 2 /\ p \in {1, 2}
  /\ generation' = generation + 1 /\ activeEpoch' = epoch
  /\ goal' = p /\ status' = "accepted"
  /\ callbacks' = callbacks \cup {Message(generation + 1, epoch, p)}
  /\ UNCHANGED <<epoch, position, arrived, online, sceneTime, badClock,
                  disconnected, restarted, ended>>
Walk ==
  /\ ~ended /\ online = 2 /\ status \in {"accepted", "moving"}
  /\ activeEpoch = epoch /\ position # goal
  /\ position' = IF position < goal THEN position + 1 ELSE position - 1
  /\ status' = "moving"
  /\ UNCHANGED <<epoch, generation, activeEpoch, goal, callbacks, arrived,
                  online, sceneTime, badClock, disconnected, restarted, ended>>
Handle(m) ==
  LET current == m.generation = generation /\ m.epoch = epoch
                 /\ activeEpoch = epoch /\ m.goal = goal
                 /\ status \in {"accepted", "moving"}
      allowed == ~ended /\ online = 2
                 /\ (current \/ Fault = "stale")
                 /\ (position = m.goal \/ Fault = "teleport")
  IN /\ m \in callbacks /\ callbacks' = callbacks \ {m}
     /\ status' = IF allowed THEN "arrived" ELSE status
     /\ arrived' = IF allowed
                    THEN [generation |-> m.generation, epoch |-> m.epoch,
                          current |-> current, physical |-> (position = m.goal /\ m.goal = goal)]
                    ELSE arrived
     /\ UNCHANGED <<epoch, generation, activeEpoch, position, goal, online,
                     sceneTime, badClock, disconnected, restarted, ended>>
Stop ==
  /\ ~ended /\ status \in {"accepted", "moving"}
  /\ status' = "cancelled"
  /\ UNCHANGED <<epoch, generation, activeEpoch, position, goal, callbacks,
                  arrived, online, sceneTime, badClock, disconnected, restarted, ended>>
Disconnect ==
  /\ ~ended /\ ~disconnected /\ online = 2
  /\ disconnected' = TRUE /\ online' = 1 /\ epoch' = epoch + 1
  /\ status' = "cancelled"
  /\ UNCHANGED <<generation, activeEpoch, position, goal, callbacks, arrived,
                  sceneTime, badClock, restarted, ended>>
Reconnect ==
  /\ ~ended /\ online = 1 /\ online' = 2
  /\ epoch' = epoch + 1 /\ status' = "cancelled"
  /\ UNCHANGED <<generation, activeEpoch, position, goal, callbacks, arrived,
                  sceneTime, badClock, disconnected, restarted, ended>>
Restart ==
  /\ ~ended /\ ~restarted /\ restarted' = TRUE
  /\ epoch' = epoch + 1 /\ status' = "cancelled"
  /\ UNCHANGED <<generation, activeEpoch, position, goal, callbacks, arrived,
                  online, sceneTime, badClock, disconnected, ended>>
ClockTick ==
  /\ ~ended /\ sceneTime < 2
  /\ (online = 2 \/ Fault = "paused-clock")
  /\ sceneTime' = sceneTime + 1
  /\ badClock' = (badClock \/ online # 2)
  /\ UNCHANGED <<epoch, generation, activeEpoch, position, goal, status, callbacks,
                  arrived, online, disconnected, restarted, ended>>
Finish ==
  /\ ~ended /\ ended' = TRUE /\ status' = "cancelled"
  /\ UNCHANGED <<epoch, generation, activeEpoch, position, goal, callbacks,
                  arrived, online, sceneTime, badClock, disconnected, restarted>>
BreakType ==
  /\ Fault = "type" /\ position = 0 /\ position' = 3
  /\ UNCHANGED <<epoch, generation, activeEpoch, goal, status, callbacks,
                  arrived, online, sceneTime, badClock, disconnected, restarted, ended>>
Done == ended /\ callbacks = {} /\ UNCHANGED vars
Next == (\E p \in {1, 2}: Request(p)) \/ Walk \/ (\E m \in callbacks: Handle(m))
        \/ Stop \/ Disconnect \/ Reconnect \/ Restart \/ ClockTick \/ Finish \/ BreakType \/ Done
Spec == Init /\ [][Next]_vars
TypeOK == epoch \in 0..3 /\ generation \in 0..2 /\ activeEpoch \in 0..3
          /\ position \in 0..2 /\ goal \in {1,2} /\ status \in Statuses
          /\ online \in {1,2} /\ sceneTime \in 0..2
          /\ callbacks \subseteq [generation:1..2, epoch:0..3, goal:{1,2}]
          /\ badClock \in BOOLEAN /\ disconnected \in BOOLEAN /\ restarted \in BOOLEAN /\ ended \in BOOLEAN
ArrivalCurrent == status = "arrived" => arrived.current /\ arrived.generation = generation /\ arrived.epoch = epoch /\ activeEpoch = epoch
ArrivalPhysical == status = "arrived" => arrived.physical /\ position = goal
PausedTimeStable == ~badClock
NoArrivalWitness == status # "arrived"
NoReplacedArrivalWitness == ~(generation = 2 /\ status = "arrived")
NoRecoverArrivalWitness == ~(restarted /\ status = "arrived")
=============================================================================
