import nativeScenarioFailure from '../fixtures/native-scenario-failure.json';
import {NativeScenarioFailureEvidenceSchema} from './index.js';
import visualEvidence from '../fixtures/visual-evidence.json';
import {VisualEvidenceReportSchema} from './index.js';
import {describe,it,expect} from 'vitest';
import {DeviceProfileSchema,WireframeSpecSchema,ToolSchemas,ToolOutputSchemas,RnStylePatchSchema,NativeClientMessageSchema,SpatialSnapshotSchema,ProfileOverridesSchema} from './index.js';
import fixture from '../fixtures/footer.json';
import expansion from '../fixtures/design-diagnostics.json';
import {DesignIntentSchema,AccessibilityEvidenceSchema,SuggestionProfileSchema,NativeSuggestionEvidenceSchema} from './index.js';
describe('boundary contracts',()=>{
 it('round-trips the authoritative fixture and applies default tolerance',()=>{const s=WireframeSpecSchema.parse(fixture);expect(WireframeSpecSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);const c={...fixture,constraints:[{type:'insideSafeArea',id:'safe',elementId:'submit'}]};expect(WireframeSpecSchema.parse(c).constraints[0].tolerance).toBe(2)});
 it('rejects nonfinite geometry, duplicate IDs and unknown properties',()=>{expect(DeviceProfileSchema.safeParse({...fixture.profile,fontScale:Infinity}).success).toBe(false);expect(WireframeSpecSchema.safeParse({...fixture,requiredElementIds:['a','a']}).success).toBe(false);expect(RnStylePatchSchema.safeParse({width:2,transform:'none'}).success).toBe(false)});
 it('exposes strict MCP inputs and rejects malformed native messages',()=>{expect(Object.keys(ToolSchemas).sort()).toEqual(Object.keys(ToolOutputSchemas).sort());expect(ToolSchemas.close_session.safeParse({sessionId:'s',extra:true}).success).toBe(false);expect(NativeClientMessageSchema.safeParse({type:'hello',token:'a',scenarioId:'b',protocolVersion:2}).success).toBe(false)});
 it('requires exactly one plan or receipt in commit tool output',()=>{
 const plan={source:{path:'App.tsx',hash:'a'.repeat(64),start:1,end:2,line:1,column:1},expectedHash:'a'.repeat(64),updatedText:'x',diff:'d'};
 const receipt={commitId:'c',path:'App.tsx',oldHash:'a'.repeat(64),newHash:'b'.repeat(64),diff:'d',nativeStatus:'pending'};
 expect(ToolOutputSchemas.commit_rn_ast_patch.safeParse({plan}).success).toBe(true);
 expect(ToolOutputSchemas.commit_rn_ast_patch.safeParse({receipt}).success).toBe(true);
 expect(ToolOutputSchemas.commit_rn_ast_patch.safeParse({}).success).toBe(false);
 expect(ToolOutputSchemas.commit_rn_ast_patch.safeParse({plan,receipt}).success).toBe(false);
 expect(ToolOutputSchemas.close_session.safeParse({closed:true,extra:true}).success).toBe(false);
 });
 it('rejects a mixed source tree even when revisions claims the latest hash',()=>{
 const source={path:'App.tsx',hash:'a'.repeat(64),start:0,end:10,line:1,column:0};
 const input={schemaVersion:1,sessionId:'s',snapshotId:'x',scenarioId:'broken-footer',profile:fixture.profile,platform:'android',generation:1,status:'stable',revisions:{'App.tsx':'b'.repeat(64)},nodes:[{id:'screen',parentId:null,kind:'View',role:null,rect:{x:0,y:0,width:10,height:10},styles:{},source,editable:true,editReason:null}]};
 const parsed=SpatialSnapshotSchema.safeParse(input);expect(parsed.success).toBe(false);if(!parsed.success)expect(parsed.error.issues[0].message).toContain('source hash');
 input.revisions['App.tsx']=source.hash;expect(SpatialSnapshotSchema.safeParse(input).success).toBe(true);
 });
 it('keeps CDP diagnostics web-only and accepts text measurements when supplied',()=>{
 const snapshot={schemaVersion:1,sessionId:'s',snapshotId:'x',scenarioId:'broken-footer',profile:fixture.profile,platform:'web' as const,generation:1,status:'stable' as const,revisions:{},nodes:[{id:'copy',parentId:null,kind:'Text' as const,role:null,rect:{x:0,y:0,width:10,height:20},styles:{},source:null,editable:false,editReason:null,authoredTextProps:{fontSize:16,numberOfLines:2,allowFontScaling:true},measuredLineCount:2}],webDiagnostics:{nodes:{copy:{clipping:'clear' as const,centerHitTest:'clear' as const,scrollOverflow:{horizontal:false,vertical:false},paintOrder:3,fonts:[{family:'Example',glyphCount:4,isCustom:true}],lineBoxCount:2}},warnings:[]}};
 expect(SpatialSnapshotSchema.safeParse(snapshot).success).toBe(true);
 expect(SpatialSnapshotSchema.safeParse({...snapshot,platform:'android'}).success).toBe(false);
 });
 it('validates narrow profile overrides on both relevant MCP inputs',()=>{
 expect(ProfileOverridesSchema.safeParse({orientation:'landscape'}).success).toBe(true);
 expect(ProfileOverridesSchema.safeParse({fontScale:1.2}).success).toBe(true);
 expect(ProfileOverridesSchema.safeParse({orientation:'diagonal'}).success).toBe(false);
 expect(ToolSchemas.inspect_ui_spatial_graph.safeParse({sessionId:'s',profileOverrides:{orientation:'landscape'}}).success).toBe(true);
 expect(ToolSchemas.simulate_layout_mutation.safeParse({sessionId:'s',baselineSnapshotId:'b',elementId:'x',patch:{width:12},profileOverrides:{fontScale:1.2}}).success).toBe(true);
 });
});

it('round-trips reviewable design intent, profile requests, and unknown accessibility evidence',()=>{
 for(const [schema,input] of [[DesignIntentSchema,expansion.design],[AccessibilityEvidenceSchema,expansion.accessibility],[SuggestionProfileSchema,expansion.profiles[0]]] as const){const parsed=schema.parse(input);expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);}
 expect(ToolSchemas.import_design_intent.safeParse({sessionId:'s',design:expansion.design}).success).toBe(true);
 expect(ToolSchemas.suggest_fix.safeParse({sessionId:'s',baselineSnapshotId:'b',profiles:expansion.profiles}).success).toBe(true);
});

it('keeps public visual evidence native acceptance honest and excludes physical targets',()=>{
 expect(VisualEvidenceReportSchema.parse(visualEvidence).runs[0].nativeStatus).toBe('pending');
 const report=structuredClone(visualEvidence);report.runs[0].nativeStatus='passed';expect(VisualEvidenceReportSchema.safeParse(report).success).toBe(false);
 const run={...visualEvidence.runs[0],target:'android-emulator',before:{...visualEvidence.runs[0].before,platform:'android',nativeTarget:{targetId:'private-target',platform:'android',kind:'physical'}},after:{...visualEvidence.runs[0].after,platform:'android',nativeTarget:{targetId:'private-target',platform:'android',kind:'physical'}}};
 expect(VisualEvidenceReportSchema.safeParse({...visualEvidence,runs:[run]}).success).toBe(false);
});

it('accepts matching verified native report evidence and rejects revision drift',()=>{
 const snapshot={...visualEvidence.runs[0].before,platform:'android',nativeTarget:{targetId:'ci-emulator',platform:'android',kind:'emulator'},nodes:[{id:'footer',parentId:null,kind:'View',role:null,rect:{x:0,y:0,width:64,height:48},styles:{},source:null,editable:false,editReason:'fixture'}]};
 const receipt={commitId:'commit',path:'App.tsx',oldHash:'a'.repeat(64),newHash:'b'.repeat(64),diff:'diff',nativeStatus:'passed'};
 const run={...visualEvidence.runs[0],target:'android-emulator',before:snapshot,after:{...snapshot,snapshotId:'after',revisions:{'App.tsx':receipt.newHash}},receipt,nativeStatus:'passed',results:[{constraintId:'row',status:'pass',elementIds:['footer'],deviation:0,tolerance:2,message:'Measured condition passed'}]};
 const report={...visualEvidence,runs:[run]};expect(VisualEvidenceReportSchema.safeParse(report).success).toBe(true);
 expect(VisualEvidenceReportSchema.safeParse({...report,runs:[{...run,after:{...run.after,revisions:{'App.tsx':'c'.repeat(64)}}}]}).success).toBe(false);
 expect(VisualEvidenceReportSchema.safeParse({...report,runs:[{...run,results:[{...run.results[0],elementIds:['missing']}]}]}).success).toBe(false);
});

it('keeps deferred native checks opt-in and native proposal evidence explicit',()=>{
 expect(ToolSchemas.commit_rn_ast_patch.parse({sessionId:'s',trialId:'t',mode:'preview'}).allowNativePending).toBe(false);
 expect(ToolSchemas.suggest_fix.parse({sessionId:'s',baselineSnapshotId:'b'}).includeNativeEvidence).toBe(false);
 expect(ToolSchemas.commit_rn_ast_patch.parse(expansion.nativePending.request).allowNativePending).toBe(true);
 expect(ToolSchemas.suggest_fix.parse(expansion.nativePending.suggestionRequest).includeNativeEvidence).toBe(true);
 expect(NativeSuggestionEvidenceSchema.safeParse({status:'captured',results:[]}).success).toBe(false);
 expect(NativeSuggestionEvidenceSchema.safeParse({status:'captured',snapshot:visualEvidence.runs[0].before,results:[]}).success).toBe(false);
 expect(NativeSuggestionEvidenceSchema.parse(expansion.nativePending.nativeBaseline).status).toBe('unavailable');
});

it('bounds native scenario error evidence without treating process failure as a pass',()=>{
 const parsed=NativeScenarioFailureEvidenceSchema.parse(nativeScenarioFailure);expect(parsed.exitCode).toBe(1);
 expect(NativeScenarioFailureEvidenceSchema.safeParse({...parsed,stdout:'x'.repeat(16385)}).success).toBe(false);
 expect(NativeScenarioFailureEvidenceSchema.safeParse({...parsed,signal:'SIGTERM',terminated:true,exitCode:null}).success).toBe(true);
});
