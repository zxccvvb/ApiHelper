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

function extractApiLikeLiteral(value: string): string | undefined {
  const matches = [...value.matchAll(/['"`](\/(?:v2|wscump)\/[^'"`]*)['"`]/g)];
  return matches[0]?.[1];
}

function collectConstExpressions(content: string): Map<string, string> {
  const expressions = new Map<string, string>();
  const constRe =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  let match: RegExpExecArray | null;
  while ((match = constRe.exec(content)) !== null) {
    expressions.set(match[1], match[2].trim());
  }
  return expressions;
}

function resolveApiPathFromExpression(
  expression: string,
  expressions: Map<string, string>,
  visited = new Set<string>()
): string | undefined {
  const trimmed = expression.trim();
  const direct = extractApiLikeLiteral(trimmed);
  if (direct) {
    return normalizePath(direct);
  }

  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    if (visited.has(trimmed)) {
      return undefined;
    }
    const next = expressions.get(trimmed);
    if (!next) {
      return undefined;
    }
    visited.add(trimmed);
    return resolveApiPathFromExpression(next, expressions, visited);
  }

  return undefined;
}

function resolveApiPathFromIdentifier(
  doc: vscode.TextDocument,
  identifier: string
): string | undefined {
  const expressions = collectConstExpressions(doc.getText());
  const expression = expressions.get(identifier);
  if (!expression) {
    return undefined;
  }
  return resolveApiPathFromExpression(expression, expressions);
}

function getIdentifierAtPosition(
  doc: vscode.TextDocument,
  pos: vscode.Position
): { text: string; range: vscode.Range } | undefined {
  const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_$][\w$]*/);
  if (!range) {
    return undefined;
  }
  return {
    text: doc.getText(range),
    range
  };
}

function normalizeApiLikePath(p: string): string {
  const noQueryOrHash = p.split(/[?#]/)[0];
  const normalized = normalizePath(noQueryOrHash);
  return normalized.replace(/\/+$/, '') || '/';
}

/**
 * 解析输入值为接口路径：
 * - 支持完整 URL（任意域名，如 https://foo.com/v2/ump/mobile-order#...）
 * - 支持 domain/path 形式（如 store.youzan.com/v2/ump/mobile-order）
 * - 支持直接输入 /v2/... 路径
 */
export function parseApiPathFromInput(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) {
    return undefined;
  }

  const asPath = (): string | undefined => {
    if (raw.startsWith('/')) {
      return normalizeApiLikePath(raw);
    }
    const slashIdx = raw.indexOf('/');
    if (slashIdx > 0) {
      return normalizeApiLikePath(raw.slice(slashIdx));
    }
    return undefined;
  };

  try {
    const asUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(asUrl);
    if (parsed.pathname && parsed.pathname !== '/') {
      return normalizeApiLikePath(parsed.pathname);
    }
  } catch {
    // fallback to path parse
  }

  return asPath();
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

  const identifier = getIdentifierAtPosition(doc, pos);
  if (identifier) {
    const resolvedPath = resolveApiPathFromIdentifier(doc, identifier.text);
    if (resolvedPath) {
      return {
        apiPath: resolvedPath,
        originRange: identifier.range
      };
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

  const identifier = getIdentifierAtPosition(doc, pos);
  if (identifier) {
    return resolveApiPathFromIdentifier(doc, identifier.text);
  }

  return undefined;
}

/**
 * 从当前文件路径提取 client/route 下的「应用路径」（相对 route 目录，可含多级目录）。
 * 例如 financial-statement/app.tsx → financial-statement；
 * life/business-overview/foo.tsx → life/business-overview
 */
export function extractRouteFolderName(
  editor: vscode.TextEditor
): string | undefined {
  const fsPath = editor.document.uri.fsPath.replace(/\\/g, '/');
  const m = fsPath.match(
    /\/client\/route\/((?:[^/]+(?:\/[^/]+)*))\/[^/]+\.(tsx|jsx|ts|js)$/
  );
  return m?.[1];
}
