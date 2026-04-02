import * as path from 'path';
import * as vscode from 'vscode';
import { extractApiPath, getApiPathAtPosition, normalizePath } from './editorPathExtract';
import { findRouteForPath } from './nodeRouteResolve';

const DEFINITION_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', language: 'typescript' },
  { scheme: 'file', language: 'typescriptreact' },
  { scheme: 'file', language: 'javascript' },
  { scheme: 'file', language: 'javascriptreact' }
];

async function openAt(uri: vscode.Uri, pos: vscode.Position): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const ed = await vscode.window.showTextDocument(doc, {
    preview: false,
    selection: new vscode.Range(pos, pos)
  });
  ed.revealRange(
    new vscode.Range(pos, pos),
    vscode.TextEditorRevealType.InCenter
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    DEFINITION_SELECTOR,
    {
      async provideDefinition(document, position, token) {
        const hit = getApiPathAtPosition(document, position);
        if (!hit) {
          return null;
        }

        const found = await findRouteForPath(hit.apiPath, token);
        if (!found) {
          void vscode.window.showErrorMessage(
            `ApiHelper: 未在 app/routers 中找到路径 ${hit.apiPath}`
          );
          return null;
        }

        const line = Math.max(0, found.handlerLine - 1);
        const targetPos = new vscode.Position(line, 0);
        const targetRange = new vscode.Range(targetPos, targetPos);

        const link: vscode.LocationLink = {
          originSelectionRange: hit.originRange,
          targetUri: found.controllerUri,
          targetRange,
          targetSelectionRange: targetRange
        };
        return [link];
      }
    }
  );

  const disposable = vscode.commands.registerCommand(
    'apiHelper.goToNodeHandler',
    async () => {
      const editor = vscode.window.activeTextEditor;
      let apiPath = editor ? extractApiPath(editor) : undefined;

      if (!apiPath) {
        apiPath = await vscode.window.showInputBox({
          title: 'ApiHelper',
          prompt: '输入接口路径，例如 /v2/ump/mobile-order/updateAllScanOrderConfigs',
          value: '/v2/ump/'
        });
        if (!apiPath) {
          return;
        }
        apiPath = normalizePath(apiPath);
      }

      if (!apiPath.startsWith('/v2/')) {
        const ok = await vscode.window.showWarningMessage(
          '路径通常以 /v2/ 开头，是否继续查找？',
          '继续',
          '取消'
        );
        if (ok !== '继续') {
          return;
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ApiHelper: 查找路由与 Controller...',
          cancellable: true
        },
        async (progress, token) => {
          const found = await findRouteForPath(apiPath!, token);
          if (!found) {
            vscode.window.showErrorMessage(
              `未在 app/routers 中找到路径：${apiPath}`
            );
            return;
          }

          progress.report({ increment: 100 });

          const routerPos = new vscode.Position(found.routerLine - 1, 0);
          const ctrlPos = new vscode.Position(found.handlerLine - 1, 0);

          await openAt(found.controllerUri, ctrlPos);

          const openRouter = '查看 Router 定义';
          const choice = await vscode.window.showInformationMessage(
            `ApiHelper: ${found.httpMethod} ${apiPath} → ${path.basename(
              found.controllerUri.fsPath
            )}:${found.handlerLine}`,
            openRouter
          );
          if (choice === openRouter) {
            await openAt(found.routerUri, routerPos);
          }
        }
      );
    }
  );

  context.subscriptions.push(definitionProvider, disposable);
}

export function deactivate(): void {}
