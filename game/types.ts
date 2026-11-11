// 本文件由 protocol/scripts/generate.mjs 从 schema.mjs 生成，请修改唯一字段源后重新生成。
export type Id = string;

export type UserId = Id;

export type CharacterId = Id;

export type SessionId = Id;

export type DecimalString = string;

export type PositiveDecimalString = string;

export type UtcTimestamp = string;

export type Digest = string;

export type SessionPhase = "Lobby" | "Running" | "Finished" | "Aborted";

export type ControlMode = "HumanControlled" | "GracePeriod" | "AIProxyControlled" | "CoreNPCControlled" | "Revoked";

export type DecisionStatus = "Pending" | "Committed" | "Rejected" | "Expired" | "Cancelled";

export type ActionKind = "move" | "inspect" | "take_item" | "transfer_item" | "use_item" | "interact" | "share_evidence" | "speak" | "make_claim" | "wait";

export type Scalar = (string) | (number) | (boolean) | (null);

export type FactField = { "key": Id; "label": string; "value": Scalar; };

export type ItemLocation = ({ "kind": "character"; "characterId": CharacterId; }) | ({ "kind": "region"; "regionId": Id; }) | ({ "kind": "consumed"; });

export type Dialogue = { "text": string; "channel": "public" | "directed" | "private"; "recipientIds": Array<Id>; };

export type PublicDialogue = { "text": string; "channel": "public" | "directed"; "recipientIds": Array<Id>; };

export type Action = ({ "kind": "move"; "regionId": Id; }) | ({ "kind": "inspect"; "targetId": Id; }) | ({ "kind": "take_item"; "itemId": Id; "expectedItemRevision": DecimalString; }) | ({ "kind": "transfer_item"; "itemId": Id; "targetId": CharacterId; "expectedItemRevision": DecimalString; }) | ({ "kind": "use_item"; "itemIds": Array<Id>; "expectedItemRevisions": Record<string, DecimalString>; "targetId": Id; "expectedTargetRevision": DecimalString; "operation": Id; }) | ({ "kind": "interact"; "targetId": Id; "operation": Id; "expectedTargetRevision": DecimalString; }) | ({ "kind": "share_evidence"; "evidenceId": Id; "recipientIds": Array<Id>; }) | ({ "kind": "speak"; "text": string; "channel": "public" | "directed" | "private"; "recipientIds": Array<Id>; }) | ({ "kind": "make_claim"; "text": string; "channel": "public" | "directed" | "private"; "recipientIds": Array<Id>; }) | ({ "kind": "wait"; });

export type ClientAction = { "schemaVersion": 1; "sessionId": SessionId; "actorId": CharacterId; "clientActionId": Id; "controlEpoch": DecimalString; "baseSeq": DecimalString; "action": Action; };

export type DedupeKey = { "sessionId": SessionId; "principalId": Id; "clientActionId": Id; };

export type EventRange = { "first": PositiveDecimalString; "last": PositiveDecimalString; };

export type ReceiptResult = { "message"?: string; "observationIds"?: Array<Id>; "changedEntityIds"?: Array<Id>; };

export type AcceptedCode = "OK" | "NO_CHANGE";

export type RejectedCode = "SESSION_NOT_RUNNING" | "STALE_CONTROL" | "TARGET_UNAVAILABLE" | "STALE_PRECONDITION" | "ACTION_ID_REUSE" | "DECISION_STALE" | "DECISION_EXPIRED" | "FUTURE_BASE_SEQ" | "CONTROL_HELD" | "RULE_VIOLATION" | "NOT_READY" | "ROOM_FULL";

export type ErrorCode = "INVALID_MESSAGE" | "UNAUTHENTICATED" | "FORBIDDEN" | "SESSION_GONE" | "RESYNC_REQUIRED" | "OUTCOME_UNKNOWN" | "CONTROL_HELD" | "ACTION_ID_REUSE";

export type ErrorResponse = { "schemaVersion": 1; "code": ErrorCode; "message"?: string; };

export type TrustedExecutionContext = { "principalId": Id; "principalKind": "human" | "core_npc" | "proxy" | "system"; "sessionId": SessionId; "actorId"?: CharacterId; "userId"?: UserId; "connectionId"?: Id; "authenticatedAt": UtcTimestamp; };

export type ObservationSource = { "kind": "initial_content" | "inspection" | "event" | "speech" | "evidence_share"; "sourceIds": Array<Id>; "sourceSeq": DecimalString; };

export type Observation = { "observationId": Id; "observerId": CharacterId; "category": "WorldFact" | "Claim" | "Evidence"; "source": ObservationSource; "statement": string; "subjectId"?: Id; "fields": Array<FactField>; "shareable": boolean; };

export type Claim = { "claimId": Id; "speakerId": CharacterId; "text": string; "channel": "public" | "directed" | "private"; "recipientIds": Array<Id>; };

export type Belief = { "beliefId": Id; "holderId": CharacterId; "statement": string; "confidence": "uncertain" | "likely" | "confident"; "basedOnObservationIds": Array<Id>; "revision": DecimalString; };

export type BeliefProposal = { "beliefId": Id; "statement": string; "confidence": "uncertain" | "likely" | "confident"; "basedOnObservationIds": Array<Id>; };

export type Goal = { "goalId": Id; "holderId": CharacterId; "label": string; "status": "active" | "completed" | "abandoned"; "revision": DecimalString; };

export type ProposedIntent = { "decisionId": Id; "toolCalls": Array<Action>; "dialogue"?: PublicDialogue; "beliefUpdates"?: Array<BeliefProposal>; };

export type DecisionRecord = { "schemaVersion": 1; "sessionId": SessionId; "actorId": CharacterId; "decisionId": Id; "controlEpoch": DecimalString; "generation": DecimalString; "observationIds": Array<Id>; "readVersions": Record<string, DecimalString>; "allowedTools": Array<ActionKind>; "createdAt": UtcTimestamp; "deadlineAt": UtcTimestamp; "status": DecisionStatus; };

export type Audience = { "humanCharacterIds": Array<Id>; "coreNpcCharacterIds": Array<Id>; "proxyCharacterIds": Array<Id>; };

export type EventCause = { "principalId": Id; "actionId": Id; "actorId"?: CharacterId; "decisionId"?: Id; "toolCallIndex"?: number; };

export type CharacterView = { "characterId": CharacterId; "name": string; "regionId": (Id) | (null); "roles": Array<Id>; "mode": ControlMode; "online": boolean; };

export type SelfView = { "characterId": CharacterId; "name": string; "regionId": (Id) | (null); "roles": Array<Id>; "mode": ControlMode; "controlEpoch": DecimalString; "canControl": boolean; "capabilities": Array<Id>; };

export type RegionView = { "regionId": Id; "name": string; "description": string; "exits": Array<Id>; };

export type ItemView = { "itemId": Id; "name": string; "location": ItemLocation; "resourceRevision": DecimalString; "transferable": boolean; "fields": Array<FactField>; };

export type TargetView = { "targetId": Id; "name": string; "regionId": Id; "resourceRevision": DecimalString; "availableOperations": Array<Id>; "fields": Array<FactField>; };

export type ObjectiveView = { "objectiveId": Id; "label": string; "status": "active" | "completed" | "blocked"; "detail"?: string; };

export type EndingView = { "endingCode": Id; "title": string; "summary": string; "facts": Array<FactField>; "unresolved": Array<string>; };

export type AuthorizedProjection = { "phase": SessionPhase; "contentVersion": Id; "reducerVersion": Id; "self": SelfView; "characters": Array<CharacterView>; "regions": Array<RegionView>; "items": Array<ItemView>; "targets": Array<TargetView>; "observations": Array<Observation>; "claims": Array<Claim>; "objectives": Array<ObjectiveView>; "ending": (EndingView) | (null); "deadlineAt": (UtcTimestamp) | (null); };

export type AuthorizedSnapshot = { "schemaVersion": 1; "type": "world.snapshot"; "sessionId": SessionId; "viewId": Id; "snapshotSeq": DecimalString; "projection": AuthorizedProjection; };

export type SyncRequest = { "schemaVersion": 1; "type": "sync.request"; "sessionId": SessionId; "viewId": Id; "cursor": DecimalString; };

export type ControlRequest = { "schemaVersion": 1; "type": "control.resume" | "control.take"; "sessionId": SessionId; "actorId": CharacterId; "nonce": Id; };

export type ControlResponse = { "schemaVersion": 1; "sessionId": SessionId; "actorId": CharacterId; "nonce": Id; "controlEpoch": DecimalString; "mode": ControlMode; "observedSeq": DecimalString; };

export type OutboxRecord = { "schemaVersion": 1; "sessionId": SessionId; "fromExclusive": DecimalString; "throughSeq": DecimalString; "status": "Pending" | "Published"; "attempts": number; };

export type ActionReceipt = ({ "schemaVersion": 1; "semanticDigest": Digest; "actorId": CharacterId; "observedSeq": DecimalString; "actionEventRange": (EventRange) | (null); "result": ReceiptResult; "key": DedupeKey; "status": "Accepted"; "code": AcceptedCode; }) | ({ "schemaVersion": 1; "semanticDigest": Digest; "actorId": CharacterId; "observedSeq": DecimalString; "actionEventRange": null; "result": ReceiptResult; "key": DedupeKey; "status": "Rejected"; "code": RejectedCode; });

export type ClientReceipt = ({ "schemaVersion": 1; "semanticDigest": Digest; "actorId": CharacterId; "observedSeq": DecimalString; "actionEventRange": (EventRange) | (null); "result": ReceiptResult; "sessionId": SessionId; "clientActionId": Id; "status": "Accepted"; "code": AcceptedCode; }) | ({ "schemaVersion": 1; "semanticDigest": Digest; "actorId": CharacterId; "observedSeq": DecimalString; "actionEventRange": null; "result": ReceiptResult; "sessionId": SessionId; "clientActionId": Id; "status": "Rejected"; "code": RejectedCode; });

export type WorldEvent = ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "session.created"; "payload": { "contentVersion": Id; "reducerVersion": Id; "hostUserId": UserId; "seed": Id; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "session.member_joined"; "payload": { "userId": UserId; "characterId": CharacterId; "name": string; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "session.started"; "payload": { "deadlineAt": UtcTimestamp; "characterIds": Array<Id>; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "session.finished"; "payload": { "endingCode": Id; "facts": Array<FactField>; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "session.aborted"; "payload": { "reason": string; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "control.changed"; "payload": { "actorId": CharacterId; "mode": ControlMode; "controlEpoch": DecimalString; "activeConnectionId": (Id) | (null); "graceDeadlineAt": (UtcTimestamp) | (null); }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "character.moved"; "payload": { "actorId": CharacterId; "from": Id; "to": Id; "resourceRevision": DecimalString; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "item.taken"; "payload": { "itemId": Id; "from": ItemLocation; "to": CharacterId; "resourceRevision": DecimalString; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "item.transferred"; "payload": { "itemId": Id; "from": CharacterId; "to": CharacterId; "resourceRevision": DecimalString; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "item.used"; "payload": { "itemId": Id; "actorId": CharacterId; "targetId": Id; "operation": Id; "consumed": boolean; "resourceRevision": DecimalString; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "target.updated"; "payload": { "targetId": Id; "resourceRevision": DecimalString; "fields": Array<FactField>; }; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "ClaimRecorded"; "payload": Claim; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "ObservationRecorded"; "payload": Observation; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "BeliefUpdated"; "payload": Belief; }) | ({ "schemaVersion": 1; "sessionId": SessionId; "sessionSeq": PositiveDecimalString; "eventId": string; "causedBy": EventCause; "serverTime": UtcTimestamp; "audience": Audience; "kind": "GoalUpdated"; "payload": Goal; });

export type ClientEvent = ({ "sessionSeq": PositiveDecimalString; "eventId": string; "kind": "projection.replace"; "payload": { "projection": AuthorizedProjection; }; }) | ({ "sessionSeq": PositiveDecimalString; "eventId": string; "kind": "ClaimRecorded"; "payload": Claim; }) | ({ "sessionSeq": PositiveDecimalString; "eventId": string; "kind": "ObservationRecorded"; "payload": Observation; });

export type WorldBatch = { "schemaVersion": 1; "type": "world.batch"; "sessionId": SessionId; "viewId": Id; "fromExclusive": DecimalString; "throughSeq": DecimalString; "events": Array<ClientEvent>; };
