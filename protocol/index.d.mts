// 本文件由 protocol/scripts/generate.mjs 从 schema.mjs 生成，请修改唯一字段源后重新生成。
import type { ClientAction, ProposedIntent, ActionReceipt, ClientReceipt, WorldEvent, DecisionRecord, AuthorizedSnapshot, WorldBatch, SyncRequest, ControlRequest, ControlResponse, ErrorResponse, OutboxRecord, TrustedExecutionContext, AuthorizedProjection, AuthorizedRecap } from '../game/types.js';
export type * from '../game/types.js';
export interface ContractMap {
  ClientAction: ClientAction;
  ActionReceipt: ActionReceipt;
  ClientReceipt: ClientReceipt;
  WorldEvent: WorldEvent;
  DecisionRecord: DecisionRecord;
  ProposedIntent: ProposedIntent;
  AuthorizedSnapshot: AuthorizedSnapshot;
  WorldBatch: WorldBatch;
  SyncRequest: SyncRequest;
  ControlRequest: ControlRequest;
  ControlResponse: ControlResponse;
  ErrorResponse: ErrorResponse;
  OutboxRecord: OutboxRecord;
  TrustedExecutionContext: TrustedExecutionContext;
  AuthorizedProjection: AuthorizedProjection;
  AuthorizedRecap: AuthorizedRecap;
}
export type ContractName = keyof ContractMap;
export class ContractError extends Error {
  readonly code: 'INVALID_MESSAGE';
  readonly path: string;
  constructor(message?: string, path?: string);
}
export const contractNames: readonly ContractName[];
export const contractSchema: Readonly<Record<string, unknown>>;
export function parseStrictJSON(raw: string, options?: { maxBytes?: number; maxDepth?: number }): unknown;
export function canonicalize(value: unknown): string;
export function compareDecimal(a: string, b: string): -1 | 0 | 1;
export function validateContract<K extends ContractName>(name: K, value: unknown): ContractMap[K];
export function parseContract<K extends ContractName>(name: K, raw: string): ContractMap[K];
export function parseClientAction(raw: string): ClientAction;
export function parseProposedIntent(raw: string, expectedDecisionId: string): ProposedIntent;
export function canonicalActionPayload(value: ClientAction): string;
export function canonicalIntentPayload(value: ProposedIntent): string;
export function sha256Canonical(encoded: string): Promise<string>;
export function actionSemanticDigest(value: ClientAction): Promise<string>;
export function intentSemanticDigest(value: ProposedIntent): Promise<string>;
