import * as path from 'path';
import * as vscode from 'vscode';

function normalizeApiPath(apiPath: string): string {
  return apiPath.split('?')[0].replace(/\/+$/, '');
}

/** 从 /v2/ump/appointment-decoration 推导 folderName=appointment-decoration */
export function inferFolderNameFromApiPath(apiPath: string): string | null {
  const clean = normalizeApiPath(apiPath);
  const segments = clean.split('/').filter(Boolean);
  if (!segments.length) {
    return null;
  }
  const last = segments[segments.length - 1];
  return last || null;
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
  token?: vscode.CancellationToken
): Promise<vscode.Uri | null> {
  const folderName = inferFolderNameFromApiPath(apiPath);
  if (!folderName) {
    return null;
  }
  return findClientEntryByFolderName(folderName, token);
}
