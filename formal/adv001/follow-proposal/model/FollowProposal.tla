----------------------- MODULE FollowProposal -----------------------
EXTENDS Naturals, Integers, FiniteSets, Sequences
CONSTANTS Scenario, LegacyFirst, Fault
VARIABLES revision, consentVersion, requester, leader, destination, planStatus,
          epochs, views, rotated, context, contextChanged, semantic, moved,
          captured, knownLegacy, receipts, attempts, effectsCount, effects,
          clientResult, audit, variantChoice, environmentUsed
vars == <<revision, consentVersion, requester, leader, destination, planStatus,
          epochs, views, rotated, context, contextChanged, semantic, moved,
          captured, knownLegacy, receipts, attempts, effectsCount, effects,
          clientResult, audit, variantChoice, environmentUsed>>

Actors == {"old", "new"}
Nonces == 1..2
Keys == Actors \X Nonces
None == [absent |-> TRUE]
Other(p) == IF p = "old" THEN "new" ELSE "old"
Focus == IF LegacyFirst THEN "old" ELSE "new"
Active == IF Scenario = "identity" THEN {Focus} ELSE Actors
Mode(p) == IF LegacyFirst /\ p = "old" THEN "legacy" ELSE "public"
Contexts == {"valid", "no-member", "no-auth", "no-control", "finished",
             "far-subject", "far-leader", "occluded", "closed-door",
             "offline-leader", "no-capability"}
Variants == IF Scenario = "competition" THEN {"original"}
            ELSE {"original", "destination", "leader", "subject", "observer",
                  "view", "epoch", "future-base", "both", "missing",
                  "other-action", "other-session", "expected-version", "invalid-destination"}
CallLimit == IF Scenario = "competition" THEN 3 ELSE 2
TotalCalls == attempts[<<"old",1>>] + attempts[<<"old",2>>]
              + attempts[<<"new",1>>] + attempts[<<"new",2>>]
Codes == {"none", "Unknown", "Accepted", "STALE_CONTROL", "STALE_REFERENCE",
          "FUTURE_BASE_SEQ", "SCOPE_REJECTED", "STALE_PRECONDITION",
          "CONSENT_STALE", "ACTION_ID_REUSE", "FORBIDDEN", "INVALID_MESSAGE",
          "OTHER_ACTION"}
Permitted(p) == p \in {requester, leader}
PrivateRecord == [version |-> consentVersion, requester |-> requester,
                  leader |-> leader, destination |-> destination]
\* 只抽象当前槽记录在真实投影中的子集；旧的已授权历史不是空数组断言对象。
CurrentProjection(p) ==
  [resourceRevision |-> revision,
   consents |-> IF Permitted(p) \/ Fault = "leak-private" THEN {PrivateRecord} ELSE {},
   follows |-> IF Permitted(p) \/ Fault = "leak-private" THEN {PrivateRecord} ELSE {}]
AllCaptured == \A p \in Active: captured[p] # None
Raw(p, n) ==
  [session |-> "local", owner |-> p, nonce |-> n, kind |-> "follow",
   view |-> views[p], epoch |-> epochs[p], observer |-> p, refView |-> views[p],
   subject |-> "real", leader |-> p, destination |-> "tea", futureBase |-> FALSE,
   shape |-> Mode(p),
   expectedPublic |-> IF Mode(p) = "public" THEN CurrentProjection(p).resourceRevision ELSE 0,
   expectedConsent |-> IF Mode(p) = "legacy" THEN knownLegacy[p] ELSE 0]
Mutate(r, v) ==
  CASE v = "destination" -> [r EXCEPT !.destination = "front"]
    [] v = "leader" -> [r EXCEPT !.leader = Other(r.leader)]
    [] v = "subject" -> [r EXCEPT !.subject = "other"]
    [] v = "observer" -> [r EXCEPT !.observer = Other(r.observer)]
    [] v = "view" -> [r EXCEPT !.view = 1 - @]
    [] v = "epoch" -> [r EXCEPT !.epoch = 1 - @]
    [] v = "future-base" -> [r EXCEPT !.futureBase = TRUE]
    [] v = "both" -> [r EXCEPT !.shape = "both"]
    [] v = "missing" -> [r EXCEPT !.shape = "missing"]
    [] v = "other-action" -> [r EXCEPT !.kind = "other"]
    [] v = "other-session" -> [r EXCEPT !.session = "other"]
    [] v = "expected-version" -> IF r.shape = "public"
                                  THEN [r EXCEPT !.expectedPublic = @ + 1]
                                  ELSE [r EXCEPT !.expectedConsent = @ + 1]
    [] v = "invalid-destination" -> [r EXCEPT !.destination = "invalid"]
    [] OTHER -> r
ShapeOK(r) == r.shape \in {"public", "legacy"}
AccessOK(r) == r.session = "local" /\ context \notin {"no-member", "no-auth"}
FrameCode(p, r) ==
  CASE r.epoch # epochs[p] \/ context = "no-control" -> "STALE_CONTROL"
    [] context = "finished" -> "SCOPE_REJECTED"
    [] r.futureBase -> "FUTURE_BASE_SEQ"
    [] r.owner # p \/ r.view # views[p] \/ r.observer # p
       \/ r.refView # r.view -> "STALE_REFERENCE"
    [] r.kind # "follow" -> "OTHER_ACTION"
    [] r.subject # "real" \/ r.destination \notin {"front","tea"}
       \/ context \in {"far-subject", "far-leader",
         "occluded", "closed-door", "offline-leader", "no-capability"}
       -> "SCOPE_REJECTED"
    [] OTHER -> "OK"
EffectiveFrame(p, r) == IF Fault = "skip-scope" THEN "OK" ELSE FrameCode(p, r)
PublicFresh(r) == r.expectedPublic = revision
LegacyFresh(r) == r.expectedConsent = consentVersion
FirstDecision(p, r) ==
  IF EffectiveFrame(p, r) # "OK" THEN EffectiveFrame(p, r)
  ELSE IF r.shape = "legacy"
    THEN IF LegacyFresh(r) \/ Fault = "skip-legacy-version" THEN "APPLY" ELSE "CONSENT_STALE"
    ELSE IF Fault = "private-fallback"
      THEN IF r.expectedConsent = consentVersion THEN "APPLY" ELSE "CONSENT_STALE"
      ELSE IF PublicFresh(r) \/ Fault = "skip-public-version" THEN "APPLY" ELSE "STALE_PRECONDITION"
BlankAudit ==
 [present |-> FALSE, schemaOK |-> TRUE, accessOK |-> TRUE, ownPrior |-> FALSE,
  sameOwn |-> FALSE, owner |-> "old", receiptOwner |-> "old", fromReceipt |-> FALSE,
  code |-> "none", priorCode |-> "none", priorEffect |-> 0, returnedEffect |-> 0,
  delta |-> 0, priorStable |-> TRUE, receiptAdded |-> FALSE,
  public |-> FALSE, fresh |-> FALSE, scopeOK |-> FALSE,
  staleControl |-> FALSE, wasUnknown |-> FALSE, moved |-> FALSE]

Init ==
 /\ revision = IF Fault = "type" THEN -1 ELSE 0
 /\ consentVersion = 2 /\ requester = "old" /\ leader = "old"
 /\ destination = "front" /\ planStatus = "paused"
 /\ epochs = [p \in Actors |-> 0] /\ views = [p \in Actors |-> 0]
 /\ rotated = {} /\ context = "valid" /\ contextChanged = FALSE
 /\ semantic = "none" /\ moved = FALSE
 /\ captured = [p \in Actors |-> None]
 /\ knownLegacy = [p \in Actors |-> IF p = "old" THEN 2 ELSE 0]
 /\ receipts = [k \in Keys |-> None] /\ attempts = [k \in Keys |-> 0]
 /\ effectsCount = [k \in Keys |-> 0] /\ effects = <<>>
 /\ clientResult = [k \in Keys |-> "none"] /\ audit = BlankAudit
 /\ variantChoice \in Variants
 /\ environmentUsed = FALSE

\* 读取当前公开人物参数与提交分开；legacy 只记自己已知的私有版本。
Capture(p) ==
 /\ p \in Active /\ captured[p] = None
 /\ captured' = [captured EXCEPT ![p] =
      [raw |-> Raw(p, 1), baseline |-> revision,
       sawPrivate |-> CurrentProjection(p).consents # {}]]
 /\ UNCHANGED <<revision, consentVersion, requester, leader, destination, planStatus,
                epochs, views, rotated, context, contextChanged, semantic, moved,
                knownLegacy, receipts, attempts, effectsCount, effects, clientResult, audit, variantChoice, environmentUsed>>

\* 回应/撤回是可信本人既有入口；本模型不重建其许可或到达算法。
SubjectChange(choice) ==
 /\ choice \in {"respond", "withdraw"} /\ semantic = "none"
 /\ (Scenario = "competition" \/ ~environmentUsed)
 /\ environmentUsed' = IF Scenario = "identity" THEN TRUE ELSE environmentUsed
 /\ semantic' = choice /\ revision' = revision + 1 /\ consentVersion' = consentVersion + 1
 /\ planStatus' = IF choice = "respond" THEN "accepted" ELSE "withdrawn"
 /\ knownLegacy' = [p \in Actors |-> IF Permitted(p) THEN consentVersion + 1 ELSE knownLegacy[p]]
 /\ UNCHANGED <<requester, leader, destination, epochs, views, rotated, context,
                contextChanged, moved, captured, receipts, attempts, effectsCount,
                effects, clientResult, audit, variantChoice>>

Move ==
 /\ ~moved /\ moved' = TRUE
 /\ (Scenario = "competition" \/ ~environmentUsed)
 /\ environmentUsed' = IF Scenario = "identity" THEN TRUE ELSE environmentUsed
 /\ revision' = IF Fault = "move-bump" THEN revision + 1 ELSE revision
 /\ UNCHANGED <<consentVersion, requester, leader, destination, planStatus,
                epochs, views, rotated, context, contextChanged, semantic,
                captured, knownLegacy, receipts, attempts, effectsCount, effects,
                clientResult, audit, variantChoice>>

Rotate(p, kind) ==
 /\ Scenario = "identity" /\ ~environmentUsed /\ AllCaptured /\ p = Focus
 /\ kind \in {"epoch", "view", "both"}
 /\ environmentUsed' = TRUE
 /\ rotated' = rotated \cup (IF kind = "both" THEN {<<p,"epoch">>,<<p,"view">>} ELSE {<<p,kind>>})
 /\ epochs' = IF kind \in {"epoch","both"} THEN [epochs EXCEPT ![p] = 1] ELSE epochs
 /\ views' = IF kind \in {"view","both"} THEN [views EXCEPT ![p] = 1] ELSE views
 /\ UNCHANGED <<revision, consentVersion, requester, leader, destination, planStatus,
                context, contextChanged, semantic, moved, captured, knownLegacy,
                receipts, attempts, effectsCount, effects, clientResult, audit, variantChoice>>
ChangeContext(c) ==
 /\ Scenario = "identity" /\ ~environmentUsed
 /\ AllCaptured /\ ~contextChanged /\ c \in Contexts \ {"valid"}
 /\ environmentUsed' = TRUE
 /\ context' = c /\ contextChanged' = TRUE
 /\ UNCHANGED <<revision, consentVersion, requester, leader, destination, planStatus,
                epochs, views, rotated, semantic, moved, captured, knownLegacy,
                receipts, attempts, effectsCount, effects, clientResult, audit, variantChoice>>

\* 同一 Session 锁内：原 Receipt、规则、效果及 Receipt 保存不可拆开。
\* 接收确认在事务之外，可丢失；已保存的拒绝也是稳定原结果。
Submit(source, p, n, variant, lost) ==
 /\ source \in Active /\ captured[source] # None /\ p \in Actors /\ n \in Nonces
 /\ (Scenario # "competition" \/ p = source)
 /\ variant \in {"original", variantChoice} /\ lost \in BOOLEAN
 /\ TotalCalls < CallLimit
 /\ attempts[<<p,n>>] < 2
 /\ LET k == <<p,n>>
        r == [Mutate(captured[source].raw, variant) EXCEPT !.nonce = n]
        actualPrior == receipts[k]
        lookupOwner == IF Fault = "global-receipt-key" /\ receipts[<<Other(p),n>>] # None
                       THEN Other(p) ELSE p
        prior == receipts[<<lookupOwner,n>>]
        parseOK == ShapeOK(r) \/ Fault = "open-schema"
        decision ==
          IF ~parseOK THEN "INVALID_MESSAGE"
          ELSE IF ~AccessOK(r) THEN "FORBIDDEN"
          ELSE IF prior # None
            THEN IF Fault = "guard-before-receipt" /\ FrameCode(p,r) # "OK"
                   THEN FrameCode(p,r)
                 ELSE IF prior.raw = r \/ Fault = "ignore-digest"
                   THEN IF Fault = "reexecute-known" /\ prior.code = "Accepted"
                          THEN "APPLY" ELSE "REPLAY"
                 ELSE "ACTION_ID_REUSE"
          ELSE FirstDecision(p,r)
        apply == decision = "APPLY"
        replay == decision = "REPLAY"
        outcome == IF apply THEN "Accepted" ELSE IF replay THEN prior.code ELSE decision
        effectId == IF apply THEN Len(effects) + 1 ELSE IF replay THEN prior.effect ELSE 0
        added == parseOK /\ AccessOK(r) /\ prior = None
        afterReceipts == IF added THEN [receipts EXCEPT ![k] = [raw |-> r, code |-> outcome, effect |-> effectId]]
                         ELSE receipts
        bumped == ~(Fault = "no-public-bump" /\ r.shape # "legacy")
                  /\ ~(Fault = "no-legacy-bump" /\ r.shape = "legacy")
        createdStatus == IF Fault = "auto-accept" THEN "following" ELSE "proposed"
    IN
    /\ attempts' = [attempts EXCEPT ![k] = @ + 1]
    /\ receipts' = afterReceipts
    /\ revision' = IF apply /\ bumped THEN revision + 1 ELSE revision
    /\ consentVersion' = IF apply THEN consentVersion + 1 ELSE consentVersion
    /\ requester' = IF apply THEN p ELSE requester
    /\ leader' = IF apply THEN r.leader ELSE leader
    /\ destination' = IF apply THEN r.destination ELSE destination
    /\ planStatus' = IF apply THEN createdStatus ELSE planStatus
    /\ knownLegacy' = IF apply
         THEN [who \in Actors |-> IF who \in {p, r.leader} THEN consentVersion + 1 ELSE knownLegacy[who]]
         ELSE knownLegacy
    /\ effectsCount' = IF apply THEN [effectsCount EXCEPT ![k] = @ + 1] ELSE effectsCount
    /\ effects' = IF apply THEN Append(effects,
         [key |-> k, owner |-> p, shape |-> r.shape, publicRevisionBefore |-> revision,
          publicFresh |-> PublicFresh(r), legacyFresh |-> LegacyFresh(r),
          authorized |-> AccessOK(r) /\ FrameCode(p,r) = "OK",
          schemaOK |-> ShapeOK(r), createdStatus |-> createdStatus,
          sawPrivate |-> captured[source].sawPrivate])
         ELSE effects
    /\ clientResult' = [clientResult EXCEPT ![k] = IF lost THEN "Unknown" ELSE outcome]
    /\ audit' =
       [present |-> TRUE, schemaOK |-> ShapeOK(r), accessOK |-> AccessOK(r),
        ownPrior |-> actualPrior # None,
        sameOwn |-> IF actualPrior # None THEN actualPrior.raw = r ELSE FALSE,
        owner |-> p, receiptOwner |-> lookupOwner, fromReceipt |-> replay,
        code |-> outcome, priorCode |-> IF actualPrior # None THEN actualPrior.code ELSE "none",
        priorEffect |-> IF actualPrior # None THEN actualPrior.effect ELSE 0,
        returnedEffect |-> effectId, delta |-> IF apply THEN 1 ELSE 0,
        priorStable |-> afterReceipts[k] = actualPrior, receiptAdded |-> added,
        public |-> r.shape = "public", fresh |-> PublicFresh(r),
        scopeOK |-> FrameCode(p,r) = "OK",
        staleControl |-> r.epoch # epochs[p] \/ r.view # views[p],
        wasUnknown |-> clientResult[k] = "Unknown", moved |-> moved]
    /\ UNCHANGED <<epochs, views, rotated, context, contextChanged, semantic, moved, captured, variantChoice, environmentUsed>>

Done == AllCaptured /\ TotalCalls = CallLimit /\ UNCHANGED vars
Next == (\E p \in Active: Capture(p))
     \/ (\E choice \in {"respond", "withdraw"}: SubjectChange(choice))
     \/ Move
     \/ (\E p \in Actors, kind \in {"epoch", "view", "both"}: Rotate(p,kind))
     \/ (\E c \in Contexts \ {"valid"}: ChangeContext(c))
     \/ (\E source \in Active, p \in Actors, n \in Nonces,
             variant \in Variants, lost \in BOOLEAN: Submit(source,p,n,variant,lost))
     \/ Done
Spec == Init /\ [][Next]_vars

TypeOK ==
 /\ revision \in 0..9 /\ consentVersion \in 2..11
 /\ requester \in Actors /\ leader \in Actors /\ destination \in {"front","tea"}
 /\ planStatus \in {"paused","proposed","accepted","withdrawn","following"}
 /\ epochs \in [Actors -> 0..1] /\ views \in [Actors -> 0..1]
 /\ rotated \subseteq Actors \X {"epoch","view"}
 /\ context \in Contexts /\ contextChanged \in BOOLEAN
 /\ semantic \in {"none","respond","withdraw"} /\ moved \in BOOLEAN
 /\ DOMAIN captured = Actors /\ knownLegacy \in [Actors -> 0..11]
 /\ DOMAIN receipts = Keys /\ attempts \in [Keys -> 0..2]
 /\ effectsCount \in [Keys -> 0..2] /\ Len(effects) <= 8
 /\ clientResult \in [Keys -> Codes]
 /\ audit.code \in Codes /\ audit.delta \in 0..1
 /\ variantChoice \in Variants /\ TotalCalls \in 0..CallLimit
 /\ environmentUsed \in BOOLEAN
PublicProposalAvailable ==
 audit.present /\ audit.schemaOK /\ audit.accessOK /\ ~audit.ownPrior
 /\ audit.public /\ audit.scopeOK /\ audit.fresh => audit.code = "Accepted"
VersionFenced ==
 \A i \in 1..Len(effects):
   IF effects[i].shape = "legacy" THEN effects[i].legacyFresh ELSE effects[i].publicFresh
RevisionAccounting ==
 revision = Len(effects) + (IF semantic = "none" THEN 0 ELSE 1)
 /\ consentVersion = 2 + Len(effects) + (IF semantic = "none" THEN 0 ELSE 1)
SingleBaselineCommit ==
 \A i,j \in 1..Len(effects): effects[i].publicRevisionBefore = effects[j].publicRevisionBefore => i = j
AtMostOnce == \A k \in Keys: effectsCount[k] <= 1
ReceiptStable ==
 audit.present /\ audit.schemaOK /\ audit.accessOK /\ audit.ownPrior /\ audit.sameOwn =>
 audit.code = audit.priorCode /\ audit.returnedEffect = audit.priorEffect
 /\ audit.delta = 0 /\ audit.priorStable
NonceDigestBound ==
 audit.present /\ audit.schemaOK /\ audit.accessOK /\ audit.ownPrior /\ ~audit.sameOwn =>
 audit.code = "ACTION_ID_REUSE" /\ audit.delta = 0 /\ audit.priorStable
ReceiptOwnerScoped == audit.fromReceipt => audit.receiptOwner = audit.owner
ScopeAuthorized == \A i \in 1..Len(effects): effects[i].authorized
SchemaExclusive ==
 audit.present /\ ~audit.schemaOK =>
 audit.code = "INVALID_MESSAGE" /\ audit.delta = 0 /\ ~audit.receiptAdded
ConsentPrivate ==
 \A p \in Actors: ~Permitted(p) => CurrentProjection(p).consents = {} /\ CurrentProjection(p).follows = {}
ProposalOnly == \A i \in 1..Len(effects): effects[i].createdStatus = "proposed"

NoNewLeaderWitness ==
 ~(\E i \in 1..Len(effects): effects[i].owner = "new"
     /\ effects[i].shape = "public" /\ ~effects[i].sawPrivate)
NoReplayAfterRotateWitness ==
 ~(audit.present /\ audit.ownPrior /\ audit.sameOwn /\ audit.staleControl
   /\ audit.code = "Accepted" /\ audit.delta = 0)
NoUnknownReplayWitness ==
 ~(audit.present /\ audit.ownPrior /\ audit.sameOwn /\ audit.wasUnknown
   /\ audit.code = "Accepted" /\ audit.delta = 0)
NoCompetitionWitness ==
 ~(captured["old"] # None /\ captured["new"] # None
   /\ captured["old"].baseline = captured["new"].baseline
   /\ receipts[<<"old",1>>] # None /\ receipts[<<"new",1>>] # None
   /\ {receipts[<<"old",1>>].code,receipts[<<"new",1>>].code}
       \in {{"Accepted","STALE_PRECONDITION"},{"Accepted","CONSENT_STALE"}})
NoMovementWitness ==
 ~(audit.present /\ audit.moved /\ audit.public /\ audit.fresh
   /\ ~audit.ownPrior /\ audit.scopeOK /\ audit.code = "Accepted")
=====================================================================
