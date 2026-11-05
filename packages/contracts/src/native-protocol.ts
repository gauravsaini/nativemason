import { z } from 'zod';
import { SpatialSnapshotSchema } from './graph.js';
import { SourceRevisionsSchema,BridgeErrorSchema } from './source.js';
/** Explicit local interface for development pairing; never a wildcard/public listener. */
export const NativeBindHostSchema=z.ipv4().refine(host=>{const [a=0,b=0]=host.split('.').map(Number);return a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);},'Use a loopback or private LAN IPv4 interface address');
export type NativeBindHost=z.infer<typeof NativeBindHostSchema>;
export const NativeClientMessageSchema=z.discriminatedUnion('type',[
z.object({type:z.literal('hello'),token:z.string(),scenarioId:z.string(),protocolVersion:z.union([z.literal(1),z.literal(2)]),platform:z.enum(['android','ios']).optional(),targetId:z.string().optional(),capabilities:z.object({textFits:z.boolean(),scenarioActions:z.boolean()}).optional()}).strict(),
z.object({type:z.literal('action_result'),requestId:z.string()}).strict(),
z.object({type:z.literal('snapshot'),requestId:z.string(),snapshot:SpatialSnapshotSchema}).strict(),
z.object({type:z.literal('error'),requestId:z.string(),error:BridgeErrorSchema}).strict()]).superRefine((message,ctx)=>{if(message.type==='hello'&&message.protocolVersion===2&&(!message.platform||!message.targetId||!message.capabilities))ctx.addIssue({code:'custom',message:'Protocol v2 requires platform, targetId and capabilities'});});
export type NativeClientMessage=z.infer<typeof NativeClientMessageSchema>;
export const NativeServerMessageSchema=z.discriminatedUnion('type',[z.object({type:z.literal('capture'),requestId:z.string(),sessionId:z.string(),expectedRevisions:SourceRevisionsSchema}).strict(),z.object({type:z.literal('action'),requestId:z.string(),sessionId:z.string(),name:z.string(),value:z.unknown().optional()}).strict()]);
export type NativeServerMessage=z.infer<typeof NativeServerMessageSchema>;
export interface NativeConnectionOptions {port:number;token:string;scenarioId:string;sessionId:string;timeoutMs?:number;targetId?:string;platform?:'android'|'ios';host?:NativeBindHost}
