---------------------------- MODULE PersonalCAS ----------------------------
EXTENDS Naturals, FiniteSets
(* CS-R1 §12.2：两真人读同一公开版本，各至多两个明确提交；
   第二次提交代表刷新后再次明确操作，不是自动变更原请求。 *)
CONSTANTS SamePurpose, Fault, Probe
Players == {"p1", "p2"}
Purposes == {"appearance", "private_items"}
Purpose(p) == IF SamePurpose \/ p="p1" THEN "appearance" ELSE "private_items"
Ids == Players \X (1..2)
VARIABLES revision, slot, phase, attempt, basis, receipts, commits, audit
vars == <<revision, slot, phase, attempt, basis, receipts, commits, audit>>
Init ==
 /\ revision=0
 /\ slot=[p \in Purposes |-> "none"]
 /\ phase=[p \in Players |-> "read"]
 /\ attempt=[p \in Players |-> 1]
 /\ basis=[p \in Players |-> 0]
 /\ receipts=[i \in Ids |-> "none"]
 /\ commits={}
 /\ audit=[overwrite|->FALSE, refreshed|->FALSE, concurrent|->FALSE]
Read(p) ==
 /\ phase[p]="read"
 /\ basis'=[basis EXCEPT ![p]=revision]
 /\ phase'=[phase EXCEPT ![p]="submit"]
 /\ audit'=[audit EXCEPT !.concurrent=@ \/
      (\E q \in Players: q#p /\ phase[q]="submit" /\ basis[q]=revision)]
 /\ UNCHANGED <<revision,slot,attempt,receipts,commits>>
Submit(p) ==
 /\ phase[p]="submit"
 /\ LET fresh==basis[p]=revision \/ Fault="skip-cas"
        vacant==slot[Purpose(p)]="none" \/ Fault="overwrite"
        ok==fresh /\ vacant
    IN /\ revision'=IF ok THEN revision+1 ELSE revision
       /\ slot'=IF ok THEN [slot EXCEPT ![Purpose(p)]=p] ELSE slot
       /\ receipts'=[receipts EXCEPT ![<<p,attempt[p]>>]=IF ok THEN "Accepted" ELSE "Rejected"]
       /\ commits'=IF ok THEN commits \cup {<<p,attempt[p],basis[p]>>} ELSE commits
       /\ audit'=[audit EXCEPT !.overwrite=@ \/
              (ok /\ slot[Purpose(p)]#"none" /\ slot[Purpose(p)]#p)]
 /\ phase'=[phase EXCEPT ![p]="done"]
 /\ UNCHANGED <<attempt,basis>>
Refresh(p) ==
 /\ phase[p]="done" /\ attempt[p]=1
 /\ receipts[<<p,1>>]="Rejected"
 /\ attempt'=[attempt EXCEPT ![p]=2]
 /\ phase'=[phase EXCEPT ![p]="read"]
 /\ audit'=[audit EXCEPT !.refreshed=TRUE]
 /\ UNCHANGED <<revision,slot,basis,receipts,commits>>
TypeFault ==
 /\ Fault="type" /\ revision=0
 /\ revision'=5
 /\ UNCHANGED <<slot,phase,attempt,basis,receipts,commits,audit>>
Quiescent == /\ \A p \in Players: phase[p]="done"
             /\ UNCHANGED vars
Next == (\E p \in Players: Read(p) \/ Submit(p) \/ Refresh(p)) \/ TypeFault \/ Quiescent
Spec == Init /\ [][Next]_vars
TypeOK == /\ revision \in 0..4 /\ slot \in [Purposes -> Players \cup {"none"}]
          /\ phase \in [Players -> {"read","submit","done"}]
          /\ attempt \in [Players -> 1..2]
          /\ receipts \in [Ids -> {"none","Accepted","Rejected"}]
SingleCommitPerPublicRevision == \A v \in 0..4:
   Cardinality({c \in commits: c[3]=v})<=1
NoThirdPartyOverwrite == ~audit.overwrite
NoWitness == CASE Probe="concurrent" -> ~audit.concurrent
              [] Probe="both-purposes" -> ~(\A p \in Purposes: slot[p]#"none")
              [] OTHER -> TRUE
=============================================================================
