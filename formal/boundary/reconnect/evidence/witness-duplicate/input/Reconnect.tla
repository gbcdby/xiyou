------------------------------ MODULE Reconnect ------------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANT Fault
Sessions == {"S1", "S2"}
Views == {"A", "B"}
Limit == 4
\* 发生时受众固定：1/3公开，2仅A，4仅B；3表示移除可见字段。
Visible(v, q) == q \in {1, 3} \/ (q = 2 /\ v = "A") \/ (q = 4 /\ v = "B")
Canonical(s, v, n) == SelectSeq([q \in 1..n |-> <<s, q>>], LAMBDA e : Visible(v, e[2]))
Range(s, v, lo, hi) ==
    SelectSeq([k \in 1..(hi-lo) |-> <<s, lo+k>>],
              LAMBDA e : Visible(v, e[2]) \/ Fault = "stream_filter")

VARIABLES homeSession, head, cursor, projection, stage, view, version,
          authorized, mayRevoke, snapshot, marker, dropUsed, resyncUsed, phase, terminalHead, invalidDelivery
vars == <<homeSession, head, cursor, projection, stage, view, version,
          authorized, mayRevoke, snapshot, marker, dropUsed, resyncUsed, phase, terminalHead, invalidDelivery>>

Init == /\ homeSession \in Sessions
        /\ head = 0 /\ cursor = 0 /\ projection = <<>>
        /\ stage = "need" /\ view = "A" /\ version = 0
        /\ authorized = TRUE /\ mayRevoke = TRUE
        /\ snapshot = 0 /\ marker = "initial"
        /\ dropUsed = FALSE /\ resyncUsed = FALSE
        /\ phase = "Running" /\ terminalHead = 0 /\ invalidDelivery = FALSE

CommitEvent == /\ (phase = "Running" \/ Fault = "terminal_commit") /\ head < Limit /\ head' = head + 1
               /\ marker' = "committed"
               /\ UNCHANGED <<homeSession,cursor,projection,stage,view,version,
                                authorized,mayRevoke,snapshot,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

StartSnapshot == /\ authorized /\ stage = "need"
                 /\ snapshot' = head /\ stage' = "waiting"
                 /\ marker' = "snapshot-captured"
                 /\ UNCHANGED <<homeSession,head,cursor,projection,view,version,
                                  authorized,mayRevoke,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

DeliverSnapshot ==
    /\ authorized /\ stage = "waiting"
    /\ cursor' = snapshot /\ stage' = "ready"
    /\ projection' = IF Fault = "snapshot_filter"
                       THEN [q \in 1..snapshot |-> <<homeSession,q>>]
                       ELSE Canonical(homeSession,view,snapshot)
    /\ marker' = IF snapshot < head THEN "snapshot-behind" ELSE "snapshot-applied"
    /\ UNCHANGED <<homeSession,head,view,version,authorized,mayRevoke,
                     snapshot,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

\* 每次选择一个已提交完整区间交付；任意旧区间均可重放或先于前缀到达。
\* 这是任意数量在途包的有限抽象，不假设恰好一次或到达顺序。
Receive(s,v,ver,lo,hi) ==
    /\ stage = "ready" \/ (Fault = "revoked" /\ ~authorized)
    /\ hi <= (IF s = homeSession THEN head ELSE Limit)
    /\ LET sameStream == (s = homeSession \/ Fault = "session_filter")
                            /\ (v = view \/ Fault = "view_filter")
                            /\ (ver = version \/ Fault = "version_filter")
           allowed == (authorized \/ Fault = "revoked") /\ sameStream
           canAdvance == allowed /\ hi > cursor
                           /\ (lo = cursor \/ Fault = "out_of_order")
           hidden == \E q \in (lo+1)..hi : ~Visible(v,q)
           blocked == Fault = "hidden_block" /\ hidden
           payload == Range(s,v,lo,hi)
           applied == IF Fault = "partial_batch" /\ Len(payload) > 0
                        THEN SubSeq(payload,1,Len(payload)-1) ELSE payload
           why == IF ~allowed THEN "identity-rejected"
                  ELSE IF hi <= cursor THEN "duplicate"
                  ELSE IF lo > cursor THEN "future-rejected"
                  ELSE IF lo < cursor THEN "overlap-rejected"
                  ELSE IF blocked THEN "hidden-blocked"
                  ELSE IF hidden THEN "hidden-advanced" ELSE "applied"
       IN /\ cursor' = IF canAdvance /\ ~blocked THEN hi ELSE cursor
          /\ projection' = IF canAdvance /\ ~blocked THEN projection \o applied ELSE projection
          /\ marker' = why
          /\ invalidDelivery' = (invalidDelivery \/
                 (canAdvance /\ ~blocked /\ (~authorized \/ s # homeSession \/ v # view \/ ver # version)))
    /\ UNCHANGED <<homeSession,head,stage,view,version,authorized,mayRevoke,
                     snapshot,dropUsed,resyncUsed,phase,terminalHead>>

Repair == /\ Fault # "no_retry" /\ authorized /\ stage = "ready" /\ cursor < head
          /\ Receive(homeSession,view,version,cursor,head)

Drop == /\ ~dropUsed /\ head > cursor
        /\ dropUsed' = TRUE /\ marker' = "dropped"
        /\ UNCHANGED <<homeSession,head,cursor,projection,stage,view,version,
                         authorized,mayRevoke,snapshot,resyncUsed,phase,terminalHead,invalidDelivery>>

Rebind == /\ version = 0
          /\ version' = 1 /\ view' = "B" /\ stage' = "need"
          /\ cursor' = 0 /\ projection' = <<>> /\ snapshot' = 0
          /\ marker' = "view-rebound"
          /\ UNCHANGED <<homeSession,head,authorized,mayRevoke,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

Revoke == /\ authorized /\ mayRevoke
          /\ authorized' = FALSE /\ mayRevoke' = FALSE
          /\ cursor' = 0 /\ projection' = <<>> /\ snapshot' = 0 /\ stage' = "need"
          /\ marker' = "revoked"
          /\ UNCHANGED <<homeSession,head,view,version,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

Restore == /\ ~authorized /\ authorized' = TRUE /\ marker' = "restored"
           /\ UNCHANGED <<homeSession,head,cursor,projection,stage,view,version,
                            mayRevoke,snapshot,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

Resync == /\ authorized /\ stage = "ready" /\ ~resyncUsed
          /\ cursor' = 0 /\ projection' = <<>> /\ snapshot' = 0 /\ stage' = "need"
          /\ resyncUsed' = TRUE /\ marker' = "resync-required"
          /\ UNCHANGED <<homeSession,head,view,version,authorized,mayRevoke,dropUsed,phase,terminalHead,invalidDelivery>>

TypeFault == /\ Fault = "type" /\ cursor <= Limit
             /\ cursor' = Limit+1 /\ marker' = "out-of-domain"
             /\ UNCHANGED <<homeSession,head,projection,stage,view,version,
                              authorized,mayRevoke,snapshot,dropUsed,resyncUsed,phase,terminalHead,invalidDelivery>>

Finish(p) == /\ phase = "Running" /\ phase' = p /\ terminalHead' = head
             /\ marker' = "terminal"
             /\ UNCHANGED <<homeSession,head,cursor,projection,stage,view,version,
                              authorized,mayRevoke,snapshot,dropUsed,resyncUsed,invalidDelivery>>
FinishAny == \E p \in {"Finished","Aborted"}: Finish(p)

Quiescent == /\ authorized /\ stage = "ready" /\ cursor = head /\ (head = Limit \/ phase # "Running")
             /\ UNCHANGED vars
Next == CommitEvent \/ StartSnapshot \/ DeliverSnapshot \/ Repair \/ Drop \/ Rebind
        \/ Revoke \/ Restore \/ Resync \/ TypeFault \/ FinishAny \/ Quiescent
        \/ (\E s \in Sessions, v \in Views, ver \in 0..1, lo \in 0..(Limit-1):
             \E hi \in (lo+1)..Limit: Receive(s,v,ver,lo,hi))
Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ WF_vars(CommitEvent) /\ WF_vars(StartSnapshot)
                /\ WF_vars(DeliverSnapshot) /\ WF_vars(Restore) /\ WF_vars(Repair) /\ WF_vars(FinishAny)

TypeOK == /\ homeSession \in Sessions /\ head \in 0..Limit /\ cursor \in 0..Limit
          /\ stage \in {"need","waiting","ready"} /\ view \in Views /\ version \in 0..1
          /\ authorized \in BOOLEAN /\ mayRevoke \in BOOLEAN
          /\ snapshot \in 0..Limit /\ dropUsed \in BOOLEAN /\ resyncUsed \in BOOLEAN
          /\ projection \in Seq(Sessions \X (1..Limit))
          /\ phase \in {"Running","Finished","Aborted"} /\ terminalHead \in 0..Limit
          /\ invalidDelivery \in BOOLEAN
ProjectionMatchesCursor == projection = Canonical(homeSession,view,cursor)
NoUnauthorizedObservation ==
    /\ ~invalidDelivery
    /\ (~authorized => projection = <<>>)
    /\ \A k \in DOMAIN projection : projection[k][1] = homeSession /\ Visible(view,projection[k][2])
TerminalBlocksNewEffects == phase # "Running" => head = terminalHead
ConnectedProjectionCatchesUp == <>[](authorized /\ stage = "ready" /\ cursor = head /\ phase # "Running")

NotFuture == marker # "future-rejected"
NotOverlap == marker # "overlap-rejected"
NotDuplicate == marker # "duplicate"
NotHiddenAdvance == marker # "hidden-advanced"
NotSnapshotBehind == marker # "snapshot-behind"
NotDrop == marker # "dropped"
NotIdentityRejection == marker # "identity-rejected"
NotResync == marker # "resync-required"
NotTerminalRead == ~(phase # "Running" /\ stage = "ready" /\ cursor = head /\ head > 0)
=============================================================================
