import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,unlink,rmdir,mkdir,open} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BridgeFault,ScenarioScriptSchema,type NativeScenarioOptions,type NativeProfilePort,type ScenarioPort,type ScenarioScript} from '@nativemason/contracts';

const execute=promisify(execFile);
const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;
const regex=(value:string)=>`^${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`;
function safeString(value:string):string {
  if(value.includes('${')||value.includes('\0'))throw new BridgeFault('UNSUPPORTED_ACTION','Maestro interpolation and NUL characters are not accepted in scenario values');
  return value;
}
function validateOptions(options:NativeScenarioOptions):void {
  if(!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(options.appId))throw new BridgeFault('INVALID_INPUT','An explicit native application identifier is required');
  if(!options.target.targetId||/[\0\r\n]/.test(options.target.targetId))throw new BridgeFault('INVALID_INPUT','A native device identifier is required');
  if(options.ssh&&!/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/.test(options.ssh.destination))throw new BridgeFault('INVALID_INPUT','SSH destination must be user@host');
}
function sshArgs(options:NativeScenarioOptions):string[]{return [...(options.ssh?.identityFile?['-i',options.ssh.identityFile]:[]),'-o','BatchMode=yes','-o','ConnectTimeout=10',options.ssh!.destination];}
async function command(options:NativeScenarioOptions,executable:string,args:string[]):Promise<string>{
  const result=options.ssh?await execute('ssh',[...sshArgs(options),[executable,...args].map(quote).join(' ')],{timeout:options.timeoutMs??30000,maxBuffer:4*1024*1024}):await execute(executable,args,{timeout:options.timeoutMs??30000,maxBuffer:4*1024*1024});
  return result.stdout.trim();
}
async function maestro(options:NativeScenarioOptions,commands:unknown[]):Promise<void>{
  const flow=`appId: ${JSON.stringify(options.appId)}\n---\n${JSON.stringify(commands,null,2)}\n`;
  const directory=await mkdtemp(path.join(tmpdir(),'nativemason-maestro-'));
  const file=path.join(directory,'flow.yaml');
  try {
    await writeFile(file,flow,{mode:0o600});
    if(options.ssh){
      // SSH stdin carries the generated flow; only validated, quoted command arguments enter its shell.
      const program=`set -e; nm_flow_dir=$(mktemp -d); trap 'rm "$nm_flow_dir/flow.yaml"; rmdir "$nm_flow_dir"' EXIT; cat > "$nm_flow_dir/flow.yaml"; ${[options.maestroPath??'maestro','--device',options.adbSerial??options.target.targetId,'test'].map(quote).join(' ')} "$nm_flow_dir/flow.yaml"`;
      await new Promise<void>((resolve,reject)=>{const child=execFile('ssh',[...sshArgs(options),program],{timeout:options.timeoutMs??120000,maxBuffer:4*1024*1024},error=>error?reject(error):resolve());child.stdin?.end(flow);});
    }else await command({...options,timeoutMs:options.timeoutMs??120000},options.maestroPath??'maestro',['--device',options.adbSerial??options.target.targetId,'test',file]);
  } catch(error){throw new BridgeFault('VERIFICATION_FAILED',`Native scenario command failed: ${error instanceof Error?error.message:String(error)}`);}
  finally{await unlink(file).catch(()=>undefined);await rmdir(directory).catch(()=>undefined);}
}

/** Native UI actions run against the explicitly selected application and device. */
export function createNativeScenarioPort(options:NativeScenarioOptions):ScenarioPort {
  validateOptions(options);
  let closed=false;
  return {
    async run(script:ScenarioScript){
      if(closed)throw new BridgeFault('SESSION_NOT_FOUND','Native scenario driver is closed');
      const parsed=ScenarioScriptSchema.parse(script);
      // Reject unsupported static actions before executing earlier hooks or UI actions.
      for(const action of [...parsed.reset,...parsed.actions]){
        if(action.type==='hook'&&!options.runHook)throw new BridgeFault('UNSUPPORTED_ACTION','Native application hooks require an explicitly registered runtime hook transport');
        if(action.type==='scroll')throw new BridgeFault('UNSUPPORTED_ACTION','Native exact scroll offsets are unavailable; use the explicit swipe action');
        if(action.type==='keyboard'&&action.visible)throw new BridgeFault('UNSUPPORTED_ACTION','Show the native keyboard by tapping an input; visibility must be measured by the application');
        if('elementId' in action)safeString(action.elementId);
        if(action.type==='navigate')safeString(action.url);
        if(action.type==='input'){safeString(action.text);if(options.target.platform==='android'&&[...action.text].some(character=>character.codePointAt(0)!>127))throw new BridgeFault('UNSUPPORTED_ACTION','Maestro inputText does not support Unicode on Android');}
      }
      const commands:unknown[]=[];
      const flush=async()=>{if(commands.length){await maestro(options,commands);commands.length=0;}};
      for(const action of [...parsed.reset,...parsed.actions]){
        if(action.type==='navigate'){commands.push({openLink:safeString(action.url)});continue;}
        if(action.type==='hook'){if(!options.runHook)throw new BridgeFault('UNSUPPORTED_ACTION','Native application hooks require an explicitly registered runtime hook transport');await flush();await options.runHook(action.name,action.value);continue;}
        if(action.type==='keyboard'){
          if(action.visible)throw new BridgeFault('UNSUPPORTED_ACTION','Show the native keyboard by tapping an input; visibility must be measured by the application');
          commands.push('hideKeyboard');continue;
        }
        if(action.type==='scroll')throw new BridgeFault('UNSUPPORTED_ACTION','Native exact scroll offsets are unavailable; use the explicit swipe action');
        const selector={id:regex(safeString(action.elementId))};
        if(action.type==='tap')commands.push({tapOn:selector});
        if(action.type==='swipe')commands.push({swipe:{from:selector,direction:action.direction}});
        if(action.type==='wait')commands.push({extendedWaitUntil:{visible:selector,timeout:action.timeoutMs}});
        if(action.type==='input'){
          safeString(action.text);commands.push({tapOn:selector});
          if(action.mode==='replace')commands.push({copyTextFrom:selector},{assertTrue:'${maestro.copiedText.length <= 100}'},{eraseText:100},{assertVisible:{...selector,text:'^$'}});
          commands.push({inputText:action.text});
          if(action.mode==='replace')commands.push({assertVisible:{...selector,text:regex(action.text)}});
        }
      }
      await flush();
    },
    async close(){closed=true;},
  };
}

const profileOperations=new Set<string>();
type SavedSettings={pid:number;platform:'android'|'ios';fontScale?:string;rotation?:string;accelerometer?:string;contentSize?:string;orientation?:'portrait'|'landscape'};
const iosSizes:Record<string,string>={'1':'large','0.823':'extra-small','0.882':'small','0.941':'medium','1.118':'extra-large','1.235':'extra-extra-large','1.353':'extra-extra-extra-large','1.786':'accessibility-medium','2.143':'accessibility-large','2.643':'accessibility-extra-large','3.143':'accessibility-extra-extra-large','3.571':'accessibility-extra-extra-extra-large'};

/** Journals device-wide settings before mutation and restores them even when the callback fails. */
export function createNativeProfilePort(options:NativeScenarioOptions):NativeProfilePort {
  validateOptions(options);
  const directory=path.join(homedir(),'.cache','nativemason','native-settings');
  const journal=path.join(directory,createHash('sha256').update(`${options.ssh?.destination??'local'}:${options.target.platform}:${options.adbSerial??options.target.targetId}`).digest('hex')+'.json');
  let active=false;
  const adb=(args:string[])=>command(options,'adb',['-s',options.adbSerial??options.target.targetId,...args]);
  const settings=(operation:string,key:string,value?:string)=>adb(['shell','settings',operation,'system',key,...(value===undefined?[]:[value])]);
  async function restore(saved:SavedSettings){
    if(saved.platform==='android'){
      for(const [key,value]of [['font_scale',saved.fontScale],['user_rotation',saved.rotation],['accelerometer_rotation',saved.accelerometer]] as const)if(value!==undefined){await settings(value==='null'?'delete':'put',key,value==='null'?undefined:value);if(await settings('get',key)!==value)throw new BridgeFault('RECOVERY_CONFLICT',`Android did not restore ${key}`);}
    }else {
      if(saved.contentSize)await command(options,'xcrun',['simctl','ui',options.target.targetId,'content_size',saved.contentSize]);
      if(saved.orientation)await maestro(options,[{setOrientation:saved.orientation==='portrait'?'PORTRAIT':'LANDSCAPE_LEFT'}]);
    }
    await unlink(journal);
  }
  async function recover(owned=false){
    if(profileOperations.has(journal)&&!owned)throw new BridgeFault('RECOVERY_CONFLICT','Native profile operation is still active');
    let saved:SavedSettings;
    try{saved=JSON.parse(await readFile(journal,'utf8')) as SavedSettings;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw new BridgeFault('RECOVERY_CONFLICT','Native settings journal is unreadable');}
    if(saved.platform!==options.target.platform||!Number.isInteger(saved.pid)||saved.pid<=0||[saved.fontScale,saved.rotation,saved.accelerometer].some(value=>value!==undefined&&value!=='null'&&!/^\d+(?:\.\d+)?$/.test(value))||(saved.contentSize!==undefined&&!Object.values(iosSizes).includes(saved.contentSize))||(saved.orientation!==undefined&&!['portrait','landscape'].includes(saved.orientation)))throw new BridgeFault('RECOVERY_CONFLICT','Native settings journal is invalid');
    let alive=false;
    try{process.kill(saved.pid,0);alive=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')alive=true;}
    if(saved.pid===process.pid&&(owned||!profileOperations.has(journal)))alive=false;
    if(alive)throw new BridgeFault('RECOVERY_CONFLICT','Another process owns pending native settings; close it before recovery');
    await restore(saved);
  }
  return {
    recover:()=>recover(),
    async withProfile(profile,work){
      if(active||profileOperations.has(journal))throw new BridgeFault('RECOVERY_CONFLICT','Native profile operations must be serialized');
      active=true;profileOperations.add(journal);
      let saved:SavedSettings|undefined;
      let journalOwned=false;
      try{
        await recover(true);
        if(options.target.platform==='ios'&&options.target.kind!=='simulator')throw new BridgeFault('UNSUPPORTED_PROFILE','iOS profile overrides require a simulator');
        if(options.target.platform==='ios'&&profile.orientation!==undefined&&!options.readProfile)throw new BridgeFault('UNSUPPORTED_PROFILE','iOS orientation changes require measured orientation capability');
        const category=profile.fontScale===undefined?undefined:iosSizes[String(profile.fontScale)];
        if(options.target.platform==='ios'&&profile.fontScale!==undefined&&!category)throw new BridgeFault('UNSUPPORTED_PROFILE','The requested iOS scale has no supported Dynamic Type category');
        saved=options.target.platform==='android'?{pid:process.pid,platform:'android',fontScale:await settings('get','font_scale'),rotation:await settings('get','user_rotation'),accelerometer:await settings('get','accelerometer_rotation')}:{pid:process.pid,platform:'ios',contentSize:await command(options,'xcrun',['simctl','ui',options.target.targetId,'content_size']),...(profile.orientation!==undefined?{orientation:(await options.readProfile!()).orientation}:{})};
        await mkdir(directory,{recursive:true});
        const handle=await open(journal,'wx',0o600);
        journalOwned=true;
        try{await handle.writeFile(JSON.stringify(saved));await handle.sync();}finally{await handle.close();}
        if(options.target.platform==='android'){
          if(profile.fontScale!==undefined){await settings('put','font_scale',String(profile.fontScale));const actual=Number(await settings('get','font_scale'));if(Math.abs(actual-profile.fontScale)>0.001)throw new BridgeFault('UNSUPPORTED_PROFILE','Android did not accept the requested system font scale');}
          if(profile.orientation!==undefined){await settings('put','accelerometer_rotation','0');await settings('put','user_rotation',profile.orientation==='landscape'?'1':'0');}
        }else {
          if(category)await command(options,'xcrun',['simctl','ui',options.target.targetId,'content_size',category]);
          if(profile.orientation!==undefined)await maestro(options,[{setOrientation:profile.orientation==='portrait'?'PORTRAIT':'LANDSCAPE_LEFT'}]);
        }
        if(options.readProfile){
          const started=Date.now();
          while(true){const actual=await options.readProfile();if((profile.fontScale===undefined||Math.abs(actual.fontScale-profile.fontScale)<0.01)&&(profile.orientation===undefined||actual.orientation===profile.orientation))break;if(Date.now()-started>10000)throw new BridgeFault('UNSUPPORTED_PROFILE','Native runtime did not report the requested font scale and orientation');await new Promise(resolve=>setTimeout(resolve,100));}
        }
        return await work();
      }finally{
        try{if(saved&&journalOwned)await restore(saved);}finally{active=false;profileOperations.delete(journal);}
      }
    },
  };
}
