import * as vscode from 'vscode';
import { expandToQuotedString, isAppRouterFile } from './editorPathExtract';
import {
  extractBalancedRoute,
  extractHandlerMethod,
  findHandlerLine,
  findRouteStartOnLine,
  resolveControllerRef,
  resolveExistingControllerPath,
  splitRouteElements
} from './nodeRouteResolve';

/**
 * 在 app/routers 中点击 Controller 引用或 handler 方法名字符串时，直接跳到对应 Controller 方法实现。
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
  const line = document.lineAt(position.line).text;
  const routeStart = findRouteStartOnLine(line, position.character);
  if (routeStart < 0) {
    return undefined;
  }
  const routeStr = extractBalancedRoute(line, routeStart);
  if (!routeStr) {
    return undefined;
  }
  const parts = splitRouteElements(routeStr);
  if (parts.length < 4) {
    return undefined;
  }
  const fullContent = document.getText();
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
  const handlerLine = findHandlerLine(ctrlContent, handlerMethod);
  const line0 = Math.max(0, handlerLine - 1);
  const targetPos = new vscode.Position(line0, 0);
  const targetRange = new vscode.Range(targetPos, targetPos);
  return {
    originSelectionRange: expand,
    targetUri: controllerUri,
    targetRange,
    targetSelectionRange: targetRange
  };
}
