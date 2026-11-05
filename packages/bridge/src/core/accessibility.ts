import type {AccessibilityFinding,SpatialSnapshot} from '@nativemason/contracts';

/** WCAG relative luminance for previously validated opaque sRGB channels. */
export function solidContrastRatio(foreground:readonly number[],background:readonly number[]):number {
  const luminance=(rgb:readonly number[])=>rgb.map(value=>{const x=value/255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
  const first=luminance(foreground),second=luminance(background);
  return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05);
}

/** Bounded evidence checks; never infers native assistive-technology behavior. */
export function inspectAccessibility(snapshot:SpatialSnapshot):AccessibilityFinding[] {
  const findings:AccessibilityFinding[]=[];
  const add=(code:AccessibilityFinding['code'],status:AccessibilityFinding['status'],ids:string[],message:string)=>findings.push({code,status,elementIds:ids,message,platform:snapshot.platform});
  if(snapshot.status!=='stable')return [{code:'RTL_EVIDENCE',status:'unavailable',elementIds:[],message:'Accessibility checks require a settled capture',platform:snapshot.platform}];
  const byId=new Map(snapshot.nodes.map(node=>[node.id,node]));
  const inactive=(node:SpatialSnapshot['nodes'][number])=>{for(let parent=node.parentId;parent;parent=byId.get(parent)?.parentId??null)if(byId.get(parent)?.accessibility?.disabled)return true;return node.accessibility?.disabled===true;};
  for(const node of snapshot.nodes){
    const evidence=node.accessibility;
    if(snapshot.platform!=='web'&&evidence?.directionSource==='native-global')add('RTL_EVIDENCE','unavailable',[node.id],'I18nManager provides only a global direction; this node’s resolved Yoga direction was not measured');
    if(evidence?.hidden||evidence?.accessible===false){
      if(snapshot.platform==='web'&&typeof evidence.browser?.focusOrder==='number')add('FOCUS_ORDER','advisory',[node.id],'Estimated DOM sequential focus position: '+evidence.browser.focusOrder+'. This control is hidden from the accessibility tree, and the estimate is not verified assistive-technology order.');
      continue;
    }
    const interactive=node.kind==='Pressable'||node.kind==='TextInput'||['button','link','checkbox','switch','radio'].includes(node.role??'')||evidence?.focusable===true;
    if(interactive){
      if(snapshot.platform==='web'&&evidence?.browser?.name!==null&&evidence?.browser?.name!==undefined)add('ACCESSIBLE_NAME',evidence.browser.name.trim()?'pass':'fail',[node.id],evidence.browser.name.trim()?'Chromium computed a nonempty accessible name':'Chromium computed an empty accessible name');
      else if(evidence?.authoredLabel!==undefined)add('ACCESSIBLE_NAME',evidence.authoredLabel.trim()?'advisory':'fail',[node.id],evidence.authoredLabel.trim()?'An explicit label is authored; native spoken output has not been measured':'The explicit accessible label is empty');
      else add('ACCESSIBLE_NAME','unavailable',[node.id],'A derived accessible name was not measured; a missing explicit label alone does not prove an unlabeled control');
      const order=evidence?.browser?.focusOrder;
      add('FOCUS_ORDER',order===null||order===undefined?'unavailable':'advisory',[node.id],typeof order==='number'?'Estimated DOM sequential focus position: '+order+'. This is not verified assistive-technology order.':'Sequential focus order is unavailable for this control');
    }
    if(node.kind==='Text'||node.kind==='TextInput'){
      const contrast=evidence?.browser?.contrast;
      if(inactive(node))add('TEXT_CONTRAST','unavailable',[node.id],'Text belongs to an inactive control and is exempt from ordinary WCAG text contrast evaluation');
      else if(contrast?.status==='measured'&&contrast.ratio!==undefined&&contrast.requiredRatio!==undefined)add('TEXT_CONTRAST',contrast.ratio>=contrast.requiredRatio?'pass':'fail',[node.id],'Computed opaque-style contrast '+contrast.ratio.toFixed(2)+'; required '+contrast.requiredRatio);
      else add('TEXT_CONTRAST','unavailable',[node.id],contrast?.reason??'Native foreground/background pixel contrast has not been measured');
    }
    if(evidence?.direction==='rtl'){
      const physical=['marginLeft','marginRight','paddingLeft','paddingRight','left','right'].filter(property=>node.styles[property]!==undefined);
      if(physical.length)add('RTL_PHYSICAL_SPACING','advisory',[node.id],(evidence.directionSource==='native-global'?'I18nManager reports global RTL; this node’s direction is unmeasured. ':'RTL layout uses ')+ 'physical properties '+physical.join(', ')+'. Confirm that physical, rather than logical, edges are intended.');
    }
  }
  if(!snapshot.nodes.some(node=>node.accessibility?.direction&&node.accessibility.direction!=='unknown'))add('RTL_EVIDENCE','unavailable',[],'Layout direction was not measured');
  return findings;
}
