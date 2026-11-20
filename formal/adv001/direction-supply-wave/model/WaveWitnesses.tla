---------------------------- MODULE WaveWitnesses ----------------------------
EXTENDS WaveProgress
VARIABLE observation

\* 纯观察历史，不限制 Next、不改变业务状态。用于核对必须有先后关系的见证。
WitnessInit == Init /\ observation=[failureAfterCommit|->FALSE]
WitnessNext == Next /\ observation'=[observation EXCEPT !.failureAfterCommit=
  @ \/ ("send" \notin s.failures /\ "send" \in s'.failures /\ 1 \in s.actual)]
WitnessSpec == WitnessInit /\ [][WitnessNext]_<<s,observation>>

NotSecondGroupAfterDrain == ~(s.draining /\ s.groupAfterDrain /\ s.group={2}
  /\ s.jobs[1].phase="settled" /\ s.jobs[2].phase="lane")
NotSingleRowFullCycle == ~(s.owner=0 /\ s.overlap /\ s.commitDuringG
  /\ s.groupAfterDrain /\ s.published={1} /\ \A p \in Peers: s.sent[<<p,0>>]=3)
NotLateFailureDrained == ~(observation.failureAfterCommit /\ s.owner=0
  /\ 1 \in s.published /\ s.sent[<<1,0>>]>InitialSent)
NotNextRowWaiting == ~(s.gslots={} /\ s.wave /\ s.next=2 /\ s.published={1})
=============================================================================
