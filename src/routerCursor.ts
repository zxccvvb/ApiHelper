import * as vscode from 'vscode';
import { expandToQuotedString, isAppRouterFile } from './editorPathExtract';
import {
  extractBalancedRoute,
  extractHandlerMethod,
  findHandlerLine,
  resolveControllerRef,
  resolveExistingControllerPath,
  splitRouteElements
} from './nodeRouteResolve';

function findRouteStartBefore(content: string, index: number): number {
  const before = content.slice(0, index);
  let lastStart = -1;
  const re = /\[\s*['"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['"]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(before)) !== null) {
    lastStart = match.index;
  }
  return lastStart;
}

/**
 * 在 app/routers 中点击 Controller 引用或 handler 方法名字符串时：
 * - 点击 Controller：进入对应 Controller 文件
 * - 点击 handler：进入对应 Controller 方法
 * （路径字符串由 getApiPathAtPosition + findRouteForPath 处理）
 */
export async function resolveRouterDirectHandler(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken
): Promise<vscode.LocationLink | undefined> {
  if (token.isCancellationRequested) {
    return undefined;
  }
  if (!isAppRouterFile(document)) {
    return undefined;
  }
  const expand = expandToQuotedString(document, position);
  if (!expand) {
    return undefined;
  }
  const text = document.getText(expand).trim();
  if (text.startsWith('/')) {
    return undefined;
  }
  const fullContent = document.getText();
  const routeStart = findRouteStartBefore(
    fullContent,
    document.offsetAt(expand.start)
  );
  if (routeStart < 0) {
    return undefined;
  }
  const routeStr = extractBalancedRoute(fullContent, routeStart);
  if (!routeStr) {
    return undefined;
  }
  const parts = splitRouteElements(routeStr);
  if (parts.length < 4) {
    return undefined;
  }
  const controllerRef = resolveControllerRef(parts[2], fullContent);
  const handlerMethod = extractHandlerMethod(parts[3]);
  if (!controllerRef || !handlerMethod) {
    return undefined;
  }
  if (text !== controllerRef && text !== handlerMethod) {
    return undefined;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  const root = folders[0].uri.fsPath;
  const controllerFs = await resolveExistingControllerPath(
    root,
    controllerRef,
    token
  );
  if (!controllerFs) {
    return undefined;
  }
  const controllerUri = vscode.Uri.file(controllerFs);
  if (token.isCancellationRequested) {
    return undefined;
  }
  const ctrlContent = (await vscode.workspace.fs.readFile(controllerUri)).toString();
  const line0 = text === controllerRef
    ? 0
    : Math.max(0, findHandlerLine(ctrlContent, handlerMethod) - 1);
  const targetPos = new vscode.Position(line0, 0);
  const targetRange = new vscode.Range(targetPos, targetPos);
  return {
    originSelectionRange: expand,
    targetUri: controllerUri,
    targetRange,
    targetSelectionRange: targetRange
  };
}
