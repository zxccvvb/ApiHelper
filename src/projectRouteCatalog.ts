import * as path from 'path';
import * as vscode from 'vscode';
import {
  findClientEntryByFolderName,
  inferFolderNamesFromApiPath
} from './clientRouteResolve';
import {
  extractBalancedRoute,
  extractHandlerMethod,
  resolveControllerRef,
  splitRouteElements
} from './nodeRouteResolve';

export type RouteCatalogItemType = 'page' | 'interface' | 'backend-interface';

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
  routerFileRelativePath: string;
  items: RouteCatalogItem[];
}

const HTTP_METHOD_RE = /\[\s*['"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"]/gi;

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
  const isPageLike = !!registerAppFolder || !!(handlerMethod && /^getindexhtml$/i.test(handlerMethod));
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
  folderCandidates: string[],
  token?: vscode.CancellationToken
): Promise<{ fsPath: string; relativePath: string } | undefined> {
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

  return items;
}

function buildRouteNote(type: RouteCatalogItemType, clientEntryRelativePath?: string): string {
  if (type === 'page') {
    return clientEntryRelativePath
      ? `已找到页面入口：${clientEntryRelativePath}`
      : '已找到页面入口';
  }
  if (type === 'interface') {
    return '路由指向 getIndexHtml，但未找到前端页面注册，按接口展示';
  }
  return '未识别到页面入口，按后端接口展示';
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

  const defaultRouterFsPath = path.join(workspace.root, 'app', 'routers', 'default.js');
  const defaultRouterUri = vscode.Uri.file(defaultRouterFsPath);
  const defaultRouterContent = (await vscode.workspace.fs.readFile(defaultRouterUri)).toString();
  const items: RouteCatalogItem[] = [];

  let routeMatch: RegExpExecArray | null;
  while ((routeMatch = HTTP_METHOD_RE.exec(defaultRouterContent)) !== null) {
    if (token?.isCancellationRequested) {
      break;
    }

    const routeStart = routeMatch.index;
    const routeBlock = extractBalancedRoute(defaultRouterContent, routeStart);
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

    const controllerRef = resolveControllerRef(parts[2], defaultRouterContent);
    const handlerMethod = extractHandlerMethod(parts[3]);
    const folderCandidates = buildFolderCandidates(
      basePaths,
      controllerRef,
      handlerMethod,
      parts[1]
    );
    const clientEntry = await resolveClientEntry(folderCandidates, token);
    const clientRouteDefs = clientEntry
      ? await parseClientRoutes(clientEntry.fsPath, token)
      : [];
    const clientRoutes = buildLeafRoutes(basePaths, clientRouteDefs);

    let type: RouteCatalogItemType = 'page';
    if (!clientRoutes.length) {
      type = handlerMethod && /^getindexhtml$/i.test(handlerMethod)
        ? 'interface'
        : 'backend-interface';
    }

    items.push({
      id: `route-${items.length + 1}`,
      type,
      httpMethod: parts[0].replace(/^['"`]|['"`]$/g, ''),
      basePaths,
      routerFsPath: defaultRouterFsPath,
      routerRelativePath: vscode.workspace.asRelativePath(defaultRouterUri),
      routerLine: toLineNumber(defaultRouterContent, routeStart),
      controllerRef,
      handlerMethod,
      folderCandidates,
      clientEntryFsPath: clientEntry?.fsPath,
      clientEntryRelativePath: clientEntry?.relativePath,
      clientRoutes,
      note: buildRouteNote(type, clientEntry?.relativePath)
    });
  }

  return {
    workspaceName: workspace.name,
    routerFileRelativePath: vscode.workspace.asRelativePath(defaultRouterUri),
    items
  };
}
