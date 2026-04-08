# ApiHelper

```txt
[插件] ApiHelper
[定位目标] client 路由文件 <-> app/routers 路由列表 双向跳转
[当前行为] 默认只定位到路由定义，不自动跳 Controller 函数
```

```txt
[命令 ID] apiHelper.goToNodeHandler
[命令标题] ApiHelper: 跳转到 Node 接口实现
```

```txt
[命令 ID] apiHelper.goToNodeHandlerByFullPath
[命令标题] ApiHelper: 通过完整 URL 跳转路由
```

```txt
[命令 ID] apiHelper.showProjectRouteCatalog
[命令标题] ApiHelper: 查看项目路由总览
```

## 能力说明

```txt
[能力-1] 从 client 文件反查 router
在 client/route/<folder>/ 下执行命令，按 <folder> 匹配 app/routers 中路由第二段末尾 segment。
命中后打开对应 router 文件并定位到路由行。
```

```txt
[能力-2] 从 app/routers 反查 client 入口
在 app/routers/*.js 里点击 '/v2/...' 路径字符串，提取最后一个 path segment 作为 folderName，
再反查 client/route/<folderName>/app.* 或 main.* 入口文件并跳转。
```

```txt
[能力-3] 兼容接口路径查找
当代码里有明确 '/v2/...' 字符串时，仍可按路径在 app/routers/**/*.js 中定位匹配路由。
```

```txt
[能力-4] 输入完整 URL 直接定位 router
执行命令后弹输入框，可输入任意域名的完整 URL，
插件会自动提取 pathname（例如 /v2/ump/mobile-order）并定位到 app/routers 中对应路由行。
```

```txt
[能力-5] 可视化列出项目路由
从 app/routers/default.js 读取顶层路由列表，再尝试关联 client/route/*/app.* 中注册的 Route path，
最终将每个页面展示为 basePath#subPath 的形式，并在面板中提供搜索、展开、跳转源码能力。
```

## 使用方法（按代码位置）

```txt
[用法-A] 在 client 文件中 -> 找对应 router
适用文件：client/route/appointment-decoration/app.jsx（以及同目录其他文件）
触发方式：执行命令 apiHelper.goToNodeHandler
结果：跳到 app/routers/appointment-decoration.js 对应路由行
```

```jsx
// 文件：client/route/appointment-decoration/app.jsx
import OrderEditor from './order-editor';
// 在这个文件里执行命令 -> 跳到 app/routers/appointment-decoration.js
```

```txt
[用法-B] 在 router 文件中点击接口路径 -> 找对应 client 入口
适用文件：app/routers/appointment-decoration.js
触发方式：点击 '/v2/ump/appointment-decoration' 这段路径字符串
结果：跳到 client/route/appointment-decoration/app.jsx（或 app.tsx 等）
```

```js
// 文件：app/routers/appointment-decoration.js
module.exports = [
  ['GET', '/v2/ump/appointment-decoration', 'appointment-decoration.IndexController', 'getIndexHtml'],
];
// 点击 '/v2/ump/appointment-decoration' -> 跳到 client/route/appointment-decoration/app.jsx
```

```txt
[用法-C] 在任意文件中有 '/v2/...' 字符串 -> 找 router
触发方式：点击或基于该字符串执行命令
结果：跳到 app/routers 中精确匹配该路径的路由行
```

```ts
// 任意 TS/TSX/JS/JSX 文件
const api = '/v2/ump/api/appointment-decoration/query-page-list';
// 对这段路径触发跳转 -> 跳到 app/routers/appointment-decoration.js 对应路由项
```

```txt
[用法-D] 直接查看整个项目的路由总览
触发方式：执行命令 apiHelper.showProjectRouteCatalog
结果：打开一个可视化面板，列出 default.js 中每一条顶层路由，并尽量补齐对应 page 路由
```

## 匹配规则

```txt
[client -> router 规则]
1) 从当前文件路径提取 client/route/<folderName>
2) 扫描 app/routers/**/*.js
3) 匹配路由数组第二段 path 的最后一个 segment === <folderName>
4) 多条候选时优先：非 /api/ + GET + getIndexHtml
```

```txt
[router -> client 规则]
1) 从 '/v2/...' 提取最后一个 segment 作为 folderName
2) 按优先级查找以下文件：
   app.tsx -> app.jsx -> app.ts -> app.js -> main.tsx -> main.jsx -> main.ts -> main.js
3) 命中即跳转
```

```txt
[项目路由总览规则]
1) 先读取 app/routers/default.js 中的每一条路由
2) 取第二段 path：
   - 普通字符串：直接作为 basePath
   - registerApp(...)：提取其中的绝对路径作为 basePath
3) 推断 page 目录名，优先级如下：
   - registerApp('@scope/<folder>')
   - controller 引用前缀（如 finacial.IndexController -> finacial）
   - basePath 推导出的最后一个 segment
4) 在 client/route/<folder>/ 下按优先级查找入口：
   app.tsx -> app.jsx -> app.ts -> app.js -> main.tsx -> main.jsx -> main.ts -> main.js
5) 从入口文件里提取每个 <Route path="..."> 或 <Route path={['/...']} >
6) 将结果拼成 basePath#subPath，例如：
   /v2/data/report#/report/StaffExchange
   /v2/data/finacial#/prepaid/:type
7) 若未找到 page：
   - handler 是 getIndexHtml -> 标记为“接口”
   - 其他 handler -> 标记为“后端接口”
```

## 典型示例

```txt
[示例-1]
client/route/appointment-decoration/app.jsx
-> app/routers/appointment-decoration.js
-> ['GET', '/v2/ump/appointment-decoration', ...]
```

```txt
[示例-2]
app/routers/appointment-decoration.js 中 '/v2/ump/appointment-decoration'
-> client/route/appointment-decoration/app.jsx
```

```txt
[示例-3]
app/routers/default.js
-> registerApp('@retail-node-data/report', '/v2/data/report')
-> client/route/report/app.tsx
-> /v2/data/report#/report/StaffExchange
-> /v2/data/report#/report/DailyReportDetail
-> /v2/data/report#/report/:reportType
```

```txt
[示例-4]
app/routers/default.js
-> registerApp('@retail-node-data/finacial', '/v2/data/finacial')
-> client/route/finacial/app.jsx
-> /v2/data/finacial#/
-> /v2/data/finacial#/prepaid/:type
```

```txt
[示例-5]
app/routers/default.js
-> ['GET', '/v2/data/dashboard/getLiteStore', 'dashboard.IndexController', 'getLiteStore']
-> 未命中 page
-> 在总览中显示为“后端接口”
```
