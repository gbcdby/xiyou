------------------------- MODULE SpatialSupply -------------------------
EXTENDS Naturals, Integers, FiniteSets, Sequences
CONSTANTS Fault, MaxJobs, MaxHead, Scenario

\* 单真实连接及一次替换连接；每连接至多一次换 view。每次读取只取一事务页。
\* Read、真实队列入队、客户端 ACK 回调、Promise 续体是不同动作。
\* packetCreate 的真伪由底层已审实现负责；Enqueue 是该事实的抽象接口。
VARIABLES connected, link, view, installed, sent, baseline, proof, head,
          issued, jobs, active, waiting, pubDemand, pubSignals, wire, deferred,
          clientBinding, clientCursor, applied, staleAdvance, gap, ordered,
          oldInstallRejected, failedSend, staleRejected, appliedKinds, lateOldReceived
vars == <<connected,link,view,installed,sent,baseline,proof,head,issued,jobs,
          active,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,
          clientCursor,applied,staleAdvance,gap,ordered,oldInstallRejected,
          failedSend,staleRejected,appliedKinds,lateOldReceived>>
Ids == 1..MaxJobs
Links == 0..1
ActiveOn(l) == {j \in active: jobs[j].link=l}
WaitingOn(l) == {j \in waiting: jobs[j].link=l}
Deliverable == {i \in 1..Len(wire): \A n \in 1..(i-1): wire[n].link#wire[i].link}
RemoveAt(s,i) == SubSeq(s,1,i-1) \o SubSeq(s,i+1,Len(s))
Keys == {<<l,v>>: l \in 0..1, v \in 0..1}
NoKey == <<-1,-1>>
EventKeys == {<<k,n>>: k \in Keys,n \in 1..MaxHead}
Key == <<link,view>>
JobKey(j) == <<jobs[j].link,jobs[j].view>>
Minimum(a,b) == IF a<b THEN a ELSE b
Maximum(a,b) == IF a>b THEN a ELSE b
Current(j) == connected /\ JobKey(j)=Key /\ sent>=0
EmptyJob == [kind|->"rpc",link|->0,view|->0,requested|->0,from|->0,through|->0,phase|->"unused"]
Job(k,c) == [kind|->k,link|->link,view|->view,requested|->c,from|->0,through|->0,phase|->"read"]
Packet(k,l,v,f,t) == [kind|->k,link|->l,view|->v,from|->f,through|->t]
PacketKey(p) == <<p.link,p.view>>
ValidPacket(p) == connected /\ PacketKey(p)=Key
BatchApplicable(p) == ValidPacket(p) /\ clientBinding=Key /\ p.from=clientCursor
Duplicate(p) == ValidPacket(p) /\ clientBinding=Key /\ p.through<=clientCursor
Bump(p) == IF Fault="omit-apply" THEN applied ELSE [e \in EventKeys |-> applied[e]+(IF e[1]=PacketKey(p) /\ e[2]>p.from /\ e[2]<=p.through THEN IF Fault="double-apply" THEN 2 ELSE 1 ELSE 0)]

Init ==
  /\ connected=TRUE /\ link=0 /\ view=0 /\ installed=0 /\ sent=-1 /\ head=0
  /\ baseline=[k \in Keys |-> IF k= <<0,0>> THEN 0 ELSE -1]
  /\ proof=[k \in Keys |-> -1] /\ issued=0 /\ jobs=[j \in Ids |-> EmptyJob]
  /\ active={} /\ waiting={} /\ pubDemand=[l \in Links |-> 0] /\ pubSignals=[l \in Links |-> 0]
  /\ wire= <<>> /\ deferred= <<>> /\ clientBinding=NoKey /\ clientCursor=-1
  /\ applied=[e \in EventKeys |-> 0] /\ staleAdvance=FALSE /\ gap=FALSE /\ ordered=TRUE
  /\ oldInstallRejected=FALSE /\ failedSend=FALSE /\ staleRejected=FALSE /\ appliedKinds= <<>> /\ lateOldReceived=FALSE

Commit ==
  /\ head<MaxHead /\ head'=head+1
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,issued,
       jobs,active,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,
       clientCursor,applied,staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,
       appliedKinds,lateOldReceived>>

SnapshotEnqueue ==
  /\ connected /\ sent=-1
  /\ sent'=installed
  /\ proof'=(IF Fault="fake-enqueue" THEN proof ELSE [proof EXCEPT ![Key]=installed])
  /\ wire'=(IF Fault="fake-enqueue" THEN wire ELSE Append(wire,Packet("snapshot",link,view,installed,installed)))
  /\ UNCHANGED <<connected,link,view,installed,baseline,head,issued,jobs,
       active,waiting,pubDemand,pubSignals,deferred,clientBinding,clientCursor,applied,
       staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,appliedKinds,lateOldReceived>>

RequestRpc(c) ==
  /\ connected /\ sent>=0 /\ issued<MaxJobs /\ c \in 0..(MaxHead+1)
  /\ (ActiveOn(link)={} \/ Cardinality(WaitingOn(link))<1 \/ Fault="parallel-read" \/ Fault="waiting-overflow")
  /\ issued'=issued+1 /\ jobs'=[jobs EXCEPT ![issued+1]=Job("rpc",c)]
  /\ active'=(IF ActiveOn(link)={} \/ Fault="parallel-read" THEN active \cup {issued+1} ELSE active)
  /\ waiting'=(IF ActiveOn(link)={} \/ Fault="parallel-read" THEN waiting ELSE waiting \cup {issued+1})
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       pubDemand,pubSignals,wire,deferred,clientBinding,clientCursor,applied,staleAdvance,
       gap,ordered,oldInstallRejected,failedSend,staleRejected,appliedKinds,lateOldReceived>>

PublisherDemand ==
  /\ pubSignals[link]<2 /\ pubSignals'=[pubSignals EXCEPT ![link]=@+1]
  /\ pubDemand'=[pubDemand EXCEPT ![link]=IF Fault="publisher-overflow" THEN @+1 ELSE 1]
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,jobs,active,waiting,wire,deferred,clientBinding,clientCursor,
       applied,staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,appliedKinds,lateOldReceived>>

StartRpc(j) ==
  /\ j \in waiting /\ ActiveOn(jobs[j].link)={}
  /\ active'=active \cup {j} /\ waiting'=waiting \ {j}
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,jobs,pubDemand,pubSignals,wire,deferred,clientBinding,clientCursor,
       applied,staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,appliedKinds,lateOldReceived>>

StartPublisher ==
  /\ connected /\ sent>=0 /\ ActiveOn(link)={} /\ WaitingOn(link)={} /\ pubDemand[link]>0 /\ issued<MaxJobs
  /\ issued'=issued+1 /\ jobs'=[jobs EXCEPT ![issued+1]=Job("push",sent)]
  /\ active'=active \cup {issued+1} /\ pubDemand'=[pubDemand EXCEPT ![link]=0]
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       waiting,pubSignals,wire,deferred,clientBinding,clientCursor,applied,staleAdvance,
       gap,ordered,oldInstallRejected,failedSend,staleRejected,appliedKinds,lateOldReceived>>

Read(j) ==
  LET start == IF jobs[j].kind="push" THEN sent ELSE jobs[j].requested
      ceiling == IF jobs[j].kind="rpc" /\ start<sent THEN sent ELSE head
      through == Minimum(start+1,ceiling)
  IN /\ j \in active /\ jobs[j].phase="read" /\ Current(j)
     /\ start<=head /\ (start<=sent \/ Fault="trust-cursor")
     /\ jobs'=[jobs EXCEPT ![j].from=start,![j].through=through,![j].phase="candidate"]
     /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,active,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,
       clientCursor,applied,staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,
       appliedKinds,lateOldReceived>>

Discard(j) ==
  /\ j \in active
  /\ (~Current(j) \/ (jobs[j].phase="read" /\ jobs[j].requested>sent /\ jobs[j].kind="rpc")
     \/ (jobs[j].phase="candidate" /\ jobs[j].from#sent /\ jobs[j].through>sent))
  /\ active'=active \ {j} /\ jobs'=[jobs EXCEPT ![j].phase="done"]
  /\ staleRejected'=(staleRejected \/ JobKey(j)#Key)
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,clientCursor,
       applied,staleAdvance,gap,ordered,oldInstallRejected,failedSend,appliedKinds,lateOldReceived>>

Enqueue(j) ==
  LET f == jobs[j].from
      t == jobs[j].through
      k == JobKey(j)
      contiguous == f=sent \/ (f<sent /\ t<=sent)
      packet == Packet(IF jobs[j].kind="rpc" THEN "ack" ELSE "push",jobs[j].link,jobs[j].view,f,t)
  IN /\ j \in active /\ jobs[j].phase="candidate"
     /\ (Current(j) \/ Fault="stale-binding")
     /\ (contiguous \/ Fault="trust-cursor" \/ Fault="stale-binding")
     /\ active'=active \ {j} /\ jobs'=[jobs EXCEPT ![j].phase="done"]
     /\ wire'=(IF Fault="fake-enqueue" THEN wire ELSE Append(wire,packet))
     /\ proof'=(IF Fault="fake-enqueue" THEN proof ELSE [proof EXCEPT ![k]=IF f=@ THEN Maximum(@,t) ELSE @])
     /\ sent'=Maximum(sent,t)
     /\ installed'=(IF Fault="overwrite-installed" THEN Maximum(installed,t) ELSE installed)
     /\ staleAdvance'=(staleAdvance \/ (~Current(j) /\ t>sent))
     /\ gap'=(gap \/ (~contiguous))
     /\ UNCHANGED <<connected,link,view,baseline,head,issued,waiting,pubDemand,
       pubSignals,deferred,clientBinding,clientCursor,applied,ordered,oldInstallRejected,failedSend,
       staleRejected,appliedKinds,lateOldReceived>>

SendFailure(j) ==
  /\ j \in active /\ jobs[j].phase="candidate" /\ ~failedSend
  /\ active'=active \ {j} /\ jobs'=[jobs EXCEPT ![j].phase="done"] /\ failedSend'=TRUE
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,clientCursor,
       applied,staleAdvance,gap,ordered,oldInstallRejected,staleRejected,appliedKinds,lateOldReceived>>

ReplaceView ==
  /\ Scenario \in {"full","view"} /\ connected /\ view=0 /\ view'=1 /\ installed'=head /\ sent'=-1
  /\ baseline'=[baseline EXCEPT ![<<link,1>>]=head]
  /\ clientBinding'=NoKey /\ clientCursor'=-1 /\ appliedKinds'= <<>>
  /\ UNCHANGED <<connected,link,proof,head,issued,jobs,active,waiting,
       pubDemand,pubSignals,wire,deferred,applied,staleAdvance,gap,ordered,
       oldInstallRejected,failedSend,staleRejected,lateOldReceived>>

Disconnect ==
  /\ Scenario \in {"full","reconnect"} /\ connected /\ link=0 /\ connected'=FALSE
  /\ clientBinding'=NoKey /\ clientCursor'=-1 /\ appliedKinds'= <<>>
  /\ UNCHANGED <<link,view,installed,sent,baseline,proof,head,issued,
       jobs,active,waiting,pubDemand,pubSignals,wire,deferred,applied,
       staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,lateOldReceived>>

Reconnect ==
  /\ ~connected /\ link=0 /\ connected'=TRUE /\ link'=1 /\ view'=0
  /\ installed'=head /\ sent'=-1 /\ baseline'=[baseline EXCEPT ![<<1,0>>]=head]
  /\ UNCHANGED <<proof,head,issued,jobs,active,waiting,pubDemand,pubSignals,
       wire,deferred,clientBinding,clientCursor,applied,staleAdvance,gap,ordered,
       oldInstallRejected,failedSend,staleRejected,appliedKinds,lateOldReceived>>

OldInstallAttempt ==
  /\ connected /\ sent>installed /\ ~oldInstallRejected
  /\ oldInstallRejected'=TRUE
  /\ sent'=(IF Fault="old-install" THEN installed ELSE sent)
  /\ UNCHANGED <<connected,link,view,installed,baseline,proof,head,issued,
       jobs,active,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,
       clientCursor,applied,staleAdvance,gap,ordered,failedSend,staleRejected,appliedKinds,lateOldReceived>>

ReceiveSnapshot(i) ==
  /\ i \in Deliverable /\ wire[i].kind="snapshot"
  /\ lateOldReceived'=(lateOldReceived \/ (wire[i].link<link /\ clientBinding=Key /\ clientCursor>baseline[Key]))
  /\ wire'=RemoveAt(wire,i)
  /\ clientBinding'=(IF ValidPacket(wire[i]) \/ Fault="old-snapshot" THEN PacketKey(wire[i]) ELSE clientBinding)
  /\ clientCursor'=(IF ValidPacket(wire[i]) \/ Fault="old-snapshot" THEN wire[i].through ELSE clientCursor)
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,jobs,active,waiting,pubDemand,pubSignals,deferred,applied,
       staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,appliedKinds>>

ReceiveBatch(i) ==
  LET p == wire[i]
      postpone == p.kind="ack" /\ Fault="ack-after-push"
      apply == ~postpone /\ BatchApplicable(p)
  IN /\ i \in Deliverable /\ p.kind#"snapshot"
     /\ lateOldReceived'=(lateOldReceived \/ (wire[i].link<link /\ clientBinding=Key /\ clientCursor>baseline[Key]))
     /\ wire'=RemoveAt(wire,i)
     /\ deferred'=(IF postpone THEN Append(deferred,p) ELSE deferred)
     /\ clientCursor'=(IF apply THEN p.through ELSE clientCursor)
     /\ applied'=(IF apply THEN Bump(p) ELSE applied)
     /\ appliedKinds'=(IF apply /\ p.through>p.from THEN Append(appliedKinds,p.kind) ELSE appliedKinds)
     /\ ordered'=(ordered /\ (postpone \/ ~ValidPacket(p) \/ BatchApplicable(p) \/ Duplicate(p)))
     /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,jobs,active,waiting,pubDemand,pubSignals,clientBinding,staleAdvance,
       gap,oldInstallRejected,failedSend,staleRejected>>

PromiseContinuation ==
  LET p == Head(deferred)
      apply == BatchApplicable(p)
  IN /\ Len(deferred)>0 /\ deferred'=Tail(deferred)
     /\ clientCursor'=(IF apply THEN p.through ELSE clientCursor)
     /\ applied'=(IF apply THEN Bump(p) ELSE applied)
     /\ appliedKinds'=(IF apply /\ p.through>p.from THEN Append(appliedKinds,p.kind) ELSE appliedKinds)
     /\ ordered'=(ordered /\ (~ValidPacket(p) \/ BatchApplicable(p) \/ Duplicate(p)))
     /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,head,
       issued,jobs,active,waiting,pubDemand,pubSignals,wire,clientBinding,
       staleAdvance,gap,oldInstallRejected,failedSend,staleRejected,lateOldReceived>>

BadType ==
  /\ Fault="type" /\ head'=-1
  /\ UNCHANGED <<connected,link,view,installed,sent,baseline,proof,issued,
       jobs,active,waiting,pubDemand,pubSignals,wire,deferred,clientBinding,
       clientCursor,applied,staleAdvance,gap,ordered,oldInstallRejected,failedSend,staleRejected,
       appliedKinds,lateOldReceived>>


Next == Commit \/ SnapshotEnqueue \/ (\E c \in 0..(MaxHead+1): RequestRpc(c))
        \/ PublisherDemand \/ (\E j \in Ids: StartRpc(j) \/ Read(j) \/ Discard(j) \/ Enqueue(j) \/ SendFailure(j))
        \/ StartPublisher \/ ReplaceView \/ Disconnect \/ Reconnect \/ OldInstallAttempt
        \/ (\E i \in 1..Len(wire): ReceiveSnapshot(i) \/ ReceiveBatch(i)) \/ PromiseContinuation \/ BadType
Spec == Init /\ [][Next]_vars

TypeOK == connected \in BOOLEAN /\ link \in 0..1 /\ view \in 0..1
  /\ head \in 0..MaxHead /\ installed \in 0..MaxHead /\ sent \in -1..MaxHead
  /\ baseline \in [Keys -> -1..MaxHead] /\ proof \in [Keys -> -1..MaxHead]
  /\ issued \in 0..MaxJobs /\ active \subseteq Ids /\ waiting \subseteq Ids
  /\ jobs \in [Ids -> [kind:{"rpc","push"},link:0..1,view:0..1,requested:0..(MaxHead+1),
                         from:0..MaxHead,through:0..MaxHead,phase:{"unused","read","candidate","done"}]]
  /\ pubDemand \in [Links -> 0..2] /\ pubSignals \in [Links -> 0..2]
  /\ clientBinding \in Keys \cup {NoKey} /\ clientCursor \in -1..MaxHead
  /\ applied \in [EventKeys -> 0..2] /\ staleAdvance \in BOOLEAN /\ gap \in BOOLEAN /\ ordered \in BOOLEAN
  /\ oldInstallRejected \in BOOLEAN /\ failedSend \in BOOLEAN /\ staleRejected \in BOOLEAN
  /\ wire \in Seq([kind:{"snapshot","ack","push"},link:0..1,view:0..1,from:0..MaxHead,through:0..MaxHead])
  /\ deferred \in Seq([kind:{"ack"},link:0..1,view:0..1,from:0..MaxHead,through:0..MaxHead])
  /\ appliedKinds \in Seq({"ack","push"}) /\ lateOldReceived \in BOOLEAN
ReadCapacity == (\A l \in Links: Cardinality(ActiveOn(l))<=1 /\ Cardinality(WaitingOn(l))<=1 /\ pubDemand[l]<=1) /\ active \cap waiting={}
InstalledSeparate == installed=baseline[Key]
SentPrefix == sent=proof[Key] /\ (sent=-1 \/ sent>=installed) /\ ~gap
NoStaleAdvance == ~staleAdvance /\ clientBinding \in {NoKey,Key}
OrderedApplication == ordered
ExactlyOnce == (\A e \in EventKeys: applied[e]<=1)
  /\ IF clientBinding \in Keys THEN \A n \in 1..MaxHead:
       applied[<<clientBinding,n>>]=(IF n>baseline[clientBinding] /\ n<=clientCursor THEN 1 ELSE 0)
     ELSE TRUE

NoBaselineWitness == sent=-1
NoCapacityWitness == ~\E l \in Links: Cardinality(ActiveOn(l))=1 /\ Cardinality(WaitingOn(l))=1 /\ pubDemand[l]=1
NoOldViewWaitingWitness == ~\E a \in active,w \in waiting: JobKey(a)#Key /\ JobKey(w)=Key
NoSeparationWitness == ~(sent>installed)
NoPrefixWitness == ~(sent=MaxHead /\ sent>installed /\ proof[Key]=sent)
NoStaleRejectWitness == ~staleRejected
NoOldInstallWitness == ~oldInstallRejected
NoFailureWitness == ~failedSend
NoAckPushWitness == ~(appliedKinds= <<"ack","push">> /\ clientCursor=2)
NoLateOldLinkWitness == ~lateOldReceived
NoTwoLinkActiveWitness == ~(Cardinality(active)=2 /\ \A l \in Links: Cardinality(ActiveOn(l))=1)
=============================================================================
