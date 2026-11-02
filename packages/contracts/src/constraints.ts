import { z } from 'zod';
import { DeviceProfileSchema,RectSchema } from './geometry.js';
const base={id:z.string().min(1),tolerance:z.number().finite().nonnegative().default(2)};
export const ConstraintSchema=z.discriminatedUnion('type',[
z.object({...base,type:z.literal('rect'),elementId:z.string(),target:RectSchema}).strict(),
z.object({...base,type:z.literal('align'),elementIds:z.array(z.string()).min(2),axis:z.enum(['x','y']),edge:z.enum(['start','center','end'])}).strict(),
z.object({...base,type:z.literal('gap'),first:z.string(),second:z.string(),axis:z.enum(['x','y']),value:z.number().finite().nonnegative()}).strict(),
z.object({...base,type:z.literal('insideSafeArea'),elementId:z.string()}).strict(),
z.object({...base,type:z.literal('disjoint'),first:z.string(),second:z.string()}).strict()]);
export type Constraint=z.infer<typeof ConstraintSchema>;
export const WireframeSpecSchema=z.object({schemaVersion:z.literal(1),scenarioId:z.string(),profile:DeviceProfileSchema,requiredElementIds:z.array(z.string()),constraints:z.array(ConstraintSchema)}).strict().superRefine((s,c)=>{const ids=s.constraints.map(x=>x.id);if(new Set(ids).size!==ids.length)c.addIssue({code:'custom',message:'Duplicate constraint IDs'});if(new Set(s.requiredElementIds).size!==s.requiredElementIds.length)c.addIssue({code:'custom',message:'Duplicate required element IDs'});});
export type WireframeSpec=z.infer<typeof WireframeSpecSchema>;
export const ConstraintResultSchema=z.object({constraintId:z.string(),status:z.enum(['pass','fail','unavailable']),elementIds:z.array(z.string()),deviation:z.number().nonnegative().nullable(),tolerance:z.number(),message:z.string()}).strict();
export type ConstraintResult=z.infer<typeof ConstraintResultSchema>;
