import { z } from 'zod';
export const RectSchema = z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().nonnegative(),height:z.number().finite().nonnegative()}).strict();
export type Rect = z.infer<typeof RectSchema>;
export const InsetsSchema = z.object({top:z.number().nonnegative(),right:z.number().nonnegative(),bottom:z.number().nonnegative(),left:z.number().nonnegative()}).strict();
export const DeviceProfileSchema = z.object({window:z.object({width:z.number().positive(),height:z.number().positive()}).strict(),pixelRatio:z.number().positive(),fontScale:z.number().positive(),insets:InsetsSchema,root:RectSchema,orientation:z.enum(['portrait','landscape'])}).strict();
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;
