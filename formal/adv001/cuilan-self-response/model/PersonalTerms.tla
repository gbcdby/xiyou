---------------------------- MODULE PersonalTerms ----------------------------
EXTENDS Naturals, FiniteSets
(* CS-R2 §11.2–11.3/13/14：permissionTerm 是不可变请求输入。
   合法询问与可执行grant分开；独立authority守卫面对错误内部accept仍须拒绝。
   旁观者恒定在场，模型没有让其离开/改变控制模式的动作或公平性。
   此模型只检查term增量，通用原Receipt/Unknown沿用既有组件证据。 *)
CONSTANTS InitialSettled, FirstTerm, CorruptPurpose, Fault, Probe
Ids == 1..4
Purposes == {"private_items","appearance"}
Terms == {"single_use","reusable"}
Purpose(i) == IF i<=2 THEN "private_items" ELSE "appearance"
Old(i) == IF i<=2 THEN 1 ELSE 3
Term(i) == IF i \in {1,3} THEN FirstTerm ELSE "single_use"
VARIABLES r, current, revision, settled, e
vars == <<r,current,revision,settled,e>>
Record(i) == [exists|->i=1 \/ (i=3 /\ InitialSettled),term|->Term(i),originalTerm|->Term(i),
 status|->IF i \in {1,3} /\ Purpose(i)=CorruptPurpose THEN "accepted"
          ELSE IF i=1 \/ (i=3 /\ InitialSettled) THEN "proposed" ELSE "absent",
 ownerAction|->i \in {1,3} /\ Purpose(i)=CorruptPurpose,
 grant|->i \in {1,3} /\ Purpose(i)=CorruptPurpose,
 phase|->"none",basisTerm|->"none",choice|->"none",
 proofTerm|->"none",newPhase|->"none",expectedPublic|->0,forged|->FALSE,used|->FALSE]
Init ==
 /\ r=[i \in Ids|->Record(i)]
 /\ current=[p \in Purposes|->IF p="private_items" THEN 1 ELSE 3]
 /\ revision=2 /\ settled=InitialSettled
 /\ e=[badScope|->FALSE,oldChanged|->FALSE,blockedInternalAccept|->FALSE,bystanderPresent|->TRUE,illegalUse|->FALSE]
Policy(i) == IF ~settled /\ Purpose(i)="private_items" THEN "deferred"
             ELSE IF r[i].term="reusable" THEN "declined" ELSE "accepted"
Prepare(i) ==
 /\ r[i].exists /\ r[i].status="proposed" /\ r[i].phase="none"
 /\ r'=[r EXCEPT ![i].phase="ready",![i].basisTerm=r[i].term,![i].choice=Policy(i)]
 /\ UNCHANGED <<current,revision,settled,e>>
Commit(i,wireTerm) ==
 /\ r[i].phase="ready"
 /\ LET binding==current[Purpose(i)]=i /\ r[i].status="proposed"
           /\ wireTerm=r[i].term /\ r[i].basisTerm=r[i].term /\ r[i].choice=Policy(i)
        ok==binding \/ (Fault="drop-term-basis" /\ current[Purpose(i)]=i /\ r[i].status="proposed")
        accept==r[i].choice="accepted" /\ r[i].term="single_use"
    IN /\ r'=[r EXCEPT ![i].phase="done",![i].status=IF ok THEN r[i].choice ELSE @,
             ![i].ownerAction=IF ok THEN TRUE ELSE @,![i].grant=IF ok THEN accept ELSE @,
             ![i].proofTerm=IF ok /\ accept THEN wireTerm ELSE @]
       /\ revision'=IF ok THEN revision+1 ELSE revision
       /\ e'=[e EXCEPT !.badScope=@ \/ (ok /\ ~binding)]
 /\ UNCHANGED <<current,settled>>
PrepareNew(i) ==
 /\ i \in {2,4} /\ ~r[i].exists /\ r[i].newPhase="none"
 /\ r[Old(i)].status \in {"declined","deferred"}
 /\ r'=[r EXCEPT ![i].newPhase="ready",![i].expectedPublic=revision]
 /\ UNCHANGED <<current,revision,settled,e>>
CommitNew(i) ==
 /\ i \in {2,4} /\ r[i].newPhase="ready"
 /\ LET ok==r[i].expectedPublic=revision
    IN /\ r'=[r EXCEPT ![i].newPhase=IF ok THEN "done" ELSE "refresh",
                 ![i].exists=ok,![i].status=IF ok THEN "proposed" ELSE @]
       /\ current'=IF ok THEN [current EXCEPT ![Purpose(i)]=i] ELSE current
       /\ revision'=IF ok THEN revision+1 ELSE revision
 /\ UNCHANGED <<settled,e>>
RefreshNew(i) ==
 /\ i \in {2,4} /\ r[i].newPhase="refresh"
 /\ r'=[r EXCEPT ![i].newPhase="ready",![i].expectedPublic=revision]
 /\ UNCHANGED <<current,revision,settled,e>>
InternalAccept(i) ==
 /\ r[i].exists /\ r[i].status="proposed" /\ r[i].term="reusable" /\ ~r[i].forged
 /\ r'=[r EXCEPT ![i].forged=TRUE,![i].grant=Fault="generic-grant"]
 /\ e'=[e EXCEPT !.blockedInternalAccept=@ \/ Fault#"generic-grant"]
 /\ UNCHANGED <<current,revision,settled>>
MutateOldScope ==
 /\ Fault="edit-old-scope" /\ r[1].term="reusable"
 /\ r'=[r EXCEPT ![1].term="single_use"]
 /\ e'=[e EXCEPT !.oldChanged=TRUE]
 /\ UNCHANGED <<current,revision,settled>>
SchemaDecline(i) ==
 /\ Fault="schema-declines" /\ r[i].status="proposed"
 /\ r'=[r EXCEPT ![i].status="declined"]
 /\ UNCHANGED <<current,revision,settled,e>>
Settle == /\ ~settled /\ settled'=TRUE /\ UNCHANGED <<r,current,revision,e>>
CreateAppearance ==
 /\ settled /\ ~r[3].exists
 /\ r'=[r EXCEPT ![3].exists=TRUE,![3].status="proposed"]
 /\ revision'=revision+1
 /\ UNCHANGED <<current,settled,e>>
Use(i) ==
 /\ r[i].grant /\ r[i].status="accepted" /\ ~r[i].used
 /\ (r[i].term="single_use" \/ Fault="skip-use-term")
 /\ r'=[r EXCEPT ![i].used=TRUE]
 /\ e'=[e EXCEPT !.illegalUse=@ \/ r[i].term#"single_use"]
 /\ UNCHANGED <<current,revision,settled>>
TypeFault == /\ Fault="type" /\ revision'=99 /\ UNCHANGED <<r,current,settled,e>>
Work == (\E i \in Ids: Prepare(i) \/ InternalAccept(i) \/ SchemaDecline(i) \/ Use(i) \/
             (\E term \in Terms: Commit(i,term)))
      \/ (\E i \in {2,4}: PrepareNew(i) \/ CommitNew(i) \/ RefreshNew(i))
      \/ Settle \/ CreateAppearance \/ MutateOldScope
Idle == /\ ~ENABLED Work /\ UNCHANGED vars
Next == Work \/ TypeFault \/ Idle
Spec == Init /\ [][Next]_vars
TypeOK == /\ revision \in 2..9 /\ \A i \in Ids: r[i].term \in Terms
ScopeTermImmutable == \A i \in Ids: r[i].term=r[i].originalTerm
NoReusableGrant == \A i \in Ids: r[i].grant => r[i].term="single_use"
StrictTermBasis == ~e.badScope
OnlyOwnerDeclines == \A i \in Ids: r[i].status="declined" => r[i].ownerAction
NoReusableUse == ~e.illegalUse
NoWitness == CASE Probe="both-remedies" ->
       ~(r[1].status="declined" /\ r[3].status="declined" /\ r[2].grant /\ r[4].grant /\ e.bystanderPresent)
 [] Probe="private-deferred" -> ~(r[1].status="deferred")
 [] Probe="authority-rejected" -> ~e.blockedInternalAccept
 [] Probe="single-use-permitted" -> ~(r[2].used /\ r[4].used)
 [] OTHER -> TRUE
=============================================================================
