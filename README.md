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
