import type { PluginObj, PluginPass } from '@babel/core';
import * as t from '@babel/types';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

interface Options { projectRoot?: string }
export default function bridgeSourcePlugin(): PluginObj<PluginPass & { opts: Options }> {
  return {
    name: 'rn-layout-source',
    visitor: {
      JSXOpeningElement(path, state) {
        if (process.env.NODE_ENV === 'production' || state.file.opts.envName === 'production') return;
        const name = path.node.name;
        if (!t.isJSXIdentifier(name)) return;
        const binding = path.scope.getBinding(name.name);
        if (!binding?.path.isImportSpecifier()) return;
        const imported = binding.path.node.imported;
        const originalName = t.isIdentifier(imported) ? imported.name : imported.value;
        if (!['LayoutView', 'LayoutText', 'LayoutPressable'].includes(originalName)) return;
        const declaration = binding.path.parentPath;
        if (!declaration?.isImportDeclaration() || declaration.node.source.value !== '@rn-layout/runtime') return;
        if (path.node.attributes.some(attribute => t.isJSXAttribute(attribute) && attribute.name.name === '__bridgeSource')) throw path.buildCodeFrameError('__bridgeSource is reserved for source instrumentation');
        if (path.node.attributes.some(attribute => t.isJSXSpreadAttribute(attribute))) return;
        const element = path.parentPath.node;
        if (!t.isJSXElement(element) || element.start == null || element.end == null || !element.loc) return;
        const filename = state.filename ?? state.file.opts.filename;
        if (!filename) return;
        const projectRoot = resolve(state.opts.projectRoot ?? state.file.opts.root ?? process.cwd());
        const projectPath = relative(projectRoot, filename).split(sep).join('/');
        if (!projectPath || projectPath.startsWith('../')) throw path.buildCodeFrameError('Instrumented file must be inside projectRoot');
        const source = { path: projectPath, hash: createHash('sha256').update(state.file.code).digest('hex'), start: element.start, end: element.end, line: element.loc.start.line, column: element.loc.start.column };
        path.pushContainer('attributes', t.jsxAttribute(t.jsxIdentifier('__bridgeSource'), t.jsxExpressionContainer(t.valueToNode(source))));
      },
    },
  };
}
