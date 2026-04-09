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
    return '路由';
  }
  return '接口';
}

function getTypeClass(type: RouteCatalogItem['type']): string {
  if (type === 'page') {
    return 'is-page';
  }
  return 'is-interface';
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
        >打开前端路由</button>
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
      >打开前端入口</button>
      <span>${escapeHtml(item.clientEntryRelativePath)}</span>
    `
    : '<span>未找到前端入口</span>';

  const routeList = item.clientRoutes.length
    ? `<ul class="leaf-list">${item.clientRoutes.map(renderLeaf).join('')}</ul>`
    : '<div class="empty">未解析到前端 Route path</div>';

  return `
    <details
      class="item"
      open
      data-search="${escapeHtml(searchText)}"
      data-type="${escapeHtml(item.type)}"
    >
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
          <strong>前端入口</strong>
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
  scanTargetLabel: string,
  items: RouteCatalogItem[],
  workspaceName: string
): string {
  const totalPageRoutes = items.reduce((sum, item) => sum + item.clientRoutes.length, 0);
  const pageCount = items.filter((item) => item.type === 'page').length;
  const interfaceCount = items.filter((item) => item.type === 'interface').length;
  const itemsHtml = items.map(renderItem).join('');
  const serialized = JSON.stringify({
    itemsLength: items.length,
    totalPageRoutes,
    workspaceName
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>ApiHelper Route Catalog</title>
      <style>
        :root {
          color-scheme: dark;
          --bg: #000000;
          --bg-soft: #0a0a0a;
          --panel: rgba(18, 18, 20, 0.96);
          --panel-2: rgba(22, 22, 24, 0.96);
          --panel-3: rgba(28, 28, 31, 0.98);
          --border: rgba(255, 255, 255, 0.08);
          --border-strong: rgba(96, 141, 255, 0.34);
          --text: #b9b9bf;
          --text-strong: #e6e6eb;
          --muted: #7e7e87;
          --page: linear-gradient(135deg, #5b8cff, #7aa2ff);
          --interface: linear-gradient(135deg, #6f8cff, #8ab4ff);
          --accent: #8aa4ff;
          --accent-2: #c5d0ff;
          --shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 20px 20px 28px;
          background: var(--bg);
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
          padding: 2px 0 14px;
          background: linear-gradient(180deg, rgba(0, 0, 0, 0.98) 78%, rgba(0, 0, 0, 0));
          backdrop-filter: blur(12px);
        }
        .toolbar input {
          flex: 1;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--panel);
          color: var(--text);
          outline: none;
          transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
        }
        .toolbar input:focus {
          border-color: var(--border-strong);
          box-shadow: 0 0 0 4px rgba(96, 141, 255, 0.12);
          transform: translateY(-1px);
        }
        .toolbar button, .link {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--panel);
          color: var(--accent);
          cursor: pointer;
          padding: 7px 11px;
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
        }
        .toolbar button:hover, .link:hover {
          transform: translateY(-1px);
          border-color: var(--border-strong);
          background: var(--panel-3);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        }
        .stats {
          color: var(--muted);
          white-space: nowrap;
        }
        .tabs {
          position: sticky;
          top: 58px;
          z-index: 2;
          display: flex;
          gap: 10px;
          padding: 0 0 16px;
          background: linear-gradient(180deg, rgba(0, 0, 0, 0.98) 80%, rgba(0, 0, 0, 0));
          backdrop-filter: blur(12px);
        }
        .tab {
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--panel);
          color: var(--muted);
          cursor: pointer;
          padding: 8px 14px;
          transition: all 180ms ease;
        }
        .tab:hover {
          color: var(--text-strong);
          border-color: rgba(255, 255, 255, 0.14);
        }
        .tab.active {
          color: var(--text-strong);
          border-color: var(--border-strong);
          background: linear-gradient(135deg, rgba(91, 140, 255, 0.18), rgba(24, 24, 28, 0.96));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .hint {
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--panel);
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
            linear-gradient(135deg, rgba(91, 140, 255, 0.08), transparent 42%),
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
          color: #f5f7ff;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
        }
        .is-page { background: var(--page); }
        .is-interface { background: var(--interface); }
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
          background: linear-gradient(135deg, rgba(91, 140, 255, 0.08), rgba(255, 255, 255, 0.02));
          border: 1px solid rgba(138, 164, 255, 0.14);
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
            linear-gradient(135deg, rgba(91, 140, 255, 0.06), transparent 45%),
            var(--panel-2);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
        }
        .leaf:hover {
          transform: translateX(2px);
          border-color: rgba(138, 164, 255, 0.2);
          background:
            linear-gradient(135deg, rgba(91, 140, 255, 0.08), transparent 45%),
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
        <div class="stats" id="stats">${escapeHtml(workspaceName)} · 当前 ${items.length}/${items.length} 条 · 路由子路径 ${totalPageRoutes} 条</div>
      </div>
      <div class="tabs">
        <button class="tab active" data-filter="all">全部 ${items.length}</button>
        <button class="tab" data-filter="page">路由 ${pageCount}</button>
        <button class="tab" data-filter="interface">接口 ${interfaceCount}</button>
      </div>
      <div class="hint">扫描范围：<code>${escapeHtml(scanTargetLabel)}</code>。分类规则已和 <code>app/routers</code> 里的 <code>Alt+左键</code> 跳转保持一致：handler 以 <code>Html</code> 结尾的归类为“路由”，其余归类为“接口”；只有“路由”才会尝试解析前端入口。</div>
      <div id="list">${itemsHtml || '<div class="empty">没有解析到路由。</div>'}</div>
      <script>
        const vscode = acquireVsCodeApi();
        const bootstrap = ${serialized};
        const searchEl = document.getElementById('search');
        const refreshEl = document.getElementById('refresh');
        const statsEl = document.getElementById('stats');
        const itemEls = Array.from(document.querySelectorAll('.item'));
        const tabEls = Array.from(document.querySelectorAll('.tab'));
        let activeType = 'all';

        function applyFilter() {
          const keyword = (searchEl.value || '').trim().toLowerCase();
          let visibleCount = 0;
          itemEls.forEach((el) => {
            const haystack = el.dataset.search || '';
            const typeMatched = activeType === 'all' || el.dataset.type === activeType;
            const keywordMatched = !keyword || haystack.includes(keyword);
            const visible = typeMatched && keywordMatched;
            el.classList.toggle('hidden', !visible);
            if (visible) {
              visibleCount += 1;
            }
          });
          if (statsEl) {
            statsEl.textContent = '${escapeHtml(workspaceName)}' + ' · 当前 ' + visibleCount + '/' + bootstrap.itemsLength + ' 条 · 路由子路径 ' + bootstrap.totalPageRoutes + ' 条';
          }
        }

        searchEl.addEventListener('input', applyFilter);
        refreshEl.addEventListener('click', () => {
          vscode.postMessage({ type: 'refresh' });
        });
        tabEls.forEach((tabEl) => {
          tabEl.addEventListener('click', () => {
            activeType = tabEl.dataset.filter || 'all';
            tabEls.forEach((item) => item.classList.toggle('active', item === tabEl));
            applyFilter();
          });
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
        applyFilter();
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
          refreshed.scanTargetLabel,
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
    result.scanTargetLabel,
    result.items,
    result.workspaceName
  );
  currentPanel.reveal(vscode.ViewColumn.Beside);
}
