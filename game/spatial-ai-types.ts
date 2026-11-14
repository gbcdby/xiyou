// 由 protocol/scripts/generate-spatial-ai.mjs 从 spatial-ai-schema.mjs 生成；请修改唯一字段源。
export type SpatialProposedIntentV2 = { "schemaVersion": 2; "decisionId": Id; "toolCalls": Array<SpatialModelActionV2>; };

export type Id = string;

export type SpatialModelActionV2 = ({ "kind": "move_to"; "sceneId": Id; "destination": Position; "targetRef"?: EntityRef; "anchorId"?: Id; }) | ({ "kind": "stop_move"; }) | ({ "kind": "inspect"; "targetRef": EntityRef; }) | ({ "kind": "take_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; }) | ({ "kind": "put_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "sceneId": Id; "position": Position; }) | ({ "kind": "transfer_item"; "itemRef": EntityRef; "expectedItemRevision": DecimalString; "recipientRef": EntityRef; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": string; "expectedTargetRevision": DecimalString; }) | (GaolaoInteractionV2) | ({ "kind": "speak"; "text": string; "channel": "public" | "directed"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "make_claim"; "text": string; "channel": "public" | "directed"; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "share_evidence"; "evidenceRef": EntityRef; "recipientRefs": Array<EntityRef>; }) | ({ "kind": "respond_consent"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; "response": "accept" | "decline" | "defer"; }) | ({ "kind": "withdraw_consent"; "consentId": EntityRef; "expectedConsentVersion": DecimalString; }) | ({ "kind": "wait"; });

export type Position = { "x": number; "y": number; };

export type EntityRef = string;

export type DecimalString = string;

export type GaolaoInteractionV2 = ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-contact" | "gz-check-seal" | "gz-try-key" | "gz-step-back" | "gz-break-seal" | "gz-release-appearance" | "gz-reveal-identity" | "gz-check-appearance" | "gz-read-ledger" | "gz-hear-witness" | "gz-show-passage" | "gz-confirm-meeting" | "gz-release-support" | "gz-plan-departure" | "gz-join-party" | "gz-finish-separation"; "expectedTargetRevision": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-confirm-settlement" | "gz-pause-follow" | "gz-apply-appearance"; "expectedTargetRevision": DecimalString; "parameters": { "consentId": EntityRef; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-appearance" | "gz-invite-meeting"; "expectedTargetRevision": DecimalString; "parameters": { "destinationId": Id; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-compare-sources"; "expectedTargetRevision": DecimalString; "parameters": { "evidenceRefs": Array<EntityRef>; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-recruitment-decision" | "gz-membership-decision"; "expectedTargetRevision": DecimalString; "parameters": { "expectedDecisionVersion": DecimalString; "response": "accept" | "decline" | "defer" | "withdraw"; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-return-public"; "expectedTargetRevision": DecimalString; "parameters": { "itemRef": EntityRef; "expectedItemRevision": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-private-items"; "expectedTargetRevision": DecimalString; "parameters": { "itemRefs": Array<EntityRef>; "expectedConsentVersion": DecimalString; }; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-describe-private-items"; "expectedTargetRevision": DecimalString; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-appearance"; "expectedTargetRevision": DecimalString; "parameters": PersonalAppearanceParametersV1; }) | ({ "kind": "interact"; "targetRef": EntityRef; "operationId": "gz-request-private-items"; "expectedTargetRevision": DecimalString; "parameters": PersonalPrivateItemsParametersV1; });

export type PersonalAppearanceParametersV1 = { "destinationId": Id; "permissionTerm": PersonalPermissionTermV1; "replacement"?: PersonalRequestReplacementV1; };

export type PersonalPermissionTermV1 = "single_use" | "reusable";

export type PersonalRequestReplacementV1 = { "consentId": EntityRef; "expectedConsentVersion": DecimalString; "expectedLifecycleVersion": DecimalString; };

export type PersonalPrivateItemsParametersV1 = { "offerRef": EntityRef; "itemOptionRefs": Array<EntityRef>; "permissionTerm": PersonalPermissionTermV1; "replacement"?: PersonalRequestReplacementV1; };

export type SpatialContextV2 = { "schemaVersion": 2; "contextVersion": "spatial-ai-context-v1"; "sessionId": Id; "viewId": Id; "snapshotSeq": DecimalString; "projection": SpatialModelProjectionV2; "tools": Array<SpatialModelToolV2>; "decision"?: { "decisionId": Id; }; "persona"?: { "motives": Array<string>; "boundaries": Array<string>; }; "goals"?: Array<SpatialModelGoalV2>; };

export type SpatialModelProjectionV2 = { "protocolCapability": "spatial-v2"; "chapterVersion": Id; "mapVersion": Id; "variantId": Id; "contentVersion": Id; "reducerVersion": "spatial-world-v2" | "gaolao-world-v1" | "gaolao-world-v2"; "phase": "Lobby" | "Running" | "Finished" | "Aborted"; "sceneTimeMs": number; "paused": boolean; "self": SpatialModelSelfV2; "entities": Array<SpatialModelEntityV2>; "items": Array<SpatialModelItemV2>; "targets": Array<TargetViewV2>; "scene": (PublicScene) | (null); "movement": (SpatialModelMovementV2) | (null); "observations": Array<ObservationViewV2>; "claims": Array<ClaimViewV2>; "cooperations": Array<CooperationViewV2>; "objectives": Array<{ "objectiveId": Id; "label": string; "status": "active" | "completed" | "blocked"; }>; "ending": (EndingViewV2) | (null); "chapter"?: ChapterViewV2; };

export type SpatialModelSelfV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "appearanceId"?: AppearanceIdV2; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "capabilities": Array<Id>; "resourceRevision"?: DecimalString; "availableOperations"?: Array<GaolaoOperationId>; };

export type AppearanceIdV2 = "neutral" | "gaocai" | "courtyard-helper" | "carpenter" | "kitchen-helper" | "woodcutter" | "tang" | "wukong" | "bajie" | "cuilan" | "gao" | "witness";

export type Facing = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type GaolaoOperationId = "gz-contact" | "gz-check-seal" | "gz-try-key" | "gz-step-back" | "gz-break-seal" | "gz-confirm-settlement" | "gz-pause-follow" | "gz-request-appearance" | "gz-apply-appearance" | "gz-release-appearance" | "gz-reveal-identity" | "gz-check-appearance" | "gz-read-ledger" | "gz-hear-witness" | "gz-compare-sources" | "gz-show-passage" | "gz-invite-meeting" | "gz-confirm-meeting" | "gz-recruitment-decision" | "gz-membership-decision" | "gz-release-support" | "gz-return-public" | "gz-plan-departure" | "gz-join-party" | "gz-finish-separation" | "gz-request-private-items" | "gz-describe-private-items";

export type SpatialModelEntityV2 = { "entityRef": EntityRef; "name": string; "appearanceEpoch": DecimalString; "appearanceId"?: AppearanceIdV2; "sceneId": (Id) | (null); "position": (Position) | (null); "facing": Facing; "resourceRevision"?: DecimalString; "availableOperations"?: Array<GaolaoOperationId>; };

export type SpatialModelItemV2 = { "entityRef": EntityRef; "name": string; "location": ({ "kind": "ground"; "sceneId": Id; "position": Position; }) | ({ "kind": "held"; "ownerRef": EntityRef; }); "resourceRevision": DecimalString; "transferable": boolean; "publicBorrowable": boolean; "fields": Array<FactField>; "visualKey"?: ObjectVisualKeyV1; };

export type FactField = { "key": Id; "label": string; "value": Scalar; };

export type Scalar = (string) | (number) | (boolean) | (null);

export type ObjectVisualKeyV1 = string;

export type TargetViewV2 = { "entityRef": EntityRef; "name": string; "sceneId": Id; "position": Position; "resourceRevision": DecimalString; "availableOperations": Array<Id>; "fields": Array<FactField>; "visualKey"?: ObjectVisualKeyV1; };

export type PublicScene = { "sceneId": Id; "name": string; "width": number; "height": number; "unitsPerPixel": number; "walkableAreas": Array<{ "areaId": Id; "polygon": Polygon; }>; "obstacles": Array<{ "obstacleId": Id; "polygon": Polygon; "exceptAreas": Array<Id>; }>; "anchors": Array<{ "anchorId": Id; "position": Position; "label": string; }>; "exits": Array<{ "exitId": Id; "anchorId": Id; "destinationSceneId": Id; "destination": Position; "open": boolean; }>; };

export type Polygon = Array<Position>;

export type SpatialModelMovementV2 = { "movementId": EntityRef; "planVersion": DecimalString; "sceneId": Id; "mapVersion": Id; "goal": Position; "path": Array<Position>; "acceptedAtSceneTime": number; "status": "accepted" | "moving" | "arrived" | "blocked" | "cancelled"; "reason"?: string; };

export type ObservationViewV2 = { "observationRef": EntityRef; "category": "WorldFact" | "Evidence" | "Claim"; "statement": string; "sourceSeq": DecimalString; "fields": Array<FactField>; "shareable": boolean; "source"?: EvidenceSourceViewV2; };

export type EvidenceSourceViewV2 = { "sourceRef": EntityRef; "kind": "archive" | "testimony" | "material" | "comparison" | "decision" | "arrangement" | "contact"; "label": string; "beforeArrivalDays": number; "receivedSeq": DecimalString; };

export type ClaimViewV2 = { "claimRef": EntityRef; "speakerRef": EntityRef; "speakerName": string; "text": string; "channel": "public" | "directed" | "team"; "sourceSeq": DecimalString; };

export type CooperationViewV2 = { "operationId": Id; "operationVersion": DecimalString; "phase": "preparing" | "locked"; "readyCount": number; "requiredCount": number; "anchors": Array<Position>; };

export type EndingViewV2 = { "title": string; "summary": string; "endingCode"?: "GZ-E01" | "GZ-E02" | "GZ-E03"; "facts"?: Array<FactField>; };

export type ChapterViewV2 = { "chapterId": "gaolaozhuang"; "responsibilities": Array<"A" | "B" | "C" | "D" | "E">; "progress": Array<FactField>; "consents": Array<ConsentViewV2>; "follows": Array<FollowViewV2>; "decisions": Array<DecisionViewV2>; "destinations": Array<{ "destinationId": Id; "label": string; "sceneId": Id; "position": Position; "purpose": "follow" | "meeting" | "departure" | "waiting"; }>; "endProposal": (EndProposalViewV2) | (null); "publicItems": Array<{ "itemRef": EntityRef; "name": string; "borrowed": boolean; "returned": boolean; }>; "route"?: "undecided" | "public" | "disguise"; "personalRequests"?: Array<PersonalRequestViewV1>; "privateItemOffers"?: Array<PrivateItemOfferV1>; "privateReturns"?: Array<PrivateReturnViewV1>; };

export type ConsentViewV2 = { "consentId": EntityRef; "subjectRef": EntityRef; "requesterRef": EntityRef; "purpose": ConsentPurpose; "scope": ConsentScopeViewV2; "version": DecimalString; "status": "proposed" | "accepted" | "declined" | "deferred" | "withdrawn"; "sourceSeq": DecimalString; };

export type ConsentPurpose = "follow" | "appearance" | "private_items" | "meeting" | "membership";

export type ConsentScopeViewV2 = { "destinationId"?: Id; "leaderRef"?: EntityRef; "itemRefs"?: Array<EntityRef>; };

export type FollowViewV2 = { "followId": EntityRef; "subjectRef": EntityRef; "leaderRef": EntityRef; "destinationId": Id; "planVersion": DecimalString; "consentId": EntityRef; "consentVersion": DecimalString; "status": "proposed" | "accepted" | "following" | "paused" | "arrived" | "settled" | "withdrawn" | "cancelled"; "reason": string; };

export type DecisionViewV2 = { "decisionId": EntityRef; "subjectRef": EntityRef; "purpose": "recruitment" | "membership"; "version": DecimalString; "status": "undecided" | "accepted" | "declined" | "deferred" | "withdrawn"; "sourceSeq": DecimalString; };

export type EndProposalViewV2 = { "proposalId": Id; "proposalVersion": DecimalString; "scope": "chapter" | "recruitment"; "onlineMembershipVersion": DecimalString; "requiredCount": number; "confirmedCount": number; "ownConfirmed": boolean; "status": "pending" | "confirmed" | "invalidated"; };

export type PersonalRequestViewV1 = { "consentId": EntityRef; "purpose": PersonalPurposeV1; "lifecycleVersion": DecimalString; "lifecycle": PersonalLifecycleV1; "executionState": PersonalExecutionStateV1; "reasonCode": (PersonalReasonCodeV1) | (null); "reason": string; "permissionTerm": PersonalPermissionTermV1; "scope": PersonalRequestScopeViewV1; };

export type PersonalPurposeV1 = "appearance" | "private_items";

export type PersonalLifecycleV1 = "open" | "cancelled" | "superseded" | "closed";

export type PersonalExecutionStateV1 = "none" | "ready" | "active" | "return_only" | "ended";

export type PersonalReasonCodeV1 = "requester_cancelled" | "replaced_by_requester" | "replaced_after_closed" | "replaced_after_invalidation" | "proposal_invalidated" | "owner_declined" | "owner_deferred" | "owner_withdrew" | "fulfilled" | "usage_ended" | "appearance_disclosed" | "binding_invalidated" | "session_ended";

export type PersonalRequestScopeViewV1 = ({ "destinationId": Id; "performerLabel": string; "usage": "inquiry_meeting"; }) | ({ "handling": "retrieve_to_owner"; "ownerLabel": string; "items": Array<{ "label": string; "origin": (PersonalOriginV1) | (null); }>; });

export type PersonalOriginV1 = { "sceneId": Id; "position": Position; "label": string; };

export type PrivateItemOfferV1 = { "offerRef": EntityRef; "subjectRef": EntityRef; "sourceRef": EntityRef; "sourceRevision": DecimalString; "options": Array<{ "optionRef": EntityRef; "label": string; "handling": "retrieve_to_owner"; }>; };

export type PrivateReturnViewV1 = { "returnContextId": EntityRef; "originalConsentId": EntityRef; "acceptedConsentVersion": DecimalString; "sourceLifecycleVersion": DecimalString; "itemRef": EntityRef; "itemRevision": DecimalString; "mode": "delivery_pending" | "return_only"; "ownerLabel": string; "ownerRef": (EntityRef) | (null); "origin": PersonalOriginV1; };

export type SpatialModelToolV2 = { "kind": "move_to" | "stop_move" | "inspect" | "take_item" | "put_item" | "transfer_item" | "interact" | "speak" | "make_claim" | "share_evidence" | "respond_consent" | "withdraw_consent" | "wait"; "description": string; "sceneId"?: Id; "targetRef"?: EntityRef; "itemRef"?: EntityRef; "expectedItemRevision"?: DecimalString; "operationId"?: Id; "expectedTargetRevision"?: DecimalString; "evidenceRef"?: EntityRef; "consentId"?: EntityRef; "expectedConsentVersion"?: DecimalString; "purpose"?: ConsentPurpose; "scope"?: ConsentScopeViewV2; };

export type SpatialModelGoalV2 = { "goalId": Id; "label": string; "status": "active" | "completed" | "blocked"; "basedOnObservationRefs": Array<EntityRef>; "objectiveId"?: Id; };

export type SpatialDecisionContextV2 = { "schemaVersion": 2; "contextVersion": "spatial-ai-context-v1"; "sessionId": Id; "viewId": Id; "snapshotSeq": DecimalString; "projection": SpatialModelProjectionV2; "tools": Array<SpatialModelToolV2>; "decision": { "decisionId": Id; }; "persona"?: { "motives": Array<string>; "boundaries": Array<string>; }; "goals"?: Array<SpatialModelGoalV2>; };
