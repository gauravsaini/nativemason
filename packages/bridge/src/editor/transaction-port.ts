import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { BridgeFault,TransactionPlanSchema,TransactionReceiptSchema,type TransactionPlan,type TransactionReceipt,type TransactionSourcePort } from '@nativemason/contracts';
import {createSourcePort} from './source-port.js';
import {hashSource} from './planner.js';

interface JournalFile {path:string;before:string;after:string;mode:number;temporary:string}
interface Journal {id:string;state:'prepared'|'committed';files:JournalFile[];receipt:TransactionReceipt}
const ignore=new Set(['node_modules','.git','.nativemason','artifacts','dist','build','.expo','android','ios']);

/** Recoverable multi-file replacement. Journals persist until apply or rollback completes. */
export function createTransactionSourcePort(projectRoot:string):TransactionSourcePort {
  const base=createSourcePort(projectRoot);
  const rootPromise=realpath(projectRoot);
  let queue:Promise<unknown>=Promise.resolve();
  async function control(){const root=await rootPromise;const dir=path.join(root,'.nativemason');await mkdir(dir,{recursive:true,mode:0o700});if((await realpath(dir))!==dir)throw new BridgeFault('SOURCE_OUTSIDE_PROJECT','Transaction storage must not be a symlink');return dir;}
  async function source(relative:string){
    await base.read(relative);const root=await rootPromise;const file=path.resolve(root,relative);
    if((await realpath(file))!==file)throw new BridgeFault('UNSUPPORTED_EDIT','Transactions do not replace symlink sources');
    return file;
  }
  async function persist(file:string,value:unknown){const temporary=file+'.'+randomUUID()+'.tmp';const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}await rename(temporary,file);}
  async function remove(file:string){await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  async function syncDirectory(dir:string){const handle=await open(dir,'r');try{await handle.sync();}finally{await handle.close();}}
  async function recoverUnlocked(dir:string){
    for(const filename of await readdir(dir)){
      if(!filename.endsWith('.journal.json'))continue;
      const journalPath=path.join(dir,filename);const journal=JSON.parse(await readFile(journalPath,'utf8')) as Journal;
      if(journal.state==='committed'){
        await persist(path.join(dir,journal.id+'.receipt.json'),{receipt:journal.receipt,files:journal.files});
        await syncDirectory(dir);await remove(journalPath);await syncDirectory(dir);continue;
      }
      for(const item of [...journal.files].reverse()){
        const file=await source(item.path),current=await readFile(file,'utf8');
        if(path.dirname(item.temporary)!==path.dirname(file)||!path.basename(item.temporary).startsWith(path.basename(file)+'.')||!item.temporary.endsWith('.stage'))throw new BridgeFault('INVALID_INPUT','Invalid recovery staging path');
        if(hashSource(current)===hashSource(item.before)){await remove(item.temporary);continue;}
        if(hashSource(current)!==hashSource(item.after))throw new BridgeFault('STALE_SOURCE','Transaction recovery conflicts with external edits',{transactionId:journal.id,path:item.path});
        const temp=file+'.'+randomUUID()+'.rollback';const rollback=await open(temp,'wx',item.mode);try{await rollback.writeFile(item.before);await rollback.chmod(item.mode);await rollback.sync();}finally{await rollback.close();}await rename(temp,file);await syncDirectory(path.dirname(file));await remove(item.temporary);
      }
      await remove(journalPath);
    }
  }
  async function locked<T>(operation:(dir:string)=>Promise<T>):Promise<T>{
    const work=async()=>{
      const dir=await control(),lock=path.join(dir,'transaction.lock');
      try{const handle=await open(lock,'wx',0o600);try{await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.sync();}finally{await handle.close();}}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        let owner: {pid:number};try{owner=JSON.parse(await readFile(lock,'utf8'));}catch{throw new BridgeFault('INTERNAL_ERROR','Transaction lock is unreadable; recovery requires checking the owning process');}
        try{process.kill(owner.pid,0);throw new BridgeFault('INVALID_INPUT','Another source transaction is active');}catch(cause){if(cause instanceof BridgeFault)throw cause;if((cause as NodeJS.ErrnoException).code!=='ESRCH')throw cause;}
        await remove(lock);return work();
      }
      try{await recoverUnlocked(dir);return await operation(dir);}finally{await remove(lock);}
    };
    const result=queue.then(work,work);queue=result.catch(()=>undefined);return result;
  }
  async function applyUnlocked(plan:TransactionPlan,dir:string,revertsCommitId?:string):Promise<TransactionReceipt>{
    const parsed=TransactionPlanSchema.safeParse(plan);if(!parsed.success)throw new BridgeFault('INVALID_INPUT','Invalid transaction plan');
    const paths=plan.files.map(f=>f.source.path);if(new Set(paths).size!==paths.length)throw new BridgeFault('INVALID_INPUT','A transaction must coalesce each source file');
    const id=hashSource(JSON.stringify([plan.intentId??null,plan.files.map(f=>[f.source.path,f.expectedHash,hashSource(f.updatedText)])]));
    const receiptPath=path.join(dir,id+'.receipt.json');
    try{const prior=JSON.parse(await readFile(receiptPath,'utf8')) as {receipt:TransactionReceipt};for(const file of prior.receipt.files)if((await base.read(file.path)).hash!==file.newHash)throw new BridgeFault('STALE_SOURCE','Previously committed transaction source changed');return TransactionReceiptSchema.parse(prior.receipt);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const files:JournalFile[]=[];
    for(const planFile of plan.files){
      if(planFile.source.hash!==planFile.expectedHash)throw new BridgeFault('INVALID_INPUT','Source and expected hashes disagree');
      const file=await source(planFile.source.path),before=await readFile(file,'utf8');
      if(hashSource(before)!==planFile.expectedHash)throw new BridgeFault('STALE_SOURCE','Source changed before transaction',{path:planFile.source.path});
      files.push({path:planFile.source.path,before,after:planFile.updatedText,mode:(await lstat(file)).mode&0o777,temporary:file+'.'+randomUUID()+'.stage'});
    }
    const receipt:TransactionReceipt={commitId:id,files:plan.files.map(f=>({path:f.source.path,oldHash:f.expectedHash,newHash:hashSource(f.updatedText),diff:f.diff})),nativeStatus:'pending',...(revertsCommitId?{revertsCommitId}:{})};
    const journal:Journal={id,state:'prepared',files,receipt},journalPath=path.join(dir,id+'.journal.json');
    await persist(journalPath,journal);await syncDirectory(dir);
    try{
      for(const item of files){const handle=await open(item.temporary,'wx',item.mode);try{await handle.writeFile(item.after);await handle.chmod(item.mode);await handle.sync();}finally{await handle.close();}}
      // Preflight the complete set again before the first replacement.
      for(const item of files)if((await base.read(item.path)).hash!==hashSource(item.before))throw new BridgeFault('STALE_SOURCE','Source changed while staging',{path:item.path});
      for(const item of files){const file=await source(item.path);if(hashSource(await readFile(file,'utf8'))!==hashSource(item.before))throw new BridgeFault('STALE_SOURCE','Source changed during transaction',{path:item.path});await rename(item.temporary,file);await syncDirectory(path.dirname(file));}
      journal.state='committed';await persist(journalPath,journal);await syncDirectory(dir);
      await persist(receiptPath,{receipt,files});await syncDirectory(dir);await remove(journalPath);await syncDirectory(dir);return receipt;
    }catch(error){await recoverUnlocked(dir);throw error;}
  }
  return {...base,
    read:async relative=>{await locked(async()=>{});return base.read(relative);},
    apply:async plan=>{const receipt=await locked(dir=>applyUnlocked({files:[plan],blastRadius:{consumers:[],unresolvedReferences:[]}},dir));const file=receipt.files[0];return {commitId:receipt.commitId,...file,nativeStatus:receipt.nativeStatus,files:receipt.files};},
    readProject:async()=>{
      await locked(async()=>{});
      const root=await rootPromise;const files:Awaited<ReturnType<TransactionSourcePort['readProject']>>=[];
      const visit=async(dir:string)=>{for(const entry of await readdir(dir,{withFileTypes:true})){if(ignore.has(entry.name)||entry.isSymbolicLink())continue;const absolute=path.join(dir,entry.name);if(entry.isDirectory())await visit(absolute);else if(/\.[cm]?[jt]sx?$/.test(entry.name)){const relative=path.relative(root,absolute).split(path.sep).join('/');files.push(await base.read(relative));}}};
      await visit(root);return files;
    },
    applyTransaction:plan=>locked(dir=>applyUnlocked(plan,dir)),
    recover:()=>locked(async()=>{}),
    revert:commitId=>locked(async dir=>{
      if(!/^[a-f0-9]{64}$/.test(commitId))throw new BridgeFault('INVALID_INPUT','Invalid transaction commit ID');
      const stored=JSON.parse(await readFile(path.join(dir,commitId+'.receipt.json'),'utf8')) as {receipt:TransactionReceipt;files:JournalFile[]};
      const files=stored.files.map(item=>{const current=stored.receipt.files.find(f=>f.path===item.path)!;return {source:{path:item.path,hash:current.newHash,start:0,end:1,line:1,column:0},expectedHash:current.newHash,updatedText:item.before,diff:createTwoFilesPatch(item.path,item.path,item.after,item.before)};});
      return applyUnlocked({files,blastRadius:{consumers:[],unresolvedReferences:[]}},dir,commitId);
    }),
  };
}
