# ApiHelper

在 **VS Code / Cursor** 里，根据前端代码里的 **`/v2/...` 接口路径字符串**，**快速定位** 该请求在 **经本项目 Node 层转发之后** 的真实处理位置：**落在哪条路由注册、哪个 Controller 方法**——无需起服务、不必全仓库盲搜。

**在说什么「转发」**：浏览器 / 客户端实际打到的是 **`/v2/...`** 这类路径；本仓库的 **Node 网关层** 在 **`app/routers`** 里把路径 **注册** 到具体 **Controller**，业务逻辑写在 **`app/controllers`**。扩展做的是：从你在前端里复制/光标所在的 **同一段路径**，反查 **转发链路落地** 的那一行（Router 行可选看，默认直达 **Controller 方法**）。

适用场景：凡与 **retail-node-ump** 相同组织方式的项目均可使用，即：

- 前端在 `client/**` 等 **TS / TSX / JS / JSX** 中书写 **`/v2/...`**（如 `/v2/ump/...`、`/v2/scrm/...` 等，**不限于 ump**）；
- 后端 **`app/routers/**/*.js`** 声明「这个 URL 交给谁」，**`app/controllers/**/xxxController.js`** 写具体实现。

路径写法一致时，即可从「前端看到的 URL」跳到 **Node 转发后的最终处理代码**。

---

## 能做什么

| 目标 | 说明 |
| :--- | :--- |
| **快速定位「转发后」的实现** | 同一 `/v2/...` 在前端只是字符串；扩展帮你对齐 **Node 路由表里的注册项**，直接跳到 **最终处理该请求的 Controller 方法**（精确到文件与行）。 |
| **核对转发链路** | 需要时可在提示中选 **「查看 Router 定义」**，看到 **`app/routers`** 里 **哪条 `METHOD + path`** 把请求转给当前 Controller。 |
| **纯静态分析** | 只扫路由与 Controller 源码，**不依赖** Node 进程、不发起真实请求。 |

---

## 使用方法

### 1. 安装与打开工作区

1. **安装扩展**  
   - **从本地目录安装**：命令面板执行 **Developer: Install Extension from Location…**，选择本仓库下的 **`ApiHelper`** 目录；  
   - **或安装 VSIX**：**Install from VSIX…**，选择打包生成的 **`*.vsix`**（例如在 `ApiHelper` 下执行 `yarn vsix` / `npm run vsix`）。
2. **打开工作区**  
   以包含 **`app/routers`** 与 **`app/controllers`** 的**项目根目录**打开（例如 **retail-node-ump** 仓库根目录）。仅打开 `ApiHelper` 子文件夹时，无法解析你业务仓库里的路由。

### 2. 跳转到 Node（三种常用方式）

**前提（「转到定义」）**：光标须落在 **包含 `/v2/` 的路径**上——可以是 **引号内的字符串**，或同一行里 **`url: '/v2/...'`** 的值。

| 方式 | 操作 |
| :--- | :--- |
| **转到定义** | 光标在路径字符串内，按 **`F12`**（或编辑器绑定的 Go to Definition）。 |
| **⌘+点击 / Ctrl+点击** | 光标在路径上，**按住 Cmd（Mac）或 Ctrl（Windows/Linux）并点击**，与内置「转到定义」行为一致。 |
| **命令 / 右键菜单** | 命令面板执行 **`ApiHelper: 跳转到 Node 接口实现`**；或在编辑器中 **右键** 选择同一命令。可先 **选中** 一整段路径再执行；若未识别到路径，会弹出 **输入框** 让你粘贴或输入路径（默认提示前缀 `/v2/`）。 |

执行命令时，若路径 **不以 `/v2/` 开头**，扩展会 **提示是否继续**（仍可按你的输入去 `app/routers` 里查找）。**「转到定义」** 则主要识别含 **`/v2/`** 的写法（与实现一致）。

命令成功后会 **打开 Controller 文件并定位到方法附近**；底部通知里可点 **「查看 Router 定义」** 打开对应 **router 文件中的注册行**。

### 3. 路径从哪里来

典型写法包括但不限于：

- 字符串：`'/v2/ump/mobile-order/foo'`、`"/v2/scrm/..."` 等；
- 对象属性：`url: '/v2/...'`（同一条源码行内）；
- 先 **选中** 路径再执行命令（无需光标在引号内）。

---

## 解析规则（摘要）

| 场景 | 行为 |
| :--- | :--- |
| **路由匹配** | 在 `app/routers/**/*.js` 中查找与路径字符串一致的 **路由数组第二段**（`['METHOD', '/path', …]`），支持跨行数组。 |
| **Controller 与方法名** | 解析路由项中的 Controller 引用与 **处理方法名**（含中间件写法时，按实现规则取 **最后一个** 方法名字符串）。 |
| **Controller 文件路径** | 例如 `mobile-order.IndexController` → `app/controllers/mobile-order/IndexController.js`。 |
| **变量 controller** | 路由里第三段为 `controller` 等标识符时，会读取同文件内的 `const controller = '…'`。 |

更细的实现见源码：`src/editorPathExtract.ts`（从编辑器取出路径）、`src/nodeRouteResolve.ts`（路由 → Controller）、`src/extension.ts`（注册 DefinitionProvider 与命令）。

---

## Features（扩展能力）

| 能力 | 说明 |
| :--- | :--- |
| **DefinitionProvider** | 在 TS/TSX/JS/JSX 中，对符合规则的 **`/v2/...`** 路径提供「转到定义」，直达 **Controller 方法**。 |
| **命令 `apiHelper.goToNodeHandler`** | 同上，并支持 **手动输入路径**、**查看 Router 行**。 |
| **不依赖运行** | 静态扫描路由与 Controller，无需启动 Node 服务。 |

---

## Requirements

- **VS Code ≥ 1.85.0**（或与之一致的 **Cursor** 版本）。  
- 工作区根下需存在 **`app/routers`** 与 **`app/controllers`**（与当前解析逻辑一致）。

---

## Development

```bash
cd ApiHelper
npm install
# 或 yarn
npm run compile
```

使用 **Run Extension** 调试（见 `ApiHelper/.vscode/launch.json`）。

- **仅打开 `ApiHelper` 文件夹**：选 **Run Extension (open ApiHelper as workspace root)**。  
- **打开整个 monorepo 根目录**：选 **Run Extension (retail-node-ump monorepo root)**。

### 版本与打包

与 Ranta 扩展类似，可用 npm scripts 管理版本并打 VSIX：

| 脚本 | 说明 |
| :--- | :--- |
| `npm run version:patch` / `minor` / `major` | 仅 bump `package.json` 版本（不提交 git） |
| `npm run release:patch` / `minor` / `major` | `npm version`（会打 git tag，按仓库策略使用） |
| `npm run vsix` | `vsce package` 生成 `.vsix`（通过 npx 拉取 `@vscode/vsce`） |

---

## License

[MIT](./LICENSE)
