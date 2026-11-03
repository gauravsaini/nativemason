import {z} from 'zod';
import {SourceRefSchema,EditPlanSchema,SourceFile,SourcePort} from './source.js';
import {RnStylePatchSchema} from './styles.js';
export const LayoutMutationSchema=z.object({elementId:z.string().min(1),patch:RnStylePatchSchema}).strict();
export type LayoutMutation=z.infer<typeof LayoutMutationSchema>;
export const EditScopeSchema=z.object({kind:z.enum(['local','branch','shared','nativewind']),branch:z.enum(['consequent','alternate']).optional(),acknowledgeInstances:z.boolean().optional()}).strict();
export type EditScope=z.infer<typeof EditScopeSchema>;
export const SharedConsumerSchema=z.object({source:SourceRefSchema,mountedIds:z.array(z.string()),requiredScenarios:z.array(z.string())}).strict();
export type SharedConsumer=z.infer<typeof SharedConsumerSchema>;
export const BlastRadiusSchema=z.object({consumers:z.array(SharedConsumerSchema),unresolvedReferences:z.array(z.string())}).strict();
export type BlastRadius=z.infer<typeof BlastRadiusSchema>;
export const SourceMutationSchema=z.object({source:SourceRefSchema,patch:RnStylePatchSchema,scope:EditScopeSchema.optional()}).strict();
export type SourceMutation=z.infer<typeof SourceMutationSchema>;
export const TransactionPlanSchema=z.object({intentId:z.string().min(1).optional(),files:z.array(EditPlanSchema).min(1),blastRadius:BlastRadiusSchema}).strict();
export type TransactionPlan=z.infer<typeof TransactionPlanSchema>;
export const TransactionReceiptSchema=z.object({commitId:z.string(),files:z.array(z.object({path:z.string(),oldHash:z.string(),newHash:z.string(),diff:z.string()}).strict()).min(1),nativeStatus:z.enum(['pending','passed','failed']),revertsCommitId:z.string().optional()}).strict();
export type TransactionReceipt=z.infer<typeof TransactionReceiptSchema>;
export interface TransactionSourcePort extends SourcePort {readProject():Promise<SourceFile[]>;applyTransaction(plan:TransactionPlan):Promise<TransactionReceipt>;revert(commitId:string):Promise<TransactionReceipt>;recover():Promise<void>}
export const TextFitEvidenceSchema=z.object({status:z.enum(['supported','unavailable']),fullLineCount:z.number().int().nonnegative().optional(),limitedLineCount:z.number().int().nonnegative().optional(),fullHeight:z.number().nonnegative().optional(),availableHeight:z.number().nonnegative().optional(),reason:z.string().optional()}).strict();
export type TextFitEvidence=z.infer<typeof TextFitEvidenceSchema>;
export const NativeTargetSchema=z.object({targetId:z.string().min(1),platform:z.enum(['android','ios']),kind:z.enum(['physical','emulator','simulator'])}).strict();
export type NativeTarget=z.infer<typeof NativeTargetSchema>;
export const SuggestionCandidateSchema=z.object({mutations:z.array(LayoutMutationSchema),reason:z.string(),constraintIds:z.array(z.string())}).strict();
export type SuggestionCandidate=z.infer<typeof SuggestionCandidateSchema>;
export const InferenceOptionsSchema=z.object({tolerance:z.number().nonnegative().optional(),includeRectangles:z.boolean().optional()}).strict();
export type InferenceOptions=z.infer<typeof InferenceOptionsSchema>;
export const RuleFindingSchema=z.object({code:z.string(),severity:z.enum(['advisory','confirmed','unavailable']),elementIds:z.array(z.string()),message:z.string()}).strict();
export type RuleFinding=z.infer<typeof RuleFindingSchema>;
export const ScenarioActionSchema=z.discriminatedUnion('type',[z.object({type:z.literal('navigate'),url:z.string()}),z.object({type:z.literal('tap'),elementId:z.string()}),z.object({type:z.literal('input'),elementId:z.string(),text:z.string(),mode:z.enum(['replace','append']).default('replace')}),z.object({type:z.literal('swipe'),elementId:z.string(),direction:z.enum(['UP','DOWN','LEFT','RIGHT'])}),z.object({type:z.literal('scroll'),elementId:z.string(),x:z.number(),y:z.number()}),z.object({type:z.literal('keyboard'),visible:z.boolean()}),z.object({type:z.literal('wait'),elementId:z.string(),timeoutMs:z.number().positive().max(30000).default(5000)}),z.object({type:z.literal('hook'),name:z.string(),value:z.unknown().optional()})]);
export type ScenarioAction=z.infer<typeof ScenarioActionSchema>;
export const ScenarioScriptSchema=z.object({scenarioId:z.string(),reset:z.array(ScenarioActionSchema),actions:z.array(ScenarioActionSchema)}).strict();
export type ScenarioScript=z.infer<typeof ScenarioScriptSchema>;
export const MatrixCellSchema=z.object({targetId:z.string(),scenarioId:z.string(),orientation:z.enum(['portrait','landscape']),fontScale:z.number().positive(),status:z.enum(['passed','failed','unsupported','unavailable']),snapshotId:z.string().optional(),message:z.string().optional()}).strict();
export type MatrixCell=z.infer<typeof MatrixCellSchema>;
export interface ScenarioPort {run(script:ScenarioScript):Promise<void>;close():Promise<void>}
export interface NativeScenarioOptions {readProfile?():Promise<import('./geometry.js').DeviceProfile>;runHook?(name:string,value?:unknown):Promise<void>;target:NativeTarget;appId:string;projectRoot:string;adbSerial?:string;ssh?:{destination:string;identityFile?:string};maestroPath?:string;timeoutMs?:number}
export interface NativeProfilePort {withProfile<T>(profile:import('./graph.js').ProfileOverrides,work:()=>Promise<T>):Promise<T>;recover():Promise<void>}
