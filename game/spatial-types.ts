// 由 protocol/scripts/generate-spatial.mjs 从 spatial-schema.mjs 生成；请修改唯一字段源。
export type Id = string;

export type DecimalString = string;

export type PositiveDecimalString = string;

export type UtcTimestamp = string;

export type Scalar = (string) | (number) | (boolean) | (null);

export type FactField = { "key": Id; "label": string; "value": Scalar; };

export type EventRange = { "first": PositiveDecimalString; "last": PositiveDecimalString; };

export type EntityRef = string;

export type Position = { "x": number; "y": number; };

export type Polygon = Array<Position>;

export type Facing = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type ActionV2 = ({ "kind": "move_to"; "movementCommandSeq": PositiveDecimalString; "sceneId": Id; "destination": Position; "targetRef"?: EntityRef; "anchorId"?: Id; }) | ({ "kind": "stop_move"; "movementCommandSeq": PositiveDecimalString; }) | ({ "kind": "inspect"; "targetRef": EntityRef; }) | ({ "kind": "take_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; }) | ({ "kind": "put_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "sceneId": Id; "position": Position; }) | ({ "kind": "transfer_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "recipientRef": EntityRef; }) | ({ "kind": "reclaim_public_item"; "itemRef": EntityRef; "holderRef": EntityRef; "expectedItemRevision": DecimalString; "expectedHolderEpoch": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": Id; "expectedTargetRevision": DecimalString; }) | ({ "kind": "cooperate"; "operationId": Id; "operationVersion": DecimalString; "phase": "prepare" | "ready" | "cancel"; }) | ({ "kind": "speak"; "text": string; "channel": "public" | "directed" | "team"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "make_claim"; "text": string; "channel": "public" | "directed" | "team"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "share_evidence"; "evidenceRef": EntityRef; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "wait"; });

export type PublicEnvelope = { "schemaVersion": 2; "sessionId": Id; "viewId": Id; "actorRef": EntityRef; "clientActionId": Id; "controlEpoch": DecimalString; "baseSeq": DecimalString; "action": ActionV2; };

export type SyncRequestV2 = { "schemaVersion": 2; "type": "sync.request"; "sessionId": Id; "viewId": Id; "cursor": DecimalString; };

export type ControlRequestV2 = { "schemaVersion": 2; "type": "control.resume" | "control.take"; "sessionId": Id; "viewId": Id; "actorRef": EntityRef; "nonce": Id; };

export type ReceiptResultV2 = { "movementId"?: EntityRef; "planVersion"?: DecimalString; "movementCommandSeq"?: DecimalString; "status"?: "accepted" | "moving" | "arrived" | "blocked" | "cancelled" | "locked"; "entityRefs"?: Array<EntityRef>; "observationRefs"?: Array<EntityRef>; "message"?: string; };

export type ReceiptV2 = { "schemaVersion": 2; "sessionId": Id; "clientActionId": Id; "status": "Accepted" | "Rejected"; "code": Id; "observedSeq": DecimalString; "actionEventRange": (EventRange) | (null); "result": ReceiptResultV2; };

export type EntityViewV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "motionTrail"?: Array<Position>; "motionFromSceneTimeMs"?: number; "motionThroughSceneTimeMs"?: number; };

export type SelfViewV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "controlEpoch": DecimalString; "canControl": boolean; "capabilities": Array<Id>; "movementCommandHighWater": DecimalString; };

export type ItemViewV2 = { "entityRef": EntityRef; "name": string; "location": ({ "kind": "ground"; "sceneId": Id; "position": Position; }) | ({ "kind": "held"; "ownerRef": EntityRef; }); "resourceRevision": DecimalString; "transferable": boolean; "publicBorrowable": boolean; "fields": Array<FactField>; "reclaimHolderEpoch"?: DecimalString; };

export type TargetViewV2 = { "entityRef": EntityRef; "name": string; "sceneId": Id; "position": Position; "resourceRevision": DecimalString; "availableOperations": Array<Id>; "fields": Array<FactField>; };

export type PlanViewV2 = { "movementId": EntityRef; "planVersion": DecimalString; "movementCommandSeq": DecimalString; "sceneId": Id; "mapVersion": Id; "goal": Position; "path": Array<Position>; "acceptedAtSceneTime": number; "status": "accepted" | "moving" | "arrived" | "blocked" | "cancelled"; "reason"?: string; };

export type ObservationViewV2 = { "observationRef": EntityRef; "category": "WorldFact" | "Evidence" | "Claim"; "statement": string; "sourceSeq": DecimalString; "fields": Array<FactField>; "shareable": boolean; };

export type ClaimViewV2 = { "claimRef": EntityRef; "speakerRef": EntityRef; "speakerName": string; "text": string; "channel": "public" | "directed" | "team"; "sourceSeq": DecimalString; };

export type CooperationViewV2 = { "operationId": Id; "operationVersion": DecimalString; "phase": "preparing" | "locked"; "readyCount": number; "requiredCount": number; "anchors": Array<Position>; };

export type PublicScene = { "sceneId": Id; "name": string; "width": number; "height": number; "unitsPerPixel": number; "walkableAreas": Array<{ "areaId": Id; "polygon": Polygon; }>; "obstacles": Array<{ "obstacleId": Id; "polygon": Polygon; "exceptAreas": Array<Id>; }>; "anchors": Array<{ "anchorId": Id; "position": Position; "label": string; }>; "exits": Array<{ "exitId": Id; "anchorId": Id; "destinationSceneId": Id; "destination": Position; "open": boolean; }>; };

export type ProjectionV2 = { "protocolCapability": "spatial-v2"; "chapterVersion": Id; "mapVersion": Id; "variantId": Id; "contentVersion": Id; "reducerVersion": "spatial-world-v2"; "phase": "Lobby" | "Running" | "Finished" | "Aborted"; "sceneTimeMs": number; "paused": boolean; "self": SelfViewV2; "entities": Array<EntityViewV2>; "items": Array<ItemViewV2>; "targets": Array<TargetViewV2>; "scene": (PublicScene) | (null); "movement": (PlanViewV2) | (null); "observations": Array<ObservationViewV2>; "claims": Array<ClaimViewV2>; "cooperations": Array<CooperationViewV2>; "objectives": Array<{ "objectiveId": Id; "label": string; "status": "active" | "completed" | "blocked"; }>; "ending": ({ "title": string; "summary": string; }) | (null); };

export type SnapshotV2 = { "schemaVersion": 2; "type": "world.snapshot"; "sessionId": Id; "viewId": Id; "snapshotSeq": DecimalString; "projection": ProjectionV2; };

export type BatchV2 = { "schemaVersion": 2; "type": "world.batch"; "sessionId": Id; "viewId": Id; "fromExclusive": DecimalString; "throughSeq": DecimalString; "events": Array<{ "sessionSeq": PositiveDecimalString; "eventId": Id; "kind": "projection.replace"; "payload": { "projection": ProjectionV2; }; }>; };

export type ControlResponseV2 = { "schemaVersion": 2; "sessionId": Id; "nonce": Id; "controlEpoch": DecimalString; "observedSeq": DecimalString; "snapshot": SnapshotV2; };

export type ErrorV2 = { "schemaVersion": 2; "code": Id; "message": string; "requiredCapabilities"?: Array<"spatial-v2">; };
