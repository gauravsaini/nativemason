import {z} from 'zod';

export const ContrastEvidenceSchema=z.object({
  status:z.enum(['measured','unavailable']),ratio:z.number().finite().nonnegative().optional(),
  requiredRatio:z.number().finite().positive().optional(),reason:z.string().optional(),
}).strict().refine(value=>value.status!=='measured'||(value.ratio!==undefined&&value.ratio>=1&&value.ratio<=21&&value.requiredRatio!==undefined),'Measured contrast requires a valid ratio and threshold');
const rgb=z.tuple([z.number().min(0).max(255),z.number().min(0).max(255),z.number().min(0).max(255)]);
export const BrowserAccessibilitySampleSchema=z.object({direction:z.enum(['ltr','rtl','unknown']),focusOrder:z.number().int().nonnegative().nullable(),foreground:rgb.nullable(),background:rgb.nullable(),requiredRatio:z.number().finite().positive(),contrastReason:z.string().nullable()}).strict();
export const BrowserAccessibilitySamplesSchema=z.record(BrowserAccessibilitySampleSchema);
export type BrowserAccessibilitySample=z.infer<typeof BrowserAccessibilitySampleSchema>;
export const AccessibilityEvidenceSchema=z.object({
  authoredLabel:z.string().optional(),authoredHint:z.string().optional(),
  accessible:z.boolean().optional(),focusable:z.boolean().optional(),hidden:z.boolean().optional(),disabled:z.boolean().optional(),
  direction:z.enum(['ltr','rtl','unknown']),directionSource:z.enum(['authored','native-global','browser-computed','unknown']).optional(),
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
