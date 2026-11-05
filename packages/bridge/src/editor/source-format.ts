import { Node, SyntaxKind, type SourceFile, type ObjectLiteralExpression } from 'ts-morph';

/** JSX attribute quotes do not establish the JavaScript string convention. */
export function sourceQuote(source: SourceFile, preferred?: Node): "'" | '"' {
  if (preferred && Node.isStringLiteral(preferred)) return preferred.getText().startsWith("'") ? "'" : '"';
  const strings = source.getDescendantsOfKind(SyntaxKind.StringLiteral).filter(node => !Node.isJsxAttribute(node.getParent()));
  const singles = strings.filter(node => node.getText().startsWith("'")).length;
  return strings.length - singles > singles ? '"' : "'";
}

export function valueText(value: unknown, source: SourceFile, preferred?: Node): string {
  if (typeof value !== 'string') return JSON.stringify(value);
  const encoded = JSON.stringify(value);
  return sourceQuote(source, preferred) === '"' ? encoded : "'" + encoded.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'") + "'";
}

/** Only primitive literals may be folded without removing expression evaluation. */
export function isLiteralStyleObject(object: ObjectLiteralExpression): boolean {
  const names = new Set<string>();
  return object.getProperties().every(property => {
    if (!Node.isPropertyAssignment(property)) return false;
    const name = property.getNameNode();
    if (!Node.isIdentifier(name) && !Node.isStringLiteral(name)) return false;
    const key = Node.isStringLiteral(name) ? name.getLiteralValue() : name.getText();
    if (names.has(key)) return false;
    names.add(key);
    const value = property.getInitializer();
    return Boolean(value && (Node.isStringLiteral(value) || Node.isNumericLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) || [SyntaxKind.TrueKeyword, SyntaxKind.FalseKeyword, SyntaxKind.NullKeyword].includes(value.getKind()) || (Node.isPrefixUnaryExpression(value) && ['+', '-'].includes(value.getText().slice(0, 1)) && Node.isNumericLiteral(value.getOperand()))));
  });
}
