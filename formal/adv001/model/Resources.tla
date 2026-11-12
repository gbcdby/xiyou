--------------------------- MODULE Resources ---------------------------
EXTENDS Naturals, FiniteSets
CONSTANT Fault, Public
VARIABLES owners, itemVersion, epoch, offline, grace, near, ready, locked,
          everLocked, lockProof, requested, requestEpoch, requestVersion,
          reclaimed, reclaimProof, effects, receipt, retried, crashed, ended
vars == <<owners, itemVersion, epoch, offline, grace, near, ready, locked,
          everLocked, lockProof, requested, requestEpoch, requestVersion,
          reclaimed, reclaimProof, effects, receipt, retried, crashed, ended>>
Players == {"p1","p2"}
Init == /\ owners = {"p1"} /\ itemVersion = 0 /\ epoch = 0
        /\ offline = FALSE /\ grace = FALSE /\ near = TRUE /\ ready = {}
        /\ locked = FALSE /\ everLocked = FALSE /\ lockProof = TRUE
        /\ requested = FALSE /\ requestEpoch = 0 /\ requestVersion = 0
        /\ reclaimed = FALSE /\ reclaimProof = TRUE /\ effects = 0 /\ receipt = FALSE
        /\ retried = FALSE /\ crashed = FALSE /\ ended = FALSE
Prepare(p) ==
  /\ ~ended /\ ~locked /\ p \in Players /\ p \notin ready
  /\ (p = "p2" \/ ~offline)
  /\ ready' = ready \cup {p}
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,near,locked,everLocked,
                  lockProof,requested,requestEpoch,requestVersion,reclaimed,reclaimProof,
                  effects,receipt,retried,crashed,ended>>
Lock ==
  /\ ~ended /\ ~locked /\ effects = 0
  /\ ((ready = Players /\ ~offline /\ near) \/ Fault = "premature")
  /\ locked' = TRUE /\ everLocked' = TRUE
  /\ lockProof' = (ready = Players /\ ~offline /\ near)
  /\ effects' = 1 /\ receipt' = TRUE
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,near,ready,requested,
                  requestEpoch,requestVersion,reclaimed,reclaimProof,retried,crashed,ended>>
Disconnect ==
  /\ ~ended /\ ~offline /\ epoch = 0 /\ offline' = TRUE
  /\ ready' = ready \ {"p1"}
  /\ locked' = IF Fault = "unlock" THEN FALSE ELSE locked
  /\ UNCHANGED <<owners,itemVersion,epoch,grace,near,everLocked,lockProof,requested,
                  requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,crashed,ended>>
Proxy ==
  /\ ~ended /\ offline /\ ~grace /\ grace' = TRUE
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,near,ready,locked,everLocked,lockProof,
                  requested,requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,crashed,ended>>
Reconnect ==
  /\ ~ended /\ offline /\ epoch = 0 /\ offline' = FALSE /\ grace' = FALSE /\ epoch' = 1
  /\ UNCHANGED <<owners,itemVersion,near,ready,locked,everLocked,lockProof,requested,
                  requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,crashed,ended>>
Leave ==
  /\ ~ended /\ near /\ near' = FALSE /\ ready' = {}
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,locked,everLocked,lockProof,
                  requested,requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,crashed,ended>>
Request ==
  /\ ~ended /\ ~requested /\ requested' = TRUE
  /\ requestEpoch' = epoch /\ requestVersion' = itemVersion
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,near,ready,locked,everLocked,lockProof,
                  reclaimed,reclaimProof,effects,receipt,retried,crashed,ended>>
Reclaim ==
  LET legal == Public /\ offline /\ grace /\ near /\ epoch = requestEpoch
               /\ itemVersion = requestVersion /\ owners = {"p1"} /\ ~locked
  IN /\ ~ended /\ requested /\ ~reclaimed
     /\ (legal \/ Fault = "reclaim")
     /\ owners' = IF Fault = "duplicate-owner" THEN owners \cup {"p2"} ELSE {"p2"}
     /\ itemVersion' = itemVersion + 1 /\ reclaimed' = TRUE /\ reclaimProof' = legal
     /\ UNCHANGED <<epoch,offline,grace,near,ready,locked,everLocked,lockProof,
                     requested,requestEpoch,requestVersion,effects,receipt,retried,crashed,ended>>
Retry ==
  /\ ~ended /\ receipt /\ ~retried /\ retried' = TRUE
  /\ effects' = IF Fault = "repeat-effect" THEN effects + 1 ELSE effects
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,near,ready,locked,everLocked,lockProof,
                  requested,requestEpoch,requestVersion,reclaimed,reclaimProof,receipt,crashed,ended>>
CrashRecover ==
  /\ ~ended /\ ~crashed /\ crashed' = TRUE /\ ready' = {}
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,near,locked,everLocked,lockProof,
                  requested,requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,ended>>
Finish ==
  /\ ~ended /\ ended' = TRUE
  /\ UNCHANGED <<owners,itemVersion,epoch,offline,grace,near,ready,locked,everLocked,lockProof,
                  requested,requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,crashed>>
BreakType ==
  /\ Fault = "type" /\ itemVersion = 0 /\ itemVersion' = 2
  /\ UNCHANGED <<owners,epoch,offline,grace,near,ready,locked,everLocked,lockProof,requested,
                  requestEpoch,requestVersion,reclaimed,reclaimProof,effects,receipt,retried,crashed,ended>>
Done == ended /\ UNCHANGED vars
Next == (\E p \in Players: Prepare(p)) \/ Lock \/ Disconnect \/ Proxy \/ Reconnect \/ Leave
        \/ Request \/ Reclaim \/ Retry \/ CrashRecover \/ Finish \/ BreakType \/ Done
Spec == Init /\ [][Next]_vars
TypeOK == owners \subseteq Players /\ itemVersion \in 0..1 /\ epoch \in 0..1
          /\ ready \subseteq Players /\ effects \in 0..2 /\ requestEpoch \in 0..1
          /\ requestVersion \in 0..1 /\ offline \in BOOLEAN /\ grace \in BOOLEAN
          /\ near \in BOOLEAN /\ locked \in BOOLEAN /\ everLocked \in BOOLEAN /\ ended \in BOOLEAN
SingleOwner == Cardinality(owners) = 1
EffectOnce == effects <= 1
PreparedDurable == everLocked => locked
CooperationAuthorized == everLocked => lockProof
ReclaimAuthorized == reclaimed => reclaimProof
NoReclaimWitness == ~reclaimed
NoLockedRecoveryWitness == ~(locked /\ crashed /\ offline)
NoReclaimReconnectWitness == ~(reclaimed /\ epoch = 1 /\ ~offline)
=============================================================================
