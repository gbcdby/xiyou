// 由 protocol/scripts/generate-spatial.mjs 从 spatial-schema.mjs 生成；请修改唯一字段源。
export type SpatialClientCapability = "spatial-v2" | "spatial-appearance-v1" | "spatial-object-visual-v1";

export type ObjectVisualKeyV1 = string;

export type AppearanceIdV2 = "neutral" | "gaocai" | "courtyard-helper" | "carpenter" | "kitchen-helper" | "woodcutter" | "tang" | "wukong" | "bajie" | "cuilan" | "gao" | "witness";

export type GaolaoInteractionV2 = ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-contact" | "gz-check-seal" | "gz-try-key" | "gz-step-back" | "gz-break-seal" | "gz-release-appearance" | "gz-reveal-identity" | "gz-check-appearance" | "gz-read-ledger" | "gz-hear-witness" | "gz-show-passage" | "gz-confirm-meeting" | "gz-release-support" | "gz-plan-departure" | "gz-join-party" | "gz-finish-separation"; "expectedTargetRevision": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-confirm-settlement" | "gz-pause-follow" | "gz-apply-appearance"; "expectedTargetRevision": DecimalString; "parameters": { "consentId": EntityRef; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-appearance" | "gz-invite-meeting"; "expectedTargetRevision": DecimalString; "parameters": { "destinationId": Id; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-compare-sources"; "expectedTargetRevision": DecimalString; "parameters": { "evidenceRefs": Array<EntityRef>; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-recruitment-decision" | "gz-membership-decision"; "expectedTargetRevision": DecimalString; "parameters": { "expectedDecisionVersion": DecimalString; "response": "accept" | "decline" | "defer" | "withdraw"; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-return-public"; "expectedTargetRevision": DecimalString; "parameters": { "itemRef": EntityRef; "expectedItemRevision": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-private-items"; "expectedTargetRevision": DecimalString; "parameters": { "itemRefs": Array<EntityRef>; "expectedConsentVersion": DecimalString; }; });

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

export type ActionV2 = ({ "kind": "move_to"; "movementCommandSeq": PositiveDecimalString; "sceneId": Id; "destination": Position; "targetRef"?: EntityRef; "anchorId"?: Id; }) | ({ "kind": "stop_move"; "movementCommandSeq": PositiveDecimalString; }) | ({ "kind": "inspect"; "targetRef": EntityRef; }) | ({ "kind": "take_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; }) | ({ "kind": "put_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "sceneId": Id; "position": Position; }) | ({ "kind": "transfer_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "recipientRef": EntityRef; }) | ({ "kind": "reclaim_public_item"; "itemRef": EntityRef; "holderRef": EntityRef; "expectedItemRevision": DecimalString; "expectedHolderEpoch": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": string; "expectedTargetRevision": DecimalString; }) | (GaolaoInteractionV2) | ({ "kind": "cooperate"; "operationId": Id; "operationVersion": DecimalString; "phase": "prepare" | "ready" | "cancel"; }) | ({ "kind": "speak"; "text": string; "channel": "public" | "directed" | "team"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "make_claim"; "text": string; "channel": "public" | "directed" | "team"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "share_evidence"; "evidenceRef": EntityRef; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "propose_follow"; "subjectRef": EntityRef; "destinationId": Id; "leaderRef": EntityRef; "expectedTargetRevision": DecimalString; }) | ({ "kind": "propose_follow"; "subjectRef": EntityRef; "destinationId": Id; "leaderRef": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "kind": "respond_consent"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; "response": "accept" | "decline" | "defer"; }) | ({ "kind": "withdraw_consent"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "kind": "request_end"; "proposalId": Id; "proposalVersion": DecimalString; "scope": "chapter" | "recruitment"; }) | ({ "kind": "confirm_end"; "proposalId": Id; "proposalVersion": DecimalString; }) | ({ "kind": "wait"; });

export type GaolaoOperationId = "gz-contact" | "gz-check-seal" | "gz-try-key" | "gz-step-back" | "gz-break-seal" | "gz-confirm-settlement" | "gz-pause-follow" | "gz-request-appearance" | "gz-apply-appearance" | "gz-release-appearance" | "gz-reveal-identity" | "gz-check-appearance" | "gz-read-ledger" | "gz-hear-witness" | "gz-compare-sources" | "gz-show-passage" | "gz-invite-meeting" | "gz-confirm-meeting" | "gz-recruitment-decision" | "gz-membership-decision" | "gz-release-support" | "gz-return-public" | "gz-plan-departure" | "gz-join-party" | "gz-finish-separation" | "gz-request-private-items";

export type ChapterInteractionParameters = ({ "consentId": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "destinationId": Id; "expectedConsentVersion": DecimalString; }) | ({ "evidenceRefs": Array<EntityRef>; }) | ({ "expectedDecisionVersion": DecimalString; "response": "accept" | "decline" | "defer" | "withdraw"; }) | ({ "itemRef": EntityRef; "expectedItemRevision": DecimalString; }) | ({ "itemRefs": Array<EntityRef>; "expectedConsentVersion": DecimalString; });

export type ConsentPurpose = "follow" | "appearance" | "private_items" | "meeting" | "membership";

export type ConsentScopeViewV2 = { "destinationId"?: Id; "leaderRef"?: EntityRef; "itemRefs"?: Array<EntityRef>; };

export type ConsentViewV2 = { "consentId": EntityRef; "subjectRef": EntityRef; "requesterRef": EntityRef; "purpose": ConsentPurpose; "scope": ConsentScopeViewV2; "version": DecimalString; "status": "proposed" | "accepted" | "declined" | "deferred" | "withdrawn"; "sourceSeq": DecimalString; };

export type FollowViewV2 = { "followId": EntityRef; "subjectRef": EntityRef; "leaderRef": EntityRef; "destinationId": Id; "planVersion": DecimalString; "consentId": EntityRef; "consentVersion": DecimalString; "status": "proposed" | "accepted" | "following" | "paused" | "arrived" | "settled" | "withdrawn" | "cancelled"; "reason": string; };

export type DecisionViewV2 = { "decisionId": EntityRef; "subjectRef": EntityRef; "purpose": "recruitment" | "membership"; "version": DecimalString; "status": "undecided" | "accepted" | "declined" | "deferred" | "withdrawn"; "sourceSeq": DecimalString; };

export type EndProposalViewV2 = { "proposalId": Id; "proposalVersion": DecimalString; "scope": "chapter" | "recruitment"; "onlineMembershipVersion": DecimalString; "requiredCount": number; "confirmedCount": number; "ownConfirmed": boolean; "status": "pending" | "confirmed" | "invalidated"; };

export type ChapterViewV2 = { "chapterId": "gaolaozhuang"; "responsibilities": Array<"A" | "B" | "C" | "D" | "E">; "progress": Array<FactField>; "consents": Array<ConsentViewV2>; "follows": Array<FollowViewV2>; "decisions": Array<DecisionViewV2>; "destinations": Array<{ "destinationId": Id; "label": string; "sceneId": Id; "position": Position; "purpose": "follow" | "meeting" | "departure" | "waiting"; }>; "endProposal": (EndProposalViewV2) | (null); "publicItems": Array<{ "itemRef": EntityRef; "name": string; "borrowed": boolean; "returned": boolean; }>; "route"?: "undecided" | "public" | "disguise"; };

export type EndingViewV2 = { "title": string; "summary": string; "endingCode"?: "GZ-E01" | "GZ-E02" | "GZ-E03"; "facts"?: Array<FactField>; };

export type RecapEntryV2 = { "entryRef": EntityRef; "eventSeq": DecimalString; "category": "WorldFact" | "Evidence" | "Claim"; "text": string; "fields": Array<FactField>; "speakerRef"?: EntityRef; "speakerName"?: string; };

export type RecapV2 = { "schemaVersion": 2; "type": "session.recap"; "sessionId": Id; "throughSeq": DecimalString; "phase": "Finished" | "Aborted"; "ending": EndingViewV2; "entries": Array<RecapEntryV2>; "nextBeforeSeq": (DecimalString) | (null); };

export type PublicEnvelope = { "schemaVersion": 2; "sessionId": Id; "viewId": Id; "actorRef": EntityRef; "clientActionId": Id; "controlEpoch": DecimalString; "baseSeq": DecimalString; "action": ActionV2; };

export type SyncRequestV2 = { "schemaVersion": 2; "type": "sync.request"; "sessionId": Id; "viewId": Id; "cursor": DecimalString; };

export type ControlRequestV2 = { "schemaVersion": 2; "type": "control.resume" | "control.take"; "sessionId": Id; "viewId": Id; "actorRef": EntityRef; "nonce": Id; };

export type ReceiptResultV2 = { "movementId"?: EntityRef; "planVersion"?: DecimalString; "movementCommandSeq"?: DecimalString; "status"?: "accepted" | "moving" | "arrived" | "blocked" | "cancelled" | "locked"; "entityRefs"?: Array<EntityRef>; "observationRefs"?: Array<EntityRef>; "message"?: string; };

export type ReceiptV2 = { "schemaVersion": 2; "sessionId": Id; "clientActionId": Id; "status": "Accepted" | "Rejected"; "code": Id; "observedSeq": DecimalString; "actionEventRange": (EventRange) | (null); "result": ReceiptResultV2; };

export type EntityViewV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "appearanceId"?: AppearanceIdV2; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "motionTrail"?: Array<Position>; "motionFromSceneTimeMs"?: number; "motionThroughSceneTimeMs"?: number; "resourceRevision"?: DecimalString; "availableOperations"?: Array<GaolaoOperationId>; };

export type SelfViewV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "appearanceId"?: AppearanceIdV2; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "controlEpoch": DecimalString; "canControl": boolean; "capabilities": Array<Id>; "movementCommandHighWater": DecimalString; "resourceRevision"?: DecimalString; "availableOperations"?: Array<GaolaoOperationId>; };

export type ItemViewV2 = { "entityRef": EntityRef; "name": string; "location": ({ "kind": "ground"; "sceneId": Id; "position": Position; }) | ({ "kind": "held"; "ownerRef": EntityRef; }); "resourceRevision": DecimalString; "transferable": boolean; "publicBorrowable": boolean; "fields": Array<FactField>; "reclaimHolderEpoch"?: DecimalString; "visualKey"?: ObjectVisualKeyV1; };

export type TargetViewV2 = { "entityRef": EntityRef; "name": string; "sceneId": Id; "position": Position; "resourceRevision": DecimalString; "availableOperations": Array<Id>; "fields": Array<FactField>; "visualKey"?: ObjectVisualKeyV1; };

export type PlanViewV2 = { "movementId": EntityRef; "planVersion": DecimalString; "movementCommandSeq": DecimalString; "sceneId": Id; "mapVersion": Id; "goal": Position; "path": Array<Position>; "acceptedAtSceneTime": number; "status": "accepted" | "moving" | "arrived" | "blocked" | "cancelled"; "reason"?: string; };

export type EvidenceSourceViewV2 = { "sourceRef": EntityRef; "kind": "archive" | "testimony" | "material" | "comparison" | "decision" | "arrangement" | "contact"; "label": string; "beforeArrivalDays": number; "receivedSeq": DecimalString; };

export type ObservationViewV2 = { "observationRef": EntityRef; "category": "WorldFact" | "Evidence" | "Claim"; "statement": string; "sourceSeq": DecimalString; "fields": Array<FactField>; "shareable": boolean; "source"?: EvidenceSourceViewV2; };

export type ClaimViewV2 = { "claimRef": EntityRef; "speakerRef": EntityRef; "speakerName": string; "text": string; "channel": "public" | "directed" | "team"; "sourceSeq": DecimalString; };

export type CooperationViewV2 = { "operationId": Id; "operationVersion": DecimalString; "phase": "preparing" | "locked"; "readyCount": number; "requiredCount": number; "anchors": Array<Position>; };

export type PublicScene = { "sceneId": Id; "name": string; "width": number; "height": number; "unitsPerPixel": number; "walkableAreas": Array<{ "areaId": Id; "polygon": Polygon; }>; "obstacles": Array<{ "obstacleId": Id; "polygon": Polygon; "exceptAreas": Array<Id>; }>; "anchors": Array<{ "anchorId": Id; "position": Position; "label": string; }>; "exits": Array<{ "exitId": Id; "anchorId": Id; "destinationSceneId": Id; "destination": Position; "open": boolean; }>; };

export type ProjectionV2 = { "protocolCapability": "spatial-v2"; "chapterVersion": Id; "mapVersion": Id; "variantId": Id; "contentVersion": Id; "reducerVersion": "spatial-world-v2" | "gaolao-world-v1"; "phase": "Lobby" | "Running" | "Finished" | "Aborted"; "sceneTimeMs": number; "paused": boolean; "self": SelfViewV2; "entities": Array<EntityViewV2>; "items": Array<ItemViewV2>; "targets": Array<TargetViewV2>; "scene": (PublicScene) | (null); "movement": (PlanViewV2) | (null); "observations": Array<ObservationViewV2>; "claims": Array<ClaimViewV2>; "cooperations": Array<CooperationViewV2>; "objectives": Array<{ "objectiveId": Id; "label": string; "status": "active" | "completed" | "blocked"; }>; "ending": (EndingViewV2) | (null); "chapter"?: ChapterViewV2; };

export type SnapshotV2 = { "schemaVersion": 2; "type": "world.snapshot"; "sessionId": Id; "viewId": Id; "snapshotSeq": DecimalString; "projection": ProjectionV2; };

export type BatchV2 = { "schemaVersion": 2; "type": "world.batch"; "sessionId": Id; "viewId": Id; "fromExclusive": DecimalString; "throughSeq": DecimalString; "events": Array<{ "sessionSeq": PositiveDecimalString; "eventId": Id; "kind": "projection.replace"; "payload": { "projection": ProjectionV2; }; }>; };

export type ControlResponseV2 = { "schemaVersion": 2; "sessionId": Id; "nonce": Id; "controlEpoch": DecimalString; "observedSeq": DecimalString; "snapshot": SnapshotV2; };

export type ErrorV2 = { "schemaVersion": 2; "code": Id; "message": string; "requiredCapabilities"?: Array<"spatial-v2">; };
