import type {CDPSession,Page} from 'playwright';
import {BridgeFault,BrowserAccessibilitySamplesSchema,type AccessibilityEvidence,type BrowserRuntime,type SpatialSnapshot} from '@nativemason/contracts';
import {solidContrastRatio} from '../core/accessibility.js';

/** Read-only, bounded browser evidence; native semantics are never inferred here. */
export async function captureAccessibilityEvidence(page:Page,cdp:CDPSession,snapshot:SpatialSnapshot):Promise<SpatialSnapshot>{
  const samples=BrowserAccessibilitySamplesSchema.parse(await page.evaluate(()=>{
    const runtime=(window as Window&{__RN_LAYOUT_BRIDGE__?:BrowserRuntime}).__RN_LAYOUT_BRIDGE__;
    const focusable=Array.from(document.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex],[contenteditable=true]')).filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&!node.closest('[inert],[hidden]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility==='visible');
    focusable.sort((a,b)=>(a.tabIndex>0?a.tabIndex:Infinity)-(b.tabIndex>0?b.tabIndex:Infinity));
    const rgba=(value:string):number[]|null=>{
      const match=/^rgba?\(([^)]+)\)$/.exec(value);if(!match||match[1].includes('%'))return null;
      const values=match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if(values.length!==3&&values.length!==4||values.some(value=>!Number.isFinite(value)))return null;
      return [...values.slice(0,3),values[3]??1];
    };
    return Object.fromEntries((runtime?.getDiagnosticTargets()??[]).map(({id,element})=>{
      if(!(element instanceof HTMLElement))return [id,{direction:'unknown',focusOrder:null,foreground:null,background:null,requiredRatio:4.5,contrastReason:'Registered host is not an HTML element'}];
      const style=getComputedStyle(element),textFill=style.getPropertyValue('-webkit-text-fill-color'),color=textFill?rgba(textFill):rgba(style.color);let background:number[]|null=null,reason:string|null=element.closest(':disabled,[aria-disabled="true"]')?'Text belongs to an inactive control; contrast exemption cannot be evaluated as ordinary text':null;
      for(let current:HTMLElement|null=element;current;current=current.parentElement){
        const computed=getComputedStyle(current);
        if(Number(computed.opacity)!==1||computed.filter!=='none'||computed.mixBlendMode!=='normal'||(computed.backdropFilter&&computed.backdropFilter!=='none')){reason??='Opacity, blending, or filters prevent a proven solid-color contrast';break;}
        if(!background){
          if(computed.backgroundImage!=='none'){reason??='An image or gradient background requires pixel evidence';break;}
          const value=rgba(computed.backgroundColor);
          if(!value){reason??='Unsupported background color space';break;}
          if(value[3]===1)background=value.slice(0,3);
          else if(value[3]!==0){reason??='Translucent backgrounds require compositing evidence';break;}
        }
      }
      if(textFill&&!color)reason??='Unsupported text fill color space';
      if(!color||color[3]!==1)reason??='An opaque sRGB foreground was not established';
      if(!background)reason??='No explicit opaque ancestor background was established';
      if(parseFloat(style.getPropertyValue('-webkit-text-stroke-width'))>0)reason??='Text stroke changes glyph contrast and requires pixel evidence';
      if(style.textShadow!=='none')reason??='Text shadow changes require pixel evidence';
      if(element instanceof HTMLInputElement&&element.value===''&&element.placeholder)reason??='Placeholder foreground evidence is unavailable';
      const index=focusable.indexOf(element),large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.6666667&&Number(style.fontWeight)>=700);
      return [id,{direction:style.direction==='rtl'?'rtl':'ltr',focusOrder:index<0?null:index,foreground:reason?null:color!.slice(0,3),background:reason?null:background,requiredRatio:large?3:4.5,contrastReason:reason}];
    }));
  }));
  const names=new Map<string,string|null>();
  await cdp.send('Accessibility.enable');
  const root=await cdp.send('Runtime.evaluate',{expression:'Object.fromEntries(window.__RN_LAYOUT_BRIDGE__.getDiagnosticTargets().map(target=>[target.id,target.element]))',objectGroup:'nativemason-accessibility'});
  if(!root.result.objectId)throw new BridgeFault('STALE_SNAPSHOT','Accessibility targets disappeared');
  try{
    const properties=await cdp.send('Runtime.getProperties',{objectId:root.result.objectId,ownProperties:true});
    for(const property of properties.result){
      names.set(property.name,null);
      if(!property.value?.objectId)continue;
      try{
        const described=await cdp.send('DOM.describeNode',{objectId:property.value.objectId});
        const tree=await cdp.send('Accessibility.getPartialAXTree',{backendNodeId:described.node.backendNodeId,fetchRelatives:false});
        const node=tree.nodes.find(node=>node.backendDOMNodeId===described.node.backendNodeId&&!node.ignored);
        names.set(property.name,typeof node?.name?.value==='string'?node.name.value:null);
      }catch{ /* Missing AX evidence is explicit; never replace it with an inferred label. */ }
    }
  }finally{await cdp.send('Runtime.releaseObjectGroup',{objectGroup:'nativemason-accessibility'}).catch(()=>undefined);}
  return {...snapshot,nodes:snapshot.nodes.map(node=>{
    const sample=samples[node.id];
    if(!sample)return node;
    const contrast:NonNullable<AccessibilityEvidence['browser']>['contrast']=sample.foreground&&sample.background?{status:'measured',ratio:solidContrastRatio(sample.foreground,sample.background),requiredRatio:sample.requiredRatio}:{status:'unavailable',reason:sample.contrastReason??'Solid-style contrast is unavailable'};
    return {...node,accessibility:{...node.accessibility,direction:sample.direction,directionSource:'browser-computed' as const,browser:{name:names.get(node.id)??null,focusOrder:sample.focusOrder,focusOrderSource:'dom-sequential-estimate' as const,contrast}}};
  })};
}
