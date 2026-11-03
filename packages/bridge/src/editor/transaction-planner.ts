import { createTwoFilesPatch } from 'diff';
import { Node, Project, SyntaxKind, type Expression, type ObjectLiteralExpression } from 'ts-morph';
import { SourceMutationSchema, type SourceFile, type SourceMutation, type SourceRef, type TransactionPlan, type Result, type BlastRadius } from '@nativemason/contracts';
import {hashSource,planSourcePatch} from './planner.js';

/** All project inputs are supplied by the adapter. Planning never reads or executes application code. */
export function planTransaction(files:readonly SourceFile[], mutations:readonly SourceMutation[]):Result<TransactionPlan> {
  try {
    if (!mutations.length) throw Error('A transaction requires at least one mutation');
    const project=new Project({useInMemoryFileSystem:true,skipAddingFilesFromTsConfig:true,compilerOptions:{jsx:4,allowJs:true,noLib:true}});
    const originals=new Map(files.map(f=>[f.path,f]));
    for(const file of files) project.createSourceFile('/'+file.path,file.text);
    const changes=new Map<string,{source:SourceRef;edits:{start:number;end:number;text:string}[]}>();
    const blastRadius:BlastRadius={consumers:[],unresolvedReferences:[]};
    const add=(path:string,source:SourceRef,after:string)=>{
      const before=originals.get(path)!.text;
      let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
      let end=before.length,newEnd=after.length;while(end>start&&newEnd>start&&before[end-1]===after[newEnd-1]){end--;newEnd--;}
      if(start===end&&start===newEnd)return;
      const entry=changes.get(path)??{source,edits:[]};
      const edit={start,end,text:after.slice(start,newEnd)};
      if(entry.edits.some(e=>e.start===start&&e.end===end&&e.text===edit.text))return;
      if(entry.edits.some(e=>Math.max(e.start,start)<Math.min(e.end,end)||(e.start===start&&e.end===end)))throw Error('Conflicting mutations target the same source range');
      entry.edits.push(edit);changes.set(path,entry);
    };
    const grouped=new Map<string,SourceMutation>();
    for(const raw of mutations){
      const mutation=SourceMutationSchema.parse(raw),key=JSON.stringify([mutation.source,mutation.scope??{kind:'local'}]);
      const prior=grouped.get(key);
      if(prior){for(const [property,value]of Object.entries(mutation.patch)){const old=prior.patch[property as keyof typeof prior.patch];if(old!==undefined&&old!==value)throw Error('Conflicting values target the same style property');}prior.patch={...prior.patch,...mutation.patch};}
      else grouped.set(key,structuredClone(mutation));
    }
    for(const raw of grouped.values()){

      const mutation=SourceMutationSchema.parse(raw),file=originals.get(mutation.source.path);
      if(!file||file.hash!==hashSource(file.text)||file.hash!==mutation.source.hash)return {ok:false,error:{code:'STALE_SOURCE',message:'Transaction source revision is unavailable or stale'}};
      if(mutation.scope?.kind!=='shared'){
        const planned=planSourcePatch(file.text,mutation.source,mutation.patch,mutation.scope??{kind:'local'});
        if(!planned.ok)return planned;
        add(file.path,mutation.source,planned.value.updatedText);
        blastRadius.consumers.push({source:mutation.source,mountedIds:[],requiredScenarios:[]});
        continue;
      }
      const ast=project.getSourceFileOrThrow('/'+file.path);
      const site=ast.getDescendants().find(n=>(Node.isJsxElement(n)||Node.isJsxSelfClosingElement(n))&&n.getStart()===mutation.source.start&&n.getEnd()===mutation.source.end);
      if(!site||(!Node.isJsxElement(site)&&!Node.isJsxSelfClosingElement(site)))return {ok:false,error:{code:'STALE_SOURCE',message:'Shared mutation no longer identifies its JSX source'}};
      const opening=Node.isJsxElement(site)?site.getOpeningElement():site;
      const attr=opening.getAttribute('style');
      if(!attr||!Node.isJsxAttribute(attr))throw Error('Shared editing requires a style expression');
      const initializer=attr.getInitializer();
      if(!initializer||!Node.isJsxExpression(initializer)||!initializer.getExpression())throw Error('Shared editing requires a style expression');
      const expression=initializer.getExpression()!;
      function resolveObject(expr:Expression):ObjectLiteralExpression {
        if(Node.isObjectLiteralExpression(expr))return expr;
        if(Node.isIdentifier(expr)){
          const symbol=expr.getSymbol()?.getAliasedSymbol()??expr.getSymbol();
          const declaration=symbol?.getDeclarations().find(Node.isVariableDeclaration);
          const value=declaration?.getInitializer();if(value)return resolveObject(value);
        }
        if(Node.isPropertyAccessExpression(expr)){
          const base=resolveObject(expr.getExpression());const property=base.getProperty(expr.getName());
          if(property&&Node.isPropertyAssignment(property)&&property.getInitializer())return resolveObject(property.getInitializer()!);
        }
        if(Node.isCallExpression(expr)&&Node.isPropertyAccessExpression(expr.getExpression())&&expr.getExpression().getText().endsWith('.create')){
          const owner=expr.getExpression() as import('ts-morph').PropertyAccessExpression;
          const base=owner.getExpression();
          if(!Node.isIdentifier(base)||!base.getSymbol()?.getDeclarations().some(d=>Node.isImportSpecifier(d)&&d.getImportDeclaration().getModuleSpecifierValue()==='react-native'&&d.getName()==='StyleSheet'))throw Error('Untrusted stylesheet factory');
          const arg=expr.getArguments()[0];if(arg&&Node.isObjectLiteralExpression(arg))return arg;
        }
        throw Error('Shared definition cannot be resolved statically');
      }
      const object=resolveObject(expression),targetFile=object.getSourceFile(),relative=targetFile.getFilePath().slice(1),original=originals.get(relative);
      if(!original)throw Error('Shared definition is outside supplied project sources');
      // Resolve property-access references rather than assuming equal text means equal binding.
      let references=0;
      for(const candidate of project.getSourceFiles())for(const node of candidate.getDescendants()){
        if(!Node.isPropertyAccessExpression(node)&&!Node.isIdentifier(node))continue;
        try {if(resolveObject(node)!==object)continue;}catch{continue;}
        const parent=node.getParent();
        if(parent&&(Node.isPropertyAccessExpression(parent)&&parent.getExpression()===node)){try{resolveObject(parent);continue;}catch{blastRadius.unresolvedReferences.push(candidate.getFilePath().slice(1)+':'+parent.getStart());continue;}}
        if(Node.isVariableDeclaration(parent)){if(parent.getInitializer()===node)blastRadius.unresolvedReferences.push(candidate.getFilePath().slice(1)+':'+node.getStart());continue;}
        const jsx=node.getAncestors().find(n=>Node.isJsxElement(n)||Node.isJsxSelfClosingElement(n));
        if(!jsx){blastRadius.unresolvedReferences.push(candidate.getFilePath().slice(1)+':'+node.getStart());continue;}
        references++;
        const location=candidate.getLineAndColumnAtPos(jsx.getStart());
        blastRadius.consumers.push({source:{path:candidate.getFilePath().slice(1),hash:hashSource(candidate.getFullText()),start:jsx.getStart(),end:jsx.getEnd(),line:location.line,column:location.column-1},mountedIds:[],requiredScenarios:[]});
      }
      if(!references||blastRadius.unresolvedReferences.length)return {ok:false,error:{code:'UNSUPPORTED_EDIT',message:'Shared definition has unresolved or escaping consumers',details:blastRadius}};
      for(const prop of object.getProperties())if(!Node.isPropertyAssignment(prop)||prop.getNameNode().getKind()===SyntaxKind.ComputedPropertyName)throw Error('Shared definitions with spreads or computed keys are unsupported');
      // Modify an isolated copy so subsequent mutations continue to use original AST offsets.
      const copyProject=new Project({useInMemoryFileSystem:true});const copy=copyProject.createSourceFile('/copy.tsx',original.text);
      const copyObject=copy.getDescendants().find(n=>Node.isObjectLiteralExpression(n)&&n.getStart()===object.getStart());
      if(!copyObject||!Node.isObjectLiteralExpression(copyObject))throw Error('Shared source mapping failed');
      for(const [key,value]of Object.entries(mutation.patch)){
        if(value===undefined)continue;const prop=copyObject.getProperty(key);
        if(prop&&Node.isPropertyAssignment(prop))prop.setInitializer(JSON.stringify(value));else copyObject.addPropertyAssignment({name:key,initializer:JSON.stringify(value)});
      }
      const location=targetFile.getLineAndColumnAtPos(object.getStart());
      add(relative,{path:relative,hash:original.hash,start:object.getStart(),end:object.getEnd(),line:location.line,column:location.column-1},copy.getFullText());
    }
    const plans=[...changes].sort(([a],[b])=>a.localeCompare(b)).map(([path,{source,edits}])=>{
      const original=originals.get(path)!;let updatedText=original.text;
      for(const edit of edits.sort((a,b)=>b.start-a.start))updatedText=updatedText.slice(0,edit.start)+edit.text+updatedText.slice(edit.end);
      return {source,expectedHash:original.hash,updatedText,diff:createTwoFilesPatch(path,path,original.text,updatedText)};
    });
    if(!plans.length)throw Error('Transaction would not change source');
    return {ok:true,value:{files:plans,blastRadius}};
  }catch(error){return {ok:false,error:{code:'UNSUPPORTED_EDIT',message:error instanceof Error?error.message:String(error)}};}
}
