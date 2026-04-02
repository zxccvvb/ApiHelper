import * as vscode from 'vscode';

/** 是否为本项目 BFF 路由表文件（用于 /wscump/... 等路径的「转到定义」） */
export function isAppRouterFile(doc: vscode.TextDocument): boolean {
  const p = doc.uri.fsPath.replace(/\\/g, '/');
  return /\/app\/routers\/.+\.(js|ts)$/.test(p);
}

export function normalizePath(p: string): string {
  let s = p.trim();
  if (!s.startsWith('/')) {
    s = '/' + s;
  }
  return s;
}

export function expandToQuotedString(
  doc: vscode.TextDocument,
  pos: vscode.Position
): vscode.Range | undefined {
  const line = doc.lineAt(pos.line).text;
  const col = pos.character;
  const quoteChars = '\'"`';
  let q = '';
  let start = -1;
  for (let i = col; i >= 0; i--) {
    const c = line[i];
    if (quoteChars.includes(c)) {
      q = c;
      start = i;
      break;
    }
  }
  if (start < 0 || !q) {
    return undefined;
  }
  const endIdx = line.indexOf(q, start + 1);
  if (endIdx < 0) {
    return undefined;
  }
  return new vscode.Range(pos.line, start + 1, pos.line, endIdx);
}

/** Cmd+点击「转到定义」：光标需在含 /v2/ 的路径字符串或 url: 的值内 */
export function getApiPathAtPosition(
  doc: vscode.TextDocument,
  pos: vscode.Position
): { apiPath: string; originRange: vscode.Range } | undefined {
  const line = doc.lineAt(pos.line).text;
  const col = pos.character;

  const urlRe = /url\s*:\s*(['"])([^'"]*)\1/;
  const um = urlRe.exec(line);
  if (um && um.index !== undefined) {
    const value = um[2];
    const valueStart = line.indexOf(value, um.index);
    const valueEnd = valueStart + value.length;
    if (
      col >= valueStart &&
      col <= valueEnd &&
      value.includes('/v2/')
    ) {
      return {
        apiPath: normalizePath(value),
        originRange: new vscode.Range(
          pos.line,
          valueStart,
          pos.line,
          valueEnd
        )
      };
    }
  }

  const expand = expandToQuotedString(doc, pos);
  if (expand) {
    const t = doc.getText(expand).trim();
    if (t.includes('/v2/')) {
      return {
        apiPath: normalizePath(t),
        originRange: expand
      };
    }
  }

  /** app/routers 内：第二段 URL 常为 /wscump/...，不要求包含 /v2/ */
  if (isAppRouterFile(doc)) {
    const routerExpand = expandToQuotedString(doc, pos);
    if (routerExpand) {
      const t = doc.getText(routerExpand).trim();
      if (t.startsWith('/') && t.length > 1) {
        return {
          apiPath: normalizePath(t),
          originRange: routerExpand
        };
      }
    }
  }

  return undefined;
}

/** 从编辑器提取 /v2/... 形式的接口路径（命令面板用） */
export function extractApiPath(editor: vscode.TextEditor): string | undefined {
  const doc = editor.document;
  const sel = editor.selection;
  const selected = doc.getText(sel).trim();
  if (selected && selected.includes('/')) {
    return normalizePath(selected);
  }
  const pos = sel.active;
  const hit = getApiPathAtPosition(doc, pos);
  if (hit) {
    return hit.apiPath;
  }

  const line = doc.lineAt(pos.line).text;

  const urlProp = line.match(/url\s*:\s*['"]([^'"]+)['"]/);
  if (urlProp) {
    return normalizePath(urlProp[1]);
  }

  const quoted = line.match(/['"](\/v2\/[^'"]+)['"]/);
  if (quoted) {
    return normalizePath(quoted[1]);
  }

  const expandSel = expandToQuotedString(doc, pos);
  if (expandSel) {
    const t = doc.getText(expandSel).trim();
    if (t.startsWith('/')) {
      return normalizePath(t);
    }
  }

  return undefined;
}
