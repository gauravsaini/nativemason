import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BridgeFault,ToolSchemas,ToolOutputSchemas,ToolMcpOutputSchemas,type ToolName } from '@nativemason/contracts';
import { BridgeApplication } from '../application/index.js';
const descriptions:Record<ToolName,string>={
 import_design_intent:'Convert Figma auto-layout JSON or agent-provided screenshot annotations into a reviewable spec. Does not load or accept design intent.',
 inspect_accessibility:'Report authored native accessibility metadata, browser accessibility evidence, and bounded RTL checks with unavailable evidence explicit.',
 open_session:'Connect a managed Chromium mirror and selected Android/iOS measurement runtime. Returns native connection port and token.',
 load_wireframe_spec:'Load explicit JSON constraints matching the session scenario/profile.',
 inspect_ui_spatial_graph:'Capture stable instrumented layout and evaluate constraints. Replaces the trial baseline.',
 capture_annotated_overlay:'Capture a matching live Chromium screenshot with numbered element marks and rectangle targets; native snapshots are unsupported.',
 simulate_layout_mutation:'Replace the current trial using React Native style props, without source writes. Null patch resets trials.',
 commit_rn_ast_patch:'Preview or apply a scoped source transaction. Explicit allowNativePending may defer unavailable native-only text checks; verification remains required.',
 verify_native_layout:'Measure committed Android/iOS layout for matching source revisions, scenario, profile, and required interaction state; return evidence and pass/fail.',
 revert_commit:'Revert a transaction with source hash checks; native verification remains pending.',
 find_elements:'Search measured elements by ID, role, kind, or source path.',
 infer_constraints:'Derive a reviewable specification and default findings from a known-good snapshot.',
 suggest_fix:'Rank bounded geometry, text-fit, and wrapping candidates using React browser trials across explicit profiles. Optional native baseline seeds proposals, never native trial claims.',
 run_scenario:'Reset and execute a typed scenario script.',
 run_profile_matrix:'Run scenario profiles and report supported, failed, or unavailable cells.',
 close_session:'Close Chromium and native transport and discard session state.',
};
export function createMcpServer(application=new BridgeApplication()):McpServer {
 const server=new McpServer({name:'nativemason',version:'0.3.0'});
 server.registerPrompt('layout-workflow',{description:'Measured layout correction workflow'},async()=>({messages:[{role:'user',content:{type:'text',text:'Open a session for the same named scenario on web and native. Inspect measurements and diagnostics; load or infer and review constraints. Use suggest_fix or batch trials, preview the transaction and blast radius, then apply only an accepted candidate. Verify matching committed revisions on the selected native target. Report unavailable evidence; use revert_commit when requested and verify the revert. Close the session.'}}]}));
 for(const name of Object.keys(ToolSchemas) as ToolName[]) {
  server.registerTool(name,{description:descriptions[name],inputSchema:ToolSchemas[name].shape,outputSchema:ToolMcpOutputSchemas[name]},async (input:unknown)=>{
   try {
    const result=await application.execute(name,input);
    if(name==='capture_annotated_overlay'){
     const {image,...metadata}=ToolOutputSchemas.capture_annotated_overlay.parse(result);
     return {structuredContent:result as Record<string,unknown>,content:[{type:'image' as const,data:image,mimeType:'image/png'},{type:'text' as const,text:JSON.stringify(metadata)}]};
    }
    return {structuredContent:result as Record<string,unknown>,content:[{type:'text' as const,text:JSON.stringify(result)}]};
   }catch(error){const fault=error instanceof BridgeFault?{code:error.code,message:error.message,details:error.details}:{code:'INTERNAL_ERROR',message:error instanceof Error?error.message:String(error)};return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:fault})}]};}
  });
 }
 return server;
}
