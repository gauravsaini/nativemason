import assert from 'node:assert/strict';
import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {chromium} from 'playwright';import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath,URL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
async function main(){
  const temp=await mkdtemp(path.join(tmpdir(),'nativemason-package-smoke-')),packs=path.join(root,'artifacts','packs');await mkdir(packs,{recursive:true});
  let metro:ChildProcess|undefined;let logs='';
  try{
    const names=['@nativemason/contracts','@nativemason/runtime','nativemason'];const tarballs:string[]=[];
    for(const name of names){
      const output=path.join(packs,name.replace('@','').replace('/','-')+'-0.2.0.tgz');
      await exec('yarn',['workspace',name,'pack','--out',output],{cwd:root,maxBuffer:4*1024*1024});tarballs.push(output);
      const files=(await exec('tar',['-tzf',output])).stdout.split('\n');
      assert.ok(files.some(file=>file==='package/LICENSE'),'Package must include its license');
      assert.ok(files.some(file=>file.startsWith('package/dist/')),'Package must include built output');
      assert.ok(!files.some(file=>/(?:^|\/)(?:src|tests|artifacts|node_modules|examples)\//.test(file)),'Package contains development-only paths');
    }
    const fixture=JSON.parse(await readFile(path.join(root,'examples/expo-fixture/package.json'),'utf8')) as {dependencies:Record<string,string>};
    const dependencies=Object.fromEntries(Object.entries(fixture.dependencies).filter(([name,value])=>!value.startsWith('workspace:')&&!names.includes(name)&&!['nativewind','tailwindcss','react-native-reanimated','react-native-worklets'].includes(name)));
    await writeFile(path.join(temp,'package.json'),JSON.stringify({name:'nativemason-external-consumer',private:true,type:'module',dependencies},null,2));
    await writeFile(path.join(temp,'app.json'),JSON.stringify({expo:{name:'NativeMason Consumer',slug:'nativemason-consumer'}}));
    await writeFile(path.join(temp,'App.tsx'),"import {View, Text} from 'react-native'; export default function App(){return <View testID='consumer-root' style={{flex:1}}><Text testID='consumer-copy'>Consumer</Text></View>;}\n");
    await exec('npm',['install','--no-audit','--no-fund',...tarballs],{cwd:temp,env:{...process.env,SHARP_IGNORE_GLOBAL_LIBVIPS:'1'},timeout:300000,maxBuffer:8*1024*1024});
    const binary=path.join(temp,'node_modules/nativemason/bin/nativemason.js');
    const help=(await exec(process.execPath,[binary,'--help'],{cwd:temp})).stdout;assert.match(help,/nativemason/);
    const first=JSON.parse((await exec(process.execPath,[binary,'init',temp],{cwd:temp})).stdout);assert.ok(first);
    const before=await readFile(path.join(temp,'babel.config.cjs'),'utf8');
    await exec(process.execPath,[binary,'init',temp],{cwd:temp});assert.equal(await readFile(path.join(temp,'babel.config.cjs'),'utf8'),before,'Init must be idempotent');
    await exec(process.execPath,['--input-type=module','-e',"import {createRequire} from 'node:module';const require=createRequire(import.meta.url); require.resolve('@nativemason/runtime');require.resolve('nativemason/babel');import('@nativemason/contracts').then(m=>{if(!m.TransactionPlanSchema)process.exit(1);});"],{cwd:temp});
    const client=new Client({name:'package-install-smoke',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[binary],cwd:temp,stderr:'pipe'});
    try{
      await client.connect(transport);const tools=await client.listTools();for(const name of ['revert_commit','suggest_fix','run_profile_matrix','find_elements'])assert.ok(tools.tools.some(tool=>tool.name===name),'Missing MCP tool '+name);
      metro=spawn(process.execPath,[path.join(temp,'node_modules/expo/bin/cli'),'start',temp,'--web','--localhost','--port','18083','--clear'],{cwd:temp,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1',NODE_ENV:'development',EXPO_PUBLIC_LAYOUT_NATIVE_URL:'',EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN:'',EXPO_PUBLIC_LAYOUT_SCENARIO:'consumer'}});
      metro.stdout?.on('data',data=>{logs+=String(data);});metro.stderr?.on('data',data=>{logs+=String(data);});
      const deadline=Date.now()+60000;while(true){try{const response=await fetch('http://localhost:18083/status');if((await response.text()).includes('packager-status:running'))break;}catch{ /* The readiness deadline and process exit check handle transient startup failures. */ }if(Date.now()>deadline||metro.exitCode!==null)throw Error('Consumer Metro failed: '+logs.slice(-4000));await new Promise(resolve=>setTimeout(resolve,200));}
      const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:412,height:915}});await page.goto('http://localhost:18083/',{timeout:90000});await page.waitForFunction(()=>Boolean((window as Window & {__RN_LAYOUT_BRIDGE__?:unknown}).__RN_LAYOUT_BRIDGE__),undefined,{timeout:90000});}finally{await browser.close();}
      const profile=JSON.parse(await readFile(path.join(root,'packages/contracts/fixtures/footer.json'),'utf8')).profile;
      const opened=await client.callTool({name:'open_session',arguments:{projectRoot:temp,webUrl:'http://localhost:18083/',scenarioId:'consumer',profile,nativePort:19488,nativeToken:'nativemason-package-smoke-token'}});
      assert.ok(!opened.isError,JSON.stringify(opened.content));const sessionId=(opened.structuredContent as {sessionId:string}).sessionId;
      const inspected=await client.callTool({name:'inspect_ui_spatial_graph',arguments:{sessionId}});assert.ok(!inspected.isError,JSON.stringify(inspected.content));const snapshot=(inspected.structuredContent as {snapshot:{nodes:{id:string}[]}}).snapshot;assert.ok(snapshot.nodes.some(node=>node.id==='consumer-root'),'Auto-instrumented packed consumer root missing');assert.ok(snapshot.nodes.some(node=>node.id==='consumer-copy'),'Auto-instrumented packed consumer text missing');await client.callTool({name:'close_session',arguments:{sessionId}});
    }finally{await client.close();}
    await writeFile(path.join(packs,'install-smoke.json'),JSON.stringify({passed:true,packages:names,node:process.version,consumer:'separate npm Expo project',checks:['allowlists','license','install','executable','init-idempotency','public-exports','mcp-discovery','packed-consumer-web-capture']},null,2));
    console.log('PACKAGE_INSTALL_SMOKE_PASSED');
  }catch(error){throw new Error((error instanceof Error?error.message:String(error))+'\nConsumer Metro: '+logs.slice(-4000),{cause:error});}finally{if(metro?.pid){try{process.kill(-metro.pid,'SIGTERM');}catch{ /* The readiness deadline and process exit check handle transient startup failures. */ }}await rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error('PACKAGE_INSTALL_SMOKE_FAILED',error);process.exitCode=1;});
