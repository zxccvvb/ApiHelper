import * as path from 'path';
import * as vscode from 'vscode';

export const ROUTER_GLOB = '**/app/routers/**/*.js';

export interface NodeRouteHit {
  routerUri: vscode.Uri;
  routerLine: number;
  controllerUri: vscode.Uri;
  handlerLine: number;
  httpMethod: string;
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

export function splitRouteElements(routeInner: string): string[] {
  const inner = routeInner.slice(1, -1).trim();
  const parts: string[] = [];
  let i = 0;
  let depth = 0;
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
      depth++;
    }
    if (c === ']') {
      depth--;
    }
    if (c === ',' && depth === 0) {
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

  const routerFiles = await vscode.workspace.findFiles(
    ROUTER_GLOB,
    '**/node_modules/**',
    500,
    token
  );

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

      const pathPart = parts[1].replace(/^['"]|['"]$/g, '');
      if (pathPart !== apiPath) {
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
  const routerFiles = await vscode.workspace.findFiles(
    ROUTER_GLOB,
    '**/node_modules/**',
    500,
    token
  );

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
      const pathPart = parts[1].replace(/^['"]|['"]$/g, '');
      if (!routePathMatchesFolderName(pathPart, folderName)) {
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
      const score = calcFolderRouteScore(pathPart, httpMethod, handlerMethod);

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
