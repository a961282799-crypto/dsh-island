# 验证记录

2026-10-25，Windows，DeepSeek Harness Desktop 0.2.1-rc.3，现有 Electron 44.0.0。

- 8 项状态与位置测试通过：多任务优先级、并行工具、多个确认、超时提问、取消与错误、状态到期、负坐标显示器和圆角点击区域。
- 实际安装版 Harness 的兼容门禁通过；真实 Cordis 中的事件投递和监听器卸载通过。事件输入为测试构造，不涉及实际模型请求。
- 真实 Electron 窗口检查通过：置顶、四个主要停靠位置、三档大小、11 个显示状态、减少动态效果、Esc 收起、面板内容无裁切、渲染器无报错。
- Windows 原生鼠标检查通过：透明区域点击到下层专用测试窗口，胶囊区域点击正常展开且不会误点下层。鼠标位置已恢复，测试窗口已关闭。
- 已查看待机、展开及思考截图，修复深色鲸鱼辨识度与预览控件裁切。截图与机器检查结果保存在 `artifacts/qa`。

尚未用真实付费模型调用重走思考、工具、确认、异常全部流程，也未进行多台实体显示器、长时间运行或其他操作系统验证。断开状态可在预览中查看；实际宿主退出时窗口随之退出。

## v0.2 界面重做（2026-10-26）

- 在 Linux 版 Chromium 中用模拟桥接渲染新界面：11 个状态 × 横向紧凑/弹出、左右竖向、底部、展开面板均截图检查，无渲染错误。
- 按 `tests/desktop.mjs` 同样的流程（展开、四个位置、竖向布局切换、三档大小、全部状态、减少动效后无运行中动画、Esc 收起、面板 inert）在模拟环境连续 3 次通过。
- `npm test` 8 项通过。
- 尚未在本机 Windows + Electron 中重跑 `npm run test:desktop`（含原生点击穿透）；窗口尺寸由 400 × 360 改为 420 × 380、屏幕边距由 8 改为 4，需要在本机确认。

## v0.3 设置迁入 Harness、任务控制台（2026-10-26）

- 对照本机 Harness 0.2.1-rc.3 安装包的源码确认接口：`settings.section` 设置分区、`ctx.configForms.get(entryId)` 读写、volatile 配置与 `loader/volatile-update`、`dsh.client` 浏览器半侧加载规则、`agent.cancel({kind:'user'},{keepInbox:true})`（与 Harness 停止按钮相同）、`todo/write` 与 `assistant/message.usage` 事件结构。
- 用本机 Harness 自带的 schemastery 解析 `Config`：6 个可见选项均为 volatile，非法位置/大小被拒绝。
- `npm test` 15 项通过（新增：计划/工具/模型/用量提取且不含参数和回复、子智能体过滤、只能停止顶层运行中任务、配置默认值与即时更新、余额只来自已登录账号且失败不显示为 0、缓存命中率）。
- 余额接口对照 `dsh-deepseek-account-platform` 的 `getBalance(client)` 与返回结构（`normal_wallets` / `bonus_wallets`）。
- 设置页在模拟的 Harness 插槽、语言、配置表单服务和真实 React 18 下渲染：浅色/深色、写入与恢复默认、只读禁用均正常，无报错。
- 灵动岛面板按 `tests/desktop.mjs` 的同样流程在模拟环境中两次通过（含两步停止、关闭弹出提醒）。
- 尚未在真实 Harness 中打开设置页、改设置、点停止，也未重跑 `npm run test:desktop` / `npm run test:host`；这些需要在本机安装后确认。

## v0.4 在灵动岛回答提问（2026-10-26）

- 对照 `dsh-user-questions`：`askTimed` → `user-questions/request` waterfall（cordis `waterfall` 外层优先、`prepend` 置前、`global` 监听收到带 Agent scope 的派发）、回答结构 `{ answers: [{ id, selected, custom? }] }`、等待结束时 `wait.close()` 中止共享 signal、`answer()` 处理已继续的问题与 `REPLY_QUEUED`。
- `npm test` 21 项通过（新增 6 项：灵动岛先答、Harness 先答、无窗口时灵动岛作答、超时释放、计划审阅/长说明/非计时/关闭时直通、回答校验、已继续问题经 `userQuestions.answer` 回答）。
- 提问卡在模拟环境中检查：自动展开、单选/输入互斥、多选加补充、两题逐个提交的负载、失败提示与重试、问题消失后自动收起、关闭开关后不展开、左侧停靠不越界。
- 尚未在真实 Harness 中让 Agent 提问并从灵动岛作答；需要安装后确认。

## v0.5 审批、上下文占用、用量统计、悬停展开、新回复（2026-10-27）

- 对照 Harness 的 `approval/request` waterfall：结果 `allowed-once` / `rejected` / `cancelled` / `unavailable`；Harness 的审批卡只在 `request.signal` 中止时撤下，所以灵动岛把下游 signal 换成“原信号或灵动岛已作答”的组合，作答后中止它，工具本身的 signal 不受影响。
- 上下文占用取自 `ctx.sessionProjections.stateOf(session, 'contextPressure')`，窗口大小取自 `request/context` 事件；用量通过 `ctx.sessionQuery.listSessions()` / `readSession()` 补算，跳过分叉会话继承的事件，按 seq 去重。
- 价格表按 DeepSeek 官方价格页（2026-10-27 查询）；测试覆盖高峰判定、两种模型的空闲/高峰价、旧模型名、未知模型不计费。
- `npm test` 29 项通过（新增：审批先答/Harness 先答/无窗口/取消/子智能体与关闭直通/只接受允许一次和拒绝/调用摘要；用量折叠、去重、补算一次、分叉、实时追加、按范围汇总、保存与重载）。
- 灵动岛在模拟环境中检查：审批卡自动展开、按钮先锁定约 0.6 秒、允许/拒绝负载、失败提示与重试、多个请求依次显示、审批优先于提问、处理完自动收起；上下文环绿/黄/红；完成时胶囊预览回复、面板显示回复卡；悬停 0.7 秒展开、移开收起、单击固定、关闭开关后不展开；无报错。
- 用量窗口在模拟数据下检查今天/7 天/30 天、悬停提示、展开会话、窄窗口无横向滚动、缩放窗口不重播动画。
- `tests/desktop.mjs` 已加入审批、回复预览和用量窗口步骤，需在 Windows 本机运行确认；尚未在真实 Harness 中触发审批或核对真实账单。


## v0.6 点外面收起、在灵动岛发消息（2026-10-29）

- 对照 Harness 0.2.1-rc.3 的 `dsh-api-session-controller`：`sessionController.prompt({ requestId, sessionId, mode: 'queue' | 'steer', content, clientTimeZone }, signal)` 与 Harness 输入框同一入口；`queue` 空闲时开始新一轮、运行中进入下一轮队列，`steer` 插入运行中的这一轮；冷会话由 `resolveAgent` 自动恢复。
- `npm test` 32 项通过（新增 4 项：对话目标只取顶层任务且在 store 清理后保留、排队/插话请求结构、本轮结束后插话降级为排队、空消息/换对话/关闭开关/旧版 Harness/错误码提示、隐藏任务内容时不带标题和回复）。
- 浏览器模拟桥接检查：单击展开、悬停展开、自动弹出的提问卡在失焦时收起，提问草稿保留，Esc 照常；对话卡空闲/进行中两种布局、Shift+Enter 换行、Enter 发送、发送中禁用、成功清空、失败保留原文并显示原因、审批/提问时隐藏对话卡、关闭开关后隐藏；空闲与预览模式下面板底部不被裁切（窗口高度 460 → 540）。
- 尚未在 Windows 上运行 `npm run test:desktop`，也未在真实 Harness 中从灵动岛发出消息；需要安装后确认中文输入法回车、失焦收起和消息出现在 Harness 对话记录中。
