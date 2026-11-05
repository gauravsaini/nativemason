import {BridgeFault,DesignIntentSchema,DesignIntentResultSchema,FigmaNodeSchema,type Constraint,type DesignIntent,type DesignIntentResult,type FigmaNode,type Rect} from '@nativemason/contracts';

const invalid=(message:string):never=>{throw new BridgeFault('INVALID_INPUT',message);};
const referenced=(rule:Constraint):string[]=>'elementId' in rule?[rule.elementId]:'elementIds' in rule?[...rule.elementIds]:[rule.first,rule.second];

/** Compiles explicit design data. No image interpretation or app-state acceptance occurs here. */
export function importDesignIntent(raw:DesignIntent):DesignIntentResult {
  const parsed=DesignIntentSchema.safeParse(raw);
  if(!parsed.success)invalid('Invalid design intent: '+parsed.error.message);
  const input=parsed.data!,constraints:Constraint[]=[],notes:string[]=[],required=new Set<string>();
  const {profile,tolerance}=input;
  if(profile.root.width<=0||profile.root.height<=0)invalid('Design import requires a nonempty target app root');
  const rectangle=(id:string,target:Rect)=>{
    if(required.has(id))invalid('Duplicate mapped element: '+id);
    required.add(id);constraints.push({id:'design:rect:'+encodeURIComponent(id),type:'rect',elementId:id,target,tolerance});
  };
  if(input.kind==='reference-annotations'){
    const crop=input.appRootPixels,scale=input.pixelsPerLogicalUnit;
    if(crop.x<0||crop.y<0||crop.x+crop.width>input.image.width||crop.y+crop.height>input.image.height)invalid('App-root crop must fit the reference image');
    if(Math.abs(crop.width-profile.root.width*scale)>1||Math.abs(crop.height-profile.root.height*scale)>1)invalid('Reference app-root crop and pixel scale disagree with the target profile');
    for(const annotation of input.annotations){
      const box=annotation.rectPixels;
      if(box.x<0||box.y<0||box.x+box.width>input.image.width||box.y+box.height>input.image.height)invalid('Annotated rectangle must fit the reference image');
      rectangle(annotation.elementId,{x:(box.x-crop.x)/scale,y:(box.y-crop.y)/scale,width:box.width/scale,height:box.height/scale});
    }
    constraints.push(...input.assertions);
    for(const rule of input.assertions)for(const id of referenced(rule))required.add(id);
    notes.push('Reference rectangles are agent-supplied annotations; the image hash records provenance, not semantic verification.');
  }else{
    const frame=input.frame.absoluteBoundingBox,scale=input.logicalUnitsPerDesignUnit;
    if(!frame||frame.width<=0||frame.height<=0)invalid('The selected Figma frame needs a nonempty absoluteBoundingBox');
    const origin=frame!;
    if(Math.abs(origin.width*scale-profile.root.width)>tolerance||Math.abs(origin.height*scale-profile.root.height)>tolerance)invalid('Figma frame scale must match the target app-root dimensions');
    const mapped=new Map(Object.entries(input.elementMap)),values=[...mapped.values()];
    if(!values.length||new Set(values).size!==values.length)invalid('Figma mappings must use unique layout element IDs');
    const nodes=new Map<string,FigmaNode>(),stack:{raw:unknown;depth:number}[]=[{raw:input.frame,depth:0}];
    while(stack.length){
      const item=stack.pop()!;
      if(item.depth>64||nodes.size>=10000)invalid('Figma import exceeds the supported traversal limit');
      const result=FigmaNodeSchema.safeParse(item.raw);
      if(!result.success)invalid('Malformed Figma node: '+result.error.message);
      const node=result.data!;
      if(nodes.has(node.id))invalid('Duplicate Figma node ID: '+node.id);
      nodes.set(node.id,node);
      for(const child of [...node.children??[]].reverse())stack.push({raw:child,depth:item.depth+1});
    }
    for(const [figmaId,elementId]of mapped){
      const box=nodes.get(figmaId)?.absoluteBoundingBox;
      if(!box)invalid('Mapped Figma node is missing or has no bounds: '+figmaId);
      rectangle(elementId,{x:(box!.x-origin.x)*scale,y:(box!.y-origin.y)*scale,width:box!.width*scale,height:box!.height*scale});
    }
    for(const node of nodes.values()){
      if(node.layoutMode!=='HORIZONTAL'&&node.layoutMode!=='VERTICAL')continue;
      if(node.layoutWrap==='WRAP'){notes.push('Wrapped Figma auto-layout requires reviewed row constraints: '+node.id);continue;}
      const axis=node.layoutMode==='HORIZONTAL'?'x':'y',cross=axis==='x'?'y':'x';
      const children=(node.children??[]).map(child=>FigmaNodeSchema.parse(child));
      const gap=node.itemSpacing;
      const fixedGap=gap!==undefined&&gap>=0&&node.primaryAxisAlignItems!=='SPACE_BETWEEN';
      if(gap!==undefined&&!fixedGap)notes.push('Skipped negative/distributed Figma spacing: '+node.id);
      let run:string[]=[];
      const align=()=>{
        const edge=node.counterAxisAlignItems==='MIN'?'start':node.counterAxisAlignItems==='CENTER'?'center':node.counterAxisAlignItems==='MAX'?'end':undefined;
        if(run.length>1&&edge)constraints.push({id:'design:align:'+encodeURIComponent(node.id)+':'+encodeURIComponent(run[0]),type:'align',axis:cross,edge,elementIds:[...run],tolerance});
        run=[];
      };
      for(const child of children){
        const id=mapped.get(child.id);
        if(!id||child.layoutPositioning==='ABSOLUTE'){align();continue;}
        const previous=run.at(-1);
        if(previous&&fixedGap)constraints.push({id:'design:gap:'+encodeURIComponent(node.id)+':'+encodeURIComponent(previous)+':'+encodeURIComponent(id),type:'gap',axis,first:previous,second:id,value:gap!*scale,tolerance});
        run.push(id);
      }
      align();
      if(node.counterAxisAlignItems==='BASELINE')notes.push('Figma baseline alignment is not a supported geometric constraint: '+node.id);
    }
    notes.push('Figma coordinates and auto-layout are design intent. Review the generated constraints against the app scenario.');
  }
  if(new Set(constraints.map(rule=>rule.id)).size!==constraints.length)invalid('Design import contains duplicate constraint IDs');
  return DesignIntentResultSchema.parse({source:input.kind,reviewRequired:true,notes,spec:{schemaVersion:1,scenarioId:input.scenarioId,profile,requiredElementIds:[...required],constraints}});
}
