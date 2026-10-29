// DeepSeek Island — Harness「设置 › 灵动岛」页面（浏览器半侧）。
// 由 Harness 的模块系统按 package.json 的 dsh.client 声明加载；读写宿主条目 "dsh-island" 的 volatile 配置，
// 保存后宿主即时转发给桌面上的灵动岛，无需重启。
window.__ModuleLoader__.load({
	id: "dsh-island",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { jsx, jsxs } = require("react/jsx-runtime");

		const css = `
.dshi-section{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.dshi-heading{margin:0;font-size:18px;font-weight:600}
.dshi-intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dshi-card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl,14px);background:var(--dsw-alias-settings-card-fill);display:flex;flex-direction:column}
.dshi-place{display:flex;gap:20px;align-items:center;padding:16px}
.dshi-screen{position:relative;flex:none;width:232px;height:142px;border-radius:12px;overflow:hidden;
  background:linear-gradient(150deg,#dfe6ff 0%,#eceef5 50%,#f6e3dc 100%);border:.5px solid var(--dsw-alias-settings-card-stroke);box-shadow:inset 0 0 0 4px rgba(0,0,0,.04)}
.dshi-taskbar{position:absolute;left:4px;right:4px;bottom:4px;height:10px;border-radius:0 0 8px 8px;background:rgba(20,24,40,.12)}
.dshi-spot{position:absolute;display:grid;place-items:center;width:52px;height:24px;border:0;padding:0;border-radius:8px;background:transparent;cursor:pointer}
.dshi-spot:hover{background:rgba(77,107,254,.10)}
.dshi-spot:focus-visible{outline:2px solid #4d6bfe;outline-offset:1px}
.dshi-spot i{display:block;width:30px;height:9px;border-radius:5px;background:rgba(20,24,40,.22);transition:background .2s,transform .35s cubic-bezier(.34,1.56,.64,1),box-shadow .3s}
.dshi-spot[aria-checked="true"] i{background:#05070d;transform:scale(1.25);box-shadow:0 2px 8px rgba(0,0,0,.25),inset -6px 0 0 -3px #4d6bfe}
.dshi-spot.v{width:24px;height:52px}
.dshi-spot.v i{width:9px;height:30px}
.dshi-spot.v[aria-checked="true"] i{box-shadow:0 2px 8px rgba(0,0,0,.25),inset 0 -6px 0 -3px #4d6bfe}
.dshi-place-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
.dshi-place-copy strong{font-size:15px;font-weight:600}
.dshi-place-copy span{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dshi-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 16px;border-top:.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))}
.dshi-row:first-child{border-top:0}
.dshi-label{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshi-label b{font-size:14px;font-weight:500}
.dshi-label span{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dshi-seg{display:inline-flex;flex:none;padding:2px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))}
.dshi-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;height:26px;padding:0 12px;border-radius:7px;cursor:pointer}
.dshi-seg button[aria-checked="true"]{background:var(--dsw-alias-bg-base, #fff);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.dshi-switch{position:relative;flex:none;width:36px;height:20px;border:0;padding:0;border-radius:10px;background:rgba(127,127,127,.32);cursor:pointer;transition:background .2s}
.dshi-switch::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
.dshi-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary, #4d6bfe)}
.dshi-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dshi-switch:disabled,.dshi-seg button:disabled,.dshi-spot:disabled{cursor:default;opacity:.55}
.dshi-note{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshi-note.warn{color:var(--dsw-alias-state-warn-label, #b7791f)}
`;
		const tagId = "dsh-island/settings.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-island";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const zh = {
			nav: "灵动岛",
			title: "灵动岛",
			intro: "桌面上的 DeepSeek 灵动岛会实时显示任务状态。这里的修改会立即应用到灵动岛。",
			enabled: "显示灵动岛",
			enabledHint: "关闭后灵动岛隐藏；也可以随时点击系统托盘里的蓝色鲸鱼。",
			position: "停靠位置",
			positionHint: "在示意屏幕上点选。左右两侧会变成竖向小胶囊，悬停时展开。",
			size: "大小",
			sizeHint: "按你的屏幕选择合适的尺寸。",
			popups: "弹出提醒",
			popupsHint: "任务开始、完成、需要你确认或出错时，灵动岛短暂放大显示。",
			details: "显示任务内容",
			detailsHint: "在灵动岛里显示任务标题、计划进度和工具步骤。关闭后只显示状态。",
			questions: "在灵动岛回答提问",
			questionsHint: "Agent 提问时灵动岛自动展开，可以直接选择或输入回答；Harness 窗口里也照常可答，先答的生效。计划审阅等需要看全文的问题仍在 Harness 中回答。",
			balance: "显示账户余额",
			balanceHint: "空闲时在灵动岛里显示 DeepSeek 账户余额（需在 设置 › 账户 中登录 DeepSeek 账号）。",
			approvals: "在灵动岛批准权限请求",
			approvalsHint: "Agent 需要授权时（如执行命令、修改文件），灵动岛显示要做什么，可直接“允许一次”或“拒绝”；Harness 窗口里也照常可批，先批的生效。始终允许等持久授权仍在 Harness 中设置。",
			chat: "在灵动岛给 Agent 发消息",
			chatHint: "展开面板里有输入框，可以接着当前或最近的任务对话，不用打开 Harness；任务进行中可以排队（这一轮结束后发送）或插话。消息和在 Harness 输入框里发的一样，会出现在对话记录里。",
			hoverExpand: "悬停展开面板",
			hoverExpandHint: "鼠标在灵动岛上停留片刻即展开面板，移开后自动收起；关闭后需要点击展开。",
			reduceMotion: "减少动态效果",
			reduceMotionHint: "关闭灵动岛的循环动画和弹性过渡。",
			small: "小巧", medium: "适中", large: "舒展",
			"top-left": "左上角", "top-center": "顶部居中", "top-right": "右上角",
			"left-center": "左侧居中", "right-center": "右侧居中", "bottom-center": "底部居中",
			loading: "正在读取设置…",
			unavailable: "灵动岛插件当前未加载，暂时无法设置。",
			readOnly: "本部署的设置为只读。",
			failed: "Harness 没有接受这次修改，已恢复原值。"
		};
		const en = {
			nav: "Island",
			title: "DeepSeek Island",
			intro: "The desktop island shows your task status live. Changes here apply to it immediately.",
			enabled: "Show the island",
			enabledHint: "Turn off to hide it; the blue whale in the system tray brings it back.",
			position: "Position",
			positionHint: "Pick a spot on the screen. On the left or right it becomes a vertical pill that widens on hover.",
			size: "Size",
			sizeHint: "Choose what suits your screen.",
			popups: "Pop-up alerts",
			popupsHint: "Briefly enlarge when a task starts, finishes, needs you, or fails.",
			details: "Show task details",
			detailsHint: "Show task titles, plan progress and tool steps. When off, only the status is shown.",
			questions: "Answer questions in the island",
			questionsHint: "When the agent asks, the island opens so you can pick or type an answer; Harness can still answer too, and whichever is first counts. Plan reviews stay in Harness.",
			balance: "Show account balance",
			balanceHint: "Show your DeepSeek account balance when idle (requires signing in under Settings › Account).",
			approvals: "Approve permission requests in the island",
			approvalsHint: "When the agent needs permission (running a command, editing a file), the island shows what it wants to do so you can allow once or reject; Harness can still answer too, and whichever is first counts. Persistent grants stay in Harness.",
			chat: "Message the agent from the island",
			chatHint: "The panel has a message box to continue the current or latest task without opening Harness; while a task runs you can queue a message for after this turn or steer the turn. Messages are the same as ones typed in Harness and appear in the conversation.",
			hoverExpand: "Expand on hover",
			hoverExpandHint: "Resting the pointer on the island opens the panel and moving away closes it; when off, click to expand.",
			reduceMotion: "Reduce motion",
			reduceMotionHint: "Turn off looping animations and springy transitions.",
			small: "Small", medium: "Medium", large: "Large",
			"top-left": "Top left", "top-center": "Top center", "top-right": "Top right",
			"left-center": "Left center", "right-center": "Right center", "bottom-center": "Bottom center",
			loading: "Loading settings…",
			unavailable: "The island plugin is not loaded right now.",
			readOnly: "Settings are read-only in this deployment.",
			failed: "Harness did not accept the change; the previous value was kept."
		};

		const ENTRY = "dsh-island";
		const NS = "settings.dshIsland";
		const DEFAULTS = { enabled: true, position: "top-center", size: "medium", reduceMotion: false, popups: true, details: true, balance: true, questions: true, approvals: true, chat: true, hoverExpand: true };
		const SPOTS = [
			["top-left", { left: 6, top: 6 }], ["top-center", { left: 90, top: 6 }], ["top-right", { right: 6, top: 6 }],
			["left-center", { left: 6, top: 45 }, true], ["right-center", { right: 6, top: 45 }, true], ["bottom-center", { left: 90, bottom: 16 }]
		];

		function Switch({ checked, label, disabled, onChange }) {
			return jsx("button", { type: "button", role: "switch", className: "dshi-switch", "aria-checked": checked, "aria-label": label, disabled, onClick: () => onChange(!checked) });
		}
		function Row({ label, hint, children }) {
			return jsxs("div", { className: "dshi-row", children: [jsxs("div", { className: "dshi-label", children: [jsx("b", { children: label }), jsx("span", { children: hint })] }), children] });
		}

		function IslandSection({ t, useIsland, write }) {
			const snap = useIsland((value) => value);
			const [pending, setPending] = React.useState({});
			const [failed, setFailed] = React.useState(false);
			const ready = snap.status === "ready";
			const disabled = !ready || !snap.writable;
			const value = (key) => Object.hasOwn(pending, key) ? pending[key] : ready && snap.value?.[key] !== undefined ? snap.value[key] : DEFAULTS[key];
			const set = (key, next) => {
				if (disabled || value(key) === next) return;
				setFailed(false);
				setPending((p) => ({ ...p, [key]: next }));
				Promise.resolve(write(key, next, snap.base?.[key] ?? DEFAULTS[key])).then((ok) => { if (ok === false) setFailed(true); }, () => setFailed(true))
					.finally(() => setPending((p) => { const n = { ...p }; delete n[key]; return n; }));
			};
			const position = value("position");
			const status = snap.status === "loading" ? t("loading") : snap.status === "unavailable" ? t("unavailable") : !snap.writable ? t("readOnly") : failed ? t("failed") : "";
			return jsxs("div", { className: "dshi-section", children: [
				jsx("h2", { className: "dshi-heading", children: t("title") }),
				jsx("p", { className: "dshi-intro", children: t("intro") }),
				status && jsx("p", { className: "dshi-note" + (failed ? " warn" : ""), role: "status", children: status }),
				jsxs("div", { className: "dshi-card", children: [
					jsxs("div", { className: "dshi-place", children: [
						jsxs("div", { className: "dshi-screen", role: "radiogroup", "aria-label": t("position"), children: [
							...SPOTS.map(([id, style, vertical]) => jsx("button", {
								type: "button", role: "radio", className: "dshi-spot" + (vertical ? " v" : ""), style, title: t(id), "aria-label": t(id),
								"aria-checked": position === id, disabled, onClick: () => set("position", id), children: jsx("i", {})
							}, id)),
							jsx("span", { className: "dshi-taskbar" }, "taskbar")
						] }),
						jsxs("div", { className: "dshi-place-copy", children: [jsx("span", { children: t("position") }), jsx("strong", { children: t(position) }), jsx("span", { children: t("positionHint") })] })
					] })
				] }),
				jsxs("div", { className: "dshi-card", children: [
					jsx(Row, { label: t("enabled"), hint: t("enabledHint"), children: jsx(Switch, { checked: value("enabled"), label: t("enabled"), disabled, onChange: (v) => set("enabled", v) }) }),
					jsx(Row, { label: t("size"), hint: t("sizeHint"), children: jsx("div", { className: "dshi-seg", role: "radiogroup", "aria-label": t("size"), children: ["small", "medium", "large"].map((id) =>
						jsx("button", { type: "button", role: "radio", "aria-checked": value("size") === id, disabled, onClick: () => set("size", id), children: t(id) }, id)) }) }),
					jsx(Row, { label: t("popups"), hint: t("popupsHint"), children: jsx(Switch, { checked: value("popups"), label: t("popups"), disabled, onChange: (v) => set("popups", v) }) }),
					jsx(Row, { label: t("details"), hint: t("detailsHint"), children: jsx(Switch, { checked: value("details"), label: t("details"), disabled, onChange: (v) => set("details", v) }) }),
					jsx(Row, { label: t("questions"), hint: t("questionsHint"), children: jsx(Switch, { checked: value("questions"), label: t("questions"), disabled, onChange: (v) => set("questions", v) }) }),
					jsx(Row, { label: t("approvals"), hint: t("approvalsHint"), children: jsx(Switch, { checked: value("approvals"), label: t("approvals"), disabled, onChange: (v) => set("approvals", v) }) }),
					jsx(Row, { label: t("chat"), hint: t("chatHint"), children: jsx(Switch, { checked: value("chat"), label: t("chat"), disabled, onChange: (v) => set("chat", v) }) }),
					jsx(Row, { label: t("hoverExpand"), hint: t("hoverExpandHint"), children: jsx(Switch, { checked: value("hoverExpand"), label: t("hoverExpand"), disabled, onChange: (v) => set("hoverExpand", v) }) }),
					jsx(Row, { label: t("balance"), hint: t("balanceHint"), children: jsx(Switch, { checked: value("balance"), label: t("balance"), disabled, onChange: (v) => set("balance", v) }) }),
					jsx(Row, { label: t("reduceMotion"), hint: t("reduceMotionHint"), children: jsx(Switch, { checked: value("reduceMotion"), label: t("reduceMotion"), disabled, onChange: (v) => set("reduceMotion", v) }) })
				] })
			] });
		}

		const inject = ["slots", "locale", "configForms"];
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-island: dictionaries");
			const form = ctx.configForms.get(ENTRY);
			// 与继承值相同的选择清除覆盖，让默认值继续生效。
			const write = (key, next, inherited) => next === inherited ? form.unset(key) : form.set(key, next);
			ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-island",
				order: 30,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ hooks: { island: form }, write })
			}, IslandSection))), "dsh-island: settings section");
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
