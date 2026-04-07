import * as path from 'path';
import * as vscode from 'vscode';

function normalizeApiPath(apiPath: string): string {
  return apiPath.split('?')[0].replace(/\/+$/, '');
}

/**
 * 从 API 路径推导可能的前端 route 目录名（按优先级返回）。
 * - /v2/ump/<module>/... => 优先 <module>
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
  }

  const last = segments[segments.length - 1];
  if (last) {
    candidates.push(last);
  }

  const seen = new Set<string>();
  return candidates.filter((name) => {
    if (!name || seen.has(name)) {
      return false;
    }
    seen.add(name);
    return true;
  });
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

  for (const fileName of candidates) {
    if (token?.isCancellationRequested) {
      return null;
    }
    const fsPath = path.join(root, 'client', 'route', folderName, fileName);
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
  return null;
}

export async function findClientEntryByApiPath(
  apiPath: string,
  token?: vscode.CancellationToken,
  preferredFolderName?: string
): Promise<vscode.Uri | null> {
  const folderNames: string[] = [
    ...inferFolderNamesFromApiPath(apiPath)
  ];
  if (preferredFolderName) {
    folderNames.push(preferredFolderName);
  }

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
