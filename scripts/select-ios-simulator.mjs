import process from 'node:process';import console from 'node:console';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {appendFile} from 'node:fs/promises';
const exec=promisify(execFile);
if(!process.env.GITHUB_ENV)throw Error('This provisioning script runs only on a GitHub macOS runner');
const listing=JSON.parse((await exec('xcrun',['simctl','list','devices','available','--json'])).stdout);
const runtimes=Object.keys(listing.devices).filter(id=>id.includes('.iOS-')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
let selected;
for(const runtime of runtimes){selected=listing.devices[runtime].find(device=>device.isAvailable&&device.name.startsWith('iPhone'));if(selected)break;}
if(!selected)throw Error('No available iOS phone simulator runtime is installed on this runner');
if(selected.state!=='Booted')await exec('xcrun',['simctl','boot',selected.udid]);
await exec('xcrun',['simctl','bootstatus',selected.udid,'-b'],{timeout:180000});
await appendFile(process.env.GITHUB_ENV,`IOS_SIMULATOR_UDID=${selected.udid}\nEXPO_PUBLIC_LAYOUT_TARGET_ID=${selected.udid}\n`);
console.log(`IOS_TARGET ${selected.udid}`);
