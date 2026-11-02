import { z } from 'zod';
import { DeviceProfileSchema } from './geometry.js';
import { WireframeSpecSchema,ConstraintResultSchema } from './constraints.js';
import { RnStylePatchSchema } from './styles.js';
import { SpatialSnapshotSchema,SpatialDeltaSchema } from './graph.js';
import { CommitReceiptSchema } from './source.js';
const session={sessionId:z.string().min(1)};
export const ToolSchemas={
open_session:z.object({projectRoot:z.string().min(1),webUrl:z.string().url(),scenarioId:z.string().min(1),profile:DeviceProfileSchema,nativePort:z.number().int().min(1024).max(65535).optional(),nativeToken:z.string().min(16).optional()}).strict(),
load_wireframe_spec:z.object({...session,spec:WireframeSpecSchema}).strict(),
inspect_ui_spatial_graph:z.object(session).strict(),
capture_annotated_overlay:z.object({...session,snapshotId:z.string()}).strict(),
simulate_layout_mutation:z.object({...session,baselineSnapshotId:z.string(),elementId:z.string(),patch:RnStylePatchSchema.nullable()}).strict(),
commit_rn_ast_patch:z.object({...session,trialId:z.string(),expectedSourceHash:z.string(),mode:z.enum(['preview','apply'])}).strict(),
verify_native_layout:z.object({...session,commitId:z.string()}).strict(),
close_session:z.object(session).strict()
} as const;
export type ToolName=keyof typeof ToolSchemas;
export type ToolInput<K extends ToolName>=z.infer<(typeof ToolSchemas)[K]>;
export const TrialSchema=z.object({trialId:z.string(),baselineSnapshotId:z.string(),elementId:z.string(),patch:RnStylePatchSchema,snapshot:SpatialSnapshotSchema,delta:SpatialDeltaSchema,results:z.array(ConstraintResultSchema)}).strict();
export type Trial=z.infer<typeof TrialSchema>;
export const NativeVerificationSchema=z.object({receipt:CommitReceiptSchema,snapshot:SpatialSnapshotSchema,results:z.array(ConstraintResultSchema),delta:SpatialDeltaSchema,passed:z.boolean()}).strict();
export type NativeVerification=z.infer<typeof NativeVerificationSchema>;
