--------------------------- MODULE ReturnInputDomain ---------------------------
EXTENDS ReturnSnapshotOperators
(* #62直接构造输入域。rows枚举两物完整持有/原取得关系、当前槽/许可及当前引用。
   requests枚举每个用途的全部两请求状态、额度和完成值，另一用途保持规范空值。
   这是按纯函数字段依赖的乘积分解；需结合PROOF_CLOSURE中的逐字段合成论证，
   不把两个切面直接称为全部世界图或全部合法Source笛卡尔积已穷尽。 *)
CONSTANTS DomainPart, Fault
Purposes == {"appearance","private_items"}
Players == {"p1","p2"}
Items == {"parcel","letter"}
Requests == Purposes \X (1..2)
PrivateRequests == {"private_items"} \X (1..2)
Requester(q) == IF q[2]=1 THEN "p1" ELSE "p2"
VARIABLES focus, stages, currentSlot, grantNumbers, holder, acquired, quotaTaken,
          quotaDone, observer, view, visibleOwner, itemRevisions
vars == <<focus,stages,currentSlot,grantNumbers,holder,acquired,quotaTaken,
          quotaDone,observer,view,visibleOwner,itemRevisions>>
RowInputs ==
 /\ focus="private_items"
 /\ stages=[n \in 1..2|->"accepted"]
 /\ currentSlot \in 1..2
 /\ grantNumbers \in SUBSET {currentSlot}
 /\ holder \in [Items->{"origin","owner","p1","p2"}]
 /\ acquired \in [Items->PrivateRequests \cup {NoAcquisition}]
 /\ \A i \in Items:
      holder[i] \in Players => acquired[i] \in PrivateRequests /\ Requester(acquired[i])=holder[i]
 /\ quotaTaken=[n \in 1..2|->{i \in Items:acquired[i]= <<"private_items",n>>}]
 /\ quotaDone=[n \in 1..2|->{i \in Items:holder[i]="owner"}]
 /\ observer \in Players /\ view \in 1..2 /\ visibleOwner \in BOOLEAN
 /\ itemRevisions \in [Items->1..2]
RequestInputs ==
 /\ focus \in Purposes
 /\ stages \in [1..2->{"absent","proposed","accepted","closed"}]
 /\ currentSlot \in 1..2
 /\ grantNumbers \in SUBSET (1..2)
 /\ holder=[i \in Items|->"origin"]
 /\ acquired=[i \in Items|->NoAcquisition]
 /\ quotaTaken \in [1..2->SUBSET Items] /\ quotaDone \in [1..2->SUBSET Items]
 /\ observer \in Players /\ view=1 /\ visibleOwner=FALSE
 /\ itemRevisions=[i \in Items|->1]
Init == IF DomainPart="rows" THEN RowInputs ELSE RequestInputs
(* 所有Init赋值是纯函数输入；没有业务动作或活性声明。 *)
Next == UNCHANGED vars
Spec == Init /\ [][Next]_vars
Source ==
 [stage|->[q \in Requests|->IF q[1]=focus THEN stages[q[2]] ELSE "absent"],
  grants|->{<<focus,n>>:n \in grantNumbers},
  slot|->[p \in Purposes|->IF p=focus THEN currentSlot ELSE 1],
  holder|->holder,acquired|->acquired,
  taken|->[q \in Requests|->IF q[1]=focus THEN quotaTaken[q[2]] ELSE {}],
  completed|->[q \in Requests|->IF q[1]=focus THEN quotaDone[q[2]] ELSE {}],
  requester|->[q \in Requests|->Requester(q)]]
Output == Snapshot(Source,observer,view,visibleOwner,itemRevisions,Fault)
SnapshotType == SnapshotTyped(Source,Output)
ReturnCompleteness == CompleteReturns(Source,Output,observer)
ObserverIsolation == PrivateToObserver(Source,Output,observer)
AcquisitionIdentity == OriginalRows(Source,Output)
CurrentReferences == FreshRows(Output,observer,view,visibleOwner,itemRevisions)
ReturnTargets == NarrowTargets(Output)
CompleteObservable == FullTuple(Source,Output,observer)
=============================================================================
