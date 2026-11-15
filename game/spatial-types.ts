// 由 protocol/scripts/generate-spatial.mjs 从 spatial-schema.mjs 生成；请修改唯一字段源。
export type SpatialClientCapability = "spatial-v2" | "spatial-appearance-v1" | "spatial-object-visual-v1" | "gaolao-personal-consent-v1" | "spatial-scene-overview-v1" | "spatial-direction-v1" | "spatial-timed-trail-v1";

export type PersonalPermissionTermV1 = "single_use" | "reusable";

export type PersonalRequestReplacementV1 = { "consentId": EntityRef; "expectedConsentVersion": DecimalString; "expectedLifecycleVersion": DecimalString; };

export type PersonalAppearanceParametersV1 = { "destinationId": Id; "permissionTerm": PersonalPermissionTermV1; "replacement"?: PersonalRequestReplacementV1; };

export type PersonalPrivateItemsParametersV1 = { "offerRef": EntityRef; "itemOptionRefs": Array<EntityRef>; "permissionTerm": PersonalPermissionTermV1; "replacement"?: PersonalRequestReplacementV1; };

export type PersonalPurposeV1 = "appearance" | "private_items";

export type PersonalLifecycleV1 = "open" | "cancelled" | "superseded" | "closed";

export type PersonalExecutionStateV1 = "none" | "ready" | "active" | "return_only" | "ended";

export type PersonalReasonCodeV1 = "requester_cancelled" | "replaced_by_requester" | "replaced_after_closed" | "replaced_after_invalidation" | "proposal_invalidated" | "owner_declined" | "owner_deferred" | "owner_withdrew" | "fulfilled" | "usage_ended" | "appearance_disclosed" | "binding_invalidated" | "session_ended";

export type PersonalOriginV1 = { "sceneId": Id; "position": Position; "label": string; };

export type PrivateItemOfferV1 = { "offerRef": EntityRef; "subjectRef": EntityRef; "sourceRef": EntityRef; "sourceRevision": DecimalString; "options": Array<{ "optionRef": EntityRef; "label": string; "handling": "retrieve_to_owner"; }>; };

export type PersonalRequestScopeViewV1 = ({ "destinationId": Id; "performerLabel": string; "usage": "inquiry_meeting"; }) | ({ "handling": "retrieve_to_owner"; "ownerLabel": string; "items": Array<{ "label": string; "origin": (PersonalOriginV1) | (null); }>; });

export type PersonalRequestViewV1 = { "consentId": EntityRef; "purpose": PersonalPurposeV1; "lifecycleVersion": DecimalString; "lifecycle": PersonalLifecycleV1; "executionState": PersonalExecutionStateV1; "reasonCode": (PersonalReasonCodeV1) | (null); "reason": string; "permissionTerm": PersonalPermissionTermV1; "scope": PersonalRequestScopeViewV1; };

export type PrivateReturnViewV1 = { "returnContextId": EntityRef; "originalConsentId": EntityRef; "acceptedConsentVersion": DecimalString; "sourceLifecycleVersion": DecimalString; "itemRef": EntityRef; "itemRevision": DecimalString; "mode": "delivery_pending" | "return_only"; "ownerLabel": string; "ownerRef": (EntityRef) | (null); "origin": PersonalOriginV1; };

export type ObjectVisualKeyV1 = string;

export type AppearanceIdV2 = "neutral" | "gaocai" | "courtyard-helper" | "carpenter" | "kitchen-helper" | "woodcutter" | "tang" | "wukong" | "bajie" | "cuilan" | "gao" | "witness";

export type GaolaoInteractionV2 = ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-contact" | "gz-check-seal" | "gz-try-key" | "gz-step-back" | "gz-break-seal" | "gz-release-appearance" | "gz-reveal-identity" | "gz-check-appearance" | "gz-read-ledger" | "gz-hear-witness" | "gz-show-passage" | "gz-confirm-meeting" | "gz-release-support" | "gz-plan-departure" | "gz-join-party" | "gz-finish-separation"; "expectedTargetRevision": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-confirm-settlement" | "gz-pause-follow" | "gz-apply-appearance"; "expectedTargetRevision": DecimalString; "parameters": { "consentId": EntityRef; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-appearance" | "gz-invite-meeting"; "expectedTargetRevision": DecimalString; "parameters": { "destinationId": Id; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-compare-sources"; "expectedTargetRevision": DecimalString; "parameters": { "evidenceRefs": Array<EntityRef>; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-recruitment-decision" | "gz-membership-decision"; "expectedTargetRevision": DecimalString; "parameters": { "expectedDecisionVersion": DecimalString; "response": "accept" | "decline" | "defer" | "withdraw"; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-return-public"; "expectedTargetRevision": DecimalString; "parameters": { "itemRef": EntityRef; "expectedItemRevision": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-private-items"; "expectedTargetRevision": DecimalString; "parameters": { "itemRefs": Array<EntityRef>; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-describe-private-items"; "expectedTargetRevision": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-appearance"; "expectedTargetRevision": DecimalString; "parameters": PersonalAppearanceParametersV1; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-private-items"; "expectedTargetRevision": DecimalString; "parameters": PersonalPrivateItemsParametersV1; });

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

export type ActionV2 = ({ "kind": "move_to"; "movementCommandSeq": PositiveDecimalString; "sceneId": Id; "destination": Position; "targetRef"?: EntityRef; "anchorId"?: Id; }) | ({ "kind": "move_direction"; "movementCommandSeq": PositiveDecimalString; "sceneId": Id; "mapVersion": Id; "direction": Facing; }) | ({ "kind": "stop_move"; "movementCommandSeq": PositiveDecimalString; }) | ({ "kind": "inspect"; "targetRef": EntityRef; }) | ({ "kind": "take_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; }) | ({ "kind": "put_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "sceneId": Id; "position": Position; }) | ({ "kind": "transfer_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "recipientRef": EntityRef; }) | ({ "kind": "reclaim_public_item"; "itemRef": EntityRef; "holderRef": EntityRef; "expectedItemRevision": DecimalString; "expectedHolderEpoch": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": string; "expectedTargetRevision": DecimalString; }) | (GaolaoInteractionV2) | ({ "kind": "cooperate"; "operationId": Id; "operationVersion": DecimalString; "phase": "prepare" | "ready" | "cancel"; }) | ({ "kind": "speak"; "text": string; "channel": "public" | "directed" | "team"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "make_claim"; "text": string; "channel": "public" | "directed" | "team"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "share_evidence"; "evidenceRef": EntityRef; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "propose_follow"; "subjectRef": EntityRef; "destinationId": Id; "leaderRef": EntityRef; "expectedTargetRevision": DecimalString; }) | ({ "kind": "propose_follow"; "subjectRef": EntityRef; "destinationId": Id; "leaderRef": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "kind": "respond_consent"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; "response": "accept" | "decline" | "defer"; }) | ({ "kind": "withdraw_consent"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "kind": "cancel_personal_request"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; "expectedLifecycleVersion": DecimalString; }) | ({ "kind": "request_end"; "proposalId": Id; "proposalVersion": DecimalString; "scope": "chapter" | "recruitment"; }) | ({ "kind": "confirm_end"; "proposalId": Id; "proposalVersion": DecimalString; }) | ({ "kind": "wait"; });

export type GaolaoOperationId = "gz-contact" | "gz-check-seal" | "gz-try-key" | "gz-step-back" | "gz-break-seal" | "gz-confirm-settlement" | "gz-pause-follow" | "gz-request-appearance" | "gz-apply-appearance" | "gz-release-appearance" | "gz-reveal-identity" | "gz-check-appearance" | "gz-read-ledger" | "gz-hear-witness" | "gz-compare-sources" | "gz-show-passage" | "gz-invite-meeting" | "gz-confirm-meeting" | "gz-recruitment-decision" | "gz-membership-decision" | "gz-release-support" | "gz-return-public" | "gz-plan-departure" | "gz-join-party" | "gz-finish-separation" | "gz-request-private-items" | "gz-describe-private-items";

export type ChapterInteractionParameters = ({ "consentId": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "destinationId": Id; "expectedConsentVersion": DecimalString; }) | ({ "evidenceRefs": Array<EntityRef>; }) | ({ "expectedDecisionVersion": DecimalString; "response": "accept" | "decline" | "defer" | "withdraw"; }) | ({ "itemRef": EntityRef; "expectedItemRevision": DecimalString; }) | ({ "itemRefs": Array<EntityRef>; "expectedConsentVersion": DecimalString; }) | (PersonalAppearanceParametersV1) | (PersonalPrivateItemsParametersV1);

export type ConsentPurpose = "follow" | "appearance" | "private_items" | "meeting" | "membership";

export type ConsentScopeViewV2 = { "destinationId"?: Id; "leaderRef"?: EntityRef; "itemRefs"?: Array<EntityRef>; };

export type ConsentViewV2 = { "consentId": EntityRef; "subjectRef": EntityRef; "requesterRef": EntityRef; "purpose": ConsentPurpose; "scope": ConsentScopeViewV2; "version": DecimalString; "status": "proposed" | "accepted" | "declined" | "deferred" | "withdrawn"; "sourceSeq": DecimalString; };

export type FollowViewV2 = { "followId": EntityRef; "subjectRef": EntityRef; "leaderRef": EntityRef; "destinationId": Id; "planVersion": DecimalString; "consentId": EntityRef; "consentVersion": DecimalString; "status": "proposed" | "accepted" | "following" | "paused" | "arrived" | "settled" | "withdrawn" | "cancelled"; "reason": string; };

export type DecisionViewV2 = { "decisionId": EntityRef; "subjectRef": EntityRef; "purpose": "recruitment" | "membership"; "version": DecimalString; "status": "undecided" | "accepted" | "declined" | "deferred" | "withdrawn"; "sourceSeq": DecimalString; };

export type EndProposalViewV2 = { "proposalId": Id; "proposalVersion": DecimalString; "scope": "chapter" | "recruitment"; "onlineMembershipVersion": DecimalString; "requiredCount": number; "confirmedCount": number; "ownConfirmed": boolean; "status": "pending" | "confirmed" | "invalidated"; };

export type ChapterViewV2 = { "chapterId": "gaolaozhuang"; "responsibilities": Array<"A" | "B" | "C" | "D" | "E">; "progress": Array<FactField>; "consents": Array<ConsentViewV2>; "follows": Array<FollowViewV2>; "decisions": Array<DecisionViewV2>; "destinations": Array<{ "destinationId": Id; "label": string; "sceneId": Id; "position": Position; "purpose": "follow" | "meeting" | "departure" | "waiting"; }>; "endProposal": (EndProposalViewV2) | (null); "publicItems": Array<{ "itemRef": EntityRef; "name": string; "borrowed": boolean; "returned": boolean; }>; "route"?: "undecided" | "public" | "disguise"; "personalRequests"?: Array<PersonalRequestViewV1>; "privateItemOffers"?: Array<PrivateItemOfferV1>; "privateReturns"?: Array<PrivateReturnViewV1>; };

export type EndingViewV2 = { "title": string; "summary": string; "endingCode"?: "GZ-E01" | "GZ-E02" | "GZ-E03"; "facts"?: Array<FactField>; };

export type RecapEntryV2 = { "entryRef": EntityRef; "eventSeq": DecimalString; "category": "WorldFact" | "Evidence" | "Claim"; "text": string; "fields": Array<FactField>; "speakerRef"?: EntityRef; "speakerName"?: string; };

export type RecapV2 = { "schemaVersion": 2; "type": "session.recap"; "sessionId": Id; "throughSeq": DecimalString; "phase": "Finished" | "Aborted"; "ending": EndingViewV2; "entries": Array<RecapEntryV2>; "nextBeforeSeq": (DecimalString) | (null); };

export type PublicEnvelope = { "schemaVersion": 2; "sessionId": Id; "viewId": Id; "actorRef": EntityRef; "clientActionId": Id; "controlEpoch": DecimalString; "baseSeq": DecimalString; "action": ActionV2; };

export type SyncRequestV2 = { "schemaVersion": 2; "type": "sync.request"; "sessionId": Id; "viewId": Id; "cursor": DecimalString; };

export type ControlRequestV2 = { "schemaVersion": 2; "type": "control.resume" | "control.take"; "sessionId": Id; "viewId": Id; "actorRef": EntityRef; "nonce": Id; };

export type ReceiptResultV2 = { "movementId"?: EntityRef; "planVersion"?: DecimalString; "movementCommandSeq"?: DecimalString; "status"?: "accepted" | "moving" | "arrived" | "blocked" | "cancelled" | "locked"; "entityRefs"?: Array<EntityRef>; "observationRefs"?: Array<EntityRef>; "message"?: string; };

export type ReceiptV2 = { "schemaVersion": 2; "sessionId": Id; "clientActionId": Id; "status": "Accepted" | "Rejected"; "code": Id; "observedSeq": DecimalString; "actionEventRange": (EventRange) | (null); "result": ReceiptResultV2; };

export type MotionTimelineSpanV1 = { "kind": "motion" | "hold"; "fromSceneTimeMs": number; "throughSceneTimeMs": number; "fromTrailIndex": number; "throughTrailIndex": number; };

export type EntityViewV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "appearanceId"?: AppearanceIdV2; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "motionTrail"?: Array<Position>; "motionFromSceneTimeMs"?: number; "motionThroughSceneTimeMs"?: number; "motionTimeline"?: Array<MotionTimelineSpanV1>; "resourceRevision"?: DecimalString; "availableOperations"?: Array<GaolaoOperationId>; };

export type SelfViewV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "appearanceId"?: AppearanceIdV2; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "controlEpoch": DecimalString; "canControl": boolean; "capabilities": Array<Id>; "movementCommandHighWater": DecimalString; "resourceRevision"?: DecimalString; "availableOperations"?: Array<GaolaoOperationId>; };

export type ItemViewV2 = { "entityRef": EntityRef; "name": string; "location": ({ "kind": "ground"; "sceneId": Id; "position": Position; }) | ({ "kind": "held"; "ownerRef": EntityRef; }); "resourceRevision": DecimalString; "transferable": boolean; "publicBorrowable": boolean; "fields": Array<FactField>; "reclaimHolderEpoch"?: DecimalString; "visualKey"?: ObjectVisualKeyV1; };

export type TargetViewV2 = { "entityRef": EntityRef; "name": string; "sceneId": Id; "position": Position; "resourceRevision": DecimalString; "availableOperations": Array<Id>; "fields": Array<FactField>; "visualKey"?: ObjectVisualKeyV1; };

export type SceneEntityViewV1 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "resourceRevision": DecimalString; "moving": boolean; "appearanceId"?: AppearanceIdV2; "sceneId": Id; "position": Position; "facing": Facing; "motionTrail"?: Array<Position>; "motionFromSceneTimeMs"?: number; "motionThroughSceneTimeMs"?: number; "motionTimeline"?: Array<MotionTimelineSpanV1>; };

export type SceneItemViewV1 = { "entityRef": EntityRef; "name": string; "resourceRevision": DecimalString; "location": { "kind": "ground"; "sceneId": Id; "position": Position; }; "visualKey"?: ObjectVisualKeyV1; "visualState": "loose" | "fixed" | "default"; };

export type SceneTargetViewV1 = { "entityRef": EntityRef; "name": string; "resourceRevision": DecimalString; "sceneId": Id; "position": Position; "visualKey"?: ObjectVisualKeyV1; "visualState": "open" | "closed" | "default"; };

export type SceneOverviewV1 = { "entities": Array<SceneEntityViewV1>; "items": Array<SceneItemViewV1>; "targets": Array<SceneTargetViewV1>; };

export type PublicMapScene = { "sceneId": Id; "name": string; "width": number; "height": number; "unitsPerPixel": number; "walkableAreas": Array<{ "areaId": Id; "polygon": Polygon; }>; "anchors": Array<{ "anchorId": Id; "position": Position; "label": string; }>; "exits": Array<{ "exitId": Id; "anchorId": Id; "destinationSceneId": Id; "destination": Position; }>; };

export type PlanViewV2 = { "movementId": EntityRef; "planVersion": DecimalString; "movementCommandSeq": DecimalString; "sceneId": Id; "mapVersion": Id; "goal": Position; "path": Array<Position>; "acceptedAtSceneTime": number; "status": "accepted" | "moving" | "arrived" | "blocked" | "cancelled"; "reason"?: string; };

export type EvidenceSourceViewV2 = { "sourceRef": EntityRef; "kind": "archive" | "testimony" | "material" | "comparison" | "decision" | "arrangement" | "contact"; "label": string; "beforeArrivalDays": number; "receivedSeq": DecimalString; };

export type ObservationViewV2 = { "observationRef": EntityRef; "category": "WorldFact" | "Evidence" | "Claim"; "statement": string; "sourceSeq": DecimalString; "fields": Array<FactField>; "shareable": boolean; "source"?: EvidenceSourceViewV2; };

export type ClaimViewV2 = { "claimRef": EntityRef; "speakerRef": EntityRef; "speakerName": string; "text": string; "channel": "public" | "directed" | "team"; "sourceSeq": DecimalString; };

export type CooperationViewV2 = { "operationId": Id; "operationVersion": DecimalString; "phase": "preparing" | "locked"; "readyCount": number; "requiredCount": number; "anchors": Array<Position>; };

export type PublicScene = { "sceneId": Id; "name": string; "width": number; "height": number; "unitsPerPixel": number; "walkableAreas": Array<{ "areaId": Id; "polygon": Polygon; }>; "obstacles": Array<{ "obstacleId": Id; "polygon": Polygon; "exceptAreas": Array<Id>; }>; "anchors": Array<{ "anchorId": Id; "position": Position; "label": string; }>; "exits": Array<{ "exitId": Id; "anchorId": Id; "destinationSceneId": Id; "destination": Position; "open": boolean; }>; };

export type ProjectionV2 = { "protocolCapability": "spatial-v2"; "chapterVersion": Id; "mapVersion": Id; "variantId": Id; "contentVersion": Id; "reducerVersion": "spatial-world-v2" | "gaolao-world-v1" | "gaolao-world-v2"; "phase": "Lobby" | "Running" | "Finished" | "Aborted"; "sceneTimeMs": number; "paused": boolean; "self": SelfViewV2; "entities": Array<EntityViewV2>; "items": Array<ItemViewV2>; "targets": Array<TargetViewV2>; "scene": (PublicScene) | (null); "movement": (PlanViewV2) | (null); "observations": Array<ObservationViewV2>; "claims": Array<ClaimViewV2>; "cooperations": Array<CooperationViewV2>; "objectives": Array<{ "objectiveId": Id; "label": string; "status": "active" | "completed" | "blocked"; }>; "ending": (EndingViewV2) | (null); "chapter"?: ChapterViewV2; "sceneOverview"?: SceneOverviewV1; "mapCatalog"?: Array<PublicMapScene>; };

export type SnapshotV2 = { "schemaVersion": 2; "type": "world.snapshot"; "sessionId": Id; "viewId": Id; "snapshotSeq": DecimalString; "projection": ProjectionV2; };

export type BatchV2 = { "schemaVersion": 2; "type": "world.batch"; "sessionId": Id; "viewId": Id; "fromExclusive": DecimalString; "throughSeq": DecimalString; "syncFrontierSeq"?: DecimalString; "events": Array<{ "sessionSeq": PositiveDecimalString; "eventId": Id; "kind": "projection.replace"; "payload": { "projection": ProjectionV2; }; }>; };

export type ControlResponseV2 = { "schemaVersion": 2; "sessionId": Id; "nonce": Id; "controlEpoch": DecimalString; "observedSeq": DecimalString; "snapshot": SnapshotV2; };

export type ErrorV2 = { "schemaVersion": 2; "code": Id; "message": string; "requiredCapabilities"?: Array<SpatialClientCapability>; };
