# 项目说明

## 项目概览

这是一个基于 Vite + React 的前端单页应用，项目名称是 `todo_list`。应用主体是一个中文待办事项提醒工具，用来添加待办、设置提醒时间、标记完成、搜索筛选、统计任务状态，并在到期时通过页面提示和浏览器系统通知提醒用户。

从后端视角看，这个项目目前没有服务端、数据库或接口层，所有数据都保存在浏览器本地的 `localStorage` 中。也就是说，数据只存在当前浏览器环境里，刷新页面后还能保留，但换浏览器、清缓存或换设备后不会自动同步。

## 技术栈

- 构建工具：Vite
- 前端框架：React
- 语言：JavaScript + JSX
- 样式：普通 CSS 文件
- 包管理：npm，依赖锁文件是 `package-lock.json`
- 代码检查：ESLint

`package.json` 中的主要脚本：

- `npm run dev`：启动本地开发服务器。
- `npm run build`：构建生产版本，输出到 `dist` 目录。
- `npm run lint`：运行 ESLint 检查代码。
- `npm run preview`：本地预览构建后的生产版本。

## 目录结构

```text
todo_list/
├── AGENTS.md              # 给 AI 助手的协作说明
├── AGENT.md               # 当前这份项目理解说明
├── index.html             # 浏览器最先加载的 HTML 入口
├── package.json           # 项目依赖和 npm 脚本
├── package-lock.json      # npm 依赖锁定文件
├── vite.config.js         # Vite 配置
├── eslint.config.js       # ESLint 配置
├── public/                # 静态资源，构建时原样暴露
│   ├── favicon.svg
│   └── icons.svg
├── src/                   # 前端源码
│   ├── main.jsx           # React 应用入口，负责挂载 App
│   ├── App.jsx            # 主应用组件，包含待办提醒的核心逻辑
│   ├── App.css            # 主应用样式
│   ├── index.css          # 全局样式
│   └── assets/            # 源码内资源
│       ├── hero.png
│       ├── react.svg
│       └── vite.svg
└── dist/                  # 构建产物目录，当前只看到静态 SVG 文件
```

## 前端入口关系

浏览器加载顺序可以理解为：

1. `index.html` 提供页面外壳，其中有一个 `<div id="root"></div>`。
2. `index.html` 通过 `<script type="module" src="/src/main.jsx"></script>` 加载前端入口。
3. `src/main.jsx` 使用 React 的 `createRoot` 找到 `#root`，把 `<App />` 渲染进去。
4. `src/App.jsx` 返回页面结构，也就是用户实际看到和操作的待办提醒界面。
5. `src/App.css` 和 `src/index.css` 控制页面视觉样式。

对后端开发者来说，可以把 `index.html` 类比成一个极薄的启动壳，把 `main.jsx` 类比成应用启动类，把 `App.jsx` 类比成当前项目的主业务模块。

## 核心业务功能

`src/App.jsx` 是当前项目最重要的文件，负责状态、业务逻辑和页面渲染。

主要功能包括：

- 初始化待办数据。
- 从 `localStorage` 读取历史待办。
- 把待办变更持久化回 `localStorage`。
- 添加新待办。
- 校验待办标题不能为空。
- 标记待办完成或未完成。
- 删除待办。
- 将待办提醒时间推迟 15 分钟。
- 按关键词搜索标题或备注。
- 按状态筛选：全部、待处理、即将到期、逾期、完成。
- 统计总任务、即将到期、已逾期、已完成数量。
- 计算下一条提醒时间。
- 每 30 秒检查一次是否有到期任务。
- 任务到期时显示页面 toast 提示。
- 如果用户授权浏览器通知，则使用 `Notification` API 弹出系统通知。

## 数据结构

每个待办对象大致长这样：

```js
{
  id: '浏览器生成的随机 UUID',
  title: '待办标题',
  notes: '备注',
  dueAt: 'datetime-local 格式的本地时间字符串',
  priority: 'high | medium | low',
  completed: false,
  createdAt: 生成时间戳,
  reminded: false
}
```

关键字段说明：

- `id`：唯一标识，用于更新、删除和列表渲染。
- `title`：待办标题，提交时必填。
- `notes`：备注，可为空。
- `dueAt`：提醒时间，对应 HTML 的 `datetime-local` 输入框。
- `priority`：优先级，支持高、中、低。
- `completed`：是否完成。
- `createdAt`：创建时间，用于排序。
- `reminded`：是否已经提醒过，避免同一个到期任务重复弹提醒。

## 本地存储

待办数据使用下面这个 key 存进浏览器：

```js
const STORAGE_KEY = 'todo-reminder-items'
```

保存逻辑在 `useEffect` 中：

```js
localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
```

读取逻辑在 `useState` 初始化函数中：

```js
const saved = localStorage.getItem(STORAGE_KEY)
return saved ? migrateStoredTodos(JSON.parse(saved)) : seedTodos
```

这里没有后端 API，所以刷新页面后数据能保留，是因为浏览器本地缓存了 JSON 字符串。

## 时间和提醒逻辑

项目里有几个时间相关函数：

- `getLocalDateTime(offsetMinutes)`：生成适配 `datetime-local` 输入框的本地时间字符串。
- `getSpecificLocalDateTime(month, day, hour, minute)`：生成当前年份中指定月日时分的本地时间字符串。
- `formatDateTime(value)`：把时间格式化成中文日期时间显示。
- `getTodoStatus(todo, now)`：根据当前时间和待办状态计算任务状态。

任务状态规则：

- 已完成：`completed === true`
- 未设置时间：`open`
- 当前时间超过提醒时间：`overdue`
- 距离提醒时间小于等于 30 分钟：`soon`
- 其他情况：`open`

提醒检查逻辑：

- 页面启动后立刻检查一次。
- 之后每 30 秒检查一次。
- 找到未完成、未提醒、并且已到时间的待办。
- 把这些待办的 `reminded` 改成 `true`。
- 显示 toast。
- 如果浏览器通知权限是 `granted`，则调用 `new Notification(...)`。

## React 状态说明

`App` 组件里使用了这些 React Hook：

- `useState`：保存会变化的页面状态，比如待办列表、表单、筛选条件、搜索词、当前时间、toast。
- `useEffect`：处理副作用，比如写入 `localStorage`、同步 ref、启动定时器。
- `useMemo`：缓存计算结果，比如统计数据、筛选后的待办、下一条提醒。
- `useRef`：保存最新的 `todos`，让定时器回调拿到最新待办列表。

主要状态：

- `todos`：所有待办。
- `form`：新增待办表单数据。
- `filter`：当前筛选状态。
- `query`：搜索关键词。
- `now`：当前时间戳，用于计算是否到期。
- `toast`：页面右下角提示文本。

## 页面结构

`App.jsx` 渲染出来的页面大致分为：

- 顶部区域：标题“待办事项提醒”和“开启系统通知”按钮。
- 统计区域：总任务、即将到期、已逾期、已完成。
- 左侧表单：添加提醒时间、待办标题、备注、优先级。
- 右侧任务面板：下一条提醒、搜索框、状态筛选按钮、待办列表。
- Toast：页面右下角可点击关闭的提示。

## 样式说明

样式主要在两个文件中：

- `src/index.css`：全局基础样式，例如字体、背景、`body` 和 `#root` 的尺寸。
- `src/App.css`：应用具体布局和组件样式。

页面布局特点：

- 桌面端使用两栏布局：左侧添加表单，右侧任务列表。
- 宽度小于 980px 时切换为单栏布局。
- 宽度小于 680px 时进一步优化移动端布局。
- 任务卡片通过左边框颜色表达状态：即将到期、逾期、已完成等。
- 优先级通过不同颜色的 pill 标签表达。

## 静态资源

- `public/favicon.svg`：浏览器标签页图标。
- `public/icons.svg`：公共 SVG 图标资源。
- `src/assets/hero.png`、`react.svg`、`vite.svg`：源码资源。当前主应用代码没有直接使用这些资源。

## 当前已知情况

- `README.md` 仍是 Vite + React 默认模板说明，还没有改成当前待办提醒工具的业务文档。
- `dist/` 是构建产物目录，通常不应该手工修改；正式构建应通过 `npm run build` 生成。
- 当前项目没有测试用例。
- 当前项目没有后端接口、登录系统、用户体系或多端同步能力。
- 当前项目没有 TypeScript，所有源码是 JavaScript/JSX。
- 浏览器系统通知需要用户点击“开启系统通知”并授权，否则只会显示页面内 toast。

## 继续开发建议

如果后续要扩展这个项目，可以优先考虑：

- 把 `README.md` 改成真实项目说明。
- 增加编辑待办功能。
- 增加清空已完成任务功能。
- 增加更灵活的推迟选项，比如 15 分钟、30 分钟、1 小时。
- 增加任务分类或标签。
- 增加单元测试，重点覆盖时间状态计算和筛选排序逻辑。
- 如果需要多设备同步，再引入后端 API 和数据库。

