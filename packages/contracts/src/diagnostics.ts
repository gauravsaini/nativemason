import {z} from 'zod';
import {DeviceProfileSchema} from './geometry.js';
import {ConstraintResultSchema} from './constraints.js';
import {BridgeErrorSchema} from './source.js';

/** Browser trials across explicit device profiles; native acceptance remains separate. */
export const SuggestionProfileSchema=z.object({id:z.string().min(1),profile:DeviceProfileSchema}).strict();
export type SuggestionProfile=z.infer<typeof SuggestionProfileSchema>;
export const SuggestionProfileEvidenceSchema=z.object({
  profileId:z.string(),platform:z.literal('web'),profile:DeviceProfileSchema,
  status:z.enum(['passed','failed','unsupported','unavailable']),
  snapshotId:z.string().optional(),results:z.array(ConstraintResultSchema),
  regressions:z.number().int().nonnegative(),warnings:z.number().int().nonnegative(),
  error:BridgeErrorSchema.optional(),
}).strict();
export type SuggestionProfileEvidence=z.infer<typeof SuggestionProfileEvidenceSchema>;
