import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BridgeFault,ToolSchemas,ToolOutputSchemas,type ToolName } from '@rn-layout/contracts';
import { BridgeApplication } from '../application/index.js';
const descriptions:Record<ToolName,string>={
 open_session:'Start a local Expo web mirror and Android measurement session. Returns native connection port and token.',
 load_wireframe_spec:'Load explicit JSON constraints matching the session scenario/profile.',
 inspect_ui_spatial_graph:'Capture stable instrumented layout and evaluate constraints. Replaces the trial baseline.',
 capture_annotated_overlay:'Capture a matching live screenshot with numbered element marks and rectangle targets.',
 simulate_layout_mutation:'Replace the current trial using React Native style props, without source writes. Null patch resets trials.',
 commit_rn_ast_patch:'Preview or apply an active passing trial to a supported local static style; native verification remains required.',
 verify_native_layout:'Measure committed Android layout for matching source revisions; return evidence and pass/fail.',
 close_session:'Close Chromium and native transport and discard session state.',
};
export function createMcpServer(application=new BridgeApplication()):McpServer {
 const server=new McpServer({name:'nativemason',version:'0.1.0'});
 for(const name of Object.keys(ToolSchemas) as ToolName[]) {
  server.registerTool(name,{description:descriptions[name],inputSchema:ToolSchemas[name].shape},async (input:unknown)=>{
   try {
    const result=await application.execute(name,input);
    if(name==='capture_annotated_overlay'){
     const {image,...metadata}=ToolOutputSchemas.capture_annotated_overlay.parse(result);
     return {content:[{type:'image' as const,data:image,mimeType:'image/png'},{type:'text' as const,text:JSON.stringify(metadata)}]};
    }
    return {content:[{type:'text' as const,text:JSON.stringify(result)}]};
   }catch(error){const fault=error instanceof BridgeFault?{code:error.code,message:error.message,details:error.details}:{code:'INTERNAL_ERROR',message:error instanceof Error?error.message:String(error)};return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:fault})}]};}
  });
 }
 return server;
}
