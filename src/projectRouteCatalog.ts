import * as path from 'path';
import * as vscode from 'vscode';
import {
  findClientEntryByApiPaths,
  findClientEntryByFolderName,
  inferFolderNamesFromApiPath
} from './clientRouteResolve';
import {
  extractBalancedRoute,
  extractHandlerMethod,
  isHtmlHandlerMethod,
  resolveControllerRef,
  splitRouteElements
} from './nodeRouteResolve';

export type RouteCatalogItemType = 'page' | 'interface';

export interface RouteCatalogLeaf {
  routePath: string;
  fullPath: string;
  sourceFsPath: string;
  sourceRelativePath: string;
  sourceLine: number;
}

export interface RouteCatalogItem {
  id: string;
  type: RouteCatalogItemType;
  httpMethod: string;
  basePaths: string[];
  routerFsPath: string;
  routerRelativePath: string;
  routerLine: number;
  controllerRef: string | null;
  handlerMethod: string | null;
  folderCandidates: string[];
  clientEntryFsPath?: string;
  clientEntryRelativePath?: string;
  clientRoutes: RouteCatalogLeaf[];
  note: string;
}

export interface RouteCatalogResult {
  workspaceName: string;
  scanTargetLabel: string;
  items: RouteCatalogItem[];
}

const HTTP_METHOD_RE = /\[\s*['"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"]/gi;
const ROUTER_CATALOG_GLOB = '**/app/routers/**/*.js';

function getWorkspaceRoot(): { root: string; name: string } | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return null;
  }
  return {
    root: folders[0].uri.fsPath,
    name: folders[0].name
  };
}

async function findCatalogRouterFiles(
  token?: vscode.CancellationToken
): Promise<vscode.Uri[]> {
  const files = await vscode.workspace.findFiles(
    ROUTER_CATALOG_GLOB,
    '**/node_modules/**',
    undefined,
    token
  );
  return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

function toLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function normalizeRoutePath(routePath: string): string {
  const trimmed = routePath.trim();
  if (!trimmed) {
    return '/';
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return `/${trimmed}`;
}

function extractBasePaths(pathPart: string): string[] {
  const text = pathPart.trim();
  const simple = text.match(/^['"`]([^'"`]+)['"`]$/);
  if (simple) {
    return [simple[1]];
  }
  const paths = [...text.matchAll(/['"`](\/[^'"`]*)['"`]/g)].map((match) => match[1]);
  return [...new Set(paths)];
}

function extractRegisterAppFolder(pathPart: string): string | undefined {
  const match = pathPart.match(/registerApp\s*\(\s*['"`]@[^/]+\/(.+?)['"`]/);
  return match?.[1];
}

function extractControllerFolder(controllerRef: string | null): string | undefined {
  if (!controllerRef) {
    return undefined;
  }
  const dotIndex = controllerRef.lastIndexOf('.');
  if (dotIndex <= 0) {
    return undefined;
  }
  return controllerRef.slice(0, dotIndex);
}

function buildFolderCandidates(
  basePaths: string[],
  controllerRef: string | null,
  handlerMethod: string | null,
  pathPart: string
): string[] {
  const registerAppFolder = extractRegisterAppFolder(pathPart);
  const isPageLike = !!registerAppFolder || isHtmlHandlerMethod(handlerMethod);
  const candidates = [
    registerAppFolder,
    ...(isPageLike ? [extractControllerFolder(controllerRef)] : []),
    ...(isPageLike ? basePaths.flatMap((item) => inferFolderNamesFromApiPath(item)) : [])
  ];
  const seen = new Set<string>();
  return candidates.filter((item): item is string => {
    if (!item || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

async function resolveClientEntry(
  basePaths: string[],
  preferredFolderName: string | undefined,
  folderCandidates: string[],
  handlerMethod: string | null,
  token?: vscode.CancellationToken
): Promise<{ fsPath: string; relativePath: string } | undefined> {
  const apiMatchedUri = await findClientEntryByApiPaths(
    basePaths,
    token,
    preferredFolderName,
    handlerMethod || undefined
  );
  if (apiMatchedUri) {
    return {
      fsPath: apiMatchedUri.fsPath,
      relativePath: vscode.workspace.asRelativePath(apiMatchedUri)
    };
  }

  for (const folderName of folderCandidates) {
    if (token?.isCancellationRequested) {
      return undefined;
    }
    const uri = await findClientEntryByFolderName(folderName, token);
    if (uri) {
      return {
        fsPath: uri.fsPath,
        relativePath: vscode.workspace.asRelativePath(uri)
      };
    }
  }
  return undefined;
}

function extractPathsFromRouteTag(routeTag: string): string[] {
  const quoted = routeTag.match(/\bpath\s*=\s*(['"`])([^'"`]+)\1/);
  if (quoted) {
    return [normalizeRoutePath(quoted[2])];
  }

  const brace = routeTag.match(/\bpath\s*=\s*\{([\s\S]*?)\}/);
  if (!brace) {
    return [];
  }

  const paths = [...brace[1].matchAll(/['"`](\/[^'"`]*)['"`]/g)].map((match) =>
    normalizeRoutePath(match[1])
  );
  return [...new Set(paths)];
}

function extractBalancedArray(content: string, start: number): string | null {
  let depth = 0;
  let inQuote = false;
  let quote = '';

  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inQuote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) {
        inQuote = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inQuote = true;
      quote = ch;
      continue;
    }
    if (ch === '[') {
      depth++;
      continue;
    }
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }

  return null;
}

function collectStaticPathConstants(content: string): Map<string, string> {
  const constants = new Map<string, string>();
  const constRe =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")\s*;/g;

  let match: RegExpExecArray | null;
  while ((match = constRe.exec(content)) !== null) {
    const [, name, rawValue] = match;
    constants.set(name, rawValue.slice(1, -1));
  }

  return constants;
}

function extractRouteListPaths(
  content: string,
  entryFsPath: string,
  relativePath: string
): RouteCatalogLeaf[] {
  const items: RouteCatalogLeaf[] = [];
  const seen = new Set<string>();
  const constants = collectStaticPathConstants(content);
  const routeListRe = /\b(?:const|let|var)\s+routeList\s*=\s*\[/g;
  const pathValueRe =
    /\bpath\s*:\s*([A-Za-z_$][\w$]*|`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g;

  let routeListMatch: RegExpExecArray | null;
  while ((routeListMatch = routeListRe.exec(content)) !== null) {
    const arrayStart = content.indexOf('[', routeListMatch.index);
    if (arrayStart < 0) {
      continue;
    }
    const routeListBlock = extractBalancedArray(content, arrayStart);
    if (!routeListBlock) {
      continue;
    }

    let pathMatch: RegExpExecArray | null;
    while ((pathMatch = pathValueRe.exec(routeListBlock)) !== null) {
      const rawValue = pathMatch[1].trim();
      let routePath: string | undefined;

      if (/^['"`]/.test(rawValue)) {
        routePath = rawValue.slice(1, -1);
      } else {
        routePath = constants.get(rawValue);
      }

      if (!routePath) {
        continue;
      }

      const normalized = normalizeRoutePath(routePath);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      items.push({
        routePath: normalized,
        fullPath: normalized,
        sourceFsPath: entryFsPath,
        sourceRelativePath: relativePath,
        sourceLine: toLineNumber(content, arrayStart + pathMatch.index)
      });
    }
  }

  return items;
}

async function parseClientRoutes(
  entryFsPath: string,
  token?: vscode.CancellationToken
): Promise<RouteCatalogLeaf[]> {
  if (token?.isCancellationRequested) {
    return [];
  }

  const entryUri = vscode.Uri.file(entryFsPath);
  const content = (await vscode.workspace.fs.readFile(entryUri)).toString();
  const relativePath = vscode.workspace.asRelativePath(entryUri);
  const routeTagRe = /<Route\b[\s\S]*?\/>/g;
  const items: RouteCatalogLeaf[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = routeTagRe.exec(content)) !== null) {
    if (token?.isCancellationRequested) {
      return items;
    }

    const routeTag = match[0];
    const routePaths = extractPathsFromRouteTag(routeTag);
    if (!routePaths.length) {
      continue;
    }

    const line = toLineNumber(content, match.index);
    for (const routePath of routePaths) {
      if (seen.has(routePath)) {
        continue;
      }
      seen.add(routePath);
      items.push({
        routePath,
        fullPath: routePath,
        sourceFsPath: entryFsPath,
        sourceRelativePath: relativePath,
        sourceLine: line
      });
    }
  }

  for (const route of extractRouteListPaths(content, entryFsPath, relativePath)) {
    if (seen.has(route.routePath)) {
      continue;
    }
    seen.add(route.routePath);
    items.push(route);
  }

  return items;
}

function buildRouteNote(
  type: RouteCatalogItemType,
  clientEntryRelativePath?: string
): string {
  if (type === 'page') {
    return clientEntryRelativePath
      ? `已按 Html 路由识别，并找到前端入口：${clientEntryRelativePath}`
      : '已按 Html 路由识别，但未找到前端入口';
  }
  return 'handler 非 Html，按接口展示';
}

function buildLeafRoutes(basePaths: string[], clientRoutes: RouteCatalogLeaf[]): RouteCatalogLeaf[] {
  const result: RouteCatalogLeaf[] = [];
  const seen = new Set<string>();

  for (const basePath of basePaths) {
    for (const clientRoute of clientRoutes) {
      const fullPath = `${basePath}#${clientRoute.routePath}`;
      if (seen.has(fullPath)) {
        continue;
      }
      seen.add(fullPath);
      result.push({
        ...clientRoute,
        fullPath
      });
    }
  }

  return result;
}

export async function scanProjectRouteCatalog(
  token?: vscode.CancellationToken
): Promise<RouteCatalogResult> {
  const workspace = getWorkspaceRoot();
  if (!workspace) {
    throw new Error('未找到工作区');
  }

  const routerFiles = await findCatalogRouterFiles(token);
  const items: RouteCatalogItem[] = [];

  for (const routerUri of routerFiles) {
    if (token?.isCancellationRequested) {
      break;
    }

    const routerFsPath = routerUri.fsPath;
    const routerRelativePath = vscode.workspace.asRelativePath(routerUri);
    const preferredFolderName = path.basename(routerFsPath, path.extname(routerFsPath));
    const routerContent = (await vscode.workspace.fs.readFile(routerUri)).toString();
    const routeStartRe = new RegExp(HTTP_METHOD_RE.source, HTTP_METHOD_RE.flags);

    let routeMatch: RegExpExecArray | null;
    while ((routeMatch = routeStartRe.exec(routerContent)) !== null) {
      if (token?.isCancellationRequested) {
        break;
      }

      const routeStart = routeMatch.index;
      const routeBlock = extractBalancedRoute(routerContent, routeStart);
      if (!routeBlock) {
        continue;
      }

      const parts = splitRouteElements(routeBlock);
      if (parts.length < 4) {
        continue;
      }

      const basePaths = extractBasePaths(parts[1]);
      if (!basePaths.length) {
        continue;
      }

      const controllerRef = resolveControllerRef(parts[2], routerContent);
      const handlerMethod = extractHandlerMethod(parts[3]);
      const isRouteLike = isHtmlHandlerMethod(handlerMethod);
      const folderCandidates = buildFolderCandidates(
        basePaths,
        controllerRef,
        handlerMethod,
        parts[1]
      );
      const clientEntry = isRouteLike
        ? await resolveClientEntry(
          basePaths,
          preferredFolderName,
          folderCandidates,
          handlerMethod,
          token
        )
        : undefined;
      const clientRouteDefs = clientEntry
        ? await parseClientRoutes(clientEntry.fsPath, token)
        : [];
      const clientRoutes = buildLeafRoutes(basePaths, clientRouteDefs);

      const type: RouteCatalogItemType = isRouteLike ? 'page' : 'interface';

      items.push({
        id: `route-${items.length + 1}`,
        type,
        httpMethod: parts[0].replace(/^['"`]|['"`]$/g, ''),
        basePaths,
        routerFsPath,
        routerRelativePath,
        routerLine: toLineNumber(routerContent, routeStart),
        controllerRef,
        handlerMethod,
        folderCandidates,
        clientEntryFsPath: clientEntry?.fsPath,
        clientEntryRelativePath: clientEntry?.relativePath,
        clientRoutes,
        note: buildRouteNote(type, clientEntry?.relativePath)
      });
    }
  }

  return {
    workspaceName: workspace.name,
    scanTargetLabel: 'app/routers/**/*.js',
    items
  };
}
