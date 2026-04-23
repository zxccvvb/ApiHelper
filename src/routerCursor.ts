import * as vscode from 'vscode';
import { expandToQuotedString, isAppRouterFile } from './editorPathExtract';
import {
  findParsedRouteAtIndex,
  findHandlerLine,
  resolveExistingControllerPath
} from './nodeRouteResolve';

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
  const routeHit = findParsedRouteAtIndex(
    fullContent,
    document.offsetAt(expand.start)
  );
  if (!routeHit) {
    return undefined;
  }
  const controllerRef = routeHit.route.controllerRef;
  const handlerMethod = routeHit.route.handlerMethod;
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
