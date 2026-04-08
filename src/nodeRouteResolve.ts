import * as path from 'path';
import * as vscode from 'vscode';

export const ROUTER_GLOBS = [
  '**/app/routers/**/*.{js,ts}',
  '**/app/routes/**/*.{js,ts}'
];

export interface NodeRouteHit {
  routerUri: vscode.Uri;
  routerLine: number;
  controllerUri: vscode.Uri;
  handlerLine: number;
  httpMethod: string;
}

export interface RouteTextHit {
  routerUri: vscode.Uri;
  routerLine: number;
}

async function findRouteFiles(
  token?: vscode.CancellationToken
): Promise<vscode.Uri[]> {
  const allFiles = await Promise.all(
    ROUTER_GLOBS.map((glob) =>
      vscode.workspace.findFiles(glob, '**/node_modules/**', 500, token)
    )
  );
  const dedup = new Map<string, vscode.Uri>();
  for (const files of allFiles) {
    for (const file of files) {
      dedup.set(file.fsPath, file);
    }
  }
  return [...dedup.values()];
}

function buildPathFallbackCandidates(apiPath: string): string[] {
  const normalized = apiPath.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    candidates.push(value);
  };

  push(normalized);
  if (normalized !== '/') {
    push(`${normalized}/*`);
  }

  const segments = normalized.split('/').filter(Boolean);
  while (segments.length > 1) {
    segments.pop();
    const base = `/${segments.join('/')}`;
    push(base);
    push(`${base}/*`);
  }

  return candidates;
}

function findQuotedPathIndex(content: string, pathValue: string): number {
  const needles = [`'${pathValue}'`, `"${pathValue}"`, `\`${pathValue}\``];
  let best = -1;
  for (const needle of needles) {
    const idx = content.indexOf(needle);
    if (idx < 0) {
      continue;
    }
    if (best < 0 || idx < best) {
      best = idx;
    }
  }
  return best;
}

export async function findPathTextInRouteFiles(
  apiPath: string,
  token?: vscode.CancellationToken
): Promise<RouteTextHit | undefined> {
  const routeFiles = await findRouteFiles(token);
  if (!routeFiles.length) {
    return undefined;
  }

  const candidates = buildPathFallbackCandidates(apiPath);
  for (const pathValue of candidates) {
    for (const uri of routeFiles) {
      if (token?.isCancellationRequested) {
        return undefined;
      }
      const content = (await vscode.workspace.fs.readFile(uri)).toString();
      const idx = findQuotedPathIndex(content, pathValue);
      if (idx < 0) {
        continue;
      }
      const line = content.slice(0, idx).split('\n').length;
      return {
        routerUri: uri,
        routerLine: line
      };
    }
  }
  return undefined;
}

function findRouteStartBefore(content: string, pathIndex: number): number {
  const before = content.slice(0, pathIndex);
  let lastStart = -1;
  const re = /\[\s*['"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    lastStart = m.index;
  }
  return lastStart;
}

export function extractBalancedRoute(
  content: string,
  routeStart: number
): string | null {
  let depth = 0;
  for (let i = routeStart; i < content.length; i++) {
    const c = content[i];
    if (c === '[') {
      depth++;
    }
    if (c === ']') {
      depth--;
      if (depth === 0) {
        return content.slice(routeStart, i + 1);
      }
    }
  }
  return null;
}

/**
 * 拆分 Astroboy 风格的路由数组元素：`[ 'GET', <path|registerApp(...)>, 'a.b', 'method' ]`
 * 需同时考虑 `[]` 与 `()` 的深度，否则 `registerApp(..., [ 'a', 'b' ])` 会在内层数组逗号处被错误切断。
 */
export function splitRouteElements(routeInner: string): string[] {
  const inner = routeInner.slice(1, -1).trim();
  const parts: string[] = [];
  let i = 0;
  let depthBracket = 0;
  let depthParen = 0;
  let start = 0;
  let inQuote = false;
  let quote = '';

  while (i < inner.length) {
    const c = inner[i];
    if (!inQuote && (c === '"' || c === "'")) {
      inQuote = true;
      quote = c;
      i++;
      continue;
    }
    if (inQuote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) {
        inQuote = false;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (c === '[') {
      depthBracket++;
    }
    if (c === ']') {
      depthBracket--;
    }
    if (c === '(') {
      depthParen++;
    }
    if (c === ')') {
      depthParen--;
    }
    if (c === ',' && depthBracket === 0 && depthParen === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

export function resolveControllerRef(
  third: string,
  routerFileContent: string
): string | null {
  const m = third.match(/^['"]([^'"]+)['"]$/);
  if (m) {
    return m[1];
  }
  const id = third.trim();
  if (!/^[\w$]+$/.test(id)) {
    return null;
  }
  const assignRe = new RegExp(
    `(?:const|let|var)\\s+${id}\\s*=\\s*['"]([^'"]+)['"]`,
    'm'
  );
  const am = routerFileContent.match(assignRe);
  return am ? am[1] : null;
}

export function extractHandlerMethod(fourth: string): string | null {
  const t = fourth.trim();
  if (t.startsWith('[')) {
    const quoted = [...t.matchAll(/'([^']*)'/g)].map((x) => x[1]);
    if (quoted.length) {
      return quoted[quoted.length - 1];
    }
    const dquoted = [...t.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    if (dquoted.length) {
      return dquoted[dquoted.length - 1];
    }
    return null;
  }
  const s = t.match(/^['"]([^'"]+)['"]$/);
  return s ? s[1] : null;
}

/**
 * Astroboy 引用 `lottery-code.IndexController` → `app/controllers/lottery-code/IndexController`
 * 实际文件可能是编译前的 `.ts` 或运行时的 `.js`，按存在性优先 `.ts` 再 `.js`
 */
export function controllerRefToDirAndBasename(
  workspaceRoot: string,
  controllerRef: string
): { dir: string; fileBase: string } | null {
  const dot = controllerRef.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const dir = controllerRef.slice(0, dot);
  const fileBase = controllerRef.slice(dot + 1);
  return {
    dir: path.join(workspaceRoot, 'app', 'controllers', dir),
    fileBase
  };
}

/** @deprecated 使用 resolveExistingControllerPath（支持 .ts / .js） */
export function controllerRefToPath(
  workspaceRoot: string,
  controllerRef: string
): string | null {
  const p = controllerRefToDirAndBasename(workspaceRoot, controllerRef);
  return p ? path.join(p.dir, `${p.fileBase}.js`) : null;
}

export async function resolveExistingControllerPath(
  workspaceRoot: string,
  controllerRef: string,
  token?: vscode.CancellationToken
): Promise<string | null> {
  const p = controllerRefToDirAndBasename(workspaceRoot, controllerRef);
  if (!p) {
    return null;
  }
  const extensions = ['.ts', '.js'];
  for (const ext of extensions) {
    if (token?.isCancellationRequested) {
      return null;
    }
    const fsPath = path.join(p.dir, `${p.fileBase}${ext}`);
    const uri = vscode.Uri.file(fsPath);
    try {
      const st = await vscode.workspace.fs.stat(uri);
      if (st.type === vscode.FileType.File) {
        return fsPath;
      }
    } catch {
      // try next extension
    }
  }
  return null;
}

export function findHandlerLine(content: string, methodName: string): number {
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*(?:async\\s+)?${escaped}\\s*\\(`, 'm');
  const m = content.match(re);
  if (m && m.index !== undefined) {
    return content.slice(0, m.index).split('\n').length;
  }
  const re2 = new RegExp(`\\b(?:async\\s+)?${escaped}\\s*\\s*\\(`, 'm');
  const m2 = content.match(re2);
  if (m2 && m2.index !== undefined) {
    return content.slice(0, m2.index).split('\n').length;
  }
  return 1;
}

/** 光标所在列属于哪一条「单行」路由数组（从 `[` 起算的 balanced `[...]`） */
export function findRouteStartOnLine(line: string, col: number): number {
  const indices: number[] = [];
  for (let i = 0; i <= col && i < line.length; i++) {
    if (line[i] === '[') {
      indices.push(i);
    }
  }
  for (let j = indices.length - 1; j >= 0; j--) {
    const start = indices[j];
    const routeStr = extractBalancedRoute(line, start);
    if (!routeStr) {
      continue;
    }
    const end = start + routeStr.length;
    if (col >= start && col < end) {
      return start;
    }
  }
  return -1;
}

export async function findRouteForPath(
  apiPath: string,
  token: vscode.CancellationToken
): Promise<NodeRouteHit | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  const root = folders[0].uri.fsPath;

  const routerFiles = await findRouteFiles(token);

  const needle1 = `'${apiPath}'`;
  const needle2 = `"${apiPath}"`;

  for (const uri of routerFiles) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const content = (await vscode.workspace.fs.readFile(uri)).toString();
    let searchFrom = 0;
    while (true) {
      const i1 = content.indexOf(needle1, searchFrom);
      const i2 = content.indexOf(needle2, searchFrom);
      let idx = -1;
      if (i1 >= 0 && i2 >= 0) {
        idx = Math.min(i1, i2);
      } else {
        idx = Math.max(i1, i2);
      }
      if (idx < 0) {
        break;
      }

      const routeStart = findRouteStartBefore(content, idx);
      if (routeStart < 0) {
        searchFrom = idx + 1;
        continue;
      }
      const routeStr = extractBalancedRoute(content, routeStart);
      if (!routeStr) {
        searchFrom = idx + 1;
        continue;
      }

      const parts = splitRouteElements(routeStr);
      if (parts.length < 4) {
        searchFrom = idx + 1;
        continue;
      }

      if (!routePathPartMatchesApiPath(parts[1], apiPath)) {
        searchFrom = idx + 1;
        continue;
      }

      const httpMethod = parts[0].replace(/^['"]|['"]$/g, '');
      const controllerRef = resolveControllerRef(parts[2], content);
      const handlerMethod = extractHandlerMethod(parts[3]);
      if (!controllerRef || !handlerMethod) {
        searchFrom = idx + 1;
        continue;
      }

      const controllerFs = await resolveExistingControllerPath(
        root,
        controllerRef,
        token
      );
      if (!controllerFs) {
        searchFrom = idx + 1;
        continue;
      }
      const controllerUri = vscode.Uri.file(controllerFs);

      const ctrlContent = (await vscode.workspace.fs.readFile(controllerUri)).toString();
      const handlerLine = findHandlerLine(ctrlContent, handlerMethod);

      const routeLine = content.slice(0, routeStart).split('\n').length;

      return {
        routerUri: uri,
        routerLine: routeLine,
        controllerUri,
        handlerLine,
        httpMethod
      };
    }
  }

  return undefined;
}

function routePathMatchesFolderName(routePath: string, folderName: string): boolean {
  const trimmed = routePath.split('?')[0].replace(/\/+$/, '');
  const segments = trimmed.split('/').filter(Boolean);
  if (!segments.length) {
    return false;
  }
  const last = segments[segments.length - 1];
  if (last === folderName) {
    return true;
  }

  // 典型路由：/v2/ump/<module>/...
  if (segments.length >= 3 && segments[0] === 'v2' && segments[1] === 'ump') {
    if (segments[2] === folderName) {
      return true;
    }
  }

  // 兼容 /wscump/<module>/...
  if (segments.length >= 2 && segments[0] === 'wscump') {
    if (segments[1] === folderName) {
      return true;
    }
  }

  return false;
}

function normalizeRouteComparePath(p: string): string {
  return p.split('?')[0].replace(/\/+$/, '') || '/';
}

function collectQuotedAbsolutePaths(snippet: string): string[] {
  const out: string[] = [];
  for (const m of snippet.matchAll(/['"](\/[^'"]*)['"]/g)) {
    out.push(m[1]);
  }
  return out;
}

/** `@scope/pkg/path` → `pkg/path`（与 client/route 下相对目录对齐） */
function microAppArgToRelativePath(arg: string): string {
  const m = arg.match(/^@[^/]+\/(.+)$/);
  return m ? m[1] : arg;
}

/**
 * 路由数组第二项：普通路径字符串或 `registerApp('@scope/app-path', ['/a', '/b'])`
 */
export function routePathPartMatchesApiPath(
  pathPart: string,
  apiPath: string
): boolean {
  const want = normalizeRouteComparePath(apiPath);
  const t = pathPart.trim();
  const simple = t.match(/^['"]([^'"]+)['"]$/);
  if (simple) {
    return normalizeRouteComparePath(simple[1]) === want;
  }
  if (/registerApp\s*\(/.test(t)) {
    for (const p of collectQuotedAbsolutePaths(t)) {
      if (normalizeRouteComparePath(p) === want) {
        return true;
      }
    }
  }
  return false;
}

export function routePathPartMatchesFolderName(
  pathPart: string,
  folderName: string
): boolean {
  const t = pathPart.trim();
  const simple = t.match(/^['"]([^'"]+)['"]$/);
  if (simple) {
    return routePathMatchesFolderName(simple[1], folderName);
  }
  if (/registerApp\s*\(/.test(t)) {
    const firstArgM = t.match(/registerApp\s*\(\s*['"]([^'"]+)['"]/);
    if (firstArgM) {
      const pkgPath = microAppArgToRelativePath(firstArgM[1]);
      if (pkgPath === folderName) {
        return true;
      }
      const segs = pkgPath.split('/');
      if (segs[segs.length - 1] === folderName) {
        return true;
      }
    }
    for (const p of collectQuotedAbsolutePaths(t)) {
      if (routePathMatchesFolderName(p, folderName)) {
        return true;
      }
    }
  }
  return false;
}

function calcFolderRouteScore(pathPart: string, httpMethod: string, handlerMethod: string): number {
  let score = 0;
  if (!pathPart.includes('/api/')) {
    score += 3;
  }
  if (httpMethod.toUpperCase() === 'GET') {
    score += 2;
  }
  if (/getindexhtml/i.test(handlerMethod)) {
    score += 2;
  }
  return score;
}

/**
 * 通过 client/route/<folderName> 的 folderName 反查 Node 路由。
 * 例如 folderName=appointment-decoration 命中 /v2/ump/appointment-decoration。
 */
export async function findRouteForFolderName(
  folderName: string,
  token: vscode.CancellationToken
): Promise<NodeRouteHit | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  const root = folders[0].uri.fsPath;
  const routerFiles = await findRouteFiles(token);

  let best: (NodeRouteHit & { score: number }) | undefined;

  for (const uri of routerFiles) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const content = (await vscode.workspace.fs.readFile(uri)).toString();
    const routeStartRe = /\[\s*['"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"]/gi;
    let startMatch: RegExpExecArray | null;
    while ((startMatch = routeStartRe.exec(content)) !== null) {
      const routeStart = startMatch.index;
      const routeStr = extractBalancedRoute(content, routeStart);
      if (!routeStr) {
        continue;
      }
      const parts = splitRouteElements(routeStr);
      if (parts.length < 4) {
        continue;
      }
      if (!routePathPartMatchesFolderName(parts[1], folderName)) {
        continue;
      }

      const httpMethod = parts[0].replace(/^['"]|['"]$/g, '');
      const controllerRef = resolveControllerRef(parts[2], content);
      const handlerMethod = extractHandlerMethod(parts[3]);
      if (!controllerRef || !handlerMethod) {
        continue;
      }
      const controllerFs = await resolveExistingControllerPath(
        root,
        controllerRef,
        token
      );
      if (!controllerFs) {
        continue;
      }
      const controllerUri = vscode.Uri.file(controllerFs);
      const ctrlContent = (await vscode.workspace.fs.readFile(controllerUri)).toString();
      const handlerLine = findHandlerLine(ctrlContent, handlerMethod);
      const routeLine = content.slice(0, routeStart).split('\n').length;
      const score = calcFolderRouteScore(parts[1], httpMethod, handlerMethod);

      const candidate: NodeRouteHit & { score: number } = {
        routerUri: uri,
        routerLine: routeLine,
        controllerUri,
        handlerLine,
        httpMethod,
        score
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return undefined;
  }
  const { score: _score, ...hit } = best;
  return hit;
}

/**
 * 二次兜底：`folderName` 与 Controller 引用前缀一致（如 financial-statement.IndexController），
 * 用于 micro-app 等多路径注册且仅用目录名检索的场景。
 */
export async function findRouteForControllerDirName(
  folderName: string,
  token: vscode.CancellationToken
): Promise<NodeRouteHit | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  const root = folders[0].uri.fsPath;
  const routerFiles = await findRouteFiles(token);

  let best: (NodeRouteHit & { score: number }) | undefined;
  const prefix = `${folderName}.`;

  for (const uri of routerFiles) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const content = (await vscode.workspace.fs.readFile(uri)).toString();
    const routeStartRe = /\[\s*['"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"]/gi;
    let startMatch: RegExpExecArray | null;
    while ((startMatch = routeStartRe.exec(content)) !== null) {
      const routeStart = startMatch.index;
      const routeStr = extractBalancedRoute(content, routeStart);
      if (!routeStr) {
        continue;
      }
      const parts = splitRouteElements(routeStr);
      if (parts.length < 4) {
        continue;
      }
      const controllerQuoted = parts[2].trim();
      const cq = controllerQuoted.match(/^['"]([^'"]+)['"]$/);
      const controllerPlain = cq ? cq[1] : '';
      if (!controllerPlain.startsWith(prefix)) {
        continue;
      }

      const httpMethod = parts[0].replace(/^['"]|['"]$/g, '');
      const controllerRef = resolveControllerRef(parts[2], content);
      const handlerMethod = extractHandlerMethod(parts[3]);
      if (!controllerRef || !handlerMethod) {
        continue;
      }
      const controllerFs = await resolveExistingControllerPath(
        root,
        controllerRef,
        token
      );
      if (!controllerFs) {
        continue;
      }
      const controllerUri = vscode.Uri.file(controllerFs);
      const ctrlContent = (await vscode.workspace.fs.readFile(controllerUri)).toString();
      const handlerLine = findHandlerLine(ctrlContent, handlerMethod);
      const routeLine = content.slice(0, routeStart).split('\n').length;
      const score = calcFolderRouteScore(parts[1], httpMethod, handlerMethod);

      const candidate: NodeRouteHit & { score: number } = {
        routerUri: uri,
        routerLine: routeLine,
        controllerUri,
        handlerLine,
        httpMethod,
        score
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return undefined;
  }
  const { score: _score, ...hit } = best;
  return hit;
}
