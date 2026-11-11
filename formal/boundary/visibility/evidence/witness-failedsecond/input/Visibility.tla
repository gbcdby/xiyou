------------------------------ MODULE Visibility -----------------------------
EXTENDS Naturals, FiniteSets, Sequences

CONSTANT Fault
NPCs == {"Tang", "Wukong"}
Originals == {"evidenceA", "privateB", "foreignS2", "humanPrivate"}
Observations == Originals \cup {"sharedA", "sharedB"}
Terminals == {"Committed","Rejected","Expired","Cancelled"}
OriginalAllowed(n,o) == (n = "Tang" /\ o = "evidenceA")
                         \/ (n = "Wukong" /\ o = "privateB")

VARIABLES known, shares, beliefSources, claims, context, chosenNPC,
          status, callback, handled, mode, epoch, generation, revision, now,
          recordedEpoch, recordedGeneration, recordedRevision,
          phase, terminalEffects, invalidCommit, unrelated,
          material, repaired, effects, outbox, receipt, speech, marker
vars == <<known,shares,beliefSources,claims,context,chosenNPC,status,callback,
                              handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,
                              invalidCommit,unrelated,material,repaired,effects,outbox,receipt,speech,marker>>

Allowed(n) == {o \in Originals : OriginalAllowed(n,o)}
                 \cup (IF n = "Wukong" /\ "sharedA" \in shares THEN {"sharedA"} ELSE {})
\* privateB 不可传播；sharedB 即使被错误写入，也不会获得合法资格。

Init == /\ known = [n \in NPCs |-> {}] /\ shares = {}
        /\ beliefSources = [n \in NPCs |-> {}] /\ claims = {}
        /\ context = {} /\ chosenNPC = "Tang"
        /\ status = "Idle" /\ callback = FALSE /\ handled = FALSE /\ mode = "none"
        /\ epoch = 0 /\ generation = 0 /\ revision = 0 /\ now = 0
        /\ recordedEpoch = 0 /\ recordedGeneration = 0 /\ recordedRevision = 0
        /\ phase = "Running" /\ terminalEffects = 0
        /\ invalidCommit = FALSE /\ unrelated = FALSE
        /\ material = 1 /\ repaired = 0 /\ effects = 0 /\ outbox = 0
        /\ receipt = "none" /\ speech = 0 /\ marker = "initial"

Observe(n,o) ==
    /\ o \notin known[n]
    /\ LET allowed == OriginalAllowed(n,o)
                         \/ (Fault = "observation_filter" /\ o = "privateB")
                         \/ (Fault = "session_filter" /\ o = "foreignS2")
                         \/ (Fault = "human_private" /\ o = "humanPrivate")
       IN /\ known' = IF allowed THEN [known EXCEPT ![n] = @ \cup {o}] ELSE known
          /\ marker' = IF allowed THEN "observed" ELSE "observation-rejected"
    /\ UNCHANGED <<shares,beliefSources,claims,context,chosenNPC,status,callback,
                              handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,
                              invalidCommit,unrelated,material,repaired,effects,outbox,receipt,speech>>

Share(n) ==
    /\ phase = "Running"
    /\ LET source == IF n = "Tang" THEN "evidenceA" ELSE "privateB"
           newId == IF n = "Tang" THEN "sharedA" ELSE "sharedB"
           receiver == IF n = "Tang" THEN "Wukong" ELSE "Tang"
           allowed == n = "Tang" \/ Fault = "share_private"
       IN /\ source \in known[n] /\ newId \notin shares
          /\ shares' = IF allowed THEN shares \cup {newId} ELSE shares
          /\ known' = IF allowed THEN [known EXCEPT ![receiver] = @ \cup {newId}] ELSE known
          /\ marker' = IF allowed THEN "legally-shared" ELSE "share-rejected"
    /\ UNCHANGED <<beliefSources,claims,context,chosenNPC,status,callback,
                              handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,
                              invalidCommit,unrelated,material,repaired,effects,outbox,receipt,speech>>

Believe(n,o) ==
    /\ phase = "Running"
    /\ beliefSources[n] = {}
    /\ LET allowed == o \in known[n] \/ Fault = "belief_source"
       IN /\ beliefSources' = IF allowed THEN [beliefSources EXCEPT ![n] = {o}] ELSE beliefSources
          /\ repaired' = IF allowed /\ Fault = "belief_fact" THEN 1 ELSE repaired
          /\ marker' = IF allowed THEN "belief-from-observation" ELSE "belief-rejected"
    /\ UNCHANGED <<known,shares,claims,context,chosenNPC,status,callback,
                              handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,
                              invalidCommit,unrelated,material,effects,outbox,receipt,speech>>

Claim(n) == /\ phase = "Running" /\ n \notin claims /\ claims' = claims \cup {n}
            /\ repaired' = IF Fault = "claim_fact" THEN 1 ELSE repaired
            /\ marker' = "claimed-repaired"
            /\ UNCHANGED <<known,shares,beliefSources,context,chosenNPC,status,callback,
                              handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,
                              invalidCommit,unrelated,material,effects,outbox,receipt,speech>>

Begin(n) == /\ status = "Idle" /\ phase = "Running" /\ known[n] # {}
            /\ chosenNPC' = n /\ status' = "Pending"
            /\ context' = IF Fault = "context_filter" THEN Originals ELSE known[n]
            /\ recordedEpoch' = epoch /\ recordedGeneration' = generation
            /\ recordedRevision' = revision /\ marker' = "decision-started"
            /\ UNCHANGED <<known,shares,beliefSources,claims,callback,handled,mode,
                              epoch,generation,revision,now,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>

Callback(m) == /\ status # "Idle" /\ ~callback
               /\ callback' = TRUE /\ mode' = m /\ marker' = "callback"
               /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              handled,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,
                              invalidCommit,unrelated,material,repaired,effects,outbox,receipt,speech>>

Fresh == status = "Pending" /\ epoch = recordedEpoch /\ generation = recordedGeneration
            /\ revision = recordedRevision /\ now < 2 /\ phase = "Running"
Fence == (status = "Pending" \/ (Fault = "cancelled" /\ status = "Cancelled"))
          /\ (epoch = recordedEpoch \/ Fault = "epoch")
          /\ (generation = recordedGeneration \/ Fault = "generation")
          /\ (revision = recordedRevision \/ Fault = "revision")
          /\ (now < 2 \/ Fault = "deadline")
          /\ (phase = "Running" \/ Fault = "terminal")

\* 工具一取得材料，工具二以候选状态修复；失败不得保存工具一或提前发对白。
Submit ==
    /\ callback /\ ~handled
    /\ LET firstValid == material = 1
           afterFirst == [material |-> 0, repaired |-> repaired, version |-> revision+1]
           secondValid == mode = "two-valid" /\ afterFirst.material = 0
                              /\ afterFirst.version = revision+1
           validTools == firstValid /\ secondValid
           accepted == Fence /\ validTools
           partial == Fence /\ firstValid /\ mode = "second-invalid" /\ Fault = "partial_tools"
           bypass == Fence /\ mode = "unauthorized" /\ Fault = "intent_fact"
           delta == IF accepted THEN 2 ELSE IF partial THEN 1 ELSE 0
       IN /\ effects' = effects + delta /\ outbox' = IF accepted THEN 2 ELSE 0
          /\ revision' = IF accepted THEN afterFirst.version+1
                             ELSE IF partial THEN afterFirst.version ELSE revision
          /\ material' = IF delta > 0 THEN 0 ELSE material
          /\ repaired' = IF accepted \/ bypass THEN 1 ELSE repaired
          /\ receipt' = IF accepted THEN "Accepted" ELSE "Rejected"
          /\ speech' = IF accepted \/ (Fence /\ Fault = "early_speech") THEN 1 ELSE 0
          /\ status' = IF accepted THEN "Committed"
                         ELSE IF status = "Pending" THEN "Rejected" ELSE status
          /\ invalidCommit' = (invalidCommit \/ (accepted /\ ~Fresh))
          /\ marker' = IF accepted THEN "two-tools-committed"
                         ELSE IF ~Fresh THEN "stale-rejected" ELSE "tools-rejected"
    /\ handled' = TRUE
    /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,callback,mode,
                              epoch,generation,now,recordedEpoch,recordedGeneration,
                              recordedRevision,phase,terminalEffects,unrelated>>

ChangeEpoch == /\ status = "Pending" /\ epoch = 0 /\ epoch' = 1 /\ marker' = "epoch-changed"
               /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
ChangeGeneration == /\ status = "Pending" /\ generation = 0 /\ generation' = 1
                    /\ marker' = "generation-changed"
                    /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,epoch,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
ChangeRelated == /\ status = "Pending" /\ revision = 0 /\ revision' = 1
                 /\ marker' = "related-changed"
                 /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,epoch,generation,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
ChangeUnrelated == /\ status = "Pending" /\ ~unrelated /\ unrelated' = TRUE
                   /\ marker' = "unrelated-changed"
                   /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              material,repaired,effects,outbox,receipt,speech>>
Tick == /\ status = "Pending" /\ now < 2 /\ now' = now+1 /\ marker' = "ticked"
        /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,epoch,generation,revision,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
Expire == /\ status = "Pending" /\ now = 2 /\ Fault # "no_timeout"
          /\ status' = "Expired" /\ marker' = "expired"
          /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,
                              callback,handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
Cancel == /\ status = "Pending" /\ status' = "Cancelled" /\ marker' = "cancelled"
          /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,
                              callback,handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
Finish(p) == /\ phase = "Running" /\ phase' = p /\ terminalEffects' = effects
             /\ marker' = "terminal"
             /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,epoch,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
TypeFault == /\ Fault = "type" /\ epoch = 0 /\ epoch' = 2
             /\ marker' = "out-of-domain"
             /\ UNCHANGED <<known,shares,beliefSources,claims,context,chosenNPC,status,
                              callback,handled,mode,generation,revision,now,recordedEpoch,
                              recordedGeneration,recordedRevision,phase,terminalEffects,invalidCommit,
                              unrelated,material,repaired,effects,outbox,receipt,speech>>
Done == /\ (status \in Terminals \/ (phase # "Running" /\ status = "Idle")) /\ UNCHANGED vars
Next == (\E n \in NPCs, o \in Originals: Observe(n,o))
        \/ (\E n \in NPCs: Share(n) \/ Claim(n) \/ Begin(n))
        \/ (\E n \in NPCs, o \in Observations: Believe(n,o))
        \/ (\E m \in {"two-valid","second-invalid","unauthorized","invalid-json"}: Callback(m))
        \/ Submit \/ ChangeEpoch \/ ChangeGeneration \/ ChangeRelated \/ ChangeUnrelated
        \/ Tick \/ Expire \/ Cancel \/ (\E p \in {"Finished","Aborted"}: Finish(p)) \/ TypeFault \/ Done
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(Tick) /\ WF_vars(Expire) /\ WF_vars(Submit)

TypeOK == /\ known \in [NPCs -> SUBSET Observations]
          /\ beliefSources \in [NPCs -> SUBSET Observations]
          /\ shares \subseteq {"sharedA","sharedB"} /\ claims \subseteq NPCs
          /\ context \subseteq Observations /\ chosenNPC \in NPCs
          /\ status \in {"Idle","Pending"} \cup Terminals
          /\ epoch \in 0..1 /\ generation \in 0..1 /\ revision \in 0..3 /\ now \in 0..2
          /\ recordedEpoch \in 0..1 /\ recordedGeneration \in 0..1 /\ recordedRevision \in 0..1
          /\ phase \in {"Running","Finished","Aborted"}
          /\ material \in 0..1 /\ repaired \in 0..1 /\ effects \in 0..2 /\ outbox \in 0..2
          /\ receipt \in {"none","Accepted","Rejected"} /\ speech \in 0..1
          /\ callback \in BOOLEAN /\ handled \in BOOLEAN /\ invalidCommit \in BOOLEAN
          /\ unrelated \in BOOLEAN /\ terminalEffects \in 0..2
NoUnauthorizedObservation ==
    /\ \A n \in NPCs: known[n] \subseteq Allowed(n) /\ beliefSources[n] \subseteq known[n]
    /\ context \subseteq known[chosenNPC]
IntentCannotWriteFact == /\ repaired = (IF effects = 2 THEN 1 ELSE 0)
                        /\ material = (IF effects > 0 THEN 0 ELSE 1)
AtomicCommitBundle ==
    (effects = 0 /\ outbox = 0 /\ receipt # "Accepted" /\ speech = 0)
      \/ (effects = 2 /\ outbox = 2 /\ receipt = "Accepted" /\ speech = 1 /\ status = "Committed")
FreshDecisionOnly == ~invalidCommit
TerminalBlocksNewEffects == phase # "Running" => effects = terminalEffects
DecisionResolvesOrExpires == (status = "Pending") ~> (status \in Terminals)

NotLegalShare == marker # "legally-shared"
NotPermissionRejection == marker # "observation-rejected"
NotTwoTools == status # "Committed"
NotFailedSecond == ~(handled /\ mode = "second-invalid" /\ status = "Rejected" /\ effects = 0)
NotLateRejection == marker # "stale-rejected"
NotUnrelatedSuccess == ~(status = "Committed" /\ unrelated)
NotFalseClaim == ~(claims # {} /\ repaired = 0)
=============================================================================
