import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { Node, Project, SyntaxKind, ts, type JsxElement, type JsxSelfClosingElement, type ObjectLiteralExpression, type Expression, type SourceFile as AstSourceFile } from 'ts-morph';
import { isLiteralStyleObject, valueText } from './source-format.js';
import { RnStylePatchSchema, SourceRefSchema, type EditPlan, type Result, type RnStylePatch, type SourceRef, type EditScope } from '@nativemason/contracts';

export const hashSource = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

type Target = JsxElement | JsxSelfClosingElement;
class Unsupported extends Error {}
function reject(message: string): never { throw new Unsupported(message); }

function hasTrailingComma(sourceText: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, sourceText);
  return scanner.scan() === ts.SyntaxKind.CommaToken && scanner.scan() === ts.SyntaxKind.EndOfFileToken;
}

function staticLiteral(expression: Expression): boolean {
  if (Node.isStringLiteral(expression) || Node.isNumericLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) return true;
  if ([SyntaxKind.TrueKeyword, SyntaxKind.FalseKeyword, SyntaxKind.NullKeyword].includes(expression.getKind())) return true;
  return Node.isPrefixUnaryExpression(expression) && ['+', '-'].includes(expression.getText().slice(0, 1)) && Node.isNumericLiteral(expression.getOperand());
}

function validateObject(object: ObjectLiteralExpression): void {
  const names = new Set<string>();
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) reject('Styles must contain only explicit literal property assignments');
    const nameNode = property.getNameNode();
    if (!(Node.isIdentifier(nameNode) || Node.isStringLiteral(nameNode))) reject('Computed style property names are unsupported');
    const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
    if (names.has(name)) reject('Duplicate style properties are unsupported');
    names.add(name);
    const value = property.getInitializer();
    if (!value || !staticLiteral(value)) reject('Style values must be static primitive literals');
  }
}

function localStyleObject(expression: Expression, source: AstSourceFile): ObjectLiteralExpression {
  if (Node.isObjectLiteralExpression(expression)) return expression;
  if (!Node.isPropertyAccessExpression(expression) || !Node.isIdentifier(expression.getExpression())) reject('Only inline objects or local StyleSheet.create entries are supported');
  const variableId = expression.getExpression();
  const variableSymbol = variableId.getSymbol();
  const declaration = variableSymbol?.getDeclarations().find(Node.isVariableDeclaration);
  if (!declaration || declaration.getSourceFile() !== source) reject('Imported and unresolved styles are unsupported');
  const initializer = declaration.getInitializer();
  if (!initializer || !Node.isCallExpression(initializer)) reject('Styles must be declared with StyleSheet.create');
  const call = initializer.getExpression();
  if (!Node.isPropertyAccessExpression(call) || call.getName() !== 'create' || !Node.isIdentifier(call.getExpression())) reject('Styles must be declared with an imported StyleSheet.create');
  const importId = call.getExpression();
  const importSpecifier = importId.getSymbol()?.getDeclarations().find(Node.isImportSpecifier);
  if (!importSpecifier || importSpecifier.getName() !== 'StyleSheet' || importSpecifier.getImportDeclaration().getModuleSpecifierValue() !== 'react-native') reject('StyleSheet must be a named react-native import');
  const args = initializer.getArguments();
  if (args.length !== 1 || !Node.isObjectLiteralExpression(args[0])) reject('StyleSheet.create must receive one literal object');
  const entryName = expression.getName();
  const entryNames = new Set<string>();
  for (const property of args[0].getProperties()) {
    if (!Node.isPropertyAssignment(property)) reject('StyleSheet.create must not contain spreads or shorthand entries');
    const nameNode = property.getNameNode();
    if (!(Node.isIdentifier(nameNode) || Node.isStringLiteral(nameNode))) reject('Computed StyleSheet entry names are unsupported');
    const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
    if (entryNames.has(name)) reject('Duplicate StyleSheet entries are unsupported');
    entryNames.add(name);
  }
  const entry = args[0].getProperty(entryName);
  if (!entry || !Node.isPropertyAssignment(entry)) reject('StyleSheet entry must be a literal property');
  const object = entry.getInitializer();
  if (!object || !Node.isObjectLiteralExpression(object)) reject('StyleSheet entry must be a literal object');
  let usages = 0;
  for (const id of source.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getSymbol() !== variableSymbol || id === declaration.getNameNode()) continue;
    const parent = id.getParent();
    if (!parent || !Node.isPropertyAccessExpression(parent) || parent.getExpression() !== id) reject('StyleSheet object escapes its declaration');
    if (parent.getName() === entryName) usages++;
  }
  if (usages !== 1) reject('Shared StyleSheet entries cannot be edited automatically');
  return object;
}

function rejectRepeatedSite(target: Target): void {
  for (const ancestor of target.getAncestors()) {
    if (Node.isForStatement(ancestor) || Node.isForOfStatement(ancestor) || Node.isForInStatement(ancestor) || Node.isWhileStatement(ancestor) || Node.isDoStatement(ancestor)) reject('Repeated JSX source sites cannot be edited automatically');
    // A JSX node inside a callback may render any number of instances. Named component
    // functions are allowed; callbacks supplied to another function are deliberately not.
    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const parent = ancestor.getParent();
      if (parent && (Node.isCallExpression(parent) || Node.isArrayLiteralExpression(parent))) reject('JSX callback source sites cannot be edited automatically');
    }
  }
}

function splitNativeWindVariant(token: string): { hasVariant: boolean; utility: string } {
  let bracketDepth = 0;
  let variantSeparator = -1;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '\\') { i++; continue; }
    if (token[i] === '[') bracketDepth++;
    else if (token[i] === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (token[i] === ':' && bracketDepth === 0) variantSeparator = i;
  }
  return variantSeparator < 0
    ? { hasVariant: false, utility: token }
    : { hasVariant: true, utility: token.slice(variantSeparator + 1) };
}

function pressableStateObject(opening: ReturnType<JsxElement['getOpeningElement']> | JsxSelfClosingElement, state: EditScope['state']): ObjectLiteralExpression {
  if (!state) reject('Pressable callback edits require an explicit pressed or rest state');
  const tag = opening.getTagNameNode();
  let supported = false;
  if (Node.isIdentifier(tag)) {
    const imported = tag.getSymbol()?.getDeclarations().find(Node.isImportSpecifier);
    supported = Boolean(imported && ((imported.getName() === 'Pressable' && imported.getImportDeclaration().getModuleSpecifierValue() === 'react-native') || (imported.getName() === 'LayoutPressable' && imported.getImportDeclaration().getModuleSpecifierValue() === '@nativemason/runtime')));
  } else if (Node.isPropertyAccessExpression(tag)) {
    const imported = tag.getExpression().getSymbol()?.getDeclarations().find(Node.isNamespaceImport);
    supported = Boolean(imported && ((tag.getName() === 'Pressable' && imported.getFirstAncestorByKindOrThrow(SyntaxKind.ImportDeclaration).getModuleSpecifierValue() === 'react-native') || (tag.getName() === 'LayoutPressable' && imported.getFirstAncestorByKindOrThrow(SyntaxKind.ImportDeclaration).getModuleSpecifierValue() === '@nativemason/runtime')));
  }
  if (!supported) reject('State callback editing requires an imported RN Pressable or LayoutPressable');
  const attributes = opening.getAttributes().filter(attribute => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'style');
  if (attributes.length !== 1 || !Node.isJsxAttribute(attributes[0])) reject('State callback editing requires one style attribute');
  const initializer = attributes[0].getInitializer();
  if (!initializer || !Node.isJsxExpression(initializer)) reject('Style callback must be a JSX expression');
  const expression = initializer.getExpression();
  if (!expression || (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) || expression.isAsync() || (Node.isFunctionExpression(expression) && expression.isGenerator())) reject('Only synchronous inline Pressable callbacks are supported');
  const parameters = expression.getParameters();
  if (parameters.length !== 1) reject('Pressable callback needs one destructured pressed parameter');
  if (parameters[0].getInitializer() || parameters[0].getDotDotDotToken()) reject('Default and rest callback parameters are unsupported');
  const parameter = parameters[0].getNameNode();
  if (!Node.isObjectBindingPattern(parameter) || parameter.getElements().length !== 1) reject('Pressable callback needs one destructured pressed parameter');
  const binding = parameter.getElements()[0];
  const name = binding.getNameNode();
  if ((binding.getPropertyNameNode()?.getText() ?? name.getText()) !== 'pressed' || !Node.isIdentifier(name) || binding.getInitializer() || binding.getDotDotDotToken()) reject('Unsupported pressed parameter binding');
  const unwrap = (node: Node): Node => Node.isParenthesizedExpression(node) ? unwrap(node.getExpression()) : node;
  let body: Node = expression.getBody();
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    if (statements.length !== 1 || !Node.isReturnStatement(statements[0]) || !statements[0].getExpression()) reject('Callback body must contain only a static conditional return');
    body = statements[0].getExpression()!;
  }
  body = unwrap(body);
  if (!Node.isConditionalExpression(body)) reject('Callback must return pressed ? literal : literal');
  let condition = unwrap(body.getCondition());
  let negated = false;
  if (Node.isPrefixUnaryExpression(condition) && condition.getOperatorToken() === SyntaxKind.ExclamationToken) {
    condition = unwrap(condition.getOperand());
    negated = true;
  }
  if (!Node.isIdentifier(condition) || condition.getText() !== name.getText()) reject('Callback condition must be the pressed binding');
  const whenTrue = unwrap(body.getWhenTrue());
  const whenFalse = unwrap(body.getWhenFalse());
  if (!Node.isObjectLiteralExpression(whenTrue) || !Node.isObjectLiteralExpression(whenFalse)) reject('Callback arms must be static inline style literals');
  validateObject(whenTrue);
  validateObject(whenFalse);
  return (state === 'pressed') !== negated ? whenTrue : whenFalse;
}

/** Pure planning: parses in memory and returns text; never writes the source tree. */
export function planSourcePatch(sourceText: string, sourceRef: SourceRef, patch: RnStylePatch, scope?: EditScope): Result<EditPlan> {
  const parsedSource = SourceRefSchema.safeParse(sourceRef);
  const parsedPatch = RnStylePatchSchema.safeParse(patch);
  if (!parsedSource.success || !parsedPatch.success) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid source reference or RN style patch' } };
  if (hashSource(sourceText) !== sourceRef.hash) return { ok: false, error: { code: 'STALE_SOURCE', message: 'Source content no longer matches the measured revision' } };
  try {
    const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { jsx: 4, noResolve: true, noLib: true } });
    const source = project.createSourceFile('/source.tsx', sourceText);
    if (project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length) reject('Source contains syntax errors');
    const target = source.getDescendants().find((node): node is Target => (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node)) && node.getStart() === sourceRef.start && node.getEnd() === sourceRef.end);
    if (!target) return { ok: false, error: { code: 'STALE_SOURCE', message: 'Source range does not identify the original JSX element' } };
    const location = source.getLineAndColumnAtPos(target.getStart());
    if (location.line !== sourceRef.line || location.column - 1 !== sourceRef.column) return { ok: false, error: { code: 'STALE_SOURCE', message: 'Source location does not match the original JSX element' } };
    if (!scope?.acknowledgeInstances) rejectRepeatedSite(target);
    const opening = Node.isJsxElement(target) ? target.getOpeningElement() : target;
    if (opening.getAttributes().some(Node.isJsxSpreadAttribute)) reject('JSX spread attributes could override the trial styles');
    if (scope?.kind === 'nativewind') return planNativeWind(sourceText, sourceRef, parsedPatch.data, opening, scope);
    let foldedObject: ObjectLiteralExpression | undefined=scope?.kind==='pressable-state'?pressableStateObject(opening,scope.state):undefined;
    if (scope?.kind === 'local' || scope?.kind === 'branch') {
      const attrs = opening.getAttributes().filter(a => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'style');
      if (attrs.length > 1) reject('Duplicate style attributes are unsupported');
      const attribute = attrs[0];
      const literal = '{ ' + Object.keys(parsedPatch.data).sort().map(key => key + ': ' + valueText(parsedPatch.data[key as keyof RnStylePatch], source)).join(', ') + ' }';
      let updatedText: string;
      if (attribute && Node.isJsxAttribute(attribute)) {
        const initializer = attribute.getInitializer();
        if (!initializer || !Node.isJsxExpression(initializer)) reject('Style must be a JSX expression');
        let expression = initializer.getExpression();
        if (!expression) reject('Style expression is empty');
        if (scope.kind === 'branch') {
          if (!Node.isConditionalExpression(expression) || !scope.branch) reject('Branch editing requires a conditional style and an explicit branch');
          expression = scope.branch === 'consequent' ? expression.getWhenTrue() : expression.getWhenFalse();
        }
        if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) reject('Style callback edits require a measured state and are unsupported');
        // Only the final array entry can override every preceding expression.
        const candidate = Node.isArrayLiteralExpression(expression) ? expression.getElements().at(-1) : expression;
        if (candidate && Node.isExpression(candidate)) {
          try { const object = localStyleObject(candidate, source); if (isLiteralStyleObject(object)) foldedObject = object; } catch { /* Shared/dynamic styles keep their final local override. */ }
        }
        const replacement = '[' + expression.getText() + ', ' + literal + ']';
        updatedText = sourceText.slice(0, expression.getStart()) + replacement + sourceText.slice(expression.getEnd());
      } else {
        const end = opening.getTagNameNode().getEnd();
        updatedText = sourceText.slice(0, end) + ' style={' + literal + '}' + sourceText.slice(end);
      }
      if (!foldedObject) return {ok:true,value:{source:sourceRef,expectedHash:sourceRef.hash,updatedText,diff:createTwoFilesPatch(sourceRef.path,sourceRef.path,sourceText,updatedText)}};
    }
    const attributes = opening.getAttributes().filter(attribute => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'style');
    if (attributes.length > 1) reject('Duplicate style attributes are unsupported');
    const styleAttribute = attributes[0];
    let object: ObjectLiteralExpression | undefined = foldedObject;
    if (!object && styleAttribute && Node.isJsxAttribute(styleAttribute)) {
      const value = styleAttribute.getInitializer();
      if (!value || !Node.isJsxExpression(value)) reject('Style must be a JSX expression');
      const expression = value.getExpression();
      if (!expression) reject('Style expression is empty');
      object = localStyleObject(expression, source);
      validateObject(object);
    }
    const edits: { start: number; end: number; text: string }[] = [];
    const additions: string[] = [];
    for (const key of Object.keys(parsedPatch.data).sort()) {
      const value = parsedPatch.data[key as keyof RnStylePatch];
      if (value === undefined) continue;
      const existing = object?.getProperty(key);
      const text = valueText(value, source, existing && Node.isPropertyAssignment(existing) ? existing.getInitializer() : undefined);
      if (existing && Node.isPropertyAssignment(existing)) {
        const initializer = existing.getInitializerOrThrow();
        edits.push({ start: initializer.getStart(), end: initializer.getEnd(), text });
      } else additions.push(`${key}: ${text}`);
    }
    if (object && additions.length) {
      const closing = object.getEnd() - 1;
      const properties = object.getProperties();
      // Inserting before the closing brace preserves comments and all unrelated text.
      const trailingComma = properties.length > 0 && hasTrailingComma(sourceText.slice(properties.at(-1)!.getEnd(), closing));
      edits.push({ start: closing, end: closing, text: `${properties.length && !trailingComma ? ',' : ''} ${additions.join(', ')} ` });
    } else if (!object) {
      const tag = opening.getTagNameNode();
      edits.push({ start: tag.getEnd(), end: tag.getEnd(), text: ` style={{ ${additions.join(', ')} }}` });
    }
    let updatedText = sourceText;
    for (const edit of edits.sort((a, b) => b.start - a.start)) updatedText = updatedText.slice(0, edit.start) + edit.text + updatedText.slice(edit.end);
    const updated = project.createSourceFile('/updated.tsx', updatedText);
    if (project.getProgram().compilerObject.getSyntacticDiagnostics(updated.compilerNode).length) reject('Planned source edit would produce invalid syntax');
    return { ok: true, value: { source: sourceRef, expectedHash: sourceRef.hash, updatedText, diff: createTwoFilesPatch(sourceRef.path, sourceRef.path, sourceText, updatedText, '', '', { context: 3 }) } };
  } catch (error) {
    return { ok: false, error: { code: 'UNSUPPORTED_EDIT', message: error instanceof Error ? error.message : 'Unsupported source edit' } };
  }
}

function planNativeWind(text: string, source: SourceRef, patch: RnStylePatch, opening: ReturnType<JsxElement['getOpeningElement']> | JsxSelfClosingElement, scope: EditScope): Result<EditPlan> {
  const attr = opening.getAttribute('className');
  if (!attr || !Node.isJsxAttribute(attr)) reject('NativeWind requires a literal className');
  let init = attr.getInitializer();
  if(init && Node.isJsxExpression(init) && init.getExpression() && Node.isConditionalExpression(init.getExpression())){
    const conditional=init.getExpression() as import('ts-morph').ConditionalExpression;
    if(!scope.branch)reject('Conditional NativeWind classes require an explicit branch');
    const expression=scope.branch==='consequent'?conditional.getWhenTrue():conditional.getWhenFalse();
    if(!Node.isStringLiteral(expression))reject('NativeWind branches must be string literals');
    init=expression;
  }
  let classes: string;
  if (init && Node.isStringLiteral(init)) classes = init.getLiteralValue();
  else if (init && Node.isJsxExpression(init) && init.getExpression() && Node.isStringLiteral(init.getExpression())) classes = (init.getExpression() as import('ts-morph').StringLiteral).getLiteralValue();
  else reject('Dynamic class construction is unsupported');
  const utility: Record<string,string> = {width:'w',height:'h',minWidth:'min-w',maxWidth:'max-w',minHeight:'min-h',maxHeight:'max-h',gap:'gap',rowGap:'gap-y',columnGap:'gap-x',padding:'p',paddingHorizontal:'px',paddingVertical:'py',paddingTop:'pt',paddingBottom:'pb',paddingLeft:'pl',paddingRight:'pr',margin:'m',marginHorizontal:'mx',marginVertical:'my',marginTop:'mt',marginBottom:'mb',marginLeft:'ml',marginRight:'mr',fontSize:'text',lineHeight:'leading',top:'top',bottom:'bottom',left:'left',right:'right',flexGrow:'grow',flexShrink:'shrink',paddingStart:'ps',paddingEnd:'pe',marginStart:'ms',marginEnd:'me',start:'start',end:'end',aspectRatio:'aspect',flex:'flex'};
  const fixed: Record<string,Record<string,string>> = {flexDirection:{row:'flex-row',column:'flex-col','row-reverse':'flex-row-reverse','column-reverse':'flex-col-reverse'},justifyContent:{'flex-start':'justify-start','flex-end':'justify-end',center:'justify-center','space-between':'justify-between','space-around':'justify-around','space-evenly':'justify-evenly'},alignItems:{'flex-start':'items-start','flex-end':'items-end',center:'items-center',stretch:'items-stretch',baseline:'items-baseline'},flexWrap:{wrap:'flex-wrap',nowrap:'flex-nowrap','wrap-reverse':'flex-wrap-reverse'},position:{relative:'relative',absolute:'absolute',static:'static'},alignSelf:{auto:'self-auto','flex-start':'self-start','flex-end':'self-end',center:'self-center',stretch:'self-stretch',baseline:'self-baseline'},alignContent:{'flex-start':'content-start','flex-end':'content-end',center:'content-center',stretch:'content-stretch','space-between':'content-between','space-around':'content-around'},fontWeight:{normal:'font-normal',bold:'font-bold','100':'font-thin','200':'font-extralight','300':'font-light','400':'font-normal','500':'font-medium','600':'font-semibold','700':'font-bold','800':'font-extrabold','900':'font-black'}};
  let tokens = classes.split(/\s+/).filter(Boolean);
  for (const [key,value] of Object.entries(patch)) {
    if (value === undefined) continue;
    let token: string;
    let matches: (s:string)=>boolean;
    if(key==='fontFamily'){
      if(typeof value!=='string'||! /^[A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+)*$/.test(value))reject('NativeWind font families must be literal names without CSS expressions');
      const weights=new Set(['thin','extralight','light','normal','medium','semibold','bold','extrabold','black']);
      const family=(candidate:string)=>/^font-(?:sans|serif|mono)$/.test(candidate)||/^font-\[family-name:[A-Za-z][A-Za-z0-9]*(?:(?:_|\\_|-)[A-Za-z0-9]+)*\]$/.test(candidate);
      for(const existing of tokens){const base=splitNativeWindVariant(existing).utility;if(base.startsWith('font-')&&!weights.has(base.slice(5))&&!/^font-\[\d+\]$/.test(base)&&!family(base))reject('Configured or dynamic font utilities require explicit static theme evidence');}
      token='font-[family-name:'+value.replaceAll('_','\\_').replaceAll(' ','_')+']';matches=family;
    }
    else if (fixed[key]) { token = fixed[key][String(value)]; if (!token) reject('Unsupported NativeWind value for '+key); const values = Object.values(fixed[key]); matches = s=>values.includes(s); }
    else { const prefix=utility[key]; if (!prefix) reject('Unsupported NativeWind property '+key); token=prefix+'-['+String(value)+(typeof value === 'number'&&!['flexGrow','flexShrink','aspectRatio','flex'].includes(key)?'px':'')+']'; matches=s=>s.startsWith(prefix+'-')&&!s.startsWith(prefix+'-x-')&&!s.startsWith(prefix+'-y-')&&(key!=='fontSize'||/^text-(?:\[[-.\d]|xs$|sm$|base$|lg$|[2-9]?xl$)/.test(s)); }
    const splitTokens = tokens.map(splitNativeWindVariant);
    if(splitTokens.some(({hasVariant,utility:base})=>hasVariant&&matches(base)))reject('Conflicting variant utilities require an explicit variant-specific edit');
    tokens = tokens.filter((_,index)=>splitTokens[index].hasVariant||!matches(splitTokens[index].utility)); tokens.push(token);
  }
  const updatedText=text.slice(0,init!.getStart())+valueText(tokens.join(' '),opening.getSourceFile(),init)+text.slice(init!.getEnd());
  return {ok:true,value:{source,expectedHash:source.hash,updatedText,diff:createTwoFilesPatch(source.path,source.path,text,updatedText)}};
}
