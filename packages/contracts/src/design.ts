import {z} from 'zod';
import {DeviceProfileSchema,RectSchema} from './geometry.js';
import {ConstraintSchema,WireframeSpecSchema} from './constraints.js';

/** Each nested Figma node is validated independently by the bounded importer. */
export const FigmaNodeSchema=z.object({
  id:z.string().min(1),type:z.string(),name:z.string().optional(),
  absoluteBoundingBox:RectSchema.optional(),
  layoutMode:z.enum(['NONE','HORIZONTAL','VERTICAL']).optional(),
  itemSpacing:z.number().finite().optional(),
  counterAxisAlignItems:z.enum(['MIN','CENTER','MAX','BASELINE']).optional(),
  children:z.array(z.unknown()).max(10000).optional(),
}).passthrough();
export type FigmaNode=z.infer<typeof FigmaNodeSchema>;
const common={scenarioId:z.string().min(1),profile:DeviceProfileSchema,tolerance:z.number().finite().nonnegative().default(2)};
export const DesignIntentSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('figma-auto-layout'),frame:FigmaNodeSchema,
    elementMap:z.record(z.string(),z.string().min(1)),
    logicalUnitsPerDesignUnit:z.number().finite().positive().default(1),
  }).strict(),
  z.object({...common,kind:z.literal('reference-annotations'),
    image:z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),width:z.number().finite().positive(),height:z.number().finite().positive()}).strict(),
    appRootPixels:RectSchema,pixelsPerLogicalUnit:z.number().finite().positive(),
    annotations:z.array(z.object({elementId:z.string().min(1),rectPixels:RectSchema}).strict()).min(1).max(10000),
    assertions:z.array(ConstraintSchema).default([]),
  }).strict(),
]);
export type DesignIntent=z.infer<typeof DesignIntentSchema>;
export const DesignIntentResultSchema=z.object({
  spec:WireframeSpecSchema,reviewRequired:z.literal(true),
  source:z.enum(['figma-auto-layout','reference-annotations']),notes:z.array(z.string()),
}).strict();
export type DesignIntentResult=z.infer<typeof DesignIntentResultSchema>;
