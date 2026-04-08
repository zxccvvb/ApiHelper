import * as vscode from 'vscode';
import {
  RouteCatalogItem,
  RouteCatalogLeaf,
  scanProjectRouteCatalog
} from './projectRouteCatalog';

let currentPanel: vscode.WebviewPanel | undefined;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTypeLabel(type: RouteCatalogItem['type']): string {
  if (type === 'page') {
    return '页面';
  }
  if (type === 'interface') {
    return '接口';
  }
  return '后端接口';
}

function getTypeClass(type: RouteCatalogItem['type']): string {
  if (type === 'page') {
    return 'is-page';
  }
  if (type === 'interface') {
    return 'is-interface';
  }
  return 'is-backend';
}

function renderLeaf(leaf: RouteCatalogLeaf): string {
  return `
    <li class="leaf">
      <div class="leaf-main">
        <code class="full-path">${escapeHtml(leaf.fullPath)}</code>
        <button
          class="link"
          data-open-path="${escapeHtml(leaf.sourceFsPath)}"
          data-open-line="${leaf.sourceLine}"
        >打开 page 路由</button>
      </div>
      <div class="meta">
        <span>${escapeHtml(leaf.sourceRelativePath)}</span>
        <span>#${leaf.sourceLine}</span>
      </div>
    </li>
  `;
}

function renderItem(item: RouteCatalogItem): string {
  const searchText = [
    item.basePaths.join(' '),
    item.clientRoutes.map((leaf) => leaf.fullPath).join(' '),
    item.controllerRef || '',
    item.handlerMethod || '',
    item.folderCandidates.join(' '),
    item.clientEntryRelativePath || ''
  ]
    .join(' ')
    .toLowerCase();

  const pageInfo = item.clientEntryRelativePath
    ? `
      <button
        class="link"
        data-open-path="${escapeHtml(item.clientEntryFsPath || '')}"
        data-open-line="1"
      >打开 page 入口</button>
      <span>${escapeHtml(item.clientEntryRelativePath)}</span>
    `
    : '<span>未找到 page 入口</span>';

  const routeList = item.clientRoutes.length
    ? `<ul class="leaf-list">${item.clientRoutes.map(renderLeaf).join('')}</ul>`
    : '<div class="empty">未解析到前端 Route path</div>';

  return `
    <details class="item" open data-search="${escapeHtml(searchText)}">
      <summary>
        <div class="summary-main">
          <span class="badge ${getTypeClass(item.type)}">${getTypeLabel(item.type)}</span>
          <code>${escapeHtml(item.basePaths.join(' , '))}</code>
        </div>
        <div class="summary-side">
          <span class="summary-method">${escapeHtml(item.httpMethod)}</span>
          <span class="summary-arrow" aria-hidden="true"></span>
        </div>
      </summary>
      <div class="content-shell">
      <div class="content">
        <div class="row">
          <strong>来源</strong>
          <div class="row-main">
            <button
              class="link"
              data-open-path="${escapeHtml(item.routerFsPath)}"
              data-open-line="${item.routerLine}"
            >打开 router</button>
            <span>${escapeHtml(item.routerRelativePath)}</span>
            <span>#${item.routerLine}</span>
          </div>
        </div>
        <div class="row">
          <strong>Page</strong>
          <div class="row-main">${pageInfo}</div>
        </div>
        <div class="row">
          <strong>Controller</strong>
          <div class="row-main">
            <span>${escapeHtml(item.controllerRef || '-')}</span>
            <span>${escapeHtml(item.handlerMethod || '-')}</span>
          </div>
        </div>
        <div class="row">
          <strong>候选目录</strong>
          <div class="row-main">
            <span>${escapeHtml(item.folderCandidates.join(', ') || '-')}</span>
          </div>
        </div>
        <div class="note">${escapeHtml(item.note)}</div>
        <div class="route-block">
          <div class="route-title">可视化路径</div>
          ${routeList}
        </div>
      </div>
      </div>
    </details>
  `;
}

function renderHtml(
  webview: vscode.Webview,
  routeFileRelativePath: string,
  items: RouteCatalogItem[],
  workspaceName: string
): string {
  const totalPageRoutes = items.reduce((sum, item) => sum + item.clientRoutes.length, 0);
  const itemsHtml = items.map(renderItem).join('');
  const serialized = JSON.stringify({ itemsLength: items.length }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>ApiHelper Route Catalog</title>
      <style>
        :root {
          color-scheme: dark;
          --bg: #09111f;
          --bg-glow: radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), transparent 28%);
          --panel: rgba(12, 19, 34, 0.88);
          --panel-2: rgba(9, 16, 29, 0.96);
          --panel-3: rgba(18, 29, 49, 0.92);
          --border: rgba(148, 163, 184, 0.16);
          --border-strong: rgba(96, 165, 250, 0.28);
          --text: #e6edf7;
          --muted: #8ea3c0;
          --page: linear-gradient(135deg, #2563eb, #38bdf8);
          --interface: linear-gradient(135deg, #d97706, #f59e0b);
          --backend: linear-gradient(135deg, #7c3aed, #a855f7);
          --accent: #7dd3fc;
          --accent-2: #34d399;
          --shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 20px 20px 28px;
          background: var(--bg);
          background-image:
            linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(8, 13, 24, 1)),
            var(--bg-glow);
          color: var(--text);
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .toolbar {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 2px 0 18px;
          background: linear-gradient(180deg, rgba(9, 17, 31, 0.98) 78%, rgba(9, 17, 31, 0));
          backdrop-filter: blur(12px);
        }
        .toolbar input {
          flex: 1;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: rgba(8, 15, 27, 0.95);
          color: var(--text);
          outline: none;
          transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
        }
        .toolbar input:focus {
          border-color: var(--border-strong);
          box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.12);
          transform: translateY(-1px);
        }
        .toolbar button, .link {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: rgba(15, 24, 42, 0.88);
          color: var(--accent);
          cursor: pointer;
          padding: 7px 11px;
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
        }
        .toolbar button:hover, .link:hover {
          transform: translateY(-1px);
          border-color: var(--border-strong);
          background: rgba(23, 37, 64, 0.96);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        }
        .stats {
          color: var(--muted);
          white-space: nowrap;
        }
        .hint {
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: rgba(10, 17, 30, 0.72);
          color: var(--muted);
          box-shadow: var(--shadow);
        }
        .item {
          margin-bottom: 16px;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: var(--panel);
          overflow: clip;
          box-shadow: var(--shadow);
          transition: transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease, opacity 180ms ease;
        }
        .item:hover {
          transform: translateY(-2px);
          border-color: var(--border-strong);
          box-shadow: 0 24px 54px rgba(0, 0, 0, 0.42);
        }
        summary {
          list-style: none;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 16px 18px;
          cursor: pointer;
          background:
            linear-gradient(135deg, rgba(37, 99, 235, 0.06), transparent 42%),
            rgba(255, 255, 255, 0.02);
        }
        summary::-webkit-details-marker { display: none; }
        .summary-main {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .summary-main code {
          white-space: pre-wrap;
          word-break: break-all;
        }
        .summary-side {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--muted);
          font-weight: 600;
        }
        .summary-method {
          letter-spacing: 0.06em;
        }
        .summary-arrow {
          width: 10px;
          height: 10px;
          border-right: 2px solid var(--muted);
          border-bottom: 2px solid var(--muted);
          transform: rotate(45deg);
          transition: transform 220ms ease, border-color 220ms ease;
        }
        .item[open] .summary-arrow {
          transform: rotate(225deg) translate(-1px, -1px);
        }
        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 64px;
          padding: 4px 9px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
        }
        .is-page { background: var(--page); }
        .is-interface { background: var(--interface); }
        .is-backend { background: var(--backend); }
        .content-shell {
          display: grid;
          grid-template-rows: 0fr;
          opacity: 0;
          transition: grid-template-rows 260ms ease, opacity 180ms ease;
        }
        .item[open] .content-shell {
          grid-template-rows: 1fr;
          opacity: 1;
        }
        .content {
          min-height: 0;
          overflow: hidden;
          padding: 0 18px 18px;
          transform: translateY(-6px);
          transition: transform 240ms ease;
        }
        .item[open] .content {
          transform: translateY(0);
        }
        .row {
          display: flex;
          gap: 12px;
          margin-top: 13px;
        }
        .row strong {
          width: 84px;
          flex: 0 0 auto;
          color: var(--muted);
        }
        .row-main {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          min-width: 0;
        }
        .note, .empty, .meta {
          color: var(--muted);
        }
        .note {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(52, 211, 153, 0.08), rgba(37, 99, 235, 0.06));
          border: 1px solid rgba(125, 211, 252, 0.1);
        }
        .route-block {
          margin-top: 14px;
        }
        .route-title {
          margin-bottom: 8px;
          font-weight: 700;
        }
        .leaf-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 10px;
        }
        .leaf {
          padding: 12px 13px;
          border-radius: 12px;
          background:
            linear-gradient(135deg, rgba(37, 99, 235, 0.05), transparent 45%),
            var(--panel-2);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
        }
        .leaf:hover {
          transform: translateX(2px);
          border-color: rgba(125, 211, 252, 0.18);
          background:
            linear-gradient(135deg, rgba(37, 99, 235, 0.08), transparent 45%),
            var(--panel-3);
        }
        .leaf-main {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .full-path {
          word-break: break-all;
        }
        .hidden {
          opacity: 0;
          transform: scale(0.985);
          max-height: 0;
          margin: 0;
          overflow: hidden;
          pointer-events: none;
          border-width: 0;
          transition: opacity 140ms ease, transform 140ms ease, max-height 180ms ease, margin 180ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation: none !important;
            transition: none !important;
            scroll-behavior: auto !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <input id="search" type="search" placeholder="搜索 basePath、#路径、controller、目录名" />
        <button id="refresh">刷新</button>
        <div class="stats">${escapeHtml(workspaceName)} · 顶层路由 ${items.length} 条 · 页面路径 ${totalPageRoutes} 条</div>
      </div>
      <div class="hint">入口文件：<code>${escapeHtml(routeFileRelativePath)}</code>。规则：优先从 <code>default.js</code> 找 basePath，再拼 <code>client/route/*/app.*</code> 里的 <code>Route path</code>；没找到页面则标记为“接口”或“后端接口”。</div>
      <div id="list">${itemsHtml || '<div class="empty">没有解析到路由。</div>'}</div>
      <script>
        const vscode = acquireVsCodeApi();
        const bootstrap = ${serialized};
        const searchEl = document.getElementById('search');
        const refreshEl = document.getElementById('refresh');
        const itemEls = Array.from(document.querySelectorAll('.item'));

        function applyFilter() {
          const keyword = (searchEl.value || '').trim().toLowerCase();
          itemEls.forEach((el) => {
            const haystack = el.dataset.search || '';
            el.classList.toggle('hidden', !!keyword && !haystack.includes(keyword));
          });
        }

        searchEl.addEventListener('input', applyFilter);
        refreshEl.addEventListener('click', () => {
          vscode.postMessage({ type: 'refresh' });
        });

        document.addEventListener('click', (event) => {
          const target = event.target instanceof HTMLElement
            ? event.target.closest('[data-open-path]')
            : null;
          if (!target) {
            return;
          }
          const fsPath = target.getAttribute('data-open-path');
          const line = Number(target.getAttribute('data-open-line') || '1');
          if (!fsPath) {
            return;
          }
          vscode.postMessage({ type: 'open', fsPath, line });
        });
      </script>
    </body>
  </html>`;
}

async function openFileAtLine(fsPath: string, line: number): Promise<void> {
  const uri = vscode.Uri.file(fsPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: false,
    selection: new vscode.Range(position, position)
  });
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  );
}

export async function showProjectRouteCatalog(
  context: vscode.ExtensionContext
): Promise<void> {
  const result = await scanProjectRouteCatalog();

  if (!currentPanel) {
    currentPanel = vscode.window.createWebviewPanel(
      'apiHelper.routeCatalog',
      'ApiHelper: 项目路由总览',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    }, null, context.subscriptions);

    currentPanel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      const payload = message as { type?: string; fsPath?: string; line?: number };
      if (payload.type === 'refresh') {
        const refreshed = await scanProjectRouteCatalog();
        if (!currentPanel) {
          return;
        }
        currentPanel.webview.html = renderHtml(
          currentPanel.webview,
          refreshed.routerFileRelativePath,
          refreshed.items,
          refreshed.workspaceName
        );
        return;
      }

      if (payload.type === 'open' && payload.fsPath) {
        await openFileAtLine(payload.fsPath, payload.line || 1);
      }
    }, null, context.subscriptions);
  }

  currentPanel.title = 'ApiHelper: 项目路由总览';
  currentPanel.webview.html = renderHtml(
    currentPanel.webview,
    result.routerFileRelativePath,
    result.items,
    result.workspaceName
  );
  currentPanel.reveal(vscode.ViewColumn.Beside);
}
