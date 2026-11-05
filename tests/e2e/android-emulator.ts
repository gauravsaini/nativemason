import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {runNativeAcceptance} from './native-workflow.js';
const exec=promisify(execFile);
async function main(){
  const serial=process.env.ADB_SERIAL;if(!serial?.startsWith('emulator-'))throw Error('Set ADB_SERIAL to an explicitly selected, running Android emulator');
  const adb=async(args:string[])=>exec('adb',['-s',serial,...args],{timeout:30000,maxBuffer:4*1024*1024});
  if((await adb(['shell','getprop','ro.kernel.qemu'])).stdout.trim()!=='1')throw Error('Selected Android target is not an emulator');
  await adb(['reverse','tcp:8081','tcp:8081']);await adb(['reverse','tcp:19482','tcp:19482']);
  const application=process.env.NM_ANDROID_PACKAGE??'dev.rnlayout.fixture';
  try{
    await runNativeAcceptance({appId:application,target:{targetId:serial,platform:'android',kind:'emulator'},launch:async()=>{await adb(['shell','am','force-stop',application]);await adb(['shell','monkey','-p',application,'-c','android.intent.category.LAUNCHER','1']);}});
  }catch(error){
    const directory='artifacts/android-emulator-acceptance';await mkdir(directory,{recursive:true});
    const commands=[['logcat','-d','-t','2000'],['shell','pidof',application],['shell','settings','get','system','font_scale']];
    const diagnostics=await Promise.allSettled(commands.map(args=>adb(args)));
    await writeFile(directory+'/failure-device-state.json',JSON.stringify(diagnostics.map((result,index)=>({command:commands[index],...(result.status==='fulfilled'?{stdout:result.value.stdout,stderr:result.value.stderr}:{error:String(result.reason)})})),null,2)).catch(()=>undefined);
    throw error;
  }
}
main().catch(error=>{console.error('ANDROID_EMULATOR_ACCEPTANCE_INCOMPLETE',error instanceof Error?error.message:String(error));process.exitCode=1;});
