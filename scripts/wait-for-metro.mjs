import console from 'node:console';import {setTimeout as delay} from 'node:timers/promises';
const deadline=Date.now()+120_000;
let ready=false;
while(Date.now()<deadline){
  try{const response=await globalThis.fetch('http://127.0.0.1:8081/status',{signal:globalThis.AbortSignal.timeout(3000)});if(response.ok&&(await response.text()).includes('packager-status:running')){ready=true;break;}}catch{/* Metro is still starting. */}
  await delay(1000);
}
if(!ready)throw Error('Metro did not become ready within 120 seconds');
console.log('METRO_READY');
