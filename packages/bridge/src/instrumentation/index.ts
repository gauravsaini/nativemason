import type { PluginObj, PluginPass } from '@babel/core';
import * as t from '@babel/types';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

interface Options { projectRoot?: string; autoInstrument?: boolean; rootComponent?: string; textProbes?: boolean; nativewind?: boolean }
type State = PluginPass & { opts: Options; bridgeHosts?: Map<string, t.Identifier>; bridgeRoot?: t.Identifier; bridgeRevision?: t.Identifier; bridgeOrdinal?: number };
const hosts = new Set(['View', 'Text', 'Pressable', 'TextInput', 'ScrollView', 'Image']);
function development(state: State) { const filename=state.filename??state.file.opts.filename??''; if(filename.includes('\0')||! /\.[cm]?[jt]sx?$/.test(filename))return false; return process.env.NODE_ENV !== 'production' && state.file.opts.envName !== 'production' && !state.filename?.split(/[\\/]/).includes('node_modules'); }
function filePath(state: State) {
  const filename = state.filename ?? state.file.opts.filename;
  if (!filename) return null;
  return relative(resolve(state.opts.projectRoot ?? state.file.opts.root ?? process.cwd()), filename).split(sep).join('/');
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
          state.bridgeHosts = new Map();
          const imports: t.ImportSpecifier[] = [t.importSpecifier(state.bridgeRevision, t.identifier("registerSourceRevision"))];
          if (state.opts.nativewind) path.unshiftContainer("body", t.importDeclaration([], t.stringLiteral("@nativemason/runtime/nativewind")));
          if (state.opts.autoInstrument) for (const statement of path.node.body) {
            if (!t.isImportDeclaration(statement) || statement.source.value !== 'react-native') continue;
            for (const specifier of statement.specifiers) {
              if (t.isImportNamespaceSpecifier(specifier)) {
                for (const host of hosts) {
                  const alias = path.scope.generateUidIdentifier('NativeMason' + host);
                  state.bridgeHosts.set(specifier.local.name + '.' + host, alias);
                  imports.push(t.importSpecifier(alias, t.identifier('Layout' + host)));
                }
                continue;
              }
              if (!t.isImportSpecifier(specifier) || specifier.importKind === 'type' || statement.importKind === 'type') continue;
              const name = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
              if (!hosts.has(name)) continue;
              const alias = path.scope.generateUidIdentifier(`NativeMason${name}`);
              state.bridgeHosts.set(specifier.local.name, alias);
              imports.push(t.importSpecifier(alias, t.identifier(`Layout${name}`)));
            }
          }
          if (state.opts.rootComponent?.replaceAll('\\', '/') === projectPath) {
            state.bridgeRoot = path.scope.generateUidIdentifier('withLayoutRoot');
            imports.push(t.importSpecifier(state.bridgeRoot, t.identifier('withLayoutRoot')));
          }
          if (imports.length) path.unshiftContainer('body', t.importDeclaration(imports, t.stringLiteral('@nativemason/runtime')));
        },
        exit(path, state) {
          if (!development(state)) return;
          const projectPath = filePath(state);
          if (state.bridgeRevision && projectPath && !projectPath.startsWith('../')) path.pushContainer('body', t.expressionStatement(t.callExpression(state.bridgeRevision, [t.stringLiteral(projectPath), t.stringLiteral(createHash('sha256').update(state.file.code).digest('hex'))])));
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
      },
      JSXOpeningElement(path, state) {
        if (!development(state)) return;
        const name = path.node.name;
        const member = t.isJSXMemberExpression(name) && t.isJSXIdentifier(name.object) && t.isJSXIdentifier(name.property) ? name : null;
        const localName = t.isJSXIdentifier(name) ? name.name : member && t.isJSXIdentifier(member.object) ? member.object.name : null;
        if (!localName) return;
        const binding = path.scope.getBinding(localName);
        if (!binding || (!binding.path.isImportSpecifier() && !binding.path.isImportNamespaceSpecifier())) return;
        const imported = binding.path.isImportSpecifier() ? binding.path.node.imported : null;
        const originalName = imported ? t.isIdentifier(imported) ? imported.name : imported.value : member?.property.name;
        if (!originalName) return;
        const lookupName = member ? localName + '.' + member.property.name : localName;
        const declaration = binding.path.parentPath;
        if (!declaration?.isImportDeclaration()) return;
        const automatic = declaration.node.source.value === 'react-native' && hosts.has(originalName) && state.opts.autoInstrument;
        const explicit = declaration.node.source.value === '@nativemason/runtime' && originalName.startsWith('Layout') && hosts.has(originalName.slice(6));
        if (!automatic && !explicit) return;
        if (path.node.attributes.some(attribute => t.isJSXAttribute(attribute) && ['__bridgeSource', '__bridgeId'].includes(String(attribute.name.name)))) throw path.buildCodeFrameError('__bridgeSource is reserved for source instrumentation');
        const element = path.parentPath.node;
        if (!t.isJSXElement(element) || element.start == null || element.end == null || !element.loc) return;
        const projectPath = filePath(state);
        if (!projectPath || projectPath.startsWith('../')) throw path.buildCodeFrameError('Instrumented file must be inside projectRoot');
        const source = { path: projectPath, hash: createHash('sha256').update(state.file.code).digest('hex'), start: element.start, end: element.end, line: element.loc.start.line, column: element.loc.start.column };
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
