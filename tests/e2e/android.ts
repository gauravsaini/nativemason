/** Physical Android acceptance; never launches an emulator on this host. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runNativeAcceptance} from './native-workflow.js';
const exec=promisify(execFile);
const destination=process.env.NM_ANDROID_SSH;
const serial=process.env.ADB_SERIAL;
const metroPort=Number(process.env.NM_ANDROID_METRO_PORT??8081);
if(!Number.isInteger(metroPort)||metroPort<1024||metroPort>65535)throw Error('Invalid Metro port');
const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;
async function adb(args:string[]){
 if(!serial)throw Error('Set ADB_SERIAL to the explicitly selected connected device');
 if(destination){
  if(!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(destination))throw Error('NM_ANDROID_SSH must be user@host');
  const sshArgs=['-o','BatchMode=yes','-o','ConnectTimeout=10'];
  if(process.env.NM_ANDROID_SSH_KEY)sshArgs.push('-i',process.env.NM_ANDROID_SSH_KEY);
  return (await exec('ssh',[...sshArgs,destination,['adb','-s',serial,...args].map(quote).join(' ')],{timeout:30000})).stdout;
 }
 return (await exec('adb',['-s',serial,...args],{timeout:30000})).stdout;
}
async function main(){
 if(!serial)throw Error('Set ADB_SERIAL');
 const appId=process.env.NM_ANDROID_PACKAGE??'host.exp.exponent';
 const url=process.env.NM_ANDROID_LAUNCH_URL??`exp://127.0.0.1:${metroPort}`;
 if((process.env.NM_ANDROID_PACKAGE===undefined)!==(process.env.NM_ANDROID_LAUNCH_URL===undefined))throw Error('Set NM_ANDROID_PACKAGE and NM_ANDROID_LAUNCH_URL together');
 if(!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(appId))throw Error('Invalid Android package ID');
 new URL(url);
 if(Number((await adb(['shell','getprop','ro.build.version.sdk'])).trim())<24)throw Error('Android API24+ required');
 const packages=await adb(['shell','pm','list','packages','--user','current',appId]);if(!packages.split(/\r?\n/).includes('package:'+appId))throw Error('Install a compatible Expo Go or fixture development build');
 await runNativeAcceptance({appId,target:{targetId:serial,platform:'android',kind:'physical'},webUrl:process.env.NM_ANDROID_WEB_URL??`http://127.0.0.1:${metroPort}/?scenario=broken-footer`,launch:async()=>{await adb(['reverse',`tcp:${metroPort}`,`tcp:${metroPort}`]);await adb(['reverse','tcp:19482','tcp:19482']);if(appId!=='host.exp.exponent')await adb(['shell','am','force-stop','--user','current',appId]);await adb(['shell','am','start','--user','current','-a','android.intent.action.VIEW','-d',url,appId]);}});
}
main().catch(error=>{console.error('ANDROID_ACCEPTANCE_INCOMPLETE',error);process.exitCode=1;});
