-------------------------- MODULE BoundaryDeadlock --------------------------
EXTENDS Naturals, FiniteSets, Sequences

CONSTANT Fault
Sessions == {"S1", "S2"}
Requests == {"local1", "local2", "cross1", "cross2"}
TrustedSession(r) == IF r \in {"local1", "cross1"} THEN "S1" ELSE "S2"
TargetSession(r) == IF r \in {"local1", "cross2"} THEN "S1" ELSE "S2"

\* 两局均有同名 item；请求目标范围与认证绑定分开保存。
VARIABLES pending, prepared, writes, versions, result, marker
vars == <<pending, prepared, writes, versions, result, marker>>

Init == /\ pending = Requests
        /\ prepared = "none"
        /\ writes = {}
        /\ versions = [s \in Sessions |-> 0]
        /\ result = [r \in Requests |-> "Pending"]
        /\ marker = "initial"

Receive(r) == /\ prepared = "none" /\ r \in pending
              /\ prepared' = r /\ pending' = pending \ {r}
              /\ marker' = "received"
              /\ UNCHANGED <<writes, versions, result>>

Commit ==
    /\ prepared # "none"
    /\ LET r == prepared
           sameSession == TrustedSession(r) = TargetSession(r)
           allowed == sameSession \/ Fault = "unscoped_lookup"
       IN /\ writes' = IF allowed
                         THEN writes \cup {[request |-> r, authority |-> TrustedSession(r),
                                           target |-> TargetSession(r), localId |-> "item"]}
                         ELSE writes
          /\ versions' = IF allowed
                           THEN [versions EXCEPT ![TargetSession(r)] = @ + 1]
                           ELSE versions
          /\ result' = [result EXCEPT ![r] = IF allowed THEN "Accepted" ELSE "Rejected"]
          /\ marker' = IF sameSession THEN "legal-write" ELSE IF allowed THEN "cross-accepted" ELSE "cross-rejected"
    /\ prepared' = "none"
    /\ UNCHANGED pending

TypeFault == /\ Fault = "type" /\ versions["S1"] <= 4
             /\ versions' = [versions EXCEPT !["S1"] = 5]
             /\ marker' = "out-of-domain"
             /\ UNCHANGED <<pending, prepared, writes, result>>

Done == /\ pending = {} /\ prepared = "none" /\ UNCHANGED vars
Next == FALSE
Spec == Init /\ [][Next]_vars

TypeOK == /\ pending \subseteq Requests
          /\ prepared \in Requests \cup {"none"}
          /\ versions \in [Sessions -> 0..4]
          /\ result \in [Requests -> {"Pending", "Accepted", "Rejected"}]
          /\ writes \subseteq [request : Requests, authority : Sessions,
                                target : Sessions, localId : {"item"}]
SessionIsolation == \A w \in writes : w.authority = w.target
NotBothSessionsWritten == ~(result["local1"] = "Accepted" /\ result["local2"] = "Accepted")
NotCrossRejected == ~(result["cross1"] = "Rejected" /\ result["cross2"] = "Rejected")
=============================================================================
