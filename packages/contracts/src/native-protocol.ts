import { z } from 'zod';
import { SpatialSnapshotSchema } from './graph.js';
import { SourceRevisionsSchema,BridgeErrorSchema } from './source.js';
export const NativeClientMessageSchema=z.discriminatedUnion('type',[
z.object({type:z.literal('hello'),token:z.string(),scenarioId:z.string(),protocolVersion:z.literal(1)}).strict(),
z.object({type:z.literal('snapshot'),requestId:z.string(),snapshot:SpatialSnapshotSchema}).strict(),
z.object({type:z.literal('error'),requestId:z.string(),error:BridgeErrorSchema}).strict()]);
export type NativeClientMessage=z.infer<typeof NativeClientMessageSchema>;
export const NativeServerMessageSchema=z.object({type:z.literal('capture'),requestId:z.string(),sessionId:z.string(),expectedRevisions:SourceRevisionsSchema}).strict();
export type NativeServerMessage=z.infer<typeof NativeServerMessageSchema>;
export interface NativeConnectionOptions {port:number;token:string;scenarioId:string;sessionId:string;timeoutMs?:number}
