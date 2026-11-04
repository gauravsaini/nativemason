import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { BridgeApplication } from '../../packages/bridge/src/application/index.js';
import {createNativeProfilePort} from '../../packages/bridge/src/scenario/index.js';
import {evaluateConstraints} from '../../packages/bridge/src/core/index.js';
import { createNativeBridge } from '../../packages/bridge/src/native/index.js';
import { WireframeSpecSchema, type NativePort,type NativeTarget, type SpatialSnapshot, type ToolOutput } from '@nativemason/contracts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Uses actual runtime measurements. Missing hardware, stale builds, and failed constraints fail the command. */
export async function runNativeAcceptance(options:{target:NativeTarget;appId?:string;launch():Promise<void>;nativePort?:number;webUrl?:string}):Promise<void>{
  const {target}=options,projectRoot=path.join(root,'examples/expo-fixture'),sourcePath=path.join(projectRoot,'App.tsx');
  const nativePort=options.nativePort??19482,token=process.env.EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN;
  if(!token||token.length<16)throw Error('Set EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN to the same pairing token used by Metro (at least 16 characters)');
  const artifactRoot=path.join(root,'artifacts',target.platform+'-'+target.kind+'-acceptance');await mkdir(artifactRoot,{recursive:true});
  const original=await readFile(sourcePath,'utf8');
  const calibration=await createNativeBridge({port:nativePort,token,scenarioId:'broken-footer',sessionId:'calibration-'+target.targetId,platform:target.platform,targetId:target.targetId,timeoutMs:15000});
  let calibrated:SpatialSnapshot|undefined;
  try{
    await options.launch();let error:unknown;
    for(let i=0;i<8;i++){try{calibrated=await calibration.capture({});break;}catch(cause){error=cause;await pause(1000);}}
    if(!calibrated)throw error??Error('Native calibration unavailable');
    assert.equal(calibrated.platform,target.platform);assert.equal(calibrated.nativeTarget?.targetId,target.targetId);
    await writeFile(path.join(artifactRoot,'calibration.json'),JSON.stringify(calibrated,null,2));
  }finally{await calibration.close();}
  let liveNative:NativePort|undefined;
  const app=new BridgeApplication({artifactsRoot:artifactRoot,native:async options=>{const port=await createNativeBridge(options);liveNative=port;return port;}});
  try{
    const {sessionId}=await app.execute('open_session',{projectRoot,webUrl:options.webUrl??'http://127.0.0.1:8081/?scenario=broken-footer',scenarioId:'broken-footer',profile:calibrated.profile,nativePort,nativeToken:token,nativeTarget:target});
    const sourceSpec=JSON.parse(await readFile(path.join(root,'packages/contracts/fixtures/footer.json'),'utf8'));
    const textRule={id:'description-fits',type:'textFits' as const,elementId:'description',tolerance:2};
    const spec=WireframeSpecSchema.parse({...sourceSpec,profile:calibrated.profile,constraints:[...sourceSpec.constraints,textRule]});
    await app.execute('load_wireframe_spec',{sessionId,spec});
    const inspected=await app.execute('inspect_ui_spatial_graph',{sessionId});assert.ok(inspected.results.some(result=>result.status==='fail'),'Broken fixture must fail');assert.equal(inspected.results.find(result=>result.constraintId===textRule.id)?.status,'unavailable','Web must defer native-only text-fit evidence');
    await app.execute('capture_annotated_overlay',{sessionId,snapshotId:inspected.snapshot.snapshotId});
    const suggestions=await app.execute('suggest_fix',{sessionId,baselineSnapshotId:inspected.snapshot.snapshotId,includeNativeEvidence:true});assert.equal(suggestions.nativeBaseline?.status,'captured');
    const trial=await app.execute('simulate_layout_mutation',{sessionId,baselineSnapshotId:inspected.snapshot.snapshotId,mutations:[{elementId:'footer',patch:{flexDirection:'row'}},{elementId:'cancel',patch:{width:Math.max(0,Math.min(176,(calibrated.profile.root.width-44)/2))}},{elementId:'submit',patch:{width:Math.max(0,Math.min(176,(calibrated.profile.root.width-44)/2)),minHeight:48}}]});
    assert.ok('trialId'in trial);assert.ok(trial.results.length&&trial.results.every(result=>result.status==='pass'||result.constraintId===textRule.id&&result.status==='unavailable'),'Every web constraint other than native-only text fit must pass');
    const expectedRevisions=trial.snapshot.revisions;
    const preview=await app.execute('commit_rn_ast_patch',{sessionId,trialId:trial.trialId,expectedRevisions,allowNativePending:true,mode:'preview'});
    assert.ok(preview.transactionPlan?.files.length);assert.match(preview.plan?.diff??'',/row/);
    assert.equal(await readFile(sourcePath,'utf8'),original,'Preview must not write source');
    const applied=await app.execute('commit_rn_ast_patch',{sessionId,trialId:trial.trialId,expectedRevisions,allowNativePending:true,mode:'apply'});
    assert.ok(applied.receipt);assert.equal(applied.webStatus,'native-checks-pending',JSON.stringify(applied));assert.deepEqual(applied.pendingNativeConstraints,[textRule.id]);assert.equal(applied.receipt.nativeStatus,'pending');
    const verify=async(commitId:string):Promise<ToolOutput<'verify_native_layout'>>=>{
      let last:unknown;for(let i=0;i<15;i++){try{return await app.execute('verify_native_layout',{sessionId,commitId});}catch(error){last=error;await pause(1000);}}throw last??Error('Native verification did not complete');
    };
    const verified=await verify(applied.receipt.commitId);assert.equal(verified.passed,true,JSON.stringify(verified.results));assert.equal(verified.snapshot.platform,target.platform);assert.equal(verified.receipt.nativeStatus,'passed');
    await writeFile(path.join(artifactRoot,'acceptance.json'),JSON.stringify({target,preview,applied,verified},null,2));
    const textResults=evaluateConstraints(verified.snapshot,spec);
    assert.ok(textResults.every(result=>result.status==='pass'),'Settled native text probe must establish fit: '+JSON.stringify(textResults));
    const profiles=createNativeProfilePort({target,appId:options.appId??(target.platform==='ios'?'dev.nativemason.fixture':'dev.rnlayout.fixture'),projectRoot,readProfile:async()=>(await liveNative!.capture(verified.snapshot.revisions)).profile});
    const requestedScale=target.platform==='android'?1.3:1.353;
    const scaled=await profiles.withProfile({fontScale:requestedScale},async()=>{
      const snapshot=await liveNative!.capture(verified.snapshot.revisions);
      const results=evaluateConstraints(snapshot,{...spec,profile:snapshot.profile});
      assert.ok(results.every(result=>result.status==='pass'),'Native font-scale constraints must pass: '+JSON.stringify(results));
      return {snapshot,results};
    });
    const restored=await liveNative!.capture(verified.snapshot.revisions);
    assert.ok(Math.abs(restored.profile.fontScale-verified.snapshot.profile.fontScale)<0.01,'Original font scale must be restored');
    await writeFile(path.join(artifactRoot,'font-scale.json'),JSON.stringify({requestedScale,scaled,restored},null,2));

    const reverted=await app.execute('revert_commit',{sessionId,commitId:applied.receipt.commitId});assert.equal(reverted.receipt.nativeStatus,'pending');assert.equal(await readFile(sourcePath,'utf8'),original,'Revert must restore original source');
    const revertEvidence=await verify(reverted.receipt.commitId);assert.equal(revertEvidence.passed,false,'Reverting the deliberate fix must expose the original regression');assert.ok(revertEvidence.results.some(result=>result.status==='fail'));assert.equal(revertEvidence.results.find(result=>result.constraintId===textRule.id)?.status,'pass','Reverted text-fit constraint still requires and records native proof');
    await writeFile(path.join(artifactRoot,'revert.json'),JSON.stringify({reverted,verification:revertEvidence},null,2));
    console.log(target.platform.toUpperCase()+'_'+target.kind.toUpperCase()+'_ACCEPTANCE_PASSED');
  }finally{await app.close();if(await readFile(sourcePath,'utf8')!==original)await writeFile(sourcePath,original);}
}
