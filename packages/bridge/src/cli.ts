#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeApplication } from './application/index.js';
import { createMcpServer } from './mcp/index.js';
if(process.argv[2]==='init'){const {initialize}=await import('./init/index.js');const root=process.argv.find((arg,index)=>index>2&&!arg.startsWith('--'))??process.cwd();console.log(JSON.stringify(await initialize(root,process.argv.includes('--dry-run'),{textProbes:process.argv.includes('--text-probes')}),null,2));process.exit(0);}
if(process.argv.includes('--help')){console.log('nativemason [init [project-root] [--dry-run]]\nWithout arguments, starts the MCP stdio server.');process.exit(0);}
const app=new BridgeApplication();
const server=createMcpServer(app);
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await server.close();}
process.once('SIGINT',()=>{void close().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});
process.stdin.once('end',()=>{void close();});
await server.connect(new StdioServerTransport());
