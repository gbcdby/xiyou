// 由 protocol/scripts/generate-spatial.mjs 从 spatial-schema.mjs 生成；请修改唯一字段源。
import type * as T from '../game/spatial-types.js';
export type * from '../game/spatial-types.js';
export function parseSpatial<K extends keyof SpatialContracts>(name: K, raw: string): SpatialContracts[K];
export function validateSpatial<K extends keyof SpatialContracts>(name: K, value: unknown): SpatialContracts[K];
export interface SpatialContracts {
  Id: T.Id;
  DecimalString: T.DecimalString;
  PositiveDecimalString: T.PositiveDecimalString;
  UtcTimestamp: T.UtcTimestamp;
  Scalar: T.Scalar;
  FactField: T.FactField;
  EventRange: T.EventRange;
  EntityRef: T.EntityRef;
  Position: T.Position;
  Polygon: T.Polygon;
  Facing: T.Facing;
  ActionV2: T.ActionV2;
  PublicEnvelope: T.PublicEnvelope;
  SyncRequestV2: T.SyncRequestV2;
  ControlRequestV2: T.ControlRequestV2;
  ReceiptResultV2: T.ReceiptResultV2;
  ReceiptV2: T.ReceiptV2;
  EntityViewV2: T.EntityViewV2;
  SelfViewV2: T.SelfViewV2;
  ItemViewV2: T.ItemViewV2;
  TargetViewV2: T.TargetViewV2;
  PlanViewV2: T.PlanViewV2;
  ObservationViewV2: T.ObservationViewV2;
  ClaimViewV2: T.ClaimViewV2;
  CooperationViewV2: T.CooperationViewV2;
  PublicScene: T.PublicScene;
  ProjectionV2: T.ProjectionV2;
  SnapshotV2: T.SnapshotV2;
  BatchV2: T.BatchV2;
  ControlResponseV2: T.ControlResponseV2;
  ErrorV2: T.ErrorV2;
}
export class MovementCommandSource { readonly controlEpoch: string; constructor(controlEpoch: string); move(sceneId: string, destination: T.Position, options?: { targetRef?: string; anchorId?: string }): T.ActionV2; stop(): T.ActionV2; }
