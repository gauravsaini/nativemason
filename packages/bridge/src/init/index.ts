import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,URL} from 'node:url';
import {Project,Node,SyntaxKind} from 'ts-morph';
import {BridgeFault} from '@nativemason/contracts';
const exists=async(p:string)=>access(p).then(()=>true,()=>false);
export async function initialize(projectRoot:string,dryRun=false,settings:{textProbes?:boolean}={}){
 const root=path.resolve(projectRoot);
 const app=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')) as {dependencies?:Record<string,string>};
 if(!app.dependencies?.expo)throw new BridgeFault('INVALID_INPUT','Initialization requires an Expo project');
 const roots=['app/_layout.tsx','src/app/_layout.tsx','App.tsx','App.jsx','App.js','src/App.tsx'];
 const candidates=[];for(const file of roots)if(await exists(path.join(root,file)))candidates.push(file);
 if(candidates.length!==1)throw new BridgeFault('INVALID_INPUT','Expected one Expo app root',{candidates});
 const configs=['babel.config.js','babel.config.cjs'];const present=[];for(const file of configs)if(await exists(path.join(root,file)))present.push(file);
 if(present.length>1)throw new BridgeFault('UNSUPPORTED_EDIT','Multiple Babel configurations require manual selection');
 const file=present[0]??'babel.config.cjs';
 const old=present.length?await readFile(path.join(root,file),'utf8'):"module.exports = function(api) { api.cache(true); return { presets: ['babel-preset-expo'], plugins: [] }; };\n";
 const project=new Project({useInMemoryFileSystem:true,skipAddingFilesFromTsConfig:true});const source=project.createSourceFile('/babel.js',old);
 const config=source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression).filter(o=>o.getProperty('presets')||o.getProperty('plugins'));
 const rootSource=project.createSourceFile('/root.tsx',await readFile(path.join(root,candidates[0]),'utf8'));
 const providerTags=new Set<string>();let wrappedRoot=false;
 for(const declaration of rootSource.getImportDeclarations())if(declaration.getModuleSpecifierValue()==='@nativemason/runtime'){
  for(const imported of declaration.getNamedImports()){if(imported.getName()==='LayoutProvider')providerTags.add(imported.getAliasNode()?.getText()??imported.getName());if(imported.getName()==='withLayoutRoot')wrappedRoot=true;}
  const namespace=declaration.getNamespaceImport();if(namespace)providerTags.add(namespace.getText()+'.LayoutProvider');
 }
 const manualProvider=wrappedRoot||rootSource.getDescendants().some(node=>(Node.isJsxOpeningElement(node)||Node.isJsxSelfClosingElement(node))&&providerTags.has(node.getTagNameNode().getText()));
 const options={autoInstrument:true,textProbes:settings.textProbes??false,nativewind:Boolean(app.dependencies?.nativewind),...(manualProvider?{}:{rootComponent:candidates[0]})};
 let updated=old;
 if(!old.includes('nativemason/babel')){
  if(config.length!==1)throw new BridgeFault('UNSUPPORTED_EDIT','Babel configuration cannot be safely edited',{suggestedPlugin:["nativemason/babel",options]});
  const plugins=config[0].getProperty('plugins');const text=`[require.resolve('nativemason/babel'), { projectRoot: __dirname, ...${JSON.stringify(options)} }]`;
  if(!plugins)config[0].addPropertyAssignment({name:'plugins',initializer:`[${text}]`});
  else if(Node.isPropertyAssignment(plugins)&&Node.isArrayLiteralExpression(plugins.getInitializer()))plugins.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression).insertElement(0,text);
  else throw new BridgeFault('UNSUPPORTED_EDIT','Computed Babel plugins cannot be safely edited',{suggestedPlugin:["nativemason/babel",options]});
  updated=source.getFullText();
 }
 const ignorePath=path.join(root,'.gitignore');
 const ignoreBefore=await readFile(ignorePath,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 let ignoreAfter=ignoreBefore;
 for(const entry of ['/.nativemason/','/artifacts/nativemason/'])if(!ignoreBefore.split(/\r?\n/).includes(entry))ignoreAfter+=(ignoreAfter&&!ignoreAfter.endsWith('\n')?'\n':'')+entry+'\n';
 if(!dryRun){if(updated!==old)await writeFile(path.join(root,file),updated,'utf8');if(ignoreAfter!==ignoreBefore)await writeFile(ignorePath,ignoreAfter,'utf8');}
 const mcp={mcpServers:{nativemason:{command:'node',args:[fileURLToPath(new URL('../cli.js',import.meta.url))],cwd:root}}};
 return {projectRoot:root,rootComponent:candidates[0],automaticRoot:!manualProvider,dryRun,changed:updated!==old||ignoreAfter!==ignoreBefore,file,before:old,after:updated,ignoreEdit:{before:ignoreBefore,after:ignoreAfter},install:'Install matching nativemason, @nativemason/runtime and @nativemason/contracts packages before starting Expo.',mcp};
}
