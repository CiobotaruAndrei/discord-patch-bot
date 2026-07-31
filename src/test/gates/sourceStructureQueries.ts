import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

export type ParamInfo = {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly hasDefault: boolean;
};

export type SignatureInfo = {
  readonly name: string;
  readonly async: boolean;
  readonly params: readonly ParamInfo[];
  readonly returnType: string;
};

export type MemberInfo = {
  readonly name: string;
  readonly kind: "property" | "method";
  readonly optional: boolean;
  readonly type: string;
  readonly params: readonly ParamInfo[];
  readonly returnType: string;
};

export type ImportInfo = {
  readonly module: string;
  readonly typeOnly: boolean;
  readonly defaultName: string | null;
  readonly namespaceName: string | null;
  readonly named: readonly string[];
  readonly bound: readonly string[];
};

export type AssertionInfo = {
  readonly expression: string;
  readonly type: string;
  readonly toNever: boolean;
  readonly throughUnknown: boolean;
};

export type CallInfo = {
  readonly callee: string;
  readonly args: readonly string[];
};

export type CompositionLayer = {
  readonly name: string;
  readonly spreads: readonly string[];
  readonly properties: readonly string[];
};

export type ModuleQuery = {
  readonly relativePath: string;
  readonly source: ts.SourceFile;
};

const srcRoot = process.cwd();

export function lineCount(query: ModuleQuery): number {
  return query.source.getLineStarts().length;
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseModule(label: string, text: string): ModuleQuery {
  return { relativePath: label, source: ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true) };
}

export function loadModule(...segments: readonly string[]): ModuleQuery {
  const absolute = path.join(srcRoot, ...segments);
  const relativePath = path.relative(srcRoot, absolute).split(path.sep).join("/");
  return parseModule(relativePath, fs.readFileSync(absolute, "utf8"));
}

export function loadModulesIn(directory: readonly string[], filter: (name: string) => boolean): ModuleQuery[] {
  const absolute = path.join(srcRoot, ...directory);
  return fs
    .readdirSync(absolute)
    .filter(name => name.endsWith(".ts") && filter(name))
    .sort()
    .map(name => loadModule(...directory, name));
}

export function loadModulesUnder(directory: readonly string[], filter: (relativePath: string) => boolean = () => true): ModuleQuery[] {
  const root = path.join(srcRoot, ...directory);
  const found: ModuleQuery[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const segments = path.relative(srcRoot, full).split(path.sep);
      if (!filter(segments.join("/"))) continue;
      found.push(loadModule(...segments));
    }
  }
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

export function eachNode(query: ModuleQuery, visit: (node: ts.Node) => void): void {
  walk(query.source, visit);
}

function typeText(node: ts.TypeNode | undefined): string {
  return node ? normalize(node.getText()) : "";
}

function readParams(declaration: ts.SignatureDeclarationBase): ParamInfo[] {
  return declaration.parameters.map(parameter => ({
    name: ts.isIdentifier(parameter.name) ? parameter.name.text : normalize(parameter.name.getText()),
    type: typeText(parameter.type),
    optional: parameter.questionToken !== undefined,
    hasDefault: parameter.initializer !== undefined
  }));
}

function isAsync(declaration: ts.FunctionLikeDeclarationBase): boolean {
  const modifiers = ts.canHaveModifiers(declaration) ? ts.getModifiers(declaration) : undefined;
  return (modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

export function functions(query: ModuleQuery): SignatureInfo[] {
  const found: SignatureInfo[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    found.push({ name: node.name.text, async: isAsync(node), params: readParams(node), returnType: typeText(node.type) });
  });
  return found;
}

export function functionNames(query: ModuleQuery): string[] {
  return functions(query).map(signature => signature.name);
}

export function exportedFunctionNames(query: ModuleQuery): string[] {
  const names: string[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    const modifiers = ts.getModifiers(node) ?? [];
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return;
    names.push(node.name.text);
  });
  return names;
}

export function findFunction(query: ModuleQuery, name: string): SignatureInfo | undefined {
  return functions(query).find(signature => signature.name === name);
}

export function requireFunction(query: ModuleQuery, name: string): SignatureInfo {
  const found = findFunction(query, name);
  if (!found) throw new Error(`${query.relativePath}: functia ${name} nu exista`);
  return found;
}

function memberOf(member: ts.TypeElement): MemberInfo | null {
  const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
  if (!name) return null;
  if (ts.isPropertySignature(member)) {
    const declared = member.type;
    if (declared && ts.isFunctionTypeNode(declared)) {
      return {
        name,
        kind: "property",
        optional: member.questionToken !== undefined,
        type: typeText(declared),
        params: readParams(declared),
        returnType: typeText(declared.type)
      };
    }
    return { name, kind: "property", optional: member.questionToken !== undefined, type: typeText(declared), params: [], returnType: "" };
  }
  if (ts.isMethodSignature(member)) {
    return {
      name,
      kind: "method",
      optional: member.questionToken !== undefined,
      type: normalize(member.getText()),
      params: readParams(member),
      returnType: typeText(member.type)
    };
  }
  return null;
}

export function membersOf(query: ModuleQuery, typeName: string): MemberInfo[] {
  const found: MemberInfo[] = [];
  eachNode(query, node => {
    const owns =
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === typeName;
    if (!owns) return;
    walk(node, inner => {
      if (!ts.isPropertySignature(inner) && !ts.isMethodSignature(inner)) return;
      const info = memberOf(inner);
      if (info) found.push(info);
    });
  });
  return found;
}

export function allMembers(query: ModuleQuery): MemberInfo[] {
  const found: MemberInfo[] = [];
  eachNode(query, node => {
    if (!ts.isPropertySignature(node) && !ts.isMethodSignature(node)) return;
    const info = memberOf(node);
    if (info) found.push(info);
  });
  return found;
}

export function findMember(query: ModuleQuery, typeName: string, memberName: string): MemberInfo | undefined {
  return membersOf(query, typeName).find(member => member.name === memberName);
}

export function nestedMembers(query: ModuleQuery, ownerType: string, propertyName: string): MemberInfo[] {
  const found: MemberInfo[] = [];
  eachNode(query, node => {
    const owns =
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === ownerType;
    if (!owns) return;
    walk(node, inner => {
      if (!ts.isPropertySignature(inner)) return;
      if (!inner.name || !ts.isIdentifier(inner.name) || inner.name.text !== propertyName) return;
      if (!inner.type || !ts.isTypeLiteralNode(inner.type)) return;
      for (const member of inner.type.members) {
        const info = memberOf(member);
        if (info) found.push(info);
      }
    });
  });
  return found;
}

export type CallBoundLocal = {
  readonly name: string;
  readonly callee: string;
  readonly args: readonly string[];
};

export function callBoundLocals(query: ModuleQuery, functionName: string): CallBoundLocal[] {
  const found: CallBoundLocal[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName || !node.body) return;
    for (const statement of node.body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (!ts.isCallExpression(declaration.initializer)) continue;
        found.push({
          name: declaration.name.text,
          callee: normalize(declaration.initializer.expression.getText()),
          args: declaration.initializer.arguments.map(argument => normalize(argument.getText()))
        });
      }
    }
  });
  return found;
}

export function declaresType(query: ModuleQuery, typeName: string): boolean {
  let declared = false;
  eachNode(query, node => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) declared = true;
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) declared = true;
  });
  return declared;
}

export function typeAliasTarget(query: ModuleQuery, aliasName: string): string | null {
  let target: string | null = null;
  eachNode(query, node => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === aliasName) target = normalize(node.type.getText());
  });
  return target;
}

export function stringLiteralTypesIn(query: ModuleQuery, aliasName: string): string[] {
  const literals: string[] = [];
  eachNode(query, node => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== aliasName) return;
    walk(node.type, inner => {
      if (ts.isLiteralTypeNode(inner) && ts.isStringLiteral(inner.literal)) literals.push(inner.literal.text);
    });
  });
  return literals;
}

export function stringLiteralsIn(query: ModuleQuery, variableName: string): string[] {
  const literals: string[] = [];
  eachNode(query, node => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== variableName) return;
    if (!node.initializer) return;
    walk(node.initializer, inner => {
      if (ts.isStringLiteral(inner)) literals.push(inner.text);
    });
  });
  return literals;
}

export function comparisonUpperBounds(query: ModuleQuery, leftExpression: string): number[] {
  const bounds: number[] = [];
  eachNode(query, node => {
    if (!ts.isBinaryExpression(node)) return;
    if (node.operatorToken.kind !== ts.SyntaxKind.LessThanEqualsToken) return;
    if (normalize(node.left.getText()) !== leftExpression) return;
    if (ts.isNumericLiteral(node.right)) bounds.push(Number(node.right.text));
  });
  return bounds;
}

export function indexSignatures(query: ModuleQuery): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (ts.isIndexSignatureDeclaration(node)) found.push(normalize(node.getText()));
  });
  return found;
}

export function typeReferenceNames(query: ModuleQuery): string[] {
  const names: string[] = [];
  eachNode(query, node => {
    if (ts.isTypeReferenceNode(node)) names.push(normalize(node.typeName.getText()));
  });
  return names;
}

export function typeReferenceTexts(query: ModuleQuery): string[] {
  const texts: string[] = [];
  eachNode(query, node => {
    if (ts.isTypeReferenceNode(node) || ts.isIntersectionTypeNode(node)) texts.push(normalize(node.getText()));
  });
  return texts;
}

export function imports(query: ModuleQuery): ImportInfo[] {
  const found: ImportInfo[] = [];
  for (const statement of query.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const named: string[] = [];
    const bound: string[] = [];
    let namespaceName: string | null = null;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        named.push((element.propertyName ?? element.name).text);
        bound.push(element.name.text);
      }
    }
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaceName = clause.namedBindings.name.text;
    found.push({
      module: statement.moduleSpecifier.text,
      typeOnly: clause?.isTypeOnly === true,
      defaultName: clause?.name ? clause.name.text : null,
      namespaceName,
      named,
      bound
    });
  }
  return found;
}

export function importedModules(query: ModuleQuery): string[] {
  return imports(query).map(entry => entry.module);
}

export function requireSpecifiers(query: ModuleQuery): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "require") return;
    const first = node.arguments[0];
    if (first && ts.isStringLiteral(first)) found.push(first.text);
  });
  return found;
}

export function assertions(query: ModuleQuery): AssertionInfo[] {
  const found: AssertionInfo[] = [];
  eachNode(query, node => {
    if (!ts.isAsExpression(node)) return;
    found.push({
      expression: normalize(node.expression.getText()),
      type: typeText(node.type),
      toNever: node.type.kind === ts.SyntaxKind.NeverKeyword,
      throughUnknown: ts.isAsExpression(node.expression) && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
    });
  });
  return found;
}

function callInfo(node: ts.CallExpression): CallInfo {
  return {
    callee: normalize(node.expression.getText()),
    args: node.arguments.map(argument => normalize(argument.getText()))
  };
}

export function calls(query: ModuleQuery): CallInfo[] {
  const found: CallInfo[] = [];
  eachNode(query, node => {
    if (ts.isCallExpression(node)) found.push(callInfo(node));
  });
  return found;
}

export function callsWithin(query: ModuleQuery, functionName: string): CallInfo[] {
  const found: CallInfo[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName || !node.body) return;
    walk(node.body, inner => {
      if (ts.isCallExpression(inner)) found.push(callInfo(inner));
    });
  });
  return found;
}

export function constructedNames(query: ModuleQuery): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (ts.isNewExpression(node)) found.push(normalize(node.expression.getText()));
  });
  return found;
}

export function identifierNames(query: ModuleQuery): Set<string> {
  const names = new Set<string>();
  eachNode(query, node => {
    if (ts.isIdentifier(node)) names.add(node.text);
  });
  return names;
}

export function exportedTypeNames(query: ModuleQuery): string[] {
  const names: string[] = [];
  eachNode(query, node => {
    if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) return;
    const modifiers = ts.getModifiers(node) ?? [];
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return;
    names.push(node.name.text);
  });
  return names;
}

export type ComparisonInfo = {
  readonly left: string;
  readonly right: string;
  readonly operator: string;
  readonly line: number;
};

const COMPARISON_OPERATORS = new Set([
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken
]);

export function comparisons(query: ModuleQuery): ComparisonInfo[] {
  const found: ComparisonInfo[] = [];
  eachNode(query, node => {
    if (!ts.isBinaryExpression(node)) return;
    if (!COMPARISON_OPERATORS.has(node.operatorToken.kind)) return;
    found.push({
      left: node.left.getText(query.source),
      right: node.right.getText(query.source),
      operator: node.operatorToken.getText(query.source),
      line: query.source.getLineAndCharacterOfPosition(node.getStart(query.source)).line + 1
    });
  });
  return found;
}

export type ReExport = {
  readonly name: string;
  readonly module: string;
  readonly typeOnly: boolean;
};

export function reExports(query: ModuleQuery): ReExport[] {
  const found: ReExport[] = [];
  eachNode(query, node => {
    if (!ts.isExportDeclaration(node) || !node.moduleSpecifier) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const clause = node.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return;
    for (const element of clause.elements) {
      found.push({
        name: element.name.text,
        module: node.moduleSpecifier.text,
        typeOnly: node.isTypeOnly || element.isTypeOnly
      });
    }
  });
  return found;
}

export function returnedObjectProperties(query: ModuleQuery, functionName: string): string[] {
  const names: string[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName || !node.body) return;
    for (const statement of node.body.statements) {
      if (!ts.isReturnStatement(statement) || !statement.expression) continue;
      if (!ts.isObjectLiteralExpression(statement.expression)) continue;
      for (const property of statement.expression.properties) {
        if (property.name && ts.isIdentifier(property.name)) names.push(property.name.text);
      }
    }
  });
  return names;
}

export type MutationSite = {
  readonly path: string;
  readonly line: number;
};

export function mutatedPropertyPaths(query: ModuleQuery): MutationSite[] {
  const found: MutationSite[] = [];
  const record = (target: ts.Node): void => {
    if (!ts.isPropertyAccessExpression(target)) return;
    found.push({
      path: normalize(target.getText()),
      line: query.source.getLineAndCharacterOfPosition(target.getStart(query.source)).line + 1
    });
  };
  eachNode(query, node => {
    if (ts.isBinaryExpression(node)) {
      const writes = [
        ts.SyntaxKind.EqualsToken,
        ts.SyntaxKind.PlusEqualsToken,
        ts.SyntaxKind.MinusEqualsToken,
        ts.SyntaxKind.AsteriskEqualsToken,
        ts.SyntaxKind.SlashEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken
      ];
      if (writes.includes(node.operatorToken.kind)) record(node.left);
      return;
    }
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) record(node.operand);
    }
  });
  return found;
}

export function assignedProperties(query: ModuleQuery): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (ts.isPropertyAccessExpression(node.left)) found.push(normalize(node.left.getText()));
  });
  return found;
}

export function propertyValues(query: ModuleQuery, propertyName: string): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (!ts.isPropertyAssignment(node)) return;
    if (!ts.isIdentifier(node.name) || node.name.text !== propertyName) return;
    found.push(normalize(node.initializer.getText()));
  });
  return found;
}

export function compositionLayers(query: ModuleQuery, functionName: string): CompositionLayer[] {
  const layers: CompositionLayer[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName || !node.body) return;
    for (const statement of node.body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (!ts.isObjectLiteralExpression(declaration.initializer)) continue;
        const spreads: string[] = [];
        const properties: string[] = [];
        for (const property of declaration.initializer.properties) {
          if (ts.isSpreadAssignment(property)) {
            spreads.push(normalize(property.expression.getText()));
            continue;
          }
          if (property.name && ts.isIdentifier(property.name)) properties.push(property.name.text);
        }
        layers.push({ name: declaration.name.text, spreads, properties });
      }
    }
  });
  return layers;
}

export function returnedCallees(query: ModuleQuery, functionName: string): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== functionName || !node.body) return;
    walk(node.body, inner => {
      if (!ts.isReturnStatement(inner) || !inner.expression) return;
      if (ts.isCallExpression(inner.expression)) found.push(normalize(inner.expression.expression.getText()));
    });
  });
  return found;
}

export function namedObjectProperties(query: ModuleQuery, variableName: string): string[] {
  const names: string[] = [];
  eachNode(query, node => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== variableName) return;
    if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) return;
    for (const property of node.initializer.properties) {
      if (property.name && ts.isIdentifier(property.name)) names.push(property.name.text);
    }
  });
  return names;
}

export function defaultExportName(query: ModuleQuery): string | null {
  for (const statement of query.source.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    if (ts.isIdentifier(statement.expression)) return statement.expression.text;
  }
  return null;
}

export function topLevelFrozenExports(query: ModuleQuery): string[] {
  const frozen: string[] = [];
  for (const statement of query.source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (!ts.isCallExpression(declaration.initializer)) continue;
      if (normalize(declaration.initializer.expression.getText()) !== "Object.freeze") continue;
      frozen.push(declaration.name.text);
    }
  }
  return frozen;
}

export function arrowPropertyCount(query: ModuleQuery, propertyName: string): number {
  let total = 0;
  eachNode(query, node => {
    if (!ts.isPropertyAssignment(node)) return;
    if (!ts.isIdentifier(node.name) || node.name.text !== propertyName) return;
    if (ts.isArrowFunction(node.initializer)) total += 1;
  });
  return total;
}
