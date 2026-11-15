----------------------- MODULE DirectionAuthority -----------------------
EXTENDS Naturals, Integers, FiniteSets
CONSTANTS Fault, MaxCommands, Mode

\* 单连接、单角色、一次 epoch/绑定变化。Handle 是原持久事务的抽象。
\* authority 检查最多两条命令的处理交错；budget 只检查三条未决请求的准入。
\* Unknown 是结果未知事件，不模拟 400ms 或故障恢复活性。
VARIABLES epoch, clientEpoch, binding, localSeq, issued, commands, originals,
          pending, ackReady, status, receipts, originalReceipts, effects,
          handled, highWater, lastApplied, active, activeEpoch, position, goal,
          dropped, retried, lostAck, replayed, refusedActive, refusalPreserved, replayedMoved, replayPreserved, replayContext, oldAckNewBinding
vars == <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,pending,
          ackReady,status,receipts,originalReceipts,effects,handled,highWater,
          lastApplied,active,activeEpoch,position,goal,dropped,retried,lostAck,
          replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>
Ids == 1..MaxCommands
Directions == {"E","SE","S"}
Kinds == Directions \cup {"stop"}
Positions == {<<x,y>>: x \in 0..2, y \in 0..2}
Maximum(s) == CHOOSE m \in s: \A n \in s: n <= m
Target(p,k) == CASE k="E" -> <<p[1]+1,p[2]>>
                [] k="SE" -> <<p[1]+1,p[2]+1>>
                [] k="S" -> <<p[1],p[2]+1>> [] OTHER -> p
EmptyCommand == [epoch|->0,seq|->0,kind|->"E",binding|->0,issuedOrigin|-><<0,0>>]
EmptyReceipt == [status|->"none",epoch|->0,decidedEpoch|->0,seq|->0,
                 origin|-><<0,0>>,target|-><<0,0>>,observedWater|->0]
ReceiptRecords == [status:{"none","accepted","rejected"},epoch:0..1,
                   decidedEpoch:0..1,seq:0..MaxCommands,origin:Positions,
                   target:Positions,observedWater:0..MaxCommands]
Outstanding == {c \in 1..issued: status[c] \in {"waiting","unknown"}}
Moves == {c \in Outstanding: commands[c].kind \in Directions}
Stops == {c \in Outstanding: commands[c].kind="stop"}
CountedMoves == IF Fault="binding-budget" THEN {c \in Moves: commands[c].binding=binding} ELSE Moves
AcceptedNow == {c \in 1..issued: receipts[c].status="accepted" /\ commands[c].epoch=epoch}
HandledNow == {c \in handled: commands[c].epoch=epoch}
LatestAccepted == Maximum({0} \cup {commands[c].seq: c \in AcceptedNow})
LatestHandled == Maximum({0} \cup {commands[c].seq: c \in HandledNow})
LatestIsStop == \E c \in AcceptedNow: commands[c].seq=LatestAccepted /\ commands[c].kind="stop"

Init ==
  /\ epoch=0 /\ clientEpoch=0 /\ binding=0 /\ localSeq=0 /\ issued=0
  /\ commands=[c \in Ids |-> EmptyCommand] /\ originals=commands
  /\ pending={} /\ ackReady={} /\ status=[c \in Ids |-> "unissued"]
  /\ receipts=[c \in Ids |-> EmptyReceipt] /\ originalReceipts=receipts
  /\ effects=[c \in Ids |-> 0] /\ handled={} /\ highWater=0 /\ lastApplied=0
  /\ active=FALSE /\ activeEpoch=0 /\ position= <<0,0>> /\ goal= <<0,0>>
  /\ dropped={} /\ retried={} /\ lostAck={} /\ replayed={}
  /\ refusedActive=FALSE /\ refusalPreserved=TRUE /\ replayedMoved=FALSE /\ replayPreserved=TRUE /\ replayContext={} /\ oldAckNewBinding=FALSE

Issue(k) ==
  /\ k \in Kinds /\ issued<MaxCommands /\ clientEpoch=epoch
  /\ IF k="stop" THEN Stops={} \/ Fault="stop-budget"
     ELSE Cardinality(CountedMoves)<2 /\ Stops={}
          /\ ~\E c \in Moves: status[c]="unknown"
  /\ issued'=issued+1 /\ localSeq'=localSeq+1
  /\ commands'=[commands EXCEPT ![issued+1]=[epoch|->epoch,seq|->localSeq+1,
                    kind|->k,binding|->binding,issuedOrigin|->position]]
  /\ originals'=[originals EXCEPT ![issued+1]=commands'[issued+1]]
  /\ status'=[status EXCEPT ![issued+1]="waiting"] /\ pending'=pending \cup {issued+1}
  /\ UNCHANGED <<epoch,clientEpoch,binding,ackReady,receipts,originalReceipts,
       effects,handled,highWater,lastApplied,active,activeEpoch,position,goal,
       dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>

Unknown(c) ==
  /\ c \in 1..issued /\ status[c]="waiting"
  /\ status'=[status EXCEPT ![c]="unknown"]
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
       pending,ackReady,receipts,originalReceipts,effects,handled,highWater,
       lastApplied,active,activeEpoch,position,goal,dropped,retried,lostAck,
       replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>

DropRequest(c) ==
  /\ c \in pending /\ c \notin dropped
  /\ pending'=pending \ {c} /\ dropped'=dropped \cup {c}
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
       ackReady,status,receipts,originalReceipts,effects,handled,highWater,
       lastApplied,active,activeEpoch,position,goal,retried,lostAck,replayed,
       refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>

RetryOriginal(c) ==
  /\ c \in Outstanding /\ status[c]="unknown" /\ c \notin pending /\ c \notin retried
  /\ pending'=pending \cup {c} /\ retried'=retried \cup {c}
  /\ commands'=IF Fault="retry-payload" THEN [commands EXCEPT ![c].kind=IF @="S" THEN "E" ELSE "S"] ELSE commands
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,originals,ackReady,
       status,receipts,originalReceipts,effects,handled,highWater,lastApplied,
       active,activeEpoch,position,goal,dropped,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>

\* 原 Receipt 先于 epoch/seq/方向重解；首次领域拒绝也消耗处理水位。
Handle(c,domainOK) ==
  LET first == receipts[c].status="none"
      eligible == first /\ (commands[c].epoch=epoch \/ Fault="epoch")
                  /\ (commands[c].seq>highWater \/ Fault="late")
      target == Target(IF Fault="stale-origin" THEN commands[c].issuedOrigin ELSE position,commands[c].kind)
      legal == domainOK /\ target \in Positions
      accepted == eligible /\ legal
      apply == accepted \/ (~first /\ receipts[c].status="accepted" /\ Fault="replay-effect")
      consumes == eligible /\ ~(~legal /\ Fault="domain-water")
                  /\ ~(commands[c].kind="stop" /\ Fault="stop-fence")
      water == IF consumes THEN commands[c].seq ELSE highWater
      fresh == [status|->IF accepted THEN "accepted" ELSE "rejected",
                epoch|->commands[c].epoch,decidedEpoch|->epoch,seq|->commands[c].seq,
                origin|->position,target|->IF accepted THEN target ELSE position,observedWater|->water]
      stored == IF first THEN fresh ELSE IF Fault="retry-rebase"
                THEN [receipts[c] EXCEPT !.origin=position] ELSE receipts[c]
      refused == eligible /\ ~legal
      nextActive == IF apply THEN commands[c].kind#"stop"
                    ELSE IF (refused /\ Fault="reject-route") \/ (~first /\ Fault="replay-route") THEN FALSE ELSE active
      nextGoal == IF apply THEN IF target \in Positions THEN target ELSE position
                  ELSE IF (refused /\ Fault="reject-route") \/ (~first /\ Fault="replay-route") THEN position ELSE goal
      nextApplied == IF apply THEN commands[c].seq ELSE lastApplied
  IN /\ Mode \in {"authority","order"} /\ c \in pending /\ domainOK \in BOOLEAN
     /\ pending'=pending \ {c} /\ ackReady'=ackReady \cup {c}
     /\ receipts'=[receipts EXCEPT ![c]=stored]
     /\ originalReceipts'=IF first THEN [originalReceipts EXCEPT ![c]=fresh] ELSE originalReceipts
     /\ effects'=IF apply THEN [effects EXCEPT ![c]=@+1] ELSE effects
     /\ handled'=IF eligible THEN handled \cup {c} ELSE handled
     /\ highWater'=water /\ lastApplied'=nextApplied /\ active'=nextActive
     /\ activeEpoch'=IF apply THEN commands[c].epoch ELSE activeEpoch
     /\ goal'=nextGoal
     /\ replayed'=IF ~first /\ c \in retried /\ c \in lostAck THEN replayed \cup {c} ELSE replayed
     /\ replayedMoved'=(replayedMoved \/ (~first /\ c \in retried /\ c \in lostAck /\ receipts[c].status="accepted" /\ position#receipts[c].origin))
     /\ replayPreserved'=(replayPreserved /\ (first \/ (nextActive=active /\ nextGoal=goal /\ nextApplied=lastApplied /\ water=highWater)))
     /\ replayContext'=IF ~first /\ receipts[c].status="accepted" /\ c \in retried /\ c \in lostAck
       THEN replayContext \cup (IF highWater>commands[c].seq THEN {"newer"} ELSE {})
         \cup (IF \E n \in HandledNow: commands[n].seq>commands[c].seq /\ receipts[n].status="rejected" THEN {"refusal"} ELSE {})
         \cup (IF commands[c].binding#binding /\ \E n \in AcceptedNow: commands[n].seq>commands[c].seq /\ commands[n].binding=binding THEN {"new-binding"} ELSE {})
       ELSE replayContext
     /\ refusedActive'=(refusedActive \/ (refused /\ active))
     /\ refusalPreserved'=(refusalPreserved /\ (~refused \/ (nextActive=active /\ nextGoal=goal /\ nextApplied=lastApplied)))
     /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
          status,position,dropped,retried,lostAck,oldAckNewBinding>>

Receive(c) ==
  /\ c \in ackReady /\ ackReady'=ackReady \ {c}
  /\ status'=[status EXCEPT ![c]=receipts[c].status]
  /\ oldAckNewBinding'=(oldAckNewBinding \/ (commands[c].binding#binding /\ \E n \in 1..issued: commands[n].binding=binding /\ commands[n].seq>commands[c].seq))
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
       pending,receipts,originalReceipts,effects,handled,highWater,lastApplied,
       active,activeEpoch,position,goal,dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext>>
LoseAck(c) ==
  /\ c \in ackReady /\ ackReady'=ackReady \ {c} /\ lostAck'=lostAck \cup {c}
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
       pending,status,receipts,originalReceipts,effects,handled,highWater,lastApplied,
       active,activeEpoch,position,goal,dropped,retried,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>
QueryOriginal(c) ==
  /\ c \in Outstanding /\ receipts[c].status#"none"
  /\ status'=[status EXCEPT ![c]=receipts[c].status]
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
       pending,ackReady,receipts,originalReceipts,effects,handled,highWater,lastApplied,
       active,activeEpoch,position,goal,dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>

Walk ==
  /\ active /\ position#goal /\ position'=goal /\ active'=FALSE
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,
       pending,ackReady,status,receipts,originalReceipts,effects,handled,highWater,
       lastApplied,activeEpoch,goal,dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>
Rebind ==
  /\ binding=0 /\ binding'=1
  /\ UNCHANGED <<epoch,clientEpoch,localSeq,issued,commands,originals,pending,ackReady,
       status,receipts,originalReceipts,effects,handled,highWater,lastApplied,active,
       activeEpoch,position,goal,dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>
ChangeEpoch ==
  /\ Mode="authority" /\ epoch=0 /\ epoch'=1 /\ highWater'=0 /\ lastApplied'=0 /\ active'=FALSE
  /\ UNCHANGED <<clientEpoch,binding,localSeq,issued,commands,originals,pending,ackReady,
       status,receipts,originalReceipts,effects,handled,activeEpoch,position,goal,
       dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>
BindEpoch ==
  /\ clientEpoch#epoch /\ clientEpoch'=epoch /\ localSeq'=0
  /\ UNCHANGED <<epoch,binding,issued,commands,originals,pending,ackReady,status,
       receipts,originalReceipts,effects,handled,highWater,lastApplied,active,
       activeEpoch,position,goal,dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>
BadType ==
  /\ Fault="type" /\ highWater'=-1
  /\ UNCHANGED <<epoch,clientEpoch,binding,localSeq,issued,commands,originals,pending,
       ackReady,status,receipts,originalReceipts,effects,handled,lastApplied,
       active,activeEpoch,position,goal,dropped,retried,lostAck,replayed,refusedActive,refusalPreserved,replayedMoved,replayPreserved,replayContext,oldAckNewBinding>>

\* 输入有限，所有原请求已有确定结果且网络清空才可静止终结。
Done == issued=MaxCommands /\ Outstanding={} /\ pending={} /\ ackReady={} /\ UNCHANGED vars
Next == (\E k \in Kinds: Issue(k))
        \/ (\E c \in Ids: Unknown(c) \/ DropRequest(c) \/ RetryOriginal(c)
            \/ (\E legal \in BOOLEAN: Handle(c,legal)) \/ Receive(c) \/ LoseAck(c) \/ QueryOriginal(c))
        \/ Walk \/ Rebind \/ ChangeEpoch \/ BindEpoch \/ BadType \/ Done
Spec == Init /\ [][Next]_vars

TypeOK == epoch \in 0..1 /\ clientEpoch \in 0..1 /\ binding \in 0..1
  /\ issued \in 0..MaxCommands /\ localSeq \in 0..MaxCommands
  /\ commands \in [Ids -> [epoch:0..1,seq:0..MaxCommands,kind:Kinds,binding:0..1,issuedOrigin:Positions]]
  /\ originals \in [Ids -> [epoch:0..1,seq:0..MaxCommands,kind:Kinds,binding:0..1,issuedOrigin:Positions]]
  /\ pending \subseteq Ids /\ ackReady \subseteq Ids /\ handled \subseteq Ids
  /\ status \in [Ids -> {"unissued","waiting","unknown","accepted","rejected"}]
  /\ receipts \in [Ids -> ReceiptRecords] /\ originalReceipts \in [Ids -> ReceiptRecords]
  /\ effects \in [Ids -> 0..2] /\ highWater \in 0..MaxCommands /\ lastApplied \in 0..MaxCommands
  /\ active \in BOOLEAN /\ activeEpoch \in 0..1 /\ position \in Positions /\ goal \in Positions
  /\ dropped \subseteq Ids /\ retried \subseteq Ids /\ lostAck \subseteq Ids /\ replayed \subseteq Ids
  /\ refusedActive \in BOOLEAN /\ refusalPreserved \in BOOLEAN /\ replayedMoved \in BOOLEAN /\ replayPreserved \in BOOLEAN
  /\ replayContext \subseteq {"newer","refusal","new-binding"} /\ oldAckNewBinding \in BOOLEAN
CommandWatermark == highWater=LatestHandled
AppliedOrder == lastApplied=LatestAccepted
ReceiptStable == receipts=originalReceipts /\ (\A c \in Ids: effects[c]<=1)
StopFence == LatestIsStop => ~active
EpochFence == active => activeEpoch=epoch
RejectedRoutePreserved == refusalPreserved
OutstandingBudget == Cardinality(Moves)<=2 /\ Cardinality(Stops)<=1
DirectionOriginCurrent == \A c \in AcceptedNow: receipts[c].target=Target(receipts[c].origin,commands[c].kind)
OriginalRequestIdentity == commands=originals
ReplayPreservesCurrent == replayPreserved

\* 否定可达情景的见证配置预期 rc=12；不能计作正配置 PASS。
NoIssueWitness == issued=0
NoRejectedWaterWitness == ~\E c \in HandledNow: receipts[c].status="rejected" /\ commands[c].seq=highWater
NoLateRejectedWitness == ~\E c \in 1..issued: receipts[c].status="rejected" /\ receipts[c].observedWater>commands[c].seq
NoReplayWitness == ~\E c \in replayed: receipts[c].status="accepted" /\ receipts[c]=originalReceipts[c] /\ effects[c]=1
NoMovedRetryWitness == ~replayedMoved
NoStopFenceWitness == ~(LatestIsStop /\ ~active /\ ~NoLateRejectedWitness)
NoEpochRejectedWitness == ~\E c \in 1..issued: receipts[c].status="rejected" /\ receipts[c].epoch<receipts[c].decidedEpoch
NoRefusalWitness == ~refusedActive
NoFullBudgetWitness == ~(Cardinality(Moves)=2 /\ Cardinality(Stops)=1 /\ binding=1 /\ \E c \in Moves: commands[c].binding=0)
NoFreshOriginWitness == ~\E c \in AcceptedNow: commands[c].issuedOrigin#receipts[c].origin
NoReplayAfterNewerWitness == "newer" \notin replayContext
NoReplayAfterRefusalWitness == "refusal" \notin replayContext
NoReplayAfterNewBindingWitness == "new-binding" \notin replayContext
NoOldAckNewBindingWitness == ~oldAckNewBinding
NoReplayWithNewMovingRouteWitness == ~("new-binding" \in replayContext /\ active /\ \E c \in AcceptedNow: commands[c].seq=lastApplied /\ commands[c].kind \in Directions /\ goal=receipts[c].target)
=============================================================================
