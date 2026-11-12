---------------------------- MODULE Consent ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANT Fault
VARIABLES version, subject, destination, leader, acceptedBy, consent, status,
          positions, callbacks, safe, everSafe, proof, replanned, ended
vars == <<version, subject, destination, leader, acceptedBy, consent, status,
          positions, callbacks, safe, everSafe, proof, replanned, ended>>
People == {"cuilan", "wukong"}
Places == {"origin", "A", "B"}
Init == /\ version = 0 /\ subject = "cuilan" /\ destination = "A" /\ leader = "p1"
        /\ acceptedBy = "none" /\ consent = FALSE /\ status = "none"
        /\ positions = [p \in People |-> "origin"] /\ callbacks = {}
        /\ safe = FALSE /\ everSafe = FALSE
        /\ proof = [real |-> FALSE, own |-> FALSE, fresh |-> FALSE, physical |-> FALSE,
                    planVersion |-> 0, replanned |-> FALSE]
        /\ replanned = FALSE
        /\ ended = FALSE
Propose(p, d, l) ==
  /\ ~ended /\ version < 2 /\ p \in People /\ d \in {"A","B"} /\ l \in {"p1","p2"}
  /\ version' = version + 1 /\ subject' = p /\ destination' = d /\ leader' = l
  /\ acceptedBy' = "none" /\ consent' = FALSE /\ status' = "proposed"
  /\ replanned' = (version = 1 /\ subject = "cuilan" /\ p = "cuilan"
                    /\ consent /\ status = "following" /\ (destination # d \/ leader # l))
  /\ UNCHANGED <<positions, callbacks, safe, everSafe, proof, ended>>
Respond(who) ==
  /\ ~ended /\ status = "proposed" /\ who \in {"cuilan","wukong","father"}
  /\ (who = subject \/ Fault = "impersonation")
  /\ acceptedBy' = who /\ consent' = TRUE /\ status' = "following"
  /\ callbacks' = callbacks \cup {[version |-> version, subject |-> subject,
                                  destination |-> destination, leader |-> leader,
                                  acceptedBy |-> who]}
  /\ UNCHANGED <<version, subject, destination, leader, positions, safe, everSafe, proof, replanned, ended>>
Walk ==
  /\ ~ended /\ consent /\ status = "following" /\ positions[subject] # destination
  /\ positions' = [positions EXCEPT ![subject] = destination]
  /\ UNCHANGED <<version, subject, destination, leader, acceptedBy, consent, status,
                  callbacks, safe, everSafe, proof, replanned, ended>>
Withdraw ==
  /\ ~ended /\ consent /\ consent' = FALSE /\ status' = "withdrawn"
  /\ safe' = IF Fault = "rollback" THEN FALSE ELSE safe
  /\ UNCHANGED <<version, subject, destination, leader, acceptedBy, positions,
                  callbacks, everSafe, proof, replanned, ended>>
Confirm(m) ==
  LET real == m.subject = "cuilan"
      own == m.acceptedBy = m.subject
      fresh == m.version = version /\ m.subject = subject /\ m.destination = destination
               /\ m.leader = leader /\ consent /\ status = "following"
      physical == positions[m.subject] = m.destination
      allowed == ~ended /\ (real \/ Fault = "fake")
                 /\ (own \/ Fault = "impersonation")
                 /\ (fresh \/ Fault = "stale") /\ physical
                 /\ (Fault # "block-replan" \/ m.version = 1)
  IN /\ m \in callbacks /\ callbacks' = callbacks \ {m}
     /\ safe' = IF allowed THEN TRUE ELSE safe
     /\ everSafe' = (everSafe \/ allowed)
     /\ proof' = IF allowed THEN [real |-> real, own |-> own, fresh |-> fresh, physical |-> physical,
                                  planVersion |-> m.version, replanned |-> replanned] ELSE proof
     /\ status' = IF allowed THEN "settled" ELSE status
     /\ UNCHANGED <<version, subject, destination, leader, acceptedBy, consent, positions, replanned, ended>>
Finish ==
  /\ ~ended /\ ended' = TRUE /\ consent' = FALSE /\ status' = "cancelled"
  /\ UNCHANGED <<version, subject, destination, leader, acceptedBy, positions, callbacks, safe, everSafe, proof, replanned>>
BreakType ==
  /\ Fault = "type" /\ version = 0 /\ version' = 3
  /\ UNCHANGED <<subject, destination, leader, acceptedBy, consent, status, positions,
                  callbacks, safe, everSafe, proof, replanned, ended>>
Done == ended /\ callbacks = {} /\ UNCHANGED vars
Next == (\E p \in People, d \in {"A","B"}, l \in {"p1","p2"}: Propose(p,d,l))
        \/ (\E who \in {"cuilan","wukong","father"}: Respond(who)) \/ Walk \/ Withdraw
        \/ (\E m \in callbacks: Confirm(m)) \/ Finish \/ BreakType \/ Done
Spec == Init /\ [][Next]_vars
TypeOK == version \in 0..2 /\ subject \in People /\ destination \in {"A","B"}
          /\ leader \in {"p1","p2"} /\ positions \in [People -> Places]
          /\ consent \in BOOLEAN /\ safe \in BOOLEAN /\ everSafe \in BOOLEAN /\ ended \in BOOLEAN
          /\ replanned \in BOOLEAN /\ proof.planVersion \in 0..2 /\ proof.replanned \in BOOLEAN
          /\ status \in {"none","proposed","following","withdrawn","settled","cancelled"}
SettlementAuthorized == safe => proof.real /\ proof.own /\ proof.fresh /\ proof.physical
SafetyDurable == everSafe => safe
NoSafeWitness == ~safe
NoReplanSafeWitness == ~(version = 2 /\ status = "settled" /\ safe
                        /\ proof.planVersion = 2 /\ proof.replanned)
NoWithdrawSafeWitness == ~(status = "withdrawn" /\ safe)
=============================================================================
