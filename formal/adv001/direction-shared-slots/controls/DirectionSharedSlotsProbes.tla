----------------------- MODULE DirectionSharedSlotsProbes -----------------------
EXTENDS DirectionSharedSlots

(***************************************************************************
 这些操作符只否定目标可达状态，不改变 Init/Next，不充当业务安全性质。
 预期 COUNTEREXAMPLE 表示见证被找到；不是正模型产品缺陷。
***************************************************************************)
NeverQueryBeforeReturn == ~\E r \in Moves(s) :
  s.req[r].receipt /\ s.req[r].phase = "pending" /\ s.req[r].local
NeverResolvedLedgerReuse == ~\E old \in Controllers :
  old < s.current /\ Cardinality(Local(s,old)) = 2 /\
  (\E r \in Local(s,old) : s.req[r].receipt /\ s.req[r].phase = "pending") /\
  (\E r \in Moves(s) : s.req[r].owner = s.current)
NeverLateSameRejectIgnored == ~\E a,b \in Moves(s) :
  a < b /\ s.req[a].owner = s.current /\ s.req[b].owner = s.current /\
  s.req[a].intent = s.req[b].intent /\ s.req[a].generation = s.ctrl[s.current].generation /\
  s.req[a].result = "rejected" /\ s.req[a].phase \in {"handled", "done"} /\
  s.req[b].status = "accepted" /\ s.ctrl[s.current].latest = b /\
  s.ctrl[s.current].vector = s.req[b].vector /\ ~s.ctrl[s.current].blocked
================================================================================
