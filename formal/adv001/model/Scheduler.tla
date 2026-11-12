--------------------------- MODULE Scheduler ---------------------------
EXTENDS Naturals, FiniteSets, Sequences
CONSTANT Fault, Budget
VARIABLES cursor, active, served, outcomes
vars == <<cursor, active, served, outcomes>>
Actors == {"tang","wukong","bajie"}
Order == <<"tang","wukong","bajie">>
Results == {"ok","timeout","invalid"}
Init == /\ cursor = 1 /\ active = {} /\ served = {}
        /\ outcomes = [a \in Actors |-> "pending"]
Candidate == IF Fault = "starve" THEN "tang" ELSE Order[cursor]
Dispatch ==
  /\ Candidate \notin active
  /\ (Cardinality(active) < Budget \/ Fault = "overbook")
  /\ active' = active \cup {Candidate}
  /\ cursor' = IF cursor = 3 THEN 1 ELSE cursor + 1
  /\ UNCHANGED <<served,outcomes>>
Settle(a,r) ==
  /\ a \in active /\ active' = active \ {a} /\ served' = served \cup {a}
  /\ r \in Results /\ outcomes' = [outcomes EXCEPT ![a] = r]
  /\ UNCHANGED cursor
SettleAny(a) == \E r \in Results: Settle(a,r)
BreakType ==
  /\ Fault = "type" /\ cursor = 1 /\ cursor' = 4
  /\ UNCHANGED <<active,served,outcomes>>
Next == Dispatch \/ (\E a \in Actors: SettleAny(a)) \/ BreakType
Spec == Init /\ [][Next]_vars /\ WF_vars(Dispatch) /\ (\A a \in Actors: WF_vars(SettleAny(a)))
TypeOK == cursor \in 1..3 /\ active \subseteq Actors /\ served \subseteq Actors
          /\ outcomes \in [Actors -> (Results \cup {"pending"})]
BudgetRespected == Cardinality(active) <= Budget
NoStarvation == \A a \in Actors: <>(a \in served)
NoAllServedWitness == served # Actors
=============================================================================
