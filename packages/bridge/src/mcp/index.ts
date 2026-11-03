import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BridgeFault,ToolSchemas,ToolOutputSchemas,ToolMcpOutputSchemas,type ToolName } from '@nativemason/contracts';
import { BridgeApplication } from '../application/index.js';
const descriptions:Record<ToolName,string>={
 open_session:'Start a local Expo web mirror and Android measurement session. Returns native connection port and token.',
 load_wireframe_spec:'Load explicit JSON constraints matching the session scenario/profile.',
 inspect_ui_spatial_graph:'Capture stable instrumented layout and evaluate constraints. Replaces the trial baseline.',
 capture_annotated_overlay:'Capture a matching live screenshot with numbered element marks and rectangle targets.',
 simulate_layout_mutation:'Replace the current trial using React Native style props, without source writes. Null patch resets trials.',
 commit_rn_ast_patch:'Preview or apply an active passing trial to a supported local static style; native verification remains required.',
 verify_native_layout:'Measure committed Android layout for matching source revisions; return evidence and pass/fail.',
 revert_commit:'Revert a transaction with source hash checks; native verification remains pending.',
 find_elements:'Search measured elements by ID, role, kind, or source path.',
 infer_constraints:'Derive a reviewable specification and default findings from a known-good snapshot.',
 suggest_fix:'Trial and rank deterministic alignment/gap corrections without source writes.',
 run_scenario:'Reset and execute a typed scenario script.',
 run_profile_matrix:'Run scenario profiles and report supported, failed, or unavailable cells.',
 close_session:'Close Chromium and native transport and discard session state.',
};
export function createMcpServer(application=new BridgeApplication()):McpServer {
 const server=new McpServer({name:'nativemason',version:'0.2.0'});
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
