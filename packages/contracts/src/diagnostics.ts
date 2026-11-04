import {z} from 'zod';
import {DeviceProfileSchema} from './geometry.js';
import {ConstraintResultSchema} from './constraints.js';
import {BridgeErrorSchema} from './source.js';

/** Browser trials across explicit device profiles; native acceptance remains separate. */
export const SuggestionProfileSchema=z.object({id:z.string().min(1),profile:DeviceProfileSchema}).strict();
export type SuggestionProfile=z.infer<typeof SuggestionProfileSchema>;
export const SuggestionProfilesSchema=z.array(SuggestionProfileSchema).min(1).max(6).refine(profiles=>new Set(profiles.map(profile=>profile.id)).size===profiles.length&&!profiles.some(profile=>profile.id==='baseline'),'Profile IDs must be unique; baseline is reserved');
export const SuggestionProfileEvidenceSchema=z.object({
  profileId:z.string(),platform:z.literal('web'),profile:DeviceProfileSchema,
  status:z.enum(['passed','failed','unsupported','unavailable']),
  snapshotId:z.string().optional(),results:z.array(ConstraintResultSchema),
  regressions:z.number().int().nonnegative(),warnings:z.number().int().nonnegative(),
  error:BridgeErrorSchema.optional(),
}).strict();
export type SuggestionProfileEvidence=z.infer<typeof SuggestionProfileEvidenceSchema>;
