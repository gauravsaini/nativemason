import {z} from 'zod';

export const ContrastEvidenceSchema=z.object({
  status:z.enum(['measured','unavailable']),ratio:z.number().finite().nonnegative().optional(),
  requiredRatio:z.number().positive().optional(),reason:z.string().optional(),
}).strict();
export const AccessibilityEvidenceSchema=z.object({
  authoredLabel:z.string().optional(),authoredHint:z.string().optional(),
  accessible:z.boolean().optional(),focusable:z.boolean().optional(),hidden:z.boolean().optional(),disabled:z.boolean().optional(),
  direction:z.enum(['ltr','rtl','unknown']),
  browser:z.object({name:z.string().nullable(),focusOrder:z.number().int().nonnegative().nullable(),
    focusOrderSource:z.literal('dom-sequential-estimate'),contrast:ContrastEvidenceSchema,
  }).strict().optional(),
}).strict();
export type AccessibilityEvidence=z.infer<typeof AccessibilityEvidenceSchema>;
export const AccessibilityFindingSchema=z.object({
  code:z.enum(['ACCESSIBLE_NAME','FOCUS_ORDER','TEXT_CONTRAST','RTL_PHYSICAL_SPACING','RTL_EVIDENCE']),
  status:z.enum(['pass','fail','advisory','unavailable']),elementIds:z.array(z.string()),message:z.string(),
  platform:z.enum(['web','android','ios']),
}).strict();
export type AccessibilityFinding=z.infer<typeof AccessibilityFindingSchema>;
