-------------------------- MODULE ReturnSnapshotOperators --------------------------
EXTENDS Naturals, FiniteSets
(* 参数化纯函数：输入为可信完整世界元组；输出只包含该观察者可见部分。
   本模型字段用于观察关系，不要求真实wire增加holder/acquired/额度的内部ID。 *)
Owned(s,p) == {i \in DOMAIN s.holder:s.holder[i]=p /\ s.acquired[i]#0}
VisibleRequests(s,p) == {q \in DOMAIN s.stage:
 s.requester[q]=p /\ s.stage[q]#"absent" /\ s.slot[q[1]]=q[2]}
ProjectedSlots(s,p) == [purpose \in DOMAIN s.slot|->
 IF <<purpose,s.slot[purpose]>> \in VisibleRequests(s,p) THEN s.slot[purpose] ELSE 0]
ProjectedActive(s,p) == [purpose \in DOMAIN s.slot|->
 <<purpose,s.slot[purpose]>> \in (VisibleRequests(s,p) \cap s.grants)]
Origin(i) == [scene|->"registered-scene",position|-><<"registered-origin",i>>]
Row(s,p,i,v,visible,revs,fault) ==
 LET q==s.acquired[i]
     oldView==IF fault="return-old-view" THEN 1 ELSE v
     ref==[item|->i,observer|->p,view|->oldView,revision|->revs[i]]
 IN [item|->i,context|-><<q,i,"actual-acquisition">>,
     originalRequest|->IF fault="return-wrong-acquisition" THEN <<"private_items",s.slot["private_items"]>> ELSE q,
     acceptedVersion|-><<"accepted-version",q>>,
     lifecycleVersion|->IF s.slot[q[1]]#q[2] THEN "superseded" ELSE IF q \in s.grants THEN "open" ELSE "stopped",
     itemRef|->ref,mode|->IF q \in s.grants THEN "delivery_pending" ELSE "return_only",
     ownerLabel|->"C",ownerRef|->IF visible \/ fault="return-synthesize-owner" THEN
           [entity|->"C",observer|->p,view|->oldView] ELSE 0,
     origin|->IF fault="return-wrong-origin" THEN [scene|->"public",position|-><<"public",i>>] ELSE Origin(i)]
Snapshot(s,p,v,visible,revs,fault) ==
 LET own==Owned(s,p)
     items==IF fault="return-leak" THEN {i \in DOMAIN s.holder:s.holder[i] \in {"p1","p2"} /\ s.acquired[i]#0}
       ELSE IF fault="return-current-only" THEN {i \in own:s.acquired[i][2]=s.slot["private_items"]}
       ELSE IF fault="return-omit-letter" THEN own \ {"letter"} ELSE own
     rows==IF fault="snapshot-type" THEN {[item|->"duplicate",mode|->"return_only"]}
           ELSE {Row(s,p,i,v,visible,revs,fault):i \in items}
 IN [observer|->p,view|->v,slot|->ProjectedSlots(s,p),active|->ProjectedActive(s,p),
     holder|->[i \in own|->s.holder[i]],acquired|->[i \in own|->s.acquired[i]],
     taken|->IF fault="snapshot-drop-quota" THEN [q \in VisibleRequests(s,p)|->{}]
            ELSE [q \in VisibleRequests(s,p)|->s.taken[q]],
     completed|->[q \in VisibleRequests(s,p)|->s.completed[q]],returns|->rows]
SnapshotTyped(s,o) == o.observer \in {"p1","p2"} /\ o.view \in 1..2 /\
 \A row \in o.returns:row.item \in DOMAIN s.holder /\ row.mode \in {"delivery_pending","return_only"}
CompleteReturns(s,o,p) == {row.item:row \in o.returns}=Owned(s,p) /\ Cardinality(o.returns)=Cardinality(Owned(s,p))
PrivateToObserver(s,o,p) == (\A row \in o.returns:s.holder[row.item]=p) /\
 (\A i \in DOMAIN o.holder:s.holder[i]=p) /\ DOMAIN o.taken \subseteq VisibleRequests(s,p)
OriginalRows(s,o) == \A row \in o.returns:
 row.originalRequest=s.acquired[row.item] /\ row.context= <<s.acquired[row.item],row.item,"actual-acquisition">> /\
 row.acceptedVersion= <<"accepted-version",s.acquired[row.item]>> /\
 row.mode=(IF s.acquired[row.item] \in s.grants THEN "delivery_pending" ELSE "return_only")
FreshRows(o,p,v,visible,revs) == \A row \in o.returns:
 row.itemRef=[item|->row.item,observer|->p,view|->v,revision|->revs[row.item]] /\
 row.ownerRef=(IF visible THEN [entity|->"C",observer|->p,view|->v] ELSE 0)
NarrowTargets(o) == \A row \in o.returns:row.ownerLabel="C" /\ row.origin=Origin(row.item)
FullTuple(s,o,p) ==
 /\ o.slot=ProjectedSlots(s,p) /\ o.active=ProjectedActive(s,p)
 /\ o.holder=[i \in Owned(s,p)|->s.holder[i]] /\ o.acquired=[i \in Owned(s,p)|->s.acquired[i]]
 /\ o.taken=[q \in VisibleRequests(s,p)|->s.taken[q]] /\ o.completed=[q \in VisibleRequests(s,p)|->s.completed[q]]
=============================================================================
