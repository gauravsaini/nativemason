import { z } from 'zod';
import { DeviceProfileSchema, RectSchema } from './geometry.js';
import { SourceRefSchema, SourceRevisionsSchema } from './source.js';
import { RnStylePatchSchema } from './styles.js';
export const SpatialNodeSchema=z.object({id:z.string().min(1),parentId:z.string().nullable(),kind:z.enum(['View','Text','Pressable']),role:z.string().nullable(),rect:RectSchema,styles:z.record(z.string(),z.unknown()),source:SourceRefSchema.nullable(),editable:z.boolean(),editReason:z.string().nullable()}).strict();
export type SpatialNode=z.infer<typeof SpatialNodeSchema>;
export const SpatialSnapshotSchema=z.object({schemaVersion:z.literal(1),sessionId:z.string(),snapshotId:z.string(),platform:z.enum(['web','android']),scenarioId:z.string(),profile:DeviceProfileSchema,revisions:SourceRevisionsSchema,nodes:z.array(SpatialNodeSchema),status:z.enum(['stable','unstable']),generation:z.number().int().nonnegative()}).strict().superRefine((snapshot,ctx)=>{
  snapshot.nodes.forEach((node,i)=>{
    if(node.source && snapshot.revisions[node.source.path]!==node.source.hash)ctx.addIssue({code:'custom',message:'Node source hash disagrees with snapshot revisions',path:['nodes',i,'source','hash'],params:{bridgeCode:'STALE_SOURCE'}});
  });
});
export type SpatialSnapshot=z.infer<typeof SpatialSnapshotSchema>;
export const SpatialDeltaSchema=z.object({added:z.array(z.string()),removed:z.array(z.string()),changed:z.array(z.object({id:z.string(),before:RectSchema,after:RectSchema,delta:RectSchema.extend({width:z.number(),height:z.number()})}))});
export type SpatialDelta=z.infer<typeof SpatialDeltaSchema>;
export interface BrowserPort {capture():Promise<SpatialSnapshot>;trial(elementId:string,patch:z.infer<typeof RnStylePatchSchema>):Promise<SpatialSnapshot>;resetTrial():Promise<void>;screenshot():Promise<Uint8Array>;close():Promise<void>}
export interface NativePort {capture(expectedRevisions:z.infer<typeof SourceRevisionsSchema>):Promise<SpatialSnapshot>}
export const OverlaySceneSchema=z.object({width:z.number(),height:z.number(),marks:z.array(z.object({label:z.number(),id:z.string(),rect:RectSchema})),targets:z.array(z.object({id:z.string(),rect:RectSchema}))});
export type OverlayScene=z.infer<typeof OverlaySceneSchema>;
export interface BrowserRuntime {configure(input:{sessionId:string;scenarioId:string;profile:z.infer<typeof DeviceProfileSchema>}):void;capture():Promise<SpatialSnapshot>;applyTrial(id:string,patch:z.infer<typeof RnStylePatchSchema>):Promise<void>;resetTrial():Promise<void>}
