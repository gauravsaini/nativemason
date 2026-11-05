import {z} from 'zod';
import {SpatialSnapshotSchema} from './graph.js';
import {ConstraintResultSchema} from './constraints.js';
import {CommitReceiptSchema} from './source.js';

/** Public CI reports exclude physical-target evidence by construction. */
export const VisualEvidenceRunSchema=z.object({
  id:z.string().regex(/^[A-Za-z0-9_-]+$/),title:z.string(),
  target:z.enum(['web','android-emulator','ios-simulator']),
  before:SpatialSnapshotSchema,after:SpatialSnapshotSchema,
  results:z.array(ConstraintResultSchema),receipt:CommitReceiptSchema.optional(),
  nativeStatus:z.enum(['passed','failed','pending','unavailable']),notes:z.array(z.string()),
}).strict().superRefine((run,ctx)=>{
  const platform=run.target==='android-emulator'?'android':run.target==='ios-simulator'?'ios':'web';
  for(const snapshot of [run.before,run.after]){
    if(snapshot.platform!==platform)ctx.addIssue({code:'custom',message:'Evidence target and measured platform disagree'});
    if(snapshot.nativeTarget?.kind==='physical')ctx.addIssue({code:'custom',message:'Physical-target evidence is not public report input'});
    if(platform!=='web'&&snapshot.nativeTarget?.kind!==(platform==='android'?'emulator':'simulator'))ctx.addIssue({code:'custom',message:'Native CI report requires explicit simulator/emulator identity'});
  }
  if(run.before.scenarioId!==run.after.scenarioId)ctx.addIssue({code:'custom',message:'Comparison scenarios must match'});
  if(platform!=='web'&&run.before.nativeTarget?.targetId!==run.after.nativeTarget?.targetId)ctx.addIssue({code:'custom',message:'Comparison native targets must match'});
  if(run.nativeStatus==='passed'){
    if(platform==='web'||run.after.status!=='stable'||!run.results.length||run.results.some(result=>result.status!=='pass')||run.receipt?.nativeStatus!=='passed')ctx.addIssue({code:'custom',message:'Native pass requires stable native measurements, passing constraints, and a verified receipt'});
    const measuredIds=new Set(run.after.nodes.map(node=>node.id));
    if(run.results.some(result=>result.elementIds.some(id=>!measuredIds.has(id))))ctx.addIssue({code:'custom',message:'Passing constraint evidence references an unmeasured element'});
    for(const file of (run.receipt?.files?.length?run.receipt.files:(run.receipt?[run.receipt]:[])))if(run.after.revisions[file.path]!==file.newHash)ctx.addIssue({code:'custom',message:'Native evidence revisions do not match the verified receipt'});
  }
});
export type VisualEvidenceRun=z.infer<typeof VisualEvidenceRunSchema>;
export const VisualEvidenceReportSchema=z.object({
  schemaVersion:z.literal(1),repository:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  revision:z.string().regex(/^[a-f0-9]{40,64}$/),pullRequest:z.number().int().positive().optional(),
  runs:z.array(VisualEvidenceRunSchema).max(20),notes:z.array(z.string()),
}).strict();
export type VisualEvidenceReport=z.infer<typeof VisualEvidenceReportSchema>;
export const EvidenceInputsSchema=VisualEvidenceReportSchema.pick({repository:true,revision:true,pullRequest:true}).extend({
  webFile:z.string().min(1).optional(),androidDirectory:z.string().min(1).optional(),iosDirectory:z.string().min(1).optional(),
}).strict();
export type EvidenceInputs=z.infer<typeof EvidenceInputsSchema>;
