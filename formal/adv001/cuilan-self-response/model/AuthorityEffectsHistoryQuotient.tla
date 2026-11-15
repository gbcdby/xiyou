---------------------------- MODULE AuthorityEffectsHistoryQuotient ----------------------------
EXTENDS PersonalEffectsHistoryQuotient
(* CS-R2权威组件。保留PersonalEffects全部世界动作/身份/故障，调用者可以
   在真实规则守卫满足时提交归还；不把客户端是否已经收到投影当服务器前置。
   因此服务器动作比cached客户端组合更宽，不用同步UI假设删掉世界交错。
   本组件不检查UI缓存送达或ProjectionEventuallyCurrent。 *)
AuthorityWork ==
 (\E q \in Requests: Apply(q) \/
       (\E k \in {"cancelled","withdrawn","invalidated","disclosed","ended"}: Stop(q,k)))
 \/ (\E q \in Requests,i \in Items,p \in Players: Take(q,i,p))
 \/ (\E p \in Purposes: NewRequest(p) \/ AcceptNew(p))
 \/ (\E i \in Items,t \in {"owner","origin","public"}: ReturnRule(i,t))
 \/ (\E i \in Items: OwnerRepositions(i))
 \/ (\E p \in Players: RefreshView(p)) \/ PruneHistory
 \/ Restart \/ Resume \/ Terminal \/ FinishSplit
AuthorityIdle == /\ ~ENABLED AuthorityWork /\ UNCHANGED vars
AuthorityNext == AuthorityWork \/ (\E q \in Requests: Replay(q)) \/ TypeFault \/ AuthorityIdle
AuthoritySpec == Init /\ [][AuthorityNext]_vars
AuthorityLiveSpec == AuthoritySpec /\ \A i \in Items: WF_vars(ReturnRule(i,"owner"))
=============================================================================
