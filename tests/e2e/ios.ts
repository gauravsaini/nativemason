import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runNativeAcceptance} from './native-workflow.js';
const exec=promisify(execFile);
async function main(){
  if(process.platform!=='darwin')throw Error('iOS acceptance requires macOS and full Xcode');
  const udid=process.env.IOS_SIMULATOR_UDID;if(!udid||!/^[a-f0-9-]{36}$/i.test(udid))throw Error('Set IOS_SIMULATOR_UDID to an explicitly selected, already booted simulator');
  const bundle=process.env.NM_IOS_BUNDLE_ID??'dev.nativemason.fixture';
  const listing=JSON.parse((await exec('xcrun',['simctl','list','devices','booted','--json'])).stdout) as {devices:Record<string,{udid:string;state:string}[]>};
  if(!Object.values(listing.devices).flat().some(device=>device.udid===udid&&device.state==='Booted'))throw Error('Selected iOS simulator is not booted');
  await runNativeAcceptance({target:{targetId:udid,platform:'ios',kind:'simulator'},launch:async()=>{await exec('xcrun',['simctl','launch','--terminate-running-process',udid,bundle],{timeout:30000});}});
}
main().catch(error=>{console.error('IOS_ACCEPTANCE_INCOMPLETE',error instanceof Error?error.message:String(error));process.exitCode=1;});
