import * as path from 'path';
import * as vscode from 'vscode';

function normalizeApiPath(apiPath: string): string {
  return apiPath.split('?')[0].replace(/\/+$/, '');
}

function normalizeFolderSegment(segment: string): string {
  return segment.trim().replace(/-/g, '');
}

function dedupeList(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function expandFolderNameVariants(folderName: string): string[] {
  const normalized = folderName
    .split('/')
    .filter(Boolean)
    .map((segment) => normalizeFolderSegment(segment))
    .join('/');
  return dedupeList([folderName, normalized]);
}

function inferSubFoldersFromHandlerMethod(handlerMethod?: string): string[] {
  if (!handlerMethod) {
    return [];
  }
  const match = handlerMethod.match(/^get([A-Z][A-Za-z0-9]*)Html$/);
  if (!match) {
    return [];
  }
  const rawName = match[1];
  if (/^index$/i.test(rawName)) {
    return ['list', 'index'];
  }
  const kebab = rawName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  return dedupeList([kebab, normalizeFolderSegment(kebab)]);
}

/**
 * 从 API 路径推导可能的前端 route 目录名（按优先级返回）。
 * - /v2/ump/<module>/... => 优先 <module>
 * - /erp/a/b => 兼容 a/b 这种多级目录
 * - 兜底：最后一段
 */
export function inferFolderNamesFromApiPath(apiPath: string): string[] {
  const clean = normalizeApiPath(apiPath);
  const segments = clean.split('/').filter(Boolean);
  if (!segments.length) {
    return [];
  }

  const candidates: string[] = [];
  // 典型场景：/v2/ump/<module>/...
  if (segments.length >= 3 && segments[0] === 'v2' && segments[1] === 'ump') {
    candidates.push(segments[2]);
    for (let i = 2; i < segments.length; i++) {
      candidates.push(segments.slice(i).join('/'));
    }
  } else if (segments.length >= 2) {
    for (let i = 1; i < segments.length; i++) {
      candidates.push(segments.slice(i).join('/'));
    }
  }

  const last = segments[segments.length - 1];
  if (last) {
    candidates.push(last);
  }

  return dedupeList(candidates.flatMap((name) => expandFolderNameVariants(name)));
}

function buildFolderNamesForLookup(
  apiPath: string,
  preferredFolderName?: string,
  handlerMethod?: string
): string[] {
  const apiDerivedNames = inferFolderNamesFromApiPath(apiPath);
  const preferredNames = preferredFolderName
    ? expandFolderNameVariants(preferredFolderName)
    : [];
  const baseFolderNames = dedupeList([
    ...preferredNames,
    ...apiDerivedNames.filter((name) => !name.includes('/'))
  ]);
  const subFolders = inferSubFoldersFromHandlerMethod(handlerMethod);
  const handlerDerivedNames = baseFolderNames.flatMap((baseName) =>
    subFolders.flatMap((subFolder) =>
      expandFolderNameVariants(`${baseName}/${subFolder}`)
    )
  );

  return dedupeList([
    ...preferredNames,
    ...handlerDerivedNames,
    ...apiDerivedNames
  ]);
}

/**
 * 根据前端路由目录名查找入口文件，优先 app.tsx / app.jsx。
 * 命中后返回目标文件 URI（用于 DefinitionProvider 跳转）。
 */
export async function findClientEntryByFolderName(
  folderName: string,
  token?: vscode.CancellationToken
): Promise<vscode.Uri | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return null;
  }
  const root = folders[0].uri.fsPath;
  const candidates = ['app.tsx', 'app.jsx', 'app.ts', 'app.js', 'main.tsx', 'main.jsx', 'main.ts', 'main.js'];

  for (const folderVariant of expandFolderNameVariants(folderName)) {
    for (const fileName of candidates) {
      if (token?.isCancellationRequested) {
        return null;
      }
      const fsPath = path.join(root, 'client', 'route', folderVariant, fileName);
      const uri = vscode.Uri.file(fsPath);
      try {
        const st = await vscode.workspace.fs.stat(uri);
        if (st.type === vscode.FileType.File) {
          return uri;
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

export async function findClientEntryByApiPath(
  apiPath: string,
  token?: vscode.CancellationToken,
  preferredFolderName?: string,
  handlerMethod?: string
): Promise<vscode.Uri | null> {
  const folderNames = buildFolderNamesForLookup(
    apiPath,
    preferredFolderName,
    handlerMethod
  );

  const tried = new Set<string>();
  for (const folderName of folderNames) {
    if (!folderName || tried.has(folderName)) {
      continue;
    }
    tried.add(folderName);
    const uri = await findClientEntryByFolderName(folderName, token);
    if (uri) {
      return uri;
    }
  }
  return null;
}

export async function findClientEntryByApiPaths(
  apiPaths: string[],
  token?: vscode.CancellationToken,
  preferredFolderName?: string,
  handlerMethod?: string
): Promise<vscode.Uri | null> {
  const tried = new Set<string>();

  for (const apiPath of apiPaths) {
    const normalized = normalizeApiPath(apiPath);
    if (!normalized || tried.has(normalized)) {
      continue;
    }
    tried.add(normalized);

    const uri = await findClientEntryByApiPath(
      normalized,
      token,
      preferredFolderName,
      handlerMethod
    );
    if (uri) {
      return uri;
    }
  }

  return null;
}
