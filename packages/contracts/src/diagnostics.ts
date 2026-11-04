import {z} from 'zod';
import {DeviceProfileSchema} from './geometry.js';
import {ConstraintResultSchema} from './constraints.js';
import {BridgeErrorSchema} from './source.js';
import {SpatialSnapshotSchema} from './graph.js';
import {ScenarioScriptSchema} from './workflow.js';

/** Browser trials across explicit device profiles; native acceptance remains separate. */
export const SuggestionProfileSchema=z.object({id:z.string().min(1),profile:DeviceProfileSchema,script:ScenarioScriptSchema.optional()}).strict();
export type SuggestionProfile=z.infer<typeof SuggestionProfileSchema>;
export const SuggestionProfilesSchema=z.array(SuggestionProfileSchema).min(1).max(6).refine(profiles=>new Set(profiles.map(profile=>profile.id)).size===profiles.length&&!profiles.some(profile=>profile.id==='baseline'),'Profile IDs must be unique; baseline is reserved');
export const SuggestionProfileEvidenceSchema=z.object({
  profileId:z.string(),platform:z.literal('web'),profile:DeviceProfileSchema,scenarioState:z.enum(['baseline','scripted','initial']).optional(),
  status:z.enum(['passed','failed','unsupported','unavailable']),
  snapshotId:z.string().optional(),results:z.array(ConstraintResultSchema),
  regressions:z.number().int().nonnegative(),warnings:z.number().int().nonnegative(),
  error:BridgeErrorSchema.optional(),
}).strict();
export type SuggestionProfileEvidence=z.infer<typeof SuggestionProfileEvidenceSchema>;

/** Fresh native baseline seeds proposals only; candidates are still browser trials. */
export const NativeSuggestionEvidenceSchema=z.object({
  status:z.enum(['captured','unsupported','unavailable']),snapshot:SpatialSnapshotSchema.optional(),
  results:z.array(ConstraintResultSchema),error:BridgeErrorSchema.optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.status==='captured'&&(!value.snapshot||value.snapshot.platform==='web'))ctx.addIssue({code:'custom',message:'Captured native evidence requires a native snapshot'});
  if(value.status!=='captured'&&value.snapshot)ctx.addIssue({code:'custom',message:'Unavailable native evidence cannot contain a snapshot'});
});
export type NativeSuggestionEvidence=z.infer<typeof NativeSuggestionEvidenceSchema>;
/** Required callback interaction evidence, checked again after reload and on native. */
export const InteractionRequirementSchema=z.object({elementId:z.string().min(1),pressed:z.boolean()}).strict();
export type InteractionRequirement=z.infer<typeof InteractionRequirementSchema>;
