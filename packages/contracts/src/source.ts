import { z } from 'zod';
export const SourceRefSchema=z.object({path:z.string().min(1),styleForm:z.literal('pressable-state').optional(),dependencies:z.array(z.string().min(1)).optional(),hash:z.string().regex(/^[a-f0-9]{64}$/),start:z.number().int().nonnegative(),end:z.number().int().positive(),line:z.number().int().positive(),column:z.number().int().nonnegative()}).strict().refine(s=>s.end>s.start,'Invalid source range');
export type SourceRef=z.infer<typeof SourceRefSchema>;
export const SourceRevisionsSchema=z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/));
export type SourceRevisions=z.infer<typeof SourceRevisionsSchema>;
export const ErrorCodeSchema=z.enum(['INVALID_INPUT','MISSING_ELEMENT','DUPLICATE_ELEMENT','STALE_SNAPSHOT','STALE_SOURCE','UNSUPPORTED_EDIT','UNSUPPORTED_PROFILE','UNSTABLE_LAYOUT','NATIVE_DISCONNECTED','TIMEOUT','VERIFICATION_FAILED','SESSION_NOT_FOUND','TRIAL_NOT_FOUND','SOURCE_OUTSIDE_PROJECT','INTERNAL_ERROR','RECOVERY_CONFLICT','TRANSACTION_CONFLICT','UNSUPPORTED_ACTION','PROTOCOL_MISMATCH']);
export type ErrorCode=z.infer<typeof ErrorCodeSchema>;
export const BridgeErrorSchema=z.object({code:ErrorCodeSchema,message:z.string(),details:z.unknown().optional()}).strict();
export type BridgeError=z.infer<typeof BridgeErrorSchema>;
export type Result<T>={ok:true;value:T}|{ok:false;error:BridgeError};
export class BridgeFault extends Error {constructor(public readonly code:ErrorCode,message:string,public readonly details?:unknown){super(message);this.name='BridgeFault';}}
export interface SourceFile {path:string;text:string;hash:string}
export const EditPlanSchema=z.object({source:SourceRefSchema,expectedHash:z.string(),updatedText:z.string(),diff:z.string()}).strict();
export type EditPlan=z.infer<typeof EditPlanSchema>;
export const CommitReceiptSchema=z.object({commitId:z.string(),path:z.string(),oldHash:z.string(),newHash:z.string(),diff:z.string(),files:z.array(z.object({path:z.string(),oldHash:z.string(),newHash:z.string(),diff:z.string()}).strict()).optional(),revertsCommitId:z.string().optional(),nativeStatus:z.enum(['pending','passed','failed'])}).strict();
export type CommitReceipt=z.infer<typeof CommitReceiptSchema>;
export interface SourcePort {read(path:string):Promise<SourceFile>;apply(plan:EditPlan):Promise<CommitReceipt>}
