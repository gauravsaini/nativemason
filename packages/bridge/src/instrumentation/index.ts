import {parseSync,type PluginObj,type PluginPass,type NodePath} from '@babel/core';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import * as t from '@babel/types';
import { createHash } from 'node:crypto';
import { dirname,relative, resolve, sep } from 'node:path';

interface Options { projectRoot?: string; autoInstrument?: boolean; rootComponent?: string; textProbes?: boolean; nativewind?: boolean }
type State = PluginPass & { opts: Options; bridgeHosts?: Map<string, t.Identifier>;bridgeKinds?:Map<string,string>; bridgeRoot?: t.Identifier; bridgeRevision?: t.Identifier; bridgeBindings?:Map<string,unknown>;bridgeStyleImports?:Map<string,{file:string;binding:unknown}>;bridgeDependencyCache?:Map<string,string[]>;bridgeOrdinal?: number };
const hosts = new Set(['View', 'Text', 'Pressable', 'TextInput', 'ScrollView', 'Image']);
function staticCallback(expression:t.Node|null|undefined):boolean {
  if(!expression||(!t.isArrowFunctionExpression(expression)&&!t.isFunctionExpression(expression))||expression.async||expression.generator||expression.params.length!==1)return false;
  const parameter=expression.params[0];if(!t.isObjectPattern(parameter)||parameter.properties.length!==1)return false;
  const pressed=parameter.properties[0];if(!t.isObjectProperty(pressed)||!t.isIdentifier(pressed.key,{name:'pressed'})||!t.isIdentifier(pressed.value))return false;
  const body=t.isBlockStatement(expression.body)?expression.body.body.length===1&&t.isReturnStatement(expression.body.body[0])?expression.body.body[0].argument:null:expression.body;
  if(!t.isConditionalExpression(body))return false;
  const test=t.isUnaryExpression(body.test,{operator:'!'})?body.test.argument:body.test;
  if(!t.isIdentifier(test,{name:pressed.value.name}))return false;
  return [body.consequent,body.alternate].every(arm=>t.isObjectExpression(arm)&&arm.properties.every(property=>t.isObjectProperty(property)&&!property.computed&&!property.shorthand&&(t.isIdentifier(property.key)||t.isStringLiteral(property.key))&&(t.isStringLiteral(property.value)||t.isNumericLiteral(property.value)||t.isBooleanLiteral(property.value)||t.isNullLiteral(property.value)||(t.isUnaryExpression(property.value)&&['+','-'].includes(property.value.operator)&&t.isNumericLiteral(property.value.argument)))));
}
function development(state: State) { const caller=state.file.opts.caller;if(caller&&'dev' in caller&&caller.dev===false)return false;const filename=state.filename??state.file.opts.filename??''; if(filename.includes('\0')||! /\.[cm]?[jt]sx?$/.test(filename))return false; return process.env.NODE_ENV !== 'production' && state.file.opts.envName !== 'production' && !state.filename?.split(/[\\/]/).includes('node_modules'); }
function physicalPath(path:string){try{return realpathSync(path);}catch{return resolve(path);}}
function filePath(state: State) {
  const filename = state.filename ?? state.file.opts.filename;
  if (!filename) return null;
  return relative(physicalPath(state.opts.projectRoot ?? state.file.opts.root ?? process.cwd()), physicalPath(filename)).split(sep).join('/');
}
function localModule(from:string,specifier:string):string|undefined {
  if(!specifier.startsWith('.'))return;
  const base=resolve(dirname(from),specifier);
  return [base,...['.ts','.tsx','.js','.jsx','.mts','.cts','.mjs','.cjs'].map(ext=>base+ext),...['index.ts','index.tsx','index.js','index.jsx'].map(file=>resolve(base,file))].find(file=>/\.[cm]?[jt]sx?$/.test(file)&&existsSync(file));
}
function styleModules(file:string,root:string,seen=new Set<string>()):string[] {
  if(seen.has(file))return [];seen.add(file);
  file=physicalPath(file);root=physicalPath(root);
  const relativePath=relative(root,file).split(sep).join('/');
  if(relativePath.startsWith('../'))return [];
  const result=[relativePath];
  const ast=parseSync(readFileSync(file,'utf8'),{filename:file,configFile:false,babelrc:false,parserOpts:{plugins:['typescript','jsx'],sourceType:'unambiguous'}});
  if(ast)t.traverseFast(ast,node=>{if((t.isImportDeclaration(node)||t.isExportNamedDeclaration(node)||t.isExportAllDeclaration(node))&&node.source){const dependency=localModule(file,node.source.value);if(dependency)result.push(...styleModules(dependency,root,seen));}});
  return [...new Set(result)];
}
export default function bridgeSourcePlugin(): PluginObj<State> {
  return {
    name: 'nativemason-source',
    visitor: {
      Program: {
        enter(path, state) {
          if (!development(state)) return;
          const projectPath = filePath(state);
          if (!projectPath || projectPath.startsWith('../')) return;
          state.bridgeRevision = path.scope.generateUidIdentifier("registerSourceRevision");
          state.bridgeOrdinal = 0;
          state.bridgeHosts = new Map();state.bridgeKinds=new Map();state.bridgeBindings=new Map();state.bridgeStyleImports=new Map();state.bridgeDependencyCache=new Map();
          for(const statement of path.node.body){if(!t.isImportDeclaration(statement)||statement.importKind==='type')continue;const file=localModule(state.filename??state.file.opts.filename!,statement.source.value);if(file)for(const specifier of statement.specifiers)state.bridgeStyleImports.set(specifier.local.name,{file,binding:path.scope.getBinding(specifier.local.name)});}
          const imports: t.ImportSpecifier[] = [t.importSpecifier(state.bridgeRevision, t.identifier("registerSourceRevision"))];
          if (state.opts.nativewind) path.unshiftContainer("body", t.importDeclaration([], t.stringLiteral("@nativemason/runtime/nativewind")));
          if (state.opts.autoInstrument) for (const statement of path.node.body) {
            if (!t.isImportDeclaration(statement) || statement.source.value !== 'react-native') continue;
            for (const specifier of statement.specifiers) {
              if (t.isImportNamespaceSpecifier(specifier)) {
                for (const host of hosts) {
                  const alias = path.scope.generateUidIdentifier('NativeMason' + host);
                  state.bridgeHosts.set(specifier.local.name + '.' + host, alias);state.bridgeKinds.set(specifier.local.name+'.'+host,host);state.bridgeBindings.set(specifier.local.name+'.'+host,path.scope.getBinding(specifier.local.name));
                  imports.push(t.importSpecifier(alias, t.identifier('Layout' + host)));
                }
                continue;
              }
              if (!t.isImportSpecifier(specifier) || specifier.importKind === 'type' || statement.importKind === 'type') continue;
              const name = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
              if (!hosts.has(name)) continue;
              const alias = path.scope.generateUidIdentifier(`NativeMason${name}`);
              state.bridgeHosts.set(specifier.local.name, alias);state.bridgeKinds.set(specifier.local.name,name);state.bridgeBindings.set(specifier.local.name,path.scope.getBinding(specifier.local.name));
              imports.push(t.importSpecifier(alias, t.identifier(`Layout${name}`)));
            }
          }
          if (state.opts.rootComponent?.replaceAll('\\', '/') === projectPath) {
            state.bridgeRoot = path.scope.generateUidIdentifier('withLayoutRoot');
            imports.push(t.importSpecifier(state.bridgeRoot, t.identifier('withLayoutRoot')));
          }
          if (imports.length) path.unshiftContainer('body', t.importDeclaration(imports, t.stringLiteral('@nativemason/runtime')));
          if (!state.bridgeRoot) return;
          for (const child of path.get('body')) {
            if (!child.isExportDefaultDeclaration()) continue;
            const declaration = child.node.declaration;
            if (t.isTSDeclareFunction(declaration)) throw child.buildCodeFrameError('NativeMason root must have a runtime default export');
            const options = t.objectExpression([t.objectProperty(t.identifier('textProbes'), t.booleanLiteral(state.opts.textProbes ?? false))]);
            if ((t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) && declaration.id) {
              child.replaceWithMultiple([declaration, t.exportDefaultDeclaration(t.callExpression(state.bridgeRoot, [t.identifier(declaration.id.name), options]))]);
            } else {
              const expression = t.isDeclaration(declaration) ? t.toExpression(declaration) : declaration;
              child.node.declaration = t.callExpression(state.bridgeRoot, [expression, options]);
            }
          }
        },
        exit(path, state) {
          if (!development(state)) return;
          const projectPath = filePath(state);
          if (state.bridgeRevision && projectPath && !projectPath.startsWith('../')) path.pushContainer('body', t.expressionStatement(t.callExpression(state.bridgeRevision, [t.stringLiteral(projectPath), t.stringLiteral(createHash('sha256').update(state.file.code).digest('hex'))])));

        },
      },
      JSXOpeningElement(path, state) {
        if (!development(state)) return;
        const name = path.node.name;
        const member = t.isJSXMemberExpression(name) && t.isJSXIdentifier(name.object) && t.isJSXIdentifier(name.property) ? name : null;
        const localName = t.isJSXIdentifier(name) ? name.name : member && t.isJSXIdentifier(member.object) ? member.object.name : null;
        if (!localName) return;
        const binding=path.scope.getBinding(localName);
        const lookupName=member?localName+'.'+member.property.name:localName;
        const automatic=Boolean(binding&&state.opts.autoInstrument&&state.bridgeHosts?.has(lookupName)&&state.bridgeBindings?.get(lookupName)===binding);
        let explicit=false;let explicitKind:string|undefined;
        if(!automatic){
          if(!binding?.path.isImportSpecifier())return;
          const imported=binding.path.node.imported;
          const originalName=t.isIdentifier(imported)?imported.name:imported.value;
          const declaration=binding.path.parentPath;
          explicitKind=originalName.slice(6);
          explicit=Boolean(declaration?.isImportDeclaration()&&declaration.node.source.value==='@nativemason/runtime'&&originalName.startsWith('Layout')&&hosts.has(originalName.slice(6)));
        }
        if(!automatic&&!explicit)return;
        if (path.node.attributes.some(attribute => t.isJSXAttribute(attribute) && ['__bridgeSource', '__bridgeId'].includes(String(attribute.name.name)))) throw path.buildCodeFrameError('__bridgeSource is reserved for source instrumentation');
        const element = path.parentPath.node;
        if (!t.isJSXElement(element) || element.start == null || element.end == null || !element.loc) return;
        const projectPath = filePath(state);
        if (!projectPath || projectPath.startsWith('../')) throw path.buildCodeFrameError('Instrumented file must be inside projectRoot');
        const dependencies=new Set<string>(),visited=new Set<t.Node>();
        const inspectExpression=(expression:NodePath<t.Node|null|undefined>)=>{
          if(!expression.node||visited.has(expression.node))return;visited.add(expression.node);
          const inspectIdentifier=(identifier:NodePath<t.Identifier|t.JSXIdentifier>)=>{
            const binding=identifier.scope.getBinding(identifier.node.name),imported=state.bridgeStyleImports?.get(identifier.node.name);
            if(imported&&imported.binding===binding){let paths=state.bridgeDependencyCache?.get(imported.file);if(!paths){paths=styleModules(imported.file,resolve(state.opts.projectRoot??state.file.opts.root??process.cwd()));state.bridgeDependencyCache?.set(imported.file,paths);}for(const file of paths)dependencies.add(file);}
            else if(binding?.path.isVariableDeclarator()){const initializer=binding.path.get('init');if(initializer.node)inspectExpression(initializer);}
          };
          if(expression.isReferencedIdentifier())inspectIdentifier(expression);
          expression.traverse({ReferencedIdentifier:inspectIdentifier});
        };
        for(const attribute of path.get('attributes'))if(attribute.isJSXAttribute()&&t.isJSXIdentifier(attribute.node.name)&&['style','className'].includes(attribute.node.name.name)){const value=attribute.get('value');if(value.isJSXExpressionContainer()){const expression=value.get('expression');if(expression.node)inspectExpression(expression);}}
        const styleAttribute=path.node.attributes.find(attribute=>t.isJSXAttribute(attribute)&&t.isJSXIdentifier(attribute.name,{name:'style'}));
        const callback=(automatic?state.bridgeKinds?.get(lookupName):explicitKind)==='Pressable'&&t.isJSXAttribute(styleAttribute)&&t.isJSXExpressionContainer(styleAttribute.value)&&staticCallback(styleAttribute.value.expression)&&!path.node.attributes.some(attribute=>t.isJSXSpreadAttribute(attribute));
        const source = { path: projectPath,...(callback?{styleForm:'pressable-state'}:{}),...(dependencies.size?{dependencies:[...dependencies].sort()}:{}), hash: createHash('sha256').update(state.file.code).digest('hex'), start: element.start, end: element.end, line: element.loc.start.line, column: element.loc.start.column };
        if (automatic) {
          const alias = state.bridgeHosts?.get(lookupName);
          if (!alias) return;
          path.node.name = t.jsxIdentifier(alias.name);
          if (element.closingElement) element.closingElement.name = t.jsxIdentifier(alias.name);
        }
        path.pushContainer('attributes', t.jsxAttribute(t.jsxIdentifier('__bridgeId'), t.stringLiteral(`${projectPath}#${state.bridgeOrdinal = (state.bridgeOrdinal ?? 0) + 1}`)));
        path.pushContainer('attributes', t.jsxAttribute(t.jsxIdentifier('__bridgeSource'), t.jsxExpressionContainer(t.valueToNode(source))));
      },
    },
  };
}
