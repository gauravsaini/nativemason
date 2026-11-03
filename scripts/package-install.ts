import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath,URL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
async function main(){
  const temp=await mkdtemp(path.join(tmpdir(),'nativemason-package-smoke-')),packs=path.join(root,'artifacts','packs');await mkdir(packs,{recursive:true});
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
    const dependencies=Object.fromEntries(Object.entries(fixture.dependencies).filter(([name,value])=>!value.startsWith('workspace:')&&!names.includes(name)));
    await writeFile(path.join(temp,'package.json'),JSON.stringify({name:'nativemason-external-consumer',private:true,type:'module',dependencies},null,2));
    await writeFile(path.join(temp,'app.json'),JSON.stringify({expo:{name:'NativeMason Consumer',slug:'nativemason-consumer'}}));
    await writeFile(path.join(temp,'App.tsx'),"import {View, Text} from 'react-native'; export default function App(){return <View><Text>Consumer</Text></View>;}\n");
    await exec('npm',['install','--no-audit','--no-fund',...tarballs],{cwd:temp,env:{...process.env,SHARP_IGNORE_GLOBAL_LIBVIPS:'1'},timeout:300000,maxBuffer:8*1024*1024});
    const binary=path.join(temp,'node_modules/nativemason/bin/nativemason.js');
    const help=(await exec(process.execPath,[binary,'--help'],{cwd:temp})).stdout;assert.match(help,/nativemason/);
    const first=JSON.parse((await exec(process.execPath,[binary,'init',temp],{cwd:temp})).stdout);assert.ok(first);
    const before=await readFile(path.join(temp,'babel.config.cjs'),'utf8');
    await exec(process.execPath,[binary,'init',temp],{cwd:temp});assert.equal(await readFile(path.join(temp,'babel.config.cjs'),'utf8'),before,'Init must be idempotent');
    await exec(process.execPath,['--input-type=module','-e',"import {createRequire} from 'node:module';const require=createRequire(import.meta.url); require.resolve('@nativemason/runtime');require.resolve('nativemason/babel');import('@nativemason/contracts').then(m=>{if(!m.TransactionPlanSchema)process.exit(1);});"],{cwd:temp});
    const client=new Client({name:'package-install-smoke',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[binary],cwd:temp,stderr:'pipe'});
    try{await client.connect(transport);const tools=await client.listTools();for(const name of ['revert_commit','suggest_fix','run_profile_matrix','find_elements'])assert.ok(tools.tools.some(tool=>tool.name===name),'Missing MCP tool '+name);}finally{await client.close();}
    await writeFile(path.join(packs,'install-smoke.json'),JSON.stringify({passed:true,packages:names,node:process.version,consumer:'separate npm Expo project',checks:['allowlists','license','install','executable','init-idempotency','public-exports','mcp-discovery']},null,2));
    console.log('PACKAGE_INSTALL_SMOKE_PASSED');
  }finally{await rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error('PACKAGE_INSTALL_SMOKE_FAILED',error);process.exitCode=1;});
