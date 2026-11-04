import {AccessibilityEvidenceSchema} from './accessibility.js';
import {TextFitEvidenceSchema,NativeTargetSchema,type LayoutMutation} from './workflow.js';
import { z } from 'zod';
import { DeviceProfileSchema, RectSchema } from './geometry.js';
import { SourceRefSchema, SourceRevisionsSchema } from './source.js';
import { RnStylePatchSchema } from './styles.js';
export const AuthoredTextPropsSchema=z.object({fontSize:z.number().nonnegative().optional(),lineHeight:z.number().nonnegative().optional(),numberOfLines:z.number().int().positive().optional(),allowFontScaling:z.boolean().optional(),ellipsizeMode:z.enum(['head','middle','tail','clip']).optional()}).strict();
export const TextMetricsSchema=z.object({lineCount:z.number().int().nonnegative()}).strict();
export const DiagnosticEvidenceSchema=z.enum(['confirmed','clear','unknown']);
export const WebNodeDiagnosticsSchema=z.object({
  clipping:DiagnosticEvidenceSchema,
  centerHitTest:DiagnosticEvidenceSchema,
  scrollOverflow:z.object({horizontal:z.boolean(),vertical:z.boolean()}).strict(),
  paintOrder:z.number().int().nullable(),
  fonts:z.array(z.object({family:z.string(),glyphCount:z.number().int().nonnegative(),isCustom:z.boolean().nullable()}).strict()),
  lineBoxCount:z.number().int().nonnegative().nullable(),
}).strict();
export const WebDiagnosticsSchema=z.object({nodes:z.record(z.string(),WebNodeDiagnosticsSchema),warnings:z.array(z.object({elementId:z.string(),code:z.enum(['CLIPPED','OCCLUDED','FONT_LOAD_FAILED','EVIDENCE_UNAVAILABLE']),severity:z.enum(['confirmed','uncertain']),message:z.string()}).strict())}).strict();
export type WebDiagnostics=z.infer<typeof WebDiagnosticsSchema>;
export const SpatialNodeSchema=z.object({id:z.string().min(1),parentId:z.string().nullable(),kind:z.enum(['View','Text','Pressable','TextInput','ScrollView','Image']),role:z.string().nullable(),rect:RectSchema,styles:z.record(z.string(),z.unknown()),source:SourceRefSchema.nullable(),editable:z.boolean(),editReason:z.string().nullable(),pressableState:z.enum(['pressed','rest']).optional(),accessibility:AccessibilityEvidenceSchema.optional(),textFit:TextFitEvidenceSchema.optional(),authoredTextProps:AuthoredTextPropsSchema.optional(),measuredLineCount:z.number().int().nonnegative().optional()}).strict();
export type SpatialNode=z.infer<typeof SpatialNodeSchema>;
export const SpatialSnapshotSchema=z.object({schemaVersion:z.literal(1),sessionId:z.string(),snapshotId:z.string(),platform:z.enum(['web','android','ios']),scenarioId:z.string(),profile:DeviceProfileSchema,revisions:SourceRevisionsSchema,nodes:z.array(SpatialNodeSchema),status:z.enum(['stable','unstable']),generation:z.number().int().nonnegative(),nativeTarget:NativeTargetSchema.optional(),webDiagnostics:WebDiagnosticsSchema.optional()}).strict().superRefine((snapshot,ctx)=>{
  if(snapshot.platform!=='web'&&snapshot.webDiagnostics)ctx.addIssue({code:'custom',message:'Web diagnostics cannot appear in Android snapshots',path:['webDiagnostics']});
  snapshot.nodes.forEach((node,i)=>{
    if(snapshot.platform!=='web'&&node.accessibility?.browser)ctx.addIssue({code:'custom',message:'Browser accessibility evidence cannot appear in native snapshots',path:['nodes',i,'accessibility','browser']});
    for(const dependency of node.source?.dependencies??[])if(!snapshot.revisions[dependency])ctx.addIssue({code:'custom',message:'Required style dependency revision is missing',path:['nodes',i,'source','dependencies'],params:{bridgeCode:'STALE_SOURCE'}});
    if(node.source && snapshot.revisions[node.source.path]!==node.source.hash)ctx.addIssue({code:'custom',message:'Node source hash disagrees with snapshot revisions',path:['nodes',i,'source','hash'],params:{bridgeCode:'STALE_SOURCE'}});
  });
});
export type SpatialSnapshot=z.infer<typeof SpatialSnapshotSchema>;
export const SpatialDeltaSchema=z.object({added:z.array(z.string()),removed:z.array(z.string()),changed:z.array(z.object({id:z.string(),before:RectSchema,after:RectSchema,delta:RectSchema.extend({width:z.number(),height:z.number()})}))});
export type SpatialDelta=z.infer<typeof SpatialDeltaSchema>;
export interface BrowserPort {captureAccessibility?():Promise<SpatialSnapshot>;runScenario?(script:import('./workflow.js').ScenarioScript):Promise<void>;trialBatch?(mutations:readonly LayoutMutation[],profileOverrides?:z.infer<typeof ProfileOverridesSchema>):Promise<SpatialSnapshot>;capture(profileOverrides?:z.infer<typeof ProfileOverridesSchema>):Promise<SpatialSnapshot>;trial(elementId:string,patch:z.infer<typeof RnStylePatchSchema>,profileOverrides?:z.infer<typeof ProfileOverridesSchema>):Promise<SpatialSnapshot>;resetTrial():Promise<void>;screenshot():Promise<Uint8Array>;close():Promise<void>}
export interface NativePort {runHook?(name:string,value?:unknown):Promise<void>;capture(expectedRevisions:z.infer<typeof SourceRevisionsSchema>):Promise<SpatialSnapshot>}
export const OverlaySceneSchema=z.object({width:z.number(),height:z.number(),marks:z.array(z.object({label:z.number(),id:z.string(),rect:RectSchema})),targets:z.array(z.object({id:z.string(),rect:RectSchema}))});
export type OverlayScene=z.infer<typeof OverlaySceneSchema>;
export const ProfileOverridesSchema=z.object({fontScale:z.number().positive().optional(),orientation:z.enum(['portrait','landscape']).optional()}).strict().refine(value=>Object.keys(value).length>0,'Profile override must set a value');
export type ProfileOverrides=z.infer<typeof ProfileOverridesSchema>;
export interface BrowserRuntime {runHook?(name:string,value?:unknown):Promise<void>;applyTrialBatch?(mutations:readonly LayoutMutation[]):Promise<void>;configure(input:{sessionId:string;scenarioId:string;profile:z.infer<typeof DeviceProfileSchema>}):void;capture():Promise<SpatialSnapshot>;applyTrial(id:string,patch:z.infer<typeof RnStylePatchSchema>):Promise<void>;resetTrial():Promise<void>;getDiagnosticTargets():readonly {id:string;element:unknown}[]}
