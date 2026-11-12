---------------------------- MODULE Identity ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANT Fault
VARIABLES disguised, knows, nearby, emitted, eventAudience, heard, original,
          history, refreshed, viewEpoch, delivery, used, target, targetProof, ended
vars == <<disguised,knows,nearby,emitted,eventAudience,heard,original,history,
          refreshed,viewEpoch,delivery,used,target,targetProof,ended>>
Observers == {"player","bajie"}
Surfaces == {"snapshot","event","receipt","owner","tool","context","reconnect","recap"}
Label(o) == IF disguised /\ ~knows[o] THEN "cuilan" ELSE "wukong"
Init == /\ disguised = FALSE /\ knows = [o \in Observers |-> o = "player"]
        /\ nearby = {"player"} /\ emitted = FALSE /\ eventAudience = {} /\ heard = {}
        /\ original = [o \in Observers |-> "none"] /\ history = original
        /\ refreshed = FALSE /\ viewEpoch = 0
        /\ delivery = [surface |-> "snapshot", raw |-> FALSE, identity |-> "none", known |-> FALSE, guise |-> FALSE]
        /\ used = FALSE /\ target = "none" /\ targetProof = TRUE /\ ended = FALSE
Disguise ==
  /\ ~ended /\ ~disguised /\ disguised' = TRUE
  /\ UNCHANGED <<knows,nearby,emitted,eventAudience,heard,original,history,refreshed,
                  viewEpoch,delivery,used,target,targetProof,ended>>
Learn ==
  /\ ~ended /\ ~knows["bajie"] /\ knows' = [knows EXCEPT !["bajie"] = TRUE]
  /\ UNCHANGED <<disguised,nearby,emitted,eventAudience,heard,original,history,refreshed,
                  viewEpoch,delivery,used,target,targetProof,ended>>
ArriveLate ==
  /\ ~ended /\ "bajie" \notin nearby /\ nearby' = Observers
  /\ UNCHANGED <<disguised,knows,emitted,eventAudience,heard,original,history,refreshed,
                  viewEpoch,delivery,used,target,targetProof,ended>>
Emit ==
  /\ ~ended /\ ~emitted /\ emitted' = TRUE /\ eventAudience' = nearby
  /\ original' = [o \in Observers |-> IF o \in nearby THEN Label(o) ELSE "none"]
  /\ history' = original' /\ heard' = nearby
  /\ UNCHANGED <<disguised,knows,nearby,refreshed,viewEpoch,delivery,used,target,targetProof,ended>>
Replay ==
  /\ ~ended /\ emitted /\ ~refreshed /\ refreshed' = TRUE
  /\ heard' = IF Fault = "late-audience" THEN nearby ELSE heard
  /\ history' = IF Fault = "rewrite-history"
                 THEN [o \in Observers |-> IF o \in eventAudience THEN Label(o) ELSE "none"]
                 ELSE history
  /\ UNCHANGED <<disguised,knows,nearby,emitted,eventAudience,original,viewEpoch,
                  delivery,used,target,targetProof,ended>>
Deliver(o,s) ==
  /\ ~ended /\ o \in Observers /\ s \in Surfaces
  /\ delivery' = [surface |-> s, raw |-> Fault = "raw-id" /\ disguised /\ ~knows[o],
                   identity |-> IF Fault = "true-name" THEN "wukong" ELSE Label(o),
                   known |-> knows[o], guise |-> disguised]
  /\ UNCHANGED <<disguised,knows,nearby,emitted,eventAudience,heard,original,history,
                  refreshed,viewEpoch,used,target,targetProof,ended>>
Reconnect ==
  /\ ~ended /\ viewEpoch = 0 /\ viewEpoch' = 1
  /\ UNCHANGED <<disguised,knows,nearby,emitted,eventAudience,heard,original,history,
                  refreshed,delivery,used,target,targetProof,ended>>
UseRef(e) ==
  LET fresh == e = viewEpoch
      resolved == IF Fault = "by-name" /\ disguised THEN "cuilan" ELSE "wukong"
  IN /\ ~ended /\ ~used /\ e \in {0,1}
     /\ (fresh \/ Fault = "stale-ref")
     /\ used' = TRUE /\ target' = resolved
     /\ targetProof' = (fresh /\ resolved = "wukong")
     /\ UNCHANGED <<disguised,knows,nearby,emitted,eventAudience,heard,original,history,
                     refreshed,viewEpoch,delivery,ended>>
Finish ==
  /\ ~ended /\ ended' = TRUE
  /\ UNCHANGED <<disguised,knows,nearby,emitted,eventAudience,heard,original,history,
                  refreshed,viewEpoch,delivery,used,target,targetProof>>
BreakType ==
  /\ Fault = "type" /\ viewEpoch = 0 /\ viewEpoch' = 2
  /\ UNCHANGED <<disguised,knows,nearby,emitted,eventAudience,heard,original,history,
                  refreshed,delivery,used,target,targetProof,ended>>
Done == ended /\ UNCHANGED vars
Next == Disguise \/ Learn \/ ArriveLate \/ Emit \/ Replay \/ Reconnect
        \/ (\E o \in Observers, s \in Surfaces: Deliver(o,s))
        \/ (\E e \in {0,1}: UseRef(e)) \/ Finish \/ BreakType \/ Done
Spec == Init /\ [][Next]_vars
TypeOK == viewEpoch \in 0..1 /\ knows \in [Observers -> BOOLEAN]
          /\ nearby \subseteq Observers /\ eventAudience \subseteq Observers /\ heard \subseteq Observers
          /\ history \in [Observers -> {"none","cuilan","wukong"}]
          /\ delivery.surface \in Surfaces /\ target \in {"none","cuilan","wukong"}
          /\ disguised \in BOOLEAN /\ emitted \in BOOLEAN /\ used \in BOOLEAN /\ ended \in BOOLEAN
NoIdentityLeak == ~delivery.raw /\ (delivery.identity = "wukong" => delivery.known \/ ~delivery.guise)
EventAudienceFixed == heard \subseteq eventAudience
HistoryAsObserved == history = original
ReferenceTargetStable == used => targetProof
NoDisguisedHistoryWitness == ~(history["bajie"] = "cuilan" /\ knows["bajie"])
NoLateReplayWitness == ~(emitted /\ nearby = Observers /\ eventAudience = {"player"} /\ refreshed)
NoRefTransferWitness == ~(disguised /\ used /\ target = "wukong")
=============================================================================
