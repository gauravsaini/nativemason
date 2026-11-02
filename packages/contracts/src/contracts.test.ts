import {describe,it,expect} from 'vitest';
import {DeviceProfileSchema,WireframeSpecSchema,ToolSchemas,ToolOutputSchemas,RnStylePatchSchema,NativeClientMessageSchema,SpatialSnapshotSchema} from './index.js';
import fixture from '../fixtures/footer.json';
describe('boundary contracts',()=>{
 it('round-trips the authoritative fixture and applies default tolerance',()=>{const s=WireframeSpecSchema.parse(fixture);expect(WireframeSpecSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);const c={...fixture,constraints:[{type:'insideSafeArea',id:'safe',elementId:'submit'}]};expect(WireframeSpecSchema.parse(c).constraints[0].tolerance).toBe(2)});
 it('rejects nonfinite geometry, duplicate IDs and unknown properties',()=>{expect(DeviceProfileSchema.safeParse({...fixture.profile,fontScale:Infinity}).success).toBe(false);expect(WireframeSpecSchema.safeParse({...fixture,requiredElementIds:['a','a']}).success).toBe(false);expect(RnStylePatchSchema.safeParse({width:2,transform:'none'}).success).toBe(false)});
 it('exposes the eight strict MCP inputs and rejects malformed native messages',()=>{expect(Object.keys(ToolSchemas)).toHaveLength(8);expect(ToolSchemas.close_session.safeParse({sessionId:'s',extra:true}).success).toBe(false);expect(NativeClientMessageSchema.safeParse({type:'hello',token:'a',scenarioId:'b',protocolVersion:2}).success).toBe(false)});
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
});
