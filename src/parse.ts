import path from 'node:path';
import { parse, type ParserPlugin } from '@babel/parser';

export interface Location {
  line: number;
  column: number;
}

export interface RouteSite extends Location {
  path: string;
  start: number;
  end: number;
}

export interface ApiSite extends Location {
  kind: 'sendfile' | 'param' | 'del' | 'json' | 'send-status' | 'send-arity';
  detail?: string;
}

export interface QuerySite extends Location {
  kind: 'reassign' | 'mutate';
}

export interface IndexSite extends Location {
  index: string;
}

export interface FileFacts {
  parseError?: Location & { message: string };
  routes: RouteSite[];
  apis: ApiSite[];
  query: QuerySite[];
  paramsIndex: IndexSite[];
  body: Location[];
  hasBodyParser: boolean;
}

type Kind = 'express' | 'router' | 'app' | 'parser' | 'parser-ns' | 'value';

interface Scope {
  parent: Scope | null;
  functionScope: Scope;
  bindings: Map<string, Kind>;
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
}

const SKIP_KEYS = new Set([
  'type',
  'start',
  'end',
  'loc',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'errors',
  'tokens',
  'comments',
  'interpreter',
]);

const ROUTE_METHODS = new Set([
  'acl',
  'all',
  'bind',
  'checkout',
  'connect',
  'copy',
  'del',
  'delete',
  'get',
  'head',
  'link',
  'lock',
  'm-search',
  'merge',
  'mkactivity',
  'mkcol',
  'move',
  'notify',
  'options',
  'patch',
  'post',
  'propfind',
  'proppatch',
  'purge',
  'put',
  'query',
  'rebind',
  'report',
  'route',
  'search',
  'source',
  'subscribe',
  'trace',
  'unbind',
  'unlink',
  'unlock',
  'unsubscribe',
  'use',
]);

const PARSER_METHODS = new Set(['json', 'urlencoded', 'raw', 'text']);

function emptyFacts(): FileFacts {
  return {
    routes: [],
    apis: [],
    query: [],
    paramsIndex: [],
    body: [],
    hasBodyParser: false,
  };
}

function pluginsFor(filename: string): ParserPlugin[] {
  const extension = path.extname(filename);
  const plugins: ParserPlugin[] = [];
  if (extension === '.ts' || extension === '.tsx' || extension === '.mts' || extension === '.cts') {
    plugins.push('typescript');
  }
  if (extension === '.jsx' || extension === '.tsx') plugins.push('jsx');
  return plugins;
}

function createRootScope(): Scope {
  const scope = { parent: null, functionScope: null as unknown as Scope, bindings: new Map<string, Kind>() };
  scope.functionScope = scope;
  return scope;
}

function childScope(parent: Scope, isFunction: boolean): Scope {
  const scope: Scope = { parent, functionScope: null as unknown as Scope, bindings: new Map() };
  scope.functionScope = isFunction ? scope : parent.functionScope;
  return scope;
}

function lookup(scope: Scope | null, name: string): Kind | undefined {
  for (let current: Scope | null = scope; current; current = current.parent) {
    const kind = current.bindings.get(name);
    if (kind) return kind;
  }
  return undefined;
}

function assignBinding(scope: Scope, name: string, kind: Kind): void {
  for (let current: Scope | null = scope; current; current = current.parent) {
    if (current.bindings.has(name)) {
      current.bindings.set(name, kind);
      return;
    }
  }
  scope.bindings.set(name, kind);
}

function position(node: AstNode, code: string): Location {
  if (node.loc?.start) {
    return { line: node.loc.start.line, column: node.loc.start.column + 1 };
  }
  const prefix = code.slice(0, node.start ?? 0);
  const lines = prefix.split('\n');
  const last = lines[lines.length - 1] ?? '';
  return { line: lines.length, column: last.length + 1 };
}

function isNode(value: unknown): value is AstNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as AstNode).type === 'string';
}

function unwrap(node: AstNode | null | undefined): AstNode | null {
  let current = node ?? null;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'ParenthesizedExpression' ||
      current.type === 'ChainExpression')
  ) {
    current = isNode(current.expression) ? current.expression : null;
  }
  return current;
}

function propName(member: AstNode): string | null {
  const property = member.property;
  if (!isNode(property) && member.computed) return null;
  if (member.computed) {
    if (isNode(property) && property.type === 'StringLiteral' && typeof property.value === 'string') {
      return property.value;
    }
    return null;
  }
  if (isNode(property) && property.type === 'Identifier' && typeof property.name === 'string') return property.name;
  if (isNode(property) && property.type === 'StringLiteral' && typeof property.value === 'string') return property.value;
  return null;
}

function isIdentifierNamed(node: AstNode | null, ...names: string[]): boolean {
  return Boolean(node && node.type === 'Identifier' && typeof node.name === 'string' && names.includes(node.name));
}

function isReq(node: AstNode | null): boolean {
  return isIdentifierNamed(node, 'req', 'request');
}

function isRes(node: AstNode | null): boolean {
  return isIdentifierNamed(node, 'res', 'response');
}

function isConventionalAppName(name: string): boolean {
  return name === 'app' || name === 'application' || name === 'router' || name.endsWith('Router');
}

function moduleOfRequire(node: AstNode | null, scope: Scope): 'express' | 'body-parser' | undefined {
  if (!node || node.type !== 'CallExpression') return undefined;
  const callee = unwrap(isNode(node.callee) ? node.callee : null);
  if (!isIdentifierNamed(callee, 'require')) return undefined;
  if (lookup(scope, 'require')) return undefined;
  const args = node.arguments;
  if (!Array.isArray(args) || !isNode(args[0]) || args[0].type !== 'StringLiteral') return undefined;
  if (args[0].value === 'express' || args[0].value === 'body-parser') return args[0].value;
  return undefined;
}

function isFactoryCall(node: AstNode, scope: Scope): boolean {
  const callee = unwrap(isNode(node.callee) ? node.callee : null);
  if (!callee) return false;
  if (callee.type === 'Identifier' && typeof callee.name === 'string') {
    const kind = lookup(scope, callee.name);
    if (kind === 'express' || kind === 'router') return true;
    return moduleOfRequire(callee, scope) === 'express';
  }
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    if (propName(callee) !== 'Router') return false;
    const object = unwrap(isNode(callee.object) ? callee.object : null);
    if (!object) return false;
    if (object.type === 'Identifier' && typeof object.name === 'string' && lookup(scope, object.name) === 'express') {
      return true;
    }
    return moduleOfRequire(object, scope) === 'express';
  }
  return false;
}

function isParserCall(node: AstNode, scope: Scope): boolean {
  const callee = unwrap(isNode(node.callee) ? node.callee : null);
  if (!callee) return false;
  if (callee.type === 'Identifier' && typeof callee.name === 'string' && lookup(scope, callee.name) === 'parser') {
    return true;
  }
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return false;
  const name = propName(callee);
  if (!name || !PARSER_METHODS.has(name)) return false;
  const object = unwrap(isNode(callee.object) ? callee.object : null);
  if (!object) return false;
  if (object.type === 'Identifier' && typeof object.name === 'string') {
    const kind = lookup(scope, object.name);
    if (kind === 'express' || kind === 'parser-ns') return true;
  }
  const required = moduleOfRequire(object, scope);
  return required === 'express' || required === 'body-parser';
}

function kindOf(node: AstNode | null, scope: Scope): Kind | undefined {
  const value = unwrap(node);
  if (!value) return undefined;
  if (value.type === 'Identifier' && typeof value.name === 'string') return lookup(scope, value.name);
  if (value.type === 'CallExpression' || value.type === 'OptionalCallExpression') {
    if (isFactoryCall(value, scope)) return 'app';
    if (isParserCall(value, scope)) return 'parser';
  }
  return undefined;
}

function isAppReceiver(node: AstNode | null, scope: Scope): boolean {
  const value = unwrap(node);
  if (!value) return false;
  if (value.type === 'Identifier' && typeof value.name === 'string') {
    const kind = lookup(scope, value.name);
    if (kind === 'app') return true;
    if (kind === 'express' || kind === 'router' || kind === 'parser' || kind === 'parser-ns') return false;
    return isConventionalAppName(value.name);
  }
  if ((value.type === 'CallExpression' || value.type === 'OptionalCallExpression') && isFactoryCall(value, scope)) {
    return true;
  }
  return false;
}

function kindForImport(source: 'express' | 'body-parser', name: string): Kind | undefined {
  if (source === 'express') {
    if (name === 'Router') return 'router';
    if (name === 'default') return 'express';
    if (PARSER_METHODS.has(name)) return 'parser';
    return undefined;
  }
  if (PARSER_METHODS.has(name)) return 'parser';
  return undefined;
}

interface ObjectSpec {
  imported: string;
  local: string;
  value: AstNode;
  line: number;
  column: number;
}

function objectSpecs(pattern: AstNode, code: string): ObjectSpec[] {
  const properties = pattern.properties;
  if (!Array.isArray(properties)) return [];
  const specs: ObjectSpec[] = [];
  for (const property of properties) {
    if (!isNode(property) || property.type !== 'ObjectProperty') continue;
    const key = property.key;
    if (!isNode(key)) continue;
    let imported: string | null = null;
    if (!property.computed && key.type === 'Identifier' && typeof key.name === 'string') imported = key.name;
    else if (key.type === 'StringLiteral' && typeof key.value === 'string') imported = key.value;
    else if (key.type === 'NumericLiteral' && (typeof key.value === 'number' || typeof key.value === 'string')) {
      imported = String(key.value);
    }
    if (imported == null) continue;
    const value = isNode(property.value) ? property.value : property;
    const local = value.type === 'Identifier' && typeof value.name === 'string' ? value.name : imported;
    const at = position(value, code);
    specs.push({ imported, local, value, line: at.line, column: at.column });
  }
  return specs;
}

function bindPattern(pattern: AstNode | null, kind: Kind, scope: Scope): void {
  if (!pattern) return;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    scope.bindings.set(pattern.name, kind);
    return;
  }
  if (pattern.type === 'AssignmentPattern' && isNode(pattern.left)) {
    bindPattern(pattern.left, kind, scope);
    return;
  }
  if (pattern.type === 'RestElement' && isNode(pattern.argument)) {
    bindPattern(pattern.argument, 'value', scope);
    return;
  }
  if (pattern.type === 'TSParameterProperty' && isNode(pattern.parameter)) {
    bindPattern(pattern.parameter, kind, scope);
    return;
  }
  if (pattern.type === 'ObjectPattern' && Array.isArray(pattern.properties)) {
    for (const property of pattern.properties) {
      if (!isNode(property)) continue;
      if (property.type === 'RestElement' && isNode(property.argument)) bindPattern(property.argument, 'value', scope);
      else if (property.type === 'ObjectProperty' && isNode(property.value)) bindPattern(property.value, kind, scope);
    }
    return;
  }
  if (pattern.type === 'ArrayPattern' && Array.isArray(pattern.elements)) {
    for (const element of pattern.elements) {
      if (isNode(element)) bindPattern(element, 'value', scope);
    }
  }
}

function bindFromInit(id: AstNode, init: AstNode | null, scope: Scope, facts: FileFacts, code: string): void {
  noteDestructure(id, init, facts, code);
  const required = moduleOfRequire(unwrap(init), scope);
  if (required && id.type === 'Identifier' && typeof id.name === 'string') {
    scope.bindings.set(id.name, required === 'express' ? 'express' : 'parser-ns');
    return;
  }
  if (required && id.type === 'ObjectPattern') {
    for (const spec of objectSpecs(id, code)) {
      scope.bindings.set(spec.local, kindForImport(required, spec.imported) ?? 'value');
    }
    return;
  }
  const initKind = kindOf(init, scope);
  if (id.type === 'Identifier' && typeof id.name === 'string') {
    scope.bindings.set(id.name, initKind ?? 'value');
    return;
  }
  const unwrapped = unwrap(init);
  if (id.type === 'ObjectPattern' && unwrapped?.type === 'Identifier' && typeof unwrapped.name === 'string') {
    const namespace = lookup(scope, unwrapped.name);
    if (namespace === 'express' || namespace === 'parser-ns') {
      const source = namespace === 'express' ? 'express' : 'body-parser';
      for (const spec of objectSpecs(id, code)) {
        scope.bindings.set(spec.local, kindForImport(source, spec.imported) ?? 'value');
      }
      return;
    }
  }
  bindPattern(id, 'value', scope);
}

function isMember(node: AstNode | null): node is AstNode {
  return Boolean(node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression'));
}

function isQueryMember(node: AstNode | null): boolean {
  if (!isMember(node) || propName(node) !== 'query') return false;
  return isReq(unwrap(isNode(node.object) ? node.object : null));
}

function isBodyMember(node: AstNode | null): boolean {
  if (!isMember(node) || propName(node) !== 'body') return false;
  return isReq(unwrap(isNode(node.object) ? node.object : null));
}

function isParamsMember(node: AstNode | null): boolean {
  if (!isMember(node) || propName(node) !== 'params') return false;
  return isReq(unwrap(isNode(node.object) ? node.object : null));
}

function numericIndex(node: AstNode): string | null {
  if (!isMember(node) || !node.computed || !isNode(node.property)) return null;
  if (node.property.type === 'NumericLiteral' && typeof node.property.value === 'number') return String(node.property.value);
  if (node.property.type === 'StringLiteral' && typeof node.property.value === 'string' && /^\d+$/.test(node.property.value)) {
    return node.property.value;
  }
  return null;
}

function isAssignmentTarget(node: AstNode, parent: AstNode | null): boolean {
  return Boolean(parent && parent.type === 'AssignmentExpression' && parent.left === node);
}

function noteDestructure(id: AstNode, init: AstNode | null, facts: FileFacts, code: string): void {
  const value = unwrap(init);
  if (!value || id.type !== 'ObjectPattern') return;
  if (isReq(value)) {
    for (const spec of objectSpecs(id, code)) {
      if (spec.imported === 'body') facts.body.push({ line: spec.line, column: spec.column });
      if (spec.imported === 'params' && spec.value.type === 'ObjectPattern') {
        for (const inner of objectSpecs(spec.value, code)) {
          if (/^\d+$/.test(inner.imported)) facts.paramsIndex.push({ line: inner.line, column: inner.column, index: inner.imported });
        }
      }
    }
  }
  if (isParamsMember(value)) {
    for (const spec of objectSpecs(id, code)) {
      if (/^\d+$/.test(spec.imported)) facts.paramsIndex.push({ line: spec.line, column: spec.column, index: spec.imported });
    }
  }
}

interface LiteralSite {
  value: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

function literalsOf(node: AstNode | null, code: string): LiteralSite[] {
  const value = unwrap(node);
  if (!value) return [];
  if (value.type === 'StringLiteral' && typeof value.value === 'string') {
    const at = position(value, code);
    return [{ value: value.value, start: value.start, end: value.end, line: at.line, column: at.column }];
  }
  if (value.type === 'TemplateLiteral' && Array.isArray(value.expressions) && value.expressions.length === 0) {
    const quasis = value.quasis;
    const first = Array.isArray(quasis) && isNode(quasis[0]) ? quasis[0] : null;
    const cooked = first && typeof first.value === 'object' && first.value && 'cooked' in first.value ? first.value.cooked : null;
    if (typeof cooked !== 'string') return [];
    const at = position(value, code);
    return [{ value: cooked, start: value.start, end: value.end, line: at.line, column: at.column }];
  }
  if (value.type === 'ArrayExpression' && Array.isArray(value.elements)) {
    const sites: LiteralSite[] = [];
    for (const element of value.elements) {
      if (isNode(element)) sites.push(...literalsOf(element, code));
    }
    return sites;
  }
  return [];
}

function recordQueryWrite(node: AstNode, facts: FileFacts, code: string): void {
  const left = isNode(node.left) ? node.left : null;
  if (!left) return;
  const at = position(left, code);
  if (isQueryMember(left)) {
    facts.query.push({ kind: 'reassign', ...at });
    return;
  }
  if (isMember(left) && isQueryMember(unwrap(isNode(left.object) ? left.object : null))) {
    facts.query.push({ kind: 'mutate', ...at });
  }
}

function recordMember(node: AstNode, parent: AstNode | null, facts: FileFacts, code: string): void {
  if (isAssignmentTarget(node, parent)) return;
  const at = position(node, code);
  if (isBodyMember(node)) facts.body.push(at);
  const index = numericIndex(node);
  if (index != null && isParamsMember(unwrap(isNode(node.object) ? node.object : null))) {
    facts.paramsIndex.push({ ...at, index });
  }
}

function recordCall(node: AstNode, scope: Scope, facts: FileFacts, code: string): void {
  const callee = unwrap(isNode(node.callee) ? node.callee : null);
  if (!callee || (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression')) return;
  const method = propName(callee);
  if (!method) return;
  const object = isNode(callee.object) ? callee.object : null;
  const at = position(node, code);
  const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
  const spread = Array.isArray(node.arguments) && node.arguments.some((argument) => isNode(argument) && argument.type === 'SpreadElement');

  if (method === 'sendfile' && isRes(unwrap(object))) facts.apis.push({ kind: 'sendfile', ...at });
  if (method === 'param' && isReq(unwrap(object))) facts.apis.push({ kind: 'param', ...at });
  if (method === 'del' && isAppReceiver(object, scope)) facts.apis.push({ kind: 'del', ...at });
  if (method === 'json' && isRes(unwrap(object)) && !spread && args.length >= 2) facts.apis.push({ kind: 'json', ...at });
  if (method === 'send' && isRes(unwrap(object)) && !spread) {
    if (args.length >= 2) facts.apis.push({ kind: 'send-arity', ...at });
    else if (args.length === 1) {
      const argument = unwrap(args[0] ?? null);
      if (argument?.type === 'NumericLiteral') {
        facts.apis.push({ kind: 'send-status', detail: String(argument.value), ...at });
      } else if (
        argument?.type === 'Identifier' &&
        typeof argument.name === 'string' &&
        (argument.name === 'status' || argument.name === 'statusCode')
      ) {
        facts.apis.push({ kind: 'send-status', detail: argument.name, ...at });
      }
    }
  }

  if (!ROUTE_METHODS.has(method) || !isAppReceiver(object, scope)) return;
  const first = args[0];
  if (!first) return;
  for (const literal of literalsOf(first, code)) {
    facts.routes.push({
      path: literal.value,
      start: literal.start,
      end: literal.end,
      line: literal.line,
      column: literal.column,
    });
  }
}

function bindImport(node: AstNode, scope: Scope): void {
  if (node.type !== 'ImportDeclaration' || !isNode(node.source) || node.source.type !== 'StringLiteral') return;
  const source = node.source.value;
  const specifiers = Array.isArray(node.specifiers) ? node.specifiers.filter(isNode) : [];
  const typed = node.importKind === 'type';
  const known = source === 'express' || source === 'body-parser' ? source : null;
  for (const specifier of specifiers) {
    if (typed || specifier.importKind === 'type') {
      if (specifier.type !== 'ImportSpecifier' && specifier.type !== 'ImportDefaultSpecifier' && specifier.type !== 'ImportNamespaceSpecifier') {
        continue;
      }
      const local = specifier.local;
      if (isNode(local) && local.type === 'Identifier' && typeof local.name === 'string') scope.bindings.set(local.name, 'value');
      continue;
    }
    const local = specifier.local;
    if (!isNode(local) || local.type !== 'Identifier' || typeof local.name !== 'string') continue;
    if (!known) {
      scope.bindings.set(local.name, 'value');
      continue;
    }
    if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
      scope.bindings.set(local.name, known === 'express' ? 'express' : 'parser-ns');
      continue;
    }
    if (specifier.type === 'ImportSpecifier') {
      const imported = specifier.imported;
      const importedName =
        isNode(imported) && imported.type === 'Identifier' && typeof imported.name === 'string'
          ? imported.name
          : isNode(imported) && imported.type === 'StringLiteral' && typeof imported.value === 'string'
            ? imported.value
            : local.name;
      scope.bindings.set(local.name, kindForImport(known, importedName) ?? 'value');
    }
  }
}

function walkChildren(node: AstNode, scope: Scope, facts: FileFacts, code: string): void {
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) walkNode(child, scope, node, facts, code);
      }
    } else if (isNode(value)) {
      walkNode(value, scope, node, facts, code);
    }
  }
}

function walkNode(node: AstNode | null, scope: Scope, parent: AstNode | null, facts: FileFacts, code: string): void {
  if (!node) return;
  switch (node.type) {
    case 'File': {
      if (isNode(node.program)) walkNode(node.program, scope, node, facts, code);
      return;
    }
    case 'Program': {
      const body = Array.isArray(node.body) ? node.body : [];
      for (const statement of body) {
        if (isNode(statement)) walkNode(statement, scope, node, facts, code);
      }
      return;
    }
    case 'BlockStatement':
    case 'StaticBlock':
    case 'TSModuleBlock': {
      const child = childScope(scope, false);
      const body = Array.isArray(node.body) ? node.body : [];
      for (const statement of body) {
        if (isNode(statement)) walkNode(statement, child, node, facts, code);
      }
      return;
    }
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ObjectMethod':
    case 'ClassMethod':
    case 'ClassPrivateMethod': {
      if (node.type === 'FunctionDeclaration' && isNode(node.id) && node.id.type === 'Identifier' && typeof node.id.name === 'string') {
        scope.bindings.set(node.id.name, 'value');
      }
      const child = childScope(scope, true);
      const params = Array.isArray(node.params) ? node.params : [];
      for (const param of params) {
        if (isNode(param)) bindPattern(param, 'value', child);
      }
      if (isNode(node.body)) walkNode(node.body, child, node, facts, code);
      return;
    }
    case 'CatchClause': {
      const child = childScope(scope, false);
      if (isNode(node.param)) bindPattern(node.param, 'value', child);
      if (isNode(node.body)) walkNode(node.body, child, node, facts, code);
      return;
    }
    case 'ImportDeclaration': {
      bindImport(node, scope);
      return;
    }
    case 'TSImportEqualsDeclaration': {
      const reference = isNode(node.moduleReference) ? node.moduleReference : null;
      const id = isNode(node.id) ? node.id : null;
      if (!id || id.type !== 'Identifier' || typeof id.name !== 'string') return;
      if (reference?.type === 'TSExternalModuleReference' && isNode(reference.expression) && reference.expression.type === 'StringLiteral') {
        if (reference.expression.value === 'express') scope.bindings.set(id.name, 'express');
        else if (reference.expression.value === 'body-parser') scope.bindings.set(id.name, 'parser-ns');
        else scope.bindings.set(id.name, 'value');
        return;
      }
      scope.bindings.set(id.name, 'value');
      return;
    }
    case 'VariableDeclaration': {
      const target = node.kind === 'var' ? scope.functionScope : scope;
      const declarations = Array.isArray(node.declarations) ? node.declarations : [];
      for (const declaration of declarations) {
        if (!isNode(declaration)) continue;
        if (isNode(declaration.init)) walkNode(declaration.init, scope, declaration, facts, code);
        if (isNode(declaration.id)) bindFromInit(declaration.id, isNode(declaration.init) ? declaration.init : null, target, facts, code);
      }
      return;
    }
    case 'AssignmentExpression': {
      if (isNode(node.right)) walkNode(node.right, scope, node, facts, code);
      const rightKind = kindOf(isNode(node.right) ? node.right : null, scope);
      if (isNode(node.left) && node.left.type === 'Identifier' && typeof node.left.name === 'string' && rightKind && rightKind !== 'value') {
        assignBinding(scope, node.left.name, rightKind);
      } else if (isNode(node.left)) {
        walkNode(node.left, scope, node, facts, code);
      }
      recordQueryWrite(node, facts, code);
      return;
    }
    case 'CallExpression':
    case 'OptionalCallExpression': {
      if (isNode(node.callee)) walkNode(node.callee, scope, node, facts, code);
      if (Array.isArray(node.arguments)) {
        for (const argument of node.arguments) {
          if (isNode(argument)) walkNode(argument, scope, node, facts, code);
        }
      }
      recordCall(node, scope, facts, code);
      if (isParserCall(node, scope)) facts.hasBodyParser = true;
      return;
    }
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      recordMember(node, parent, facts, code);
      walkChildren(node, scope, facts, code);
      return;
    }
    default:
      walkChildren(node, scope, facts, code);
  }
}

export function analyzeSource(code: string, filename: string): FileFacts {
  const facts = emptyFacts();
  let ast: AstNode;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      sourceFilename: filename,
      plugins: pluginsFor(filename),
    }) as unknown as AstNode;
  } catch (error) {
    const loc = error && typeof error === 'object' && 'loc' in error ? (error as { loc?: { line?: number; column?: number } }).loc : undefined;
    facts.parseError = {
      line: loc?.line ?? 1,
      column: (loc?.column ?? 0) + 1,
      message: error instanceof Error ? error.message : String(error),
    };
    return facts;
  }
  const errors = ast.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: string; loc?: { line?: number; column?: number } };
    facts.parseError = {
      line: first.loc?.line ?? 1,
      column: (first.loc?.column ?? 0) + 1,
      message: first.message ?? 'Failed to parse file',
    };
  }
  walkNode(ast, createRootScope(), null, facts, code);
  return facts;
}
