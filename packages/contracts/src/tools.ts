import {DesignIntentSchema,DesignIntentResultSchema} from './design.js';
import {AccessibilityFindingSchema} from './accessibility.js';
import {SuggestionProfilesSchema,SuggestionProfileEvidenceSchema,NativeSuggestionEvidenceSchema,InteractionRequirementSchema} from './diagnostics.js';
import {LayoutMutationSchema,EditScopeSchema,TransactionPlanSchema,ScenarioScriptSchema,MatrixCellSchema,RuleFindingSchema,InferenceOptionsSchema,NativeTargetSchema} from './workflow.js';
import { z } from 'zod';
import { DeviceProfileSchema,RectSchema } from './geometry.js';
import { WireframeSpecSchema,ConstraintResultSchema } from './constraints.js';
import { RnStylePatchSchema } from './styles.js';
import { SpatialSnapshotSchema,SpatialDeltaSchema,SpatialNodeSchema,ProfileOverridesSchema,WebDiagnosticsSchema } from './graph.js';
import { CommitReceiptSchema,EditPlanSchema,BridgeErrorSchema } from './source.js';
const session={sessionId:z.string().min(1)};
export const ToolSchemas={
open_session:z.object({projectRoot:z.string().min(1),webUrl:z.string().url(),scenarioId:z.string().min(1),profile:DeviceProfileSchema,nativeTarget:NativeTargetSchema.optional(),nativeScenario:z.object({appId:z.string().min(1),adbSerial:z.string().optional(),maestroPath:z.string().optional(),ssh:z.object({destination:z.string(),identityFile:z.string().optional()}).strict().optional()}).strict().optional(),nativePort:z.number().int().min(1024).max(65535).optional(),nativeToken:z.string().min(16).optional()}).strict(),
import_design_intent:z.object({...session,design:DesignIntentSchema}).strict(),
inspect_accessibility:z.object({...session,target:z.enum(['web','native']).default('web')}).strict(),
load_wireframe_spec:z.object({...session,spec:WireframeSpecSchema}).strict(),
inspect_ui_spatial_graph:z.object({...session,profileOverrides:ProfileOverridesSchema.optional()}).strict(),
capture_annotated_overlay:z.object({...session,snapshotId:z.string()}).strict(),
simulate_layout_mutation:z.object({...session,baselineSnapshotId:z.string(),elementId:z.string().optional(),patch:RnStylePatchSchema.nullable().optional(),mutations:z.array(LayoutMutationSchema).min(1).optional(),profileOverrides:ProfileOverridesSchema.optional()}).strict(),
commit_rn_ast_patch:z.object({...session,trialId:z.string(),expectedSourceHash:z.string().optional(),expectedRevisions:z.record(z.string(),z.string()).optional(),scope:EditScopeSchema.optional(),allowNativePending:z.boolean().default(false),mode:z.enum(['preview','apply'])}).strict(),
verify_native_layout:z.object({...session,commitId:z.string()}).strict(),
revert_commit:z.object({...session,commitId:z.string()}).strict(),
find_elements:z.object({...session,query:z.string().default('')}).strict(),
infer_constraints:z.object({...session,snapshotId:z.string(),options:InferenceOptionsSchema.optional()}).strict(),
suggest_fix:z.object({...session,baselineSnapshotId:z.string(),limit:z.number().int().min(1).max(24).default(8),profiles:SuggestionProfilesSchema.optional(),includeNativeEvidence:z.boolean().default(false)}).strict(),
run_scenario:z.object({...session,script:ScenarioScriptSchema,target:z.enum(['web','native']).default('web')}).strict(),
run_profile_matrix:z.object({...session,script:ScenarioScriptSchema,profiles:z.array(ProfileOverridesSchema).min(1),target:z.enum(['web','native']).default('web')}).strict(),
close_session:z.object(session).strict()
} as const;
export type ToolName=keyof typeof ToolSchemas;
export type ToolInput<K extends ToolName>=z.infer<(typeof ToolSchemas)[K]>;
export const TrialSchema=z.object({trialId:z.string(),baselineSnapshotId:z.string(),elementId:z.string(),patch:RnStylePatchSchema,mutations:z.array(LayoutMutationSchema).optional(),snapshot:SpatialSnapshotSchema,delta:SpatialDeltaSchema,results:z.array(ConstraintResultSchema)}).strict();
export type Trial=z.infer<typeof TrialSchema>;
export const NativeVerificationSchema=z.object({receipt:CommitReceiptSchema,snapshot:SpatialSnapshotSchema,results:z.array(ConstraintResultSchema),delta:SpatialDeltaSchema,passed:z.boolean()}).strict();
export type NativeVerification=z.infer<typeof NativeVerificationSchema>;

const CommitRnAstPatchOutputBaseSchema=z.object({plan:EditPlanSchema.optional(),transactionPlan:TransactionPlanSchema.optional(),receipt:CommitReceiptSchema.optional(),snapshot:SpatialSnapshotSchema.nullable().optional(),results:z.array(ConstraintResultSchema).optional(),webStatus:z.enum(['passed','failed','reload-timeout','capture-failed','native-checks-pending','interaction-pending']).optional(),nativeStatus:z.literal('pending').optional(),pendingNativeConstraints:z.array(z.string()).optional(),pendingInteractions:z.array(InteractionRequirementSchema).optional(),message:z.string().optional()}).strict();

/** Every JSON tool result is validated here before reaching an MCP client. */
export const ToolOutputSchemas={
 open_session:z.object({sessionId:z.string(),native:z.object({port:z.number().int(),token:z.string()}).strict(),capabilities:z.object({trial:z.literal('rn-style-props'),sourceEdits:z.enum(['static-local-styles','scoped-transactions']),batchTrials:z.boolean().optional(),nativePlatforms:z.array(z.enum(['android','ios'])).optional(),nativeScenario:z.boolean().optional(),nativeVerification:z.literal('required')}).strict()}).strict(),
 import_design_intent:DesignIntentResultSchema,
 inspect_accessibility:z.object({snapshot:SpatialSnapshotSchema,findings:z.array(AccessibilityFindingSchema)}).strict(),
 load_wireframe_spec:z.object({specId:z.string()}).strict(),
 inspect_ui_spatial_graph:z.object({snapshot:SpatialSnapshotSchema,results:z.array(ConstraintResultSchema),webDiagnostics:WebDiagnosticsSchema.optional()}).strict(),
 capture_annotated_overlay:z.object({image:z.string(),mimeType:z.literal('image/png'),artifact:z.string(),marks:z.array(z.object({label:z.number(),id:z.string(),rect:RectSchema}).strict())}).strict(),
 simulate_layout_mutation:z.union([TrialSchema.extend({webDiagnostics:WebDiagnosticsSchema.optional()}),z.object({snapshot:SpatialSnapshotSchema,results:z.array(ConstraintResultSchema),webDiagnostics:WebDiagnosticsSchema.optional()}).strict()]),
 commit_rn_ast_patch:CommitRnAstPatchOutputBaseSchema.refine(o=>(o.plan!==undefined)!==(o.receipt!==undefined),'Result must contain either a preview plan or an applied receipt'),
 verify_native_layout:NativeVerificationSchema,
 revert_commit:z.object({receipt:CommitReceiptSchema,snapshot:SpatialSnapshotSchema.nullable(),nativeStatus:z.literal('pending')}).strict(),
 find_elements:z.object({nodes:z.array(SpatialNodeSchema)}).strict(),
 infer_constraints:z.object({spec:WireframeSpecSchema,findings:z.array(RuleFindingSchema)}).strict(),
 suggest_fix:z.object({candidates:z.array(z.object({mutations:z.array(LayoutMutationSchema),reason:z.string(),constraintIds:z.array(z.string()),results:z.array(ConstraintResultSchema),score:z.number(),warnings:z.number(),profiles:z.array(SuggestionProfileEvidenceSchema).optional(),error:BridgeErrorSchema.optional()})),baselineSnapshotId:z.string(),baselines:z.array(SuggestionProfileEvidenceSchema).optional(),nativeBaseline:NativeSuggestionEvidenceSchema.optional()}).strict(),
 run_scenario:z.object({snapshot:SpatialSnapshotSchema,results:z.array(ConstraintResultSchema)}).strict(),
 run_profile_matrix:z.object({cells:z.array(MatrixCellSchema)}).strict(),
 close_session:z.object({closed:z.literal(true)}).strict(),
} as const;
export type ToolOutput<K extends ToolName>=z.infer<(typeof ToolOutputSchemas)[K]>;
/** MCP's object-root output schema describes both existing trial and reset wire shapes.
 * ToolOutputSchemas still enforces the complete union before any response is sent. */
export const ToolMcpOutputSchemas={...ToolOutputSchemas,commit_rn_ast_patch:CommitRnAstPatchOutputBaseSchema,simulate_layout_mutation:TrialSchema.partial().extend({snapshot:SpatialSnapshotSchema,results:z.array(ConstraintResultSchema),webDiagnostics:WebDiagnosticsSchema.optional()}).strict()} as const;
