import { z } from 'zod';
export const RectSchema = z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().nonnegative(),height:z.number().finite().nonnegative()}).strict();
export type Rect = z.infer<typeof RectSchema>;
export const InsetsSchema = z.object({top:z.number().finite().nonnegative(),right:z.number().finite().nonnegative(),bottom:z.number().finite().nonnegative(),left:z.number().finite().nonnegative()}).strict();
export const DeviceProfileSchema = z.object({window:z.object({width:z.number().finite().positive(),height:z.number().finite().positive()}).strict(),pixelRatio:z.number().finite().positive(),fontScale:z.number().finite().positive(),insets:InsetsSchema,root:RectSchema,orientation:z.enum(['portrait','landscape'])}).strict();
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;
