import * as vscode from 'vscode';
import { findClientEntryByApiPath } from './clientRouteResolve';
import {
  extractApiPath,
  extractRouteFolderName,
  getApiPathAtPosition,
  isAppRouterFile,
  normalizePath
} from './editorPathExtract';
import { findRouteForFolderName, findRouteForPath } from './nodeRouteResolve';
import { resolveRouterDirectHandler } from './routerCursor';

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
        const direct = await resolveRouterDirectHandler(
          document,
          position,
          token
        );
        if (direct) {
          return [direct];
        }

        const hit = getApiPathAtPosition(document, position);
        if (!hit) {
          return null;
        }
        if (isAppRouterFile(document)) {
          const clientUri = await findClientEntryByApiPath(hit.apiPath, token);
          if (clientUri) {
            const targetPos = new vscode.Position(0, 0);
            const targetRange = new vscode.Range(targetPos, targetPos);
            const link: vscode.LocationLink = {
              originSelectionRange: hit.originRange,
              targetUri: clientUri,
              targetRange,
              targetSelectionRange: targetRange
            };
            return [link];
          }
        }

        const found = await findRouteForPath(hit.apiPath, token);
        if (!found) {
          void vscode.window.showErrorMessage(
            `ApiHelper: 未在 app/routers 中找到路径 ${hit.apiPath}`
          );
          return null;
        }

        const line = Math.max(0, found.routerLine - 1);
        const targetPos = new vscode.Position(line, 0);
        const targetRange = new vscode.Range(targetPos, targetPos);

        const link: vscode.LocationLink = {
          originSelectionRange: hit.originRange,
          targetUri: found.routerUri,
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
      const folderName = editor ? extractRouteFolderName(editor) : undefined;

      if (!apiPath && !folderName) {
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

      if (apiPath) {
        const skipV2Warning =
          apiPath.startsWith('/wscump/') ||
          (editor && isAppRouterFile(editor.document));
        if (!apiPath.startsWith('/v2/') && !skipV2Warning) {
          const ok = await vscode.window.showWarningMessage(
            '路径通常以 /v2/ 开头，是否继续查找？',
            '继续',
            '取消'
          );
          if (ok !== '继续') {
            return;
          }
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ApiHelper: 查找路由定义...',
          cancellable: true
        },
        async (progress, token) => {
          let found = apiPath
            ? await findRouteForPath(apiPath, token)
            : undefined;
          if (!found && folderName) {
            found = await findRouteForFolderName(folderName, token);
          }
          if (!found) {
            const lookupTarget = apiPath || folderName || '';
            vscode.window.showErrorMessage(
              `未在 app/routers 中找到匹配路由：${lookupTarget}`
            );
            return;
          }

          progress.report({ increment: 100 });

          const routerPos = new vscode.Position(found.routerLine - 1, 0);
          await openAt(found.routerUri, routerPos);
          void vscode.window.showInformationMessage(
            `ApiHelper: 已定位路由 ${found.httpMethod} ${apiPath || folderName}`
          );
        }
      );
    }
  );

  context.subscriptions.push(definitionProvider, disposable);
}

export function deactivate(): void {}
