#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeApplication } from './application/index.js';
import { createMcpServer } from './mcp/index.js';
const app=new BridgeApplication();
const server=createMcpServer(app);
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await server.close();}
process.once('SIGINT',()=>{void close().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});
process.stdin.once('end',()=>{void close();});
await server.connect(new StdioServerTransport());
