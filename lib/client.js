window.__ModuleLoader__.load({
	id: "dsh-neartoken",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/protocol.ts
		/**
		* The wire vocabulary shared by the Host routes and the browser section: the
		* route paths and the JSON each answers. Both build faces import this file, so
		* a route rename cannot leave the browser calling a path the Host stopped
		* serving.
		*
		* Nothing here carries a password: the plugin never collects site credentials.
		* A connection is authorized by the site's own device-authorization flow, in
		* the user's browser — the Host only polls its result.
		*
		* @module
		*/
		/** State read by the settings page before it draws, and while it waits. */
		const STATUS_PATH = "/neartoken/status";
		/**
		* Re-read the wallet right now, then answer with the same state `STATUS_PATH`
		* reads. The Host already refreshes on its own cadence; this is the page asking
		* for that read early, and the answer carries the fresh numbers.
		*/
		const REFRESH_PATH = "/neartoken/refresh";
		/** Start a device authorization (the Host then polls the site). */
		const AUTHORIZE_PATH = "/neartoken/authorize";
		/** Abandon the authorization in progress. */
		const CANCEL_PATH = "/neartoken/cancel";
		/**
		* Ask the Host to open the pending confirmation page in the user's own browser.
		* The request carries no address: the Host opens the one it is waiting on.
		*/
		const OPEN_PATH = "/neartoken/open";
		/** Forget the stored key and revoke it on the site. */
		const LOGOUT_PATH = "/neartoken/logout";
		/** Read the catalog beside the stored whitelist; POST a new whitelist. */
		const MODELS_PATH = "/neartoken/models";
		/** Read the picture models and the image-generation setting; POST one change to it. */
		const IMAGES_PATH = "/neartoken/images";
		//#endregion
		//#region src/client/api.ts
		/**
		* The browser half of the settings-page carrier: same-origin calls to the Host
		* routes declared in ../protocol.ts.
		*
		* @module
		*/
		/**
		* Read one JSON answer, turning an HTTP refusal into a thrown error.
		* @param response - the pending response.
		* @returns the parsed body.
		* @throws {Error} when the route answered a non-2xx status.
		*/
		async function jsonOf(response) {
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			return await response.json();
		}
		/**
		* Build the carrier.
		* @param fetcher - HTTP carrier; defaults to the page's own fetch.
		* @returns the section's four calls.
		*/
		function createNearTokenApi(fetcher = (input, init) => fetch(input, init)) {
			/** POST one empty JSON body and read its JSON answer. */
			const post = async (path) => jsonOf(await fetcher(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}"
			}));
			return {
				async status() {
					return await jsonOf(await fetcher(STATUS_PATH, { headers: { accept: "application/json" } }));
				},
				async refreshAccount() {
					return await post(REFRESH_PATH);
				},
				async begin() {
					return await post(AUTHORIZE_PATH);
				},
				async cancel() {
					await post(CANCEL_PATH);
				},
				async openBrowser() {
					const response = await fetcher(OPEN_PATH, { method: "POST" });
					if (!response.ok) {
						const refusal = await response.json().catch(() => ({ message: `HTTP ${String(response.status)}` }));
						throw new Error(refusal.message ?? `HTTP ${String(response.status)}`);
					}
				},
				async signOut() {
					await post(LOGOUT_PATH);
				},
				async models() {
					return await jsonOf(await fetcher(MODELS_PATH, { headers: { accept: "application/json" } }));
				},
				async saveModels(enabled, meta) {
					await jsonOf(await fetcher(MODELS_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							enabled,
							...meta === void 0 ? {} : { meta }
						})
					}));
				},
				async images() {
					return await jsonOf(await fetcher(IMAGES_PATH, { headers: { accept: "application/json" } }));
				},
				async saveImages(patch) {
					const response = await fetcher(IMAGES_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch)
					});
					if (!response.ok) {
						const refusal = await response.json().catch(() => ({ message: `HTTP ${String(response.status)}` }));
						throw new Error(refusal.message ?? `HTTP ${String(response.status)}`);
					}
				}
			};
		}
		//#endregion
		//#region src/client/groups.ts
		/**
		* The group dimension, folded out of catalog names.
		*
		* The NearToken provider (this plugin's own host half) expands the site's
		* `/api/pricing` into one catalog model per (group, model) pair, named
		* `"<model> @ <group>"`. The picker folds those back into one row per model
		* and turns the group into its own selectable level.
		*
		* Group names carry a badge convention on the site: a run of bracketed tags
		* before the group's own name (`[低价][反重力] Claude`). Those render as
		* colored capsules; the ratio comes through the catalog entry's description
		* (`分组倍率 0.4x`).
		*
		* Prototype scope: the provider allowlist and the name separator are
		* hardcoded. They become Config fields once the shape settles.
		*/
		/** Providers whose catalog names carry a group suffix. */
		const GROUPED_PROVIDERS = ["neartoken"];
		/** Tags that carry a tier meaning, with the hue the site gives each of them. */
		const KNOWN_TAG_TONES = {
			满血: "rose",
			低价: "emerald",
			神秘: "violet",
			官Key: "sky",
			官key: "sky",
			可蒸馏: "amber",
			反重力: "cyan",
			生图: "fuchsia",
			AIS: "indigo",
			稳定: "teal"
		};
		/** Hues used by tags with no tier meaning, spread out so neighbours differ. */
		const FALLBACK_TONES = [
			"sky",
			"amber",
			"cyan",
			"fuchsia",
			"indigo",
			"teal",
			"lime",
			"orange",
			"pink",
			"emerald",
			"violet",
			"rose"
		];
		/**
		* @param tag - one bracketed tag's text.
		* @returns a stable bucket for hue selection.
		*/
		function hashTag(tag) {
			let hash = 0;
			for (const char of tag) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100003;
			return hash;
		}
		/** Separator between a model name and its group suffix in the catalog name. */
		const GROUP_SEPARATOR = " @ ";
		/**
		* Split one catalog name into the model's own name and the optional group.
		* @param name - the catalog model name, e.g. `glm-5.3 @ [低价][满血] 国模`.
		* @returns the model name without the suffix, plus the group when present.
		*/
		function splitModelName(name) {
			const at = name.lastIndexOf(GROUP_SEPARATOR);
			if (at <= 0) return { model: name };
			const group = name.slice(at + 3).trim();
			const model = name.slice(0, at).trim();
			if (model === "" || group === "") return { model: name };
			return {
				model,
				group
			};
		}
		/**
		* Parse one group name's bracketed badge prefix.
		* @param name - the raw group name, e.g. `[低价][反重力] Claude`.
		* @returns the badge capsules (in order) and the group's own name.
		*/
		function parseGroupLabel(name) {
			const badges = [];
			let rest = name;
			while (rest.startsWith("[")) {
				const end = rest.indexOf("]");
				if (end <= 1) break;
				badges.push(badgeOf(rest.slice(1, end)));
				rest = rest.slice(end + 1);
			}
			return {
				badges,
				label: rest.trim()
			};
		}
		/**
		* @param text - one bracketed badge's text.
		* @returns the capsule tone that text renders in.
		*/
		function badgeOf(text) {
			const known = KNOWN_TAG_TONES[text.trim()];
			if (known !== void 0) return {
				text,
				tone: known
			};
			return {
				text,
				tone: FALLBACK_TONES[hashTag(text) % FALLBACK_TONES.length] ?? "sky"
			};
		}
		/**
		* The capitals each vendor writes its own family name with.
		*
		* The catalog publishes ids in lowercase only, so the display name has to put
		* them back: GPT and GLM are acronyms, DeepSeek is camel case, MiniMax and MiMo
		* keep an inner capital, and the `xhigh` effort is spelled `XHigh` everywhere
		* else in the product.
		*/
		const BRAND_SPELLING = {
			gpt: "GPT",
			glm: "GLM",
			deepseek: "DeepSeek",
			minimax: "MiniMax",
			mimo: "MiMo",
			xhigh: "XHigh",
			tts: "TTS"
		};
		/**
		* Render a model name the way the pickers show it: hyphens become separators
		* and every word is capitalized, so `claude-opus-5-c` reads `Claude Opus 5 C`.
		* A vendor's own spelling wins over that rule (`gpt-5.5` reads `GPT 5.5`).
		*
		* The trailing `-c` stays a word on purpose: the site pairs every such model
		* with a twin that lacks the suffix (`claude-opus-5` beside `claude-opus-5-c`),
		* so dropping it from the display would leave two different models with the
		* same name. {@link isCodingUnfriendly} is what tells the reader which one it
		* is looking at.
		* @param model - a bare model name.
		* @returns the display name.
		*/
		function displayModelName(model) {
			return model.split("-").filter((part) => part.length > 0).map((part) => BRAND_SPELLING[part.toLowerCase()] ?? part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
		}
		/**
		* Read the group ratio out of the host-provided catalog description.
		* @param description - the catalog entry's description (`分组倍率 0.4x`).
		* @returns the ratio caption, or undefined when the entry carries none.
		*/
		function ratioOf(description) {
			if (description === void 0) return void 0;
			const match = description.match(/([\d.]+)x/);
			return match === null ? void 0 : `${match[1]}x`;
		}
		/**
		* @param provider - a catalog provider id.
		* @returns whether this provider's model names carry group suffixes.
		*/
		function isGroupedProvider(provider) {
			return GROUPED_PROVIDERS.includes(provider);
		}
		/**
		* Fold one provider's models into rows, one per model name.
		*
		* A provider outside {@link GROUPED_PROVIDERS} keeps a 1:1 mapping (no suffix
		* parsing), so its rows behave exactly like the built-in picker's.
		* @param provider - the catalog provider id.
		* @param models - that provider's catalog models, in catalog order.
		* @returns one option per distinct model name, in first-seen order.
		*/
		function foldModels(provider, models) {
			const grouped = isGroupedProvider(provider);
			const byKey = /* @__PURE__ */ new Map();
			for (const model of models) {
				const { model: label, group } = grouped ? splitModelName(model.name) : {
					model: model.name,
					group: void 0
				};
				const key = grouped ? label : model.id;
				const row = byKey.get(key);
				const variant = {
					provider,
					model,
					...group === void 0 ? {} : { group }
				};
				if (row === void 0) byKey.set(key, {
					label,
					variants: [variant]
				});
				else row.variants.push(variant);
			}
			return [...byKey].map(([key, row]) => ({
				key,
				label: row.label,
				variants: row.variants
			}));
		}
		/**
		* Pick the variant a model row should route to.
		* @param option - the row being chosen.
		* @param preferredProvider - the currently selected provider, kept when it offers the model.
		* @param preferredGroup - the currently selected group, kept when that provider offers it.
		* @returns the variant to submit.
		*/
		function chooseVariant(option, preferredProvider, preferredGroup) {
			const local = option.variants.filter((variant) => variant.provider === preferredProvider);
			const pool = local.length > 0 ? local : option.variants;
			return pool.find((variant) => variant.group === preferredGroup) ?? pool[0];
		}
		//#endregion
		//#region \0dsh-css:D:\Projects\deepseek-harness\dsh-neartoken\src\client\group-tags.module.css.mjs
		const css$2 = ".FotuUq_tag{background:hsl(var(--tag-hue) 70% 45% / 12%);color:hsl(var(--tag-hue) 62% 36%);white-space:nowrap;border-radius:4px;flex:none;padding:0 5px;font-size:10px;font-weight:500;line-height:16px}body[data-ds-dark-theme] .FotuUq_tag{background:hsl(var(--tag-hue) 70% 60% / 18%);color:hsl(var(--tag-hue) 75% 76%)}.FotuUq_toneRose{--tag-hue:350}.FotuUq_toneEmerald{--tag-hue:160}.FotuUq_toneViolet{--tag-hue:258}.FotuUq_toneSky{--tag-hue:199}.FotuUq_toneAmber{--tag-hue:38}.FotuUq_toneCyan{--tag-hue:189}.FotuUq_toneFuchsia{--tag-hue:292}.FotuUq_toneIndigo{--tag-hue:239}.FotuUq_toneTeal{--tag-hue:173}.FotuUq_toneLime{--tag-hue:84}.FotuUq_toneOrange{--tag-hue:25}.FotuUq_tonePink{--tag-hue:330}.FotuUq_ratioChip{font-variant-numeric:tabular-nums;white-space:nowrap;border:1px solid #0000;border-radius:999px;flex:none;padding:0 6px;font-size:10px;line-height:15px}.FotuUq_ratioCheap{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#1a7f37) 40%, transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}.FotuUq_ratioPricey{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-label,#9a6700) 40%, transparent);color:var(--dsw-alias-state-warn-label,#9a6700)}.FotuUq_ratioBase{border-color:var(--dsw-alias-settings-card-stroke);color:var(--dsw-alias-label-tertiary)}";
		const tagId$2 = "dsh-neartoken/group-tags.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-neartoken";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var group_tags_module_css_default = {
			"toneCyan": "FotuUq_toneCyan",
			"toneIndigo": "FotuUq_toneIndigo",
			"toneSky": "FotuUq_toneSky",
			"toneEmerald": "FotuUq_toneEmerald",
			"toneOrange": "FotuUq_toneOrange",
			"tag": "FotuUq_tag",
			"toneFuchsia": "FotuUq_toneFuchsia",
			"toneRose": "FotuUq_toneRose",
			"toneTeal": "FotuUq_toneTeal",
			"toneLime": "FotuUq_toneLime",
			"toneAmber": "FotuUq_toneAmber",
			"ratioCheap": "FotuUq_ratioCheap",
			"ratioBase": "FotuUq_ratioBase",
			"ratioChip": "FotuUq_ratioChip",
			"toneViolet": "FotuUq_toneViolet",
			"tonePink": "FotuUq_tonePink",
			"ratioPricey": "FotuUq_ratioPricey"
		};
		//#endregion
		//#region src/client/group-tags.tsx
		/** CSS Module class carrying each tone's hue, kept parallel to {@link BadgeTone}. */
		const TONE_CLASS = {
			rose: group_tags_module_css_default.toneRose,
			emerald: group_tags_module_css_default.toneEmerald,
			violet: group_tags_module_css_default.toneViolet,
			sky: group_tags_module_css_default.toneSky,
			amber: group_tags_module_css_default.toneAmber,
			cyan: group_tags_module_css_default.toneCyan,
			fuchsia: group_tags_module_css_default.toneFuchsia,
			indigo: group_tags_module_css_default.toneIndigo,
			teal: group_tags_module_css_default.toneTeal,
			lime: group_tags_module_css_default.toneLime,
			orange: group_tags_module_css_default.toneOrange,
			pink: group_tags_module_css_default.tonePink
		};
		/** One bracketed group tag as a coloured capsule. */
		function GroupTag(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: group_tags_module_css_default.tag + " " + TONE_CLASS[props.tone],
				children: props.text
			});
		}
		/**
		* One group's multiplier as a capsule.
		* @param props - the multiplier caption the catalog carried (`0.3x`).
		* @returns the capsule, toned by whether it beats the base price.
		*/
		function RatioChip(props) {
			const value = Number.parseFloat(props.ratio);
			let tone = group_tags_module_css_default.ratioBase;
			if (Number.isFinite(value)) {
				if (value < 1) tone = group_tags_module_css_default.ratioCheap;
				else if (value > 1) tone = group_tags_module_css_default.ratioPricey;
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: group_tags_module_css_default.ratioChip + " " + tone,
				children: props.ratio
			});
		}
		//#endregion
		//#region \0dsh-css:D:\Projects\deepseek-harness\dsh-neartoken\src\client\ModelGroupSelect.module.css.mjs
		const css$1 = "._2pt-bW_root{min-width:0;position:relative}._2pt-bW_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}._2pt-bW_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._2pt-bW_trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}._2pt-bW_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._2pt-bW_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}._2pt-bW_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}._2pt-bW_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}._2pt-bW_chevron{color:var(--dsw-alias-label-caption);flex:none}._2pt-bW_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}._2pt-bW_status,._2pt-bW_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}._2pt-bW_error,._2pt-bW_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}._2pt-bW_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}._2pt-bW_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}._2pt-bW_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}._2pt-bW_searchRow ._2pt-bW_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}._2pt-bW_searchRow ._2pt-bW_search input{padding:0;font-size:12px;line-height:normal}._2pt-bW_searchClear{width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}._2pt-bW_searchClear:hover,._2pt-bW_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}._2pt-bW_groups{min-height:0;overflow-y:auto}._2pt-bW_option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}._2pt-bW_option:not(._2pt-bW_modelOption):hover:not(:disabled),._2pt-bW_option:focus-visible,._2pt-bW_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._2pt-bW_selected{background:0 0}._2pt-bW_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._2pt-bW_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}._2pt-bW_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}._2pt-bW_optionTrailing{flex:none;align-items:center;gap:6px;display:flex}._2pt-bW_variantCount{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:0 5px;font-size:10px;line-height:16px}._2pt-bW_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}._2pt-bW_check svg{width:14px;height:14px}._2pt-bW_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}._2pt-bW_cell:hover:not(:disabled),._2pt-bW_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}._2pt-bW_cell:disabled{cursor:default}._2pt-bW_cellLabel{white-space:nowrap;flex:none}._2pt-bW_cellValue{text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;justify-content:flex-end;display:flex;overflow:hidden}._2pt-bW_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}._2pt-bW_groupInline{align-items:center;gap:4px;min-width:0;display:inline-flex;overflow:hidden}._2pt-bW_groupName{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}._2pt-bW_groupOptionLabel{align-items:center;min-width:0;display:flex;overflow:hidden}._2pt-bW_toast{z-index:1100;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);max-width:320px;color:var(--dsw-alias-state-error-primary);padding:6px 10px;font-size:11px;line-height:16px;position:absolute;bottom:calc(100% + 6px);right:0}";
		const tagId$1 = "dsh-neartoken/ModelGroupSelect.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-neartoken";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var ModelGroupSelect_module_css_default = {
			"optionTrailing": "_2pt-bW_optionTrailing",
			"root": "_2pt-bW_root",
			"groupOptionLabel": "_2pt-bW_groupOptionLabel",
			"status": "_2pt-bW_status",
			"groups": "_2pt-bW_groups",
			"triggerLabel": "_2pt-bW_triggerLabel",
			"optionCopy": "_2pt-bW_optionCopy",
			"variantCount": "_2pt-bW_variantCount",
			"option": "_2pt-bW_option",
			"modelOption": "_2pt-bW_modelOption",
			"warning": "_2pt-bW_warning",
			"modelName": "_2pt-bW_modelName",
			"check": "_2pt-bW_check",
			"toast": "_2pt-bW_toast",
			"triggerIcon": "_2pt-bW_triggerIcon",
			"empty": "_2pt-bW_empty",
			"retry": "_2pt-bW_retry",
			"error": "_2pt-bW_error",
			"cellLabel": "_2pt-bW_cellLabel",
			"menu": "_2pt-bW_menu",
			"searchRow": "_2pt-bW_searchRow",
			"searchClear": "_2pt-bW_searchClear",
			"cell": "_2pt-bW_cell",
			"triggerEffort": "_2pt-bW_triggerEffort",
			"selected": "_2pt-bW_selected",
			"cellValue": "_2pt-bW_cellValue",
			"cellChevron": "_2pt-bW_cellChevron",
			"groupName": "_2pt-bW_groupName",
			"search": "_2pt-bW_search",
			"optionActive": "_2pt-bW_optionActive",
			"chevron": "_2pt-bW_chevron",
			"groupInline": "_2pt-bW_groupInline",
			"trigger": "_2pt-bW_trigger"
		};
		//#endregion
		//#region src/client/ModelGroupSelect.tsx
		/**
		* ModelGroupSelect: a drop-in replacement for the composer's model seat
		* ('conversation.input.model') that adds a THIRD level between the model and
		* the reasoning effort.
		*
		* The root menu is a row triple — Model / Group / Effort — where the Group row
		* appears only while the selected model comes from a provider whose catalog
		* names carry a group suffix (see groups.ts). The trigger states all three:
		* "GLM 5.3 · Zhang · high".
		*
		* Registered at priority -1, one step below the built-in seat, so the shipped
		* picker stays untouched and simply does not render.
		*/
		/** Unplaced portal card: hidden but laid out at a fixed origin so offset sizes are real. */
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		/** Provider display order: account first, official next, then catalog order. */
		function providerRank(id) {
			return id === "deepseek-account" ? 0 : id === "deepseek-official" ? 1 : 2;
		}
		/**
		* Case-insensitive containment filter for the model search.
		* @param label - the row's display name.
		* @param query - the trimmed search text; empty keeps every row.
		* @returns whether the row stays visible.
		*/
		function matchesQuery(label, query) {
			return query === "" || label.toLowerCase().includes(query.toLowerCase());
		}
		/**
		* Keep the effort the user already picked when the new model offers it.
		* @param model - the catalog model the selection will route to.
		* @param previous - the effort in use before the switch.
		* @returns the effort to submit, or undefined for a model without reasoning.
		*/
		function effortFor(model, previous) {
			const reasoning = model.reasoning;
			if (reasoning === void 0) return void 0;
			if (previous !== void 0 && reasoning.efforts.some((level) => level.id === previous)) return previous;
			return reasoning.defaultEffort;
		}
		/**
		* Render the composer model seat with the group level.
		* @param props - owner share (locked) + injected directory face + the locale seat.
		* @returns the trigger and, while open, the three-level menu.
		*/
		function ModelGroupSelect({ locked, available, directory, load, select, t }) {
			const state = (0, react.useSyncExternalStore)((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			const [open, setOpen] = (0, react.useState)(false);
			const [pane, setPane] = (0, react.useState)("root");
			const [query, setQuery] = (0, react.useState)("");
			const [highlighted, setHighlighted] = (0, react.useState)(0);
			const [toast, setToast] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const menuRef = (0, react.useRef)(null);
			const searchRef = (0, react.useRef)(null);
			const [menuPos, setMenuPos] = (0, react.useState)(null);
			const id = (0, react.useId)();
			const accountName = t("provider.account");
			const providers = (0, react.useMemo)(() => state.groups.map((group) => ({
				id: group.id,
				name: group.id === "deepseek-account" ? accountName : group.name,
				options: foldModels(group.id, group.models)
			})).toSorted((left, right) => providerRank(left.id) - providerRank(right.id)), [state.groups, accountName]);
			const current = state.current;
			const located = (0, react.useMemo)(() => {
				for (const provider of providers) for (const option of provider.options) for (const variant of option.variants) if (variant.provider === current?.provider && variant.model.id === current.model) return {
					provider,
					option,
					variant
				};
			}, [providers, current]);
			const reasoning = located?.variant.model.reasoning;
			const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel = located === void 0 ? void 0 : reasoning === void 0 ? state.retainedEffort : effectiveEffort === void 0 ? t("effort.providerDefault") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
			const currentGroup = located?.variant.group;
			const groupChoices = (0, react.useMemo)(() => located === void 0 || currentGroup === void 0 ? [] : located.option.variants.filter((variant) => variant.provider === located.provider.id && variant.group !== void 0), [located, currentGroup]);
			const filteredProviders = (0, react.useMemo)(() => {
				const trimmed = query.trim();
				return providers.map((provider) => ({
					...provider,
					options: provider.options.filter((option) => matchesQuery(option.label, trimmed))
				})).filter((provider) => provider.options.length > 0);
			}, [providers, query]);
			const visibleOptions = (0, react.useMemo)(() => filteredProviders.flatMap((provider) => provider.options.map((option) => ({
				provider,
				option
			}))), [filteredProviders]);
			const showSearch = providers.reduce((total, provider) => total + provider.options.length, 0) > 4;
			const activeIndex = Math.min(highlighted, Math.max(0, visibleOptions.length - 1));
			const { pending } = state;
			const busy = pending !== null;
			const waiting = located === void 0 && state.status === "loading";
			const show = () => {
				triggerRef.current?.focus();
				setQuery("");
				setHighlighted(0);
				setPane(located === void 0 ? "model" : "root");
				setOpen(true);
				load();
			};
			const close = (restoreFocus = false) => {
				setOpen(false);
				setPane("root");
				if (restoreFocus) queueMicrotask(() => {
					triggerRef.current?.focus();
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (rootRef.current?.contains(event.target) === true) return;
					if (menuRef.current?.contains(event.target) === true) return;
					setOpen(false);
					setPane("root");
				};
				document.addEventListener("mousedown", closeOutside);
				return () => {
					document.removeEventListener("mousedown", closeOutside);
				};
			}, [open]);
			(0, react.useLayoutEffect)(() => {
				if (!available || !open) {
					setMenuPos(null);
					return;
				}
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect === void 0) return;
					const MARGIN = 12;
					const width = menuRef.current?.offsetWidth ?? 0;
					const height = menuRef.current?.offsetHeight ?? 0;
					let x = rect.right - width;
					let y = rect.top - 8 - height;
					if (width > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - width - MARGIN);
					if (height > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - height - MARGIN);
					setMenuPos({
						left: x,
						top: y
					});
				};
				place();
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				return () => {
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [
				available,
				open,
				pane,
				state,
				query
			]);
			(0, react.useLayoutEffect)(() => {
				if (open && pane === "model" && showSearch) searchRef.current?.focus();
			}, [
				open,
				pane,
				showSearch
			]);
			if (!available) return null;
			const settle = (result) => {
				if (result === void 0) return;
				if (result.ok) {
					setOpen(false);
					setPane("root");
					return;
				}
				const { error } = result;
				setToast(error.code === "session/writer-held" ? t("error.sessionInUse") : t("error.action", { message: `${error.code}: ${error.message}` }));
			};
			const submit = (selection) => {
				triggerRef.current?.focus();
				select(selection).then(settle);
			};
			const chooseOption = (option) => {
				const variant = chooseVariant(option, current?.provider, currentGroup);
				if (variant === void 0) return;
				if (current?.provider === variant.provider && current.model === variant.model.id) {
					close(true);
					return;
				}
				const effort = effortFor(variant.model, effectiveEffort);
				submit({
					provider: variant.provider,
					model: variant.model.id,
					...effort === void 0 ? {} : { reasoningEffort: effort }
				});
			};
			const chooseGroup = (variant) => {
				if (current === null) return;
				if (variant.model.id === current.model) {
					close(true);
					return;
				}
				const effort = effortFor(variant.model, effectiveEffort);
				submit({
					provider: variant.provider,
					model: variant.model.id,
					...effort === void 0 ? {} : { reasoningEffort: effort }
				});
			};
			const chooseEffort = (effort) => {
				if (current === null) return;
				if (effectiveEffort === effort) {
					close(true);
					return;
				}
				submit({
					provider: current.provider,
					model: current.model,
					...effort === void 0 ? {} : { reasoningEffort: effort }
				});
			};
			const onKeyDown = (event) => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Escape" && open) {
					event.preventDefault();
					if (pane !== "root" && located !== void 0) setPane("root");
					else close(true);
					return;
				}
				if (!open || pane !== "root") return;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					setPane("root");
				}
			};
			const ownProvider = located !== void 0 && isGroupedProvider(located.provider.id);
			const modelLabel = waiting ? t("trigger.loading") : located === void 0 ? t("trigger.fallback") : ownProvider ? `${displayModelName(located.option.label)} @ ${located.provider.name}` : located.option.label;
			const triggerLabel = [modelLabel, effortLabel].filter((part) => part !== void 0 && part !== "").join(" · ");
			const triggerAria = waiting ? t("trigger.loading") : located === void 0 ? t("trigger.selectAria") : t("trigger.aria", { model: modelLabel });
			let optionIndex = 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: ModelGroupSelect_module_css_default.root,
				onKeyDown,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: triggerRef,
						type: "button",
						className: ModelGroupSelect_module_css_default.trigger,
						"aria-label": triggerAria,
						"aria-haspopup": "menu",
						"aria-expanded": open,
						"aria-controls": open ? `${id}-menu` : void 0,
						title: triggerLabel,
						"aria-busy": busy,
						disabled: locked,
						onClick: () => {
							if (open) close(true);
							else show();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutlineRegular, {
								className: ModelGroupSelect_module_css_default.triggerIcon,
								size: 16
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ModelGroupSelect_module_css_default.triggerLabel,
								children: modelLabel
							}),
							effortLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ModelGroupSelect_module_css_default.triggerEffort,
								children: effortLabel
							}),
							busy ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: ModelGroupSelect_module_css_default.chevron })
						]
					}),
					open && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.MenuSurface, {
						ref: menuRef,
						id: `${id}-menu`,
						className: ModelGroupSelect_module_css_default.menu,
						style: menuPos ?? MEASURE_STYLE,
						role: pane === "model" || pane === "group" ? "group" : "menu",
						"aria-label": t("menu.aria"),
						"aria-busy": state.status === "loading" || busy,
						children: [
							pane === "root" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "menuitem",
									className: ModelGroupSelect_module_css_default.cell,
									onClick: () => {
										setPane("model");
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.cellLabel,
											children: t("menu.model")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.cellValue,
											children: modelLabel
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelGroupSelect_module_css_default.cellChevron })
									]
								}),
								currentGroup !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "menuitem",
									className: ModelGroupSelect_module_css_default.cell,
									disabled: groupChoices.length < 2,
									onClick: () => {
										setPane("group");
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.cellLabel,
											children: t("menu.group")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.cellValue,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupInline, {
												group: currentGroup,
												description: located?.variant.model.description,
												showRatio: true
											})
										}),
										groupChoices.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelGroupSelect_module_css_default.cellChevron })
									]
								}),
								reasoning !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "menuitem",
									className: ModelGroupSelect_module_css_default.cell,
									onClick: () => {
										setPane("effort");
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.cellLabel,
											children: t("menu.effort")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.cellValue,
											children: effortLabel
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelGroupSelect_module_css_default.cellChevron })
									]
								})
							] }),
							pane === "model" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								showSearch && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ModelGroupSelect_module_css_default.searchRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										ref: searchRef,
										className: ModelGroupSelect_module_css_default.search,
										type: "text",
										role: "searchbox",
										"aria-label": t("search.placeholder"),
										placeholder: t("search.placeholder"),
										value: query,
										readOnly: busy,
										onChange: (event) => {
											setQuery(event.target.value);
											setHighlighted(0);
										}
									}), query !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ModelGroupSelect_module_css_default.searchClear,
										"aria-label": t("search.clear"),
										disabled: busy,
										onClick: () => {
											setQuery("");
											searchRef.current?.focus();
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFillRegular, {})
									})]
								}),
								state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ModelGroupSelect_module_css_default.status,
									children: t("status.loading")
								}),
								state.error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ModelGroupSelect_module_css_default.error,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ModelGroupSelect_module_css_default.retry,
										onClick: load,
										children: t("action.reload")
									})]
								}),
								state.failures.map((failure) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ModelGroupSelect_module_css_default.warning,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("warning.groupLoad", {
										name: failure.id === "deepseek-account" ? accountName : failure.name,
										message: failure.message
									}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ModelGroupSelect_module_css_default.retry,
										onClick: load,
										children: t("action.reload")
									})]
								}, failure.id)),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ModelGroupSelect_module_css_default.groups,
									role: "menu",
									"aria-label": t("menu.model"),
									hidden: filteredProviders.length === 0,
									children: filteredProviders.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuGroup, {
										label: provider.name,
										children: provider.options.map((option) => {
											const index = optionIndex++;
											const isCurrent = located !== void 0 && located.option.key === option.key && located.provider.id === provider.id;
											const groups = option.variants.filter((variant) => variant.group !== void 0);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												role: "menuitemradio",
												"aria-checked": isCurrent,
												id: `${id}-model-${index}`,
												tabIndex: showSearch ? -1 : 0,
												onFocus: () => {
													setHighlighted(index);
												},
												"data-highlighted": index === activeIndex ? "" : void 0,
												className: ModelGroupSelect_module_css_default.option + " " + ModelGroupSelect_module_css_default.modelOption + " " + (index === activeIndex ? ModelGroupSelect_module_css_default.optionActive : ""),
												title: option.label,
												disabled: busy,
												onMouseMove: () => {
													setHighlighted(index);
												},
												onClick: () => {
													chooseOption(option);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ModelGroupSelect_module_css_default.optionCopy,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: ModelGroupSelect_module_css_default.modelName,
														children: isGroupedProvider(provider.id) ? displayModelName(option.label) : option.label
													})
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: ModelGroupSelect_module_css_default.optionTrailing,
													children: [groups.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: ModelGroupSelect_module_css_default.variantCount,
														children: groups.length
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: ModelGroupSelect_module_css_default.check,
														children: isCurrent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
													})]
												})]
											}, option.key);
										})
									}, provider.id))
								}),
								state.status === "ready" && filteredProviders.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ModelGroupSelect_module_css_default.empty,
									role: "status",
									children: t(providers.length === 0 ? "empty.models" : "search.empty")
								})
							] }),
							pane === "group" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: groupChoices.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ModelGroupSelect_module_css_default.empty,
								children: t("empty.groups")
							}) : groupChoices.map((variant) => {
								const isCurrent = variant.model.id === current?.model;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "menuitemradio",
									"aria-checked": isCurrent,
									className: ModelGroupSelect_module_css_default.option + (isCurrent ? " " + ModelGroupSelect_module_css_default.selected : ""),
									disabled: busy,
									onClick: () => {
										chooseGroup(variant);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ModelGroupSelect_module_css_default.optionCopy,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ModelGroupSelect_module_css_default.groupOptionLabel,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupInline, {
												group: variant.group ?? "",
												description: variant.model.description,
												showRatio: true
											})
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ModelGroupSelect_module_css_default.check,
										children: isCurrent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
									})]
								}, variant.model.id);
							}) }),
							pane === "effort" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: (reasoning?.efforts.length ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ModelGroupSelect_module_css_default.empty,
								children: t("empty.efforts")
							}) : [...reasoning?.defaultEffort === void 0 ? [{
								id: void 0,
								name: t("effort.providerDefault")
							}] : [], ...(reasoning?.efforts ?? []).map((level) => ({
								id: level.id,
								name: level.name
							}))].map((level) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "menuitemradio",
								"aria-checked": effectiveEffort === level.id,
								className: ModelGroupSelect_module_css_default.option + (effectiveEffort === level.id ? " " + ModelGroupSelect_module_css_default.selected : ""),
								disabled: busy,
								onClick: () => {
									chooseEffort(level.id);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ModelGroupSelect_module_css_default.optionCopy,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ModelGroupSelect_module_css_default.modelName,
										children: level.name
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ModelGroupSelect_module_css_default.check,
									children: effectiveEffort === level.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
								})]
							}, level.id ?? "provider-default")) })
						]
					}), document.body),
					toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ModelGroupSelect_module_css_default.toast,
						role: "status",
						children: toast
					})
				]
			});
		}
		/**
		* One group's inline rendering: badge capsules, its own name, and optionally the
		* ratio badge.
		* @param props - the group key, its hardcoded style, and whether to show the ratio.
		* @returns the inline group value.
		*/
		function GroupInline({ group, description, showRatio = false }) {
			const { badges, label } = parseGroupLabel(group);
			const ratio = showRatio ? ratioOf(description) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ModelGroupSelect_module_css_default.groupInline,
				children: [
					badges.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTag, {
						text: badge.text,
						tone: badge.tone
					}, badge.text)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ModelGroupSelect_module_css_default.groupName,
						children: label
					}),
					ratio !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RatioChip, { ratio })
				]
			});
		}
		//#endregion
		//#region \0dsh-css:D:\Projects\deepseek-harness\dsh-neartoken\src\client\NearTokenSection.module.css.mjs
		const css = "._02HI2q_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}._02HI2q_title{margin:0;font-size:16px;font-weight:500;line-height:24px}._02HI2q_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}._02HI2q_card{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);flex-direction:column;gap:12px;padding:14px 16px;display:flex}._02HI2q_cardHead{align-items:baseline;gap:10px;display:flex}._02HI2q_name{font-size:15px;font-weight:500;line-height:22px}._02HI2q_handle{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}._02HI2q_badge{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);border-radius:999px;margin-left:auto;padding:2px 8px;font-size:12px;line-height:18px}._02HI2q_badgeOn{color:var(--dsw-alias-state-success-primary)}._02HI2q_facts{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:14px 18px;margin:0;padding:12px 14px;display:grid}._02HI2q_fact{flex-direction:column;gap:2px;display:flex}._02HI2q_factLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}._02HI2q_factValue{font-variant-numeric:tabular-nums;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:22px}._02HI2q_valueRow{align-items:center;gap:6px;display:flex}._02HI2q_refresh{border-radius:var(--dsw-radius-sm);width:22px;height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;padding:0;display:inline-flex}._02HI2q_refresh:hover:not(:disabled){background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary)}._02HI2q_refresh:disabled{opacity:.55;cursor:default}._02HI2q_voucherFact{grid-column:1/-1}._02HI2q_voucherList{flex-direction:column;gap:2px;margin:0;display:flex}._02HI2q_voucherRow{justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;line-height:20px;display:flex}._02HI2q_voucherGroup{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}._02HI2q_voucherAmount{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:500}._02HI2q_voucherEmpty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}._02HI2q_invite{color:var(--dsw-alias-label-primary);text-underline-offset:2px;text-decoration:underline}._02HI2q_form{flex-direction:column;gap:10px;display:flex}._02HI2q_label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}._02HI2q_codeRow{align-items:center;gap:10px;display:flex}._02HI2q_code{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);letter-spacing:.08em;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);user-select:all;padding:4px 12px;font-size:18px;line-height:26px}._02HI2q_linkRow{flex-direction:column;gap:4px;display:flex}._02HI2q_linkLine{align-items:flex-start;gap:8px;display:flex}._02HI2q_link{min-width:0;font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);word-break:break-all;color:var(--dsw-alias-label-secondary);user-select:all;flex:auto;font-size:12px;line-height:18px}._02HI2q_actions{align-items:center;gap:10px;display:flex}._02HI2q_metaBtn{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:9px;margin-left:auto;padding:1px 8px;font-size:11px;line-height:18px}._02HI2q_metaBtn:hover{color:var(--dsw-alias-label-primary)}._02HI2q_metaBtnOn{border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-button-primary-fill)}._02HI2q_metaEditor{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-md);flex-direction:column;gap:8px;margin:2px 0 6px 26px;padding:10px 12px;display:flex}._02HI2q_metaTitle{font-weight:600}._02HI2q_metaIntro{color:var(--dsw-alias-label-tertiary);margin:0}._02HI2q_metaField{flex-wrap:wrap;align-items:center;gap:10px;display:flex}._02HI2q_metaLabel{min-width:120px;color:var(--dsw-alias-label-secondary)}._02HI2q_metaInput{width:140px;padding:2px 6px}._02HI2q_metaHint{color:var(--dsw-alias-label-tertiary);font-size:11px}._02HI2q_metaCheck{align-items:center;gap:4px;display:inline-flex}._02HI2q_metaActions{align-items:center;gap:8px;display:flex}._02HI2q_button{border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-button-elevated-fill);height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;padding:0 14px;font-size:14px}._02HI2q_buttonPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:#0000}._02HI2q_button:disabled{opacity:.55;cursor:default}._02HI2q_notice{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}._02HI2q_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}._02HI2q_search{border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-button-elevated-fill);height:32px;color:var(--dsw-alias-label-primary);padding:0 10px;font-size:14px}._02HI2q_search::placeholder{color:var(--dsw-alias-label-dimmed)}._02HI2q_toolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}._02HI2q_autosave{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:12px;line-height:18px}._02HI2q_list{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-md);flex-direction:column;max-height:320px;padding:4px;display:flex;overflow-y:auto}._02HI2q_row{border-radius:var(--dsw-radius-sm);cursor:pointer;align-items:baseline;gap:8px;padding:4px 6px;font-size:13px;line-height:20px;display:flex}._02HI2q_row:hover{background:var(--dsw-alias-interactive-bg-hover)}._02HI2q_row input{accent-color:var(--dsw-alias-button-primary-fill);align-self:center}._02HI2q_rowName{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-primary);flex:auto;overflow:hidden}._02HI2q_rowMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;align-items:baseline;gap:8px;font-size:12px;display:flex}._02HI2q_rowRatio{color:var(--dsw-alias-label-secondary)}._02HI2q_tip{z-index:40;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);pointer-events:none;flex-direction:column;gap:2px;width:280px;max-height:240px;padding:8px 10px;font-size:12px;line-height:18px;display:flex;position:fixed;overflow-y:auto;box-shadow:0 8px 24px #00000024}._02HI2q_tipTitle{color:var(--dsw-alias-label-tertiary)}._02HI2q_tipRow{justify-content:space-between;align-items:baseline;gap:10px;display:flex}._02HI2q_tipGroup{min-width:0;color:var(--dsw-alias-label-primary);align-items:center;gap:4px;display:flex;overflow:hidden}._02HI2q_tipGroupName{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}._02HI2q_select{border:1px solid var(--dsw-color-border-subtle,#0000001f);max-width:60%;color:inherit;font:inherit;background:0 0;border-radius:6px;margin-left:auto;padding:2px 6px;font-size:12px}._02HI2q_select:disabled{opacity:.5}._02HI2q_cardToggle{width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:8px;padding:0;display:flex}._02HI2q_cardToggle:hover ._02HI2q_name{color:var(--dsw-alias-label-primary)}._02HI2q_count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;margin-left:auto;font-size:12px;line-height:18px;display:inline-flex}._02HI2q_countDot{background:var(--dsw-alias-label-dimmed);border-radius:50%;width:3px;height:3px}._02HI2q_countPicked{color:var(--dsw-alias-label-secondary)}._02HI2q_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .12s}._02HI2q_chevronOpen{transform:rotate(180deg)}";
		const tagId = "dsh-neartoken/NearTokenSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-neartoken";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var NearTokenSection_module_css_default = {
			"factValue": "_02HI2q_factValue",
			"countPicked": "_02HI2q_countPicked",
			"metaCheck": "_02HI2q_metaCheck",
			"tipGroup": "_02HI2q_tipGroup",
			"toolbar": "_02HI2q_toolbar",
			"metaHint": "_02HI2q_metaHint",
			"codeRow": "_02HI2q_codeRow",
			"tipRow": "_02HI2q_tipRow",
			"metaLabel": "_02HI2q_metaLabel",
			"row": "_02HI2q_row",
			"metaActions": "_02HI2q_metaActions",
			"rowName": "_02HI2q_rowName",
			"search": "_02HI2q_search",
			"voucherAmount": "_02HI2q_voucherAmount",
			"badge": "_02HI2q_badge",
			"tip": "_02HI2q_tip",
			"intro": "_02HI2q_intro",
			"card": "_02HI2q_card",
			"factLabel": "_02HI2q_factLabel",
			"metaEditor": "_02HI2q_metaEditor",
			"metaTitle": "_02HI2q_metaTitle",
			"metaField": "_02HI2q_metaField",
			"rowMeta": "_02HI2q_rowMeta",
			"rowRatio": "_02HI2q_rowRatio",
			"form": "_02HI2q_form",
			"select": "_02HI2q_select",
			"refresh": "_02HI2q_refresh",
			"notice": "_02HI2q_notice",
			"chevronOpen": "_02HI2q_chevronOpen",
			"cardHead": "_02HI2q_cardHead",
			"linkRow": "_02HI2q_linkRow",
			"metaIntro": "_02HI2q_metaIntro",
			"badgeOn": "_02HI2q_badgeOn",
			"button": "_02HI2q_button",
			"voucherEmpty": "_02HI2q_voucherEmpty",
			"metaBtnOn": "_02HI2q_metaBtnOn",
			"buttonPrimary": "_02HI2q_buttonPrimary",
			"list": "_02HI2q_list",
			"voucherList": "_02HI2q_voucherList",
			"title": "_02HI2q_title",
			"name": "_02HI2q_name",
			"metaInput": "_02HI2q_metaInput",
			"actions": "_02HI2q_actions",
			"label": "_02HI2q_label",
			"link": "_02HI2q_link",
			"hint": "_02HI2q_hint",
			"section": "_02HI2q_section",
			"voucherRow": "_02HI2q_voucherRow",
			"count": "_02HI2q_count",
			"voucherFact": "_02HI2q_voucherFact",
			"countDot": "_02HI2q_countDot",
			"voucherGroup": "_02HI2q_voucherGroup",
			"code": "_02HI2q_code",
			"metaBtn": "_02HI2q_metaBtn",
			"facts": "_02HI2q_facts",
			"valueRow": "_02HI2q_valueRow",
			"tipTitle": "_02HI2q_tipTitle",
			"tipGroupName": "_02HI2q_tipGroupName",
			"chevron": "_02HI2q_chevron",
			"cardToggle": "_02HI2q_cardToggle",
			"invite": "_02HI2q_invite",
			"handle": "_02HI2q_handle",
			"linkLine": "_02HI2q_linkLine",
			"autosave": "_02HI2q_autosave",
			"fact": "_02HI2q_fact"
		};
		//#endregion
		//#region src/client/NearTokenSection.tsx
		/**
		* The NearToken settings page: connect the plugin to the site's account through
		* the site's own device-authorization flow, show whose account is connected, and
		* disconnect.
		*
		* The page never asks for a password. It shows the short code the site issued,
		* offers the site's confirmation page, and re-reads the Host while the Host polls
		* — the key and the provider insertion both happen on the Host side of a grant.
		*/
		/** How often the page re-reads the Host while an authorization is pending. */
		const PENDING_REFRESH_MS = 1500;
		/**
		* How often the page re-reads the Host while connected, so the card shows the
		* wallet numbers the Host re-reads at the same cadence.
		*/
		const CONNECTED_REFRESH_MS = 3e5;
		/** How long a burst of checkbox clicks waits before one save is written. */
		const AUTOSAVE_DELAY_MS = 400;
		/** How long the copy button acknowledges a copied address before resetting. */
		const COPIED_RESET_MS = 2e3;
		/**
		* Render the NearToken settings page.
		* @param props - the injected route carrier and translate, plus slot owner props.
		* @returns the section element tree.
		*/
		function NearTokenSection({ api, t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			/**
			* Whether the card's money facts are being re-read right now. Kept apart from
			* `busy`: a balance read must not disable the buttons beside it.
			*/
			const [walletBusy, setWalletBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			/** Whether the confirmation address was just copied to the clipboard. */
			const [copied, setCopied] = (0, react.useState)(false);
			/** Re-read the Host state and publish it. */
			const refresh = (0, react.useCallback)(async () => {
				try {
					setStatus(await api.status());
				} catch (failure) {
					setError(t("account.failed", { message: messageOf(failure) }));
				}
			}, [api, t]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const pendingCode = status?.pending?.userCode;
			const waiting = pendingCode !== void 0;
			(0, react.useEffect)(() => {
				setCopied(false);
			}, [pendingCode]);
			(0, react.useEffect)(() => {
				if (!copied) return;
				const timer = setTimeout(() => {
					setCopied(false);
				}, COPIED_RESET_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [copied]);
			(0, react.useEffect)(() => {
				if (!waiting) return;
				const timer = setInterval(() => {
					refresh();
				}, PENDING_REFRESH_MS);
				return () => {
					clearInterval(timer);
				};
			}, [
				waiting,
				pendingCode,
				refresh
			]);
			const connected = status?.configured === true;
			(0, react.useEffect)(() => {
				if (!connected) return;
				const timer = setInterval(() => {
					refresh();
				}, CONNECTED_REFRESH_MS);
				return () => {
					clearInterval(timer);
				};
			}, [connected, refresh]);
			/** Run one Host call with the busy flag and the error channel wired. */
			const run = (0, react.useCallback)(async (action) => {
				setBusy(true);
				setError(void 0);
				try {
					await action();
				} catch (failure) {
					setError(t("account.failed", { message: messageOf(failure) }));
				} finally {
					setBusy(false);
				}
			}, [t]);
			const connect = () => {
				run(async () => {
					const outcome = await api.begin();
					if (outcome.status === "failed") setError(t("account.failed", { message: outcome.message }));
					await refresh();
				});
			};
			const cancel = () => {
				run(async () => {
					await api.cancel();
					await refresh();
				});
			};
			/**
			* Hand the confirmation page to the user's own browser, through the Host: a
			* window the page opens stays inside the shell hosting it — a desktop build
			* shows another application window, and macOS may refuse outright. The
			* address is printed below as well, for a machine with no launcher at all.
			*/
			const openAddress = () => {
				(async () => {
					setError(void 0);
					try {
						await api.openBrowser();
					} catch (failure) {
						setError(t("account.openFailed", { message: messageOf(failure) }));
					}
				})();
			};
			/**
			* Copy the confirmation address, for a machine where nothing can be launched.
			*/
			const copyAddress = () => {
				const address = status?.pending?.verificationUriComplete;
				if (address === void 0) return;
				(async () => {
					try {
						await navigator.clipboard.writeText(address);
						setCopied(true);
					} catch {
						setError(t("account.copyFailed"));
					}
				})();
			};
			const signOut = () => {
				run(async () => {
					await api.signOut();
					await refresh();
				});
			};
			/**
			* Ask the Host to re-read the wallet now, and publish the state it answers
			* with: the same read the Host runs on its own cadence, taken early.
			*/
			const refreshWallet = () => {
				(async () => {
					setWalletBusy(true);
					setError(void 0);
					try {
						setStatus(await api.refreshAccount());
					} catch (failure) {
						setError(t("account.failed", { message: messageOf(failure) }));
					} finally {
						setWalletBusy(false);
					}
				})();
			};
			const account = status?.account;
			const pending = status?.pending;
			const [vouchersBefore = "", vouchersAfter = ""] = t("account.vouchersEmpty").split("{link}");
			const minutes = pending === void 0 ? 0 : Math.max(1, Math.round((pending.expiresAt - Date.now()) / 6e4));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: NearTokenSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: NearTokenSection_module_css_default.title,
						children: t("account.title")
					}),
					status === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NearTokenSection_module_css_default.hint,
						children: t("account.loading")
					}) : status.configured ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: NearTokenSection_module_css_default.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: NearTokenSection_module_css_default.cardHead,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: NearTokenSection_module_css_default.name,
										children: account?.displayName ?? "NearToken"
									}),
									account === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: NearTokenSection_module_css_default.handle,
										children: ["@", account.username]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${NearTokenSection_module_css_default.badge} ${NearTokenSection_module_css_default.badgeOn}`,
										children: t("account.connected")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
								className: NearTokenSection_module_css_default.facts,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.fact,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											className: NearTokenSection_module_css_default.factLabel,
											children: t("account.group")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											className: NearTokenSection_module_css_default.factValue,
											children: account?.group ?? "—"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.fact,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											className: NearTokenSection_module_css_default.factLabel,
											children: t("account.balance")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
											className: `${NearTokenSection_module_css_default.factValue} ${NearTokenSection_module_css_default.valueRow}`,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: account?.balance ?? "—" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: NearTokenSection_module_css_default.refresh,
												disabled: walletBusy,
												onClick: refreshWallet,
												title: walletBusy ? t("account.refreshing") : t("account.refresh"),
												"aria-label": walletBusy ? t("account.refreshing") : t("account.refresh"),
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 })
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.fact,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											className: NearTokenSection_module_css_default.factLabel,
											children: t("account.used")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											className: NearTokenSection_module_css_default.factValue,
											children: account?.used ?? "—"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.fact,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											className: NearTokenSection_module_css_default.factLabel,
											children: t("account.token")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											className: NearTokenSection_module_css_default.factValue,
											children: status.tokenName
										})]
									}),
									account !== void 0 && (account.vouchers?.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: `${NearTokenSection_module_css_default.fact} ${NearTokenSection_module_css_default.voucherFact}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											className: NearTokenSection_module_css_default.factLabel,
											children: t("account.vouchers")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											className: NearTokenSection_module_css_default.voucherList,
											children: account.vouchers?.map((voucher) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: NearTokenSection_module_css_default.voucherRow,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.voucherGroup,
													children: voucher.group
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.voucherAmount,
													children: voucher.amount
												})]
											}, `${voucher.groupId}:${voucher.group}`))
										})]
									}) : account !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: `${NearTokenSection_module_css_default.fact} ${NearTokenSection_module_css_default.voucherFact}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
											className: NearTokenSection_module_css_default.factLabel,
											children: t("account.vouchers")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
											className: NearTokenSection_module_css_default.voucherEmpty,
											children: [
												vouchersBefore,
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
													className: NearTokenSection_module_css_default.invite,
													href: `${status.baseURL}/wallet`,
													target: "_blank",
													rel: "noreferrer",
													children: t("account.vouchersInvite")
												}),
												vouchersAfter
											]
										})]
									}) : null
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: NearTokenSection_module_css_default.actions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: NearTokenSection_module_css_default.button,
									disabled: busy,
									onClick: signOut,
									children: busy ? t("account.signingOut") : t("account.signOut")
								})
							})
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: NearTokenSection_module_css_default.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: NearTokenSection_module_css_default.cardHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.name,
									children: t("account.title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.badge,
									children: t("account.disconnected")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: NearTokenSection_module_css_default.hint,
								children: [
									t("account.site"),
									"：",
									status.baseURL
								]
							}),
							pending === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: NearTokenSection_module_css_default.actions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${NearTokenSection_module_css_default.button} ${NearTokenSection_module_css_default.buttonPrimary}`,
									disabled: busy,
									onClick: connect,
									children: busy ? t("account.connecting") : t("account.connect")
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: NearTokenSection_module_css_default.form,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: NearTokenSection_module_css_default.hint,
										children: t("account.waiting")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.codeRow,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NearTokenSection_module_css_default.label,
											children: t("account.userCode")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: NearTokenSection_module_css_default.code,
											children: pending.userCode
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.actions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: `${NearTokenSection_module_css_default.button} ${NearTokenSection_module_css_default.buttonPrimary}`,
											onClick: openAddress,
											children: t("account.openBrowser")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: NearTokenSection_module_css_default.button,
											disabled: busy,
											onClick: cancel,
											children: busy ? t("account.cancelling") : t("account.cancel")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: NearTokenSection_module_css_default.linkRow,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NearTokenSection_module_css_default.label,
											children: t("account.manualLink")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: NearTokenSection_module_css_default.linkLine,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
												className: NearTokenSection_module_css_default.link,
												href: pending.verificationUriComplete,
												target: "_blank",
												rel: "noopener noreferrer",
												children: pending.verificationUriComplete
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: NearTokenSection_module_css_default.button,
												onClick: copyAddress,
												children: copied ? t("account.copied") : t("account.copyLink")
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: NearTokenSection_module_css_default.hint,
										children: t("account.expiresIn", { minutes: String(minutes) })
									})
								]
							})
						]
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NearTokenSection_module_css_default.notice,
						children: error
					}),
					status?.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NearTokenSection_module_css_default.notice,
						children: t("account.failed", { message: status.error })
					}),
					status?.configured === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelWhitelist, {
						api,
						t
					}) : null,
					status?.configured === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageGeneration, {
						api,
						t
					}) : null
				]
			});
		}
		/**
		* The model whitelist block: which of the site's models the provider keeps in
		* the model picker, edited through the same-origin models carrier.
		*
		* An empty stored list means "no whitelist", so the boxes start all checked —
		* that is what the picker currently shows. Saving an empty list is refused
		* here, because it would read as the same "no whitelist" state; "Show all"
		* (which saves exactly that) is the explicit way back to the whole catalog.
		* @param props - the injected route carrier and translate.
		* @returns the whitelist block.
		*/
		function ModelWhitelist({ api, t }) {
			const [state, setState] = (0, react.useState)(void 0);
			const [selected, setSelected] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [query, setQuery] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [saved, setSaved] = (0, react.useState)(false);
			/** Why the last edit could not be applied; cleared by the next one. */
			const [notice, setNotice] = (0, react.useState)(void 0);
			/** Whether the list itself is showing; the card opens collapsed. */
			const [open, setOpen] = (0, react.useState)(false);
			/** The queued save, while a burst of clicks is still settling. */
			const pending = (0, react.useRef)(void 0);
			/** The stored per-model meta overrides, mirrored from the host answer. */
			const [meta, setMeta] = (0, react.useState)({});
			/** The model whose meta editor is open; one editor at a time. */
			const [editing, setEditing] = (0, react.useState)(void 0);
			/** The editor's draft: strings for the numeric fields, boxes for the modalities. */
			const [draft, setDraft] = (0, react.useState)({
				contextWindow: "",
				maxTokens: "",
				text: true,
				image: false
			});
			const [tip, setTip] = (0, react.useState)(void 0);
			/** Publish one host answer: the boxes show the stored list, or all when none is stored. */
			const adopt = (0, react.useCallback)((next) => {
				setState(next);
				setSelected(new Set(next.enabled.length === 0 ? next.models.map((entry) => entry.model) : next.enabled));
				setMeta(next.meta);
			}, []);
			const load = (0, react.useCallback)(async () => {
				try {
					adopt(await api.models());
				} catch (failure) {
					setError(t("whitelist.failed", { message: messageOf(failure) }));
				}
			}, [
				adopt,
				api,
				t
			]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const models = state?.models ?? [];
			const needle = query.trim().toLowerCase();
			const visible = needle === "" ? models : models.filter((entry) => entry.model.toLowerCase().includes(needle));
			/** Cancel the pending save, if one is queued. */
			const cancelPending = (0, react.useCallback)(() => {
				if (pending.current === void 0) return;
				window.clearTimeout(pending.current);
				pending.current = void 0;
			}, []);
			(0, react.useEffect)(() => cancelPending, [cancelPending]);
			/**
			* Apply an edit to the boxes and queue one save.
			*
			* The list is stored as it is edited — there is no Save button to forget —
			* so the delay only coalesces a burst of clicks into one profile write.
			*/
			const edit = (next) => {
				setSaved(false);
				setNotice(void 0);
				setSelected(next);
				cancelPending();
				const enabled = models.filter((entry) => next.has(entry.model)).map((entry) => entry.model);
				pending.current = window.setTimeout(() => {
					pending.current = void 0;
					persist(enabled);
				}, AUTOSAVE_DELAY_MS);
			};
			const toggle = (model) => {
				const next = new Set(selected);
				if (next.has(model)) next.delete(model);
				else next.add(model);
				if (next.size === 0) {
					setNotice(t("whitelist.keepOne"));
					return;
				}
				edit(next);
			};
			/** Show one row's groups just below it, above it when there is no room. */
			const showTip = (entry, anchor) => {
				const rect = anchor.getBoundingClientRect();
				const height = Math.min(240, 34 + entry.groups.length * 20);
				const below = rect.bottom + 6;
				setTip({
					entry,
					top: below + height > window.innerHeight ? Math.max(12, rect.top - height - 6) : below,
					left: Math.max(12, Math.min(rect.left + 24, window.innerWidth - 292))
				});
			};
			const checkVisible = () => {
				edit(/* @__PURE__ */ new Set([...selected, ...visible.map((entry) => entry.model)]));
			};
			/**
			* Empty the boxes the filter is showing.
			*
			* An emptied selection cannot be saved as such: an empty stored list means
			* "no whitelist", i.e. show every model, which is the opposite of the click.
			* So the boxes empty at once and the saved list is left alone; the next check
			* box saves the set the user actually wants, and "Show all" is the way back.
			*/
			const uncheckVisible = () => {
				const hidden = new Set(visible.map((entry) => entry.model));
				const next = new Set([...selected].filter((model) => !hidden.has(model)));
				if (next.size > 0) {
					edit(next);
					return;
				}
				cancelPending();
				setSaved(false);
				setSelected(next);
				setNotice(t("whitelist.cleared"));
			};
			/**
			* Write one list to the Host, which re-declares the provider route so the
			* model picker refetches without a page reload.
			* @param enabled - the model names to keep visible; empty restores everything.
			*/
			const persist = (0, react.useCallback)(async (enabled) => {
				setSaving(true);
				setError(void 0);
				try {
					await api.saveModels(enabled);
					setSaved(true);
				} catch (failure) {
					setError(t("whitelist.failed", { message: messageOf(failure) }));
				} finally {
					setSaving(false);
				}
			}, [api, t]);
			/** Restore the whole catalog: nothing hidden, nothing stored. */
			const showEverything = () => {
				cancelPending();
				setSelected(new Set(models.map((entry) => entry.model)));
				persist([]);
			};
			/**
			* Open one model's meta editor, seeded from its stored override.
			* @param entry - the model row the editor belongs to.
			*/
			const openEditor = (entry) => {
				const stored = meta[entry.model];
				setEditing(entry.model);
				setNotice(void 0);
				setDraft({
					contextWindow: stored?.contextWindow === void 0 ? "" : String(stored.contextWindow),
					maxTokens: stored?.maxTokens === void 0 ? "" : String(stored.maxTokens),
					text: stored?.input === void 0 ? true : stored.input.includes("text"),
					image: stored?.input === void 0 ? false : stored.input.includes("image")
				});
			};
			/**
			* Write one model's override away, or remove it.
			*
			* The numeric fields stay unoverridden when left blank; the modality boxes
			* always state their whole set, because a box cannot tell "left alone" from
			* "chosen".
			* @param model - the bare model name.
			* @param facts - the override to store, or undefined to remove the entry.
			*/
			const persistMeta = (model, facts) => {
				const next = { ...meta };
				if (facts === void 0) delete next[model];
				else next[model] = facts;
				const enabled = models.filter((entry) => selected.has(entry.model)).map((entry) => entry.model);
				setSaving(true);
				setError(void 0);
				(async () => {
					try {
						await api.saveModels(enabled, next);
						setMeta(next);
						setEditing(void 0);
						setSaved(true);
					} catch (failure) {
						setError(t("whitelist.failed", { message: messageOf(failure) }));
					} finally {
						setSaving(false);
					}
				})();
			};
			/** Validate the draft and write it; a refusal explains itself inline. */
			const saveEditor = (entry) => {
				const contextWindow = draft.contextWindow.trim();
				const maxTokens = draft.maxTokens.trim();
				const context = contextWindow === "" ? void 0 : Number(contextWindow);
				const output = maxTokens === "" ? void 0 : Number(maxTokens);
				if (context !== void 0 && (!Number.isSafeInteger(context) || context <= 0) || output !== void 0 && (!Number.isSafeInteger(output) || output <= 0)) {
					setNotice(t("meta.badNumber"));
					return;
				}
				if (!draft.text && !draft.image) {
					setNotice(t("meta.needModality"));
					return;
				}
				const input = [...draft.text ? ["text"] : [], ...draft.image ? ["image"] : []];
				persistMeta(entry.model, {
					...context === void 0 ? {} : { contextWindow: context },
					...output === void 0 ? {} : { maxTokens: output },
					input
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: NearTokenSection_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: NearTokenSection_module_css_default.cardToggle,
					"aria-expanded": open,
					"aria-label": t(open ? "card.collapse" : "card.expand"),
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NearTokenSection_module_css_default.name,
							children: t("whitelist.title")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: NearTokenSection_module_css_default.count,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.countTotal,
									children: t("whitelist.count", { total: String(models.length) })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.countDot,
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.countPicked,
									children: t("whitelist.picked", { selected: String(selected.size) })
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
							className: open ? `${NearTokenSection_module_css_default.chevron} ${NearTokenSection_module_css_default.chevronOpen}` : NearTokenSection_module_css_default.chevron,
							size: 14
						})
					]
				}), !open ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NearTokenSection_module_css_default.intro,
						children: t("whitelist.intro")
					}),
					state === void 0 ? error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NearTokenSection_module_css_default.hint,
						children: t("whitelist.loading")
					}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: NearTokenSection_module_css_default.form,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: NearTokenSection_module_css_default.search,
								type: "search",
								value: query,
								placeholder: t("whitelist.search"),
								"aria-label": t("whitelist.search"),
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: NearTokenSection_module_css_default.toolbar,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: NearTokenSection_module_css_default.button,
										disabled: saving || visible.length === 0,
										onClick: checkVisible,
										children: t("whitelist.selectAll")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: NearTokenSection_module_css_default.button,
										disabled: saving || visible.length === 0,
										onClick: uncheckVisible,
										children: t("whitelist.clear")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: NearTokenSection_module_css_default.button,
										disabled: saving,
										onClick: showEverything,
										children: t("whitelist.reset")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: NearTokenSection_module_css_default.autosave,
										"aria-live": "polite",
										children: saving ? t("whitelist.saving") : saved ? t("whitelist.autoSaved") : ""
									})
								]
							}),
							models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: NearTokenSection_module_css_default.hint,
								children: t("whitelist.empty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: NearTokenSection_module_css_default.list,
								onScroll: () => {
									setTip(void 0);
								},
								children: [visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: NearTokenSection_module_css_default.hint,
									children: t("whitelist.noMatch")
								}) : visible.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: NearTokenSection_module_css_default.row,
									onMouseEnter: (event) => {
										showTip(entry, event.currentTarget);
									},
									onMouseLeave: () => {
										setTip(void 0);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: selected.has(entry.model),
											onChange: () => {
												toggle(entry.model);
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NearTokenSection_module_css_default.rowName,
											children: entry.model
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: NearTokenSection_module_css_default.rowMeta,
											children: [entry.groups.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("whitelist.groupsCount", { count: String(entry.groups.length) }) }), entry.minRatio === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: NearTokenSection_module_css_default.rowRatio,
												children: t("whitelist.minRatio")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RatioChip, { ratio: String(entry.minRatio) + "x" })] })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: meta[entry.model] === void 0 ? NearTokenSection_module_css_default.metaBtn : NearTokenSection_module_css_default.metaBtn + " " + NearTokenSection_module_css_default.metaBtnOn,
											onClick: () => {
												if (editing === entry.model) setEditing(void 0);
												else openEditor(entry);
											},
											children: meta[entry.model] === void 0 ? t("meta.edit") : t("meta.overridden")
										})
									]
								}), editing !== entry.model ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NearTokenSection_module_css_default.metaEditor,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NearTokenSection_module_css_default.metaTitle,
											children: t("meta.editorTitle")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: NearTokenSection_module_css_default.metaIntro,
											children: t("meta.editorIntro")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: NearTokenSection_module_css_default.metaField,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.metaLabel,
													children: t("meta.contextWindow")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: NearTokenSection_module_css_default.metaInput,
													type: "number",
													min: 1,
													step: 1,
													value: draft.contextWindow,
													placeholder: entry.contextWindow === void 0 ? t("meta.undeclared") : String(entry.contextWindow),
													onChange: (event) => {
														setDraft((current) => ({
															...current,
															contextWindow: event.target.value
														}));
													}
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.metaHint,
													children: entry.contextWindow === void 0 ? t("meta.undeclared") : t("meta.declaredContext", { value: String(entry.contextWindow) })
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: NearTokenSection_module_css_default.metaField,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.metaLabel,
													children: t("meta.maxTokens")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: NearTokenSection_module_css_default.metaInput,
													type: "number",
													min: 1,
													step: 1,
													value: draft.maxTokens,
													placeholder: entry.maxTokens === void 0 ? t("meta.undeclared") : String(entry.maxTokens),
													onChange: (event) => {
														setDraft((current) => ({
															...current,
															maxTokens: event.target.value
														}));
													}
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.metaHint,
													children: entry.maxTokens === void 0 ? t("meta.undeclared") : t("meta.declaredMaxTokens", { value: String(entry.maxTokens) })
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: NearTokenSection_module_css_default.metaField,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.metaLabel,
													children: t("meta.input")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: NearTokenSection_module_css_default.metaCheck,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														checked: draft.text,
														onChange: (event) => {
															setDraft((current) => ({
																...current,
																text: event.target.checked
															}));
														}
													}), t("meta.inputText")]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: NearTokenSection_module_css_default.metaCheck,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														checked: draft.image,
														onChange: (event) => {
															setDraft((current) => ({
																...current,
																image: event.target.checked
															}));
														}
													}), t("meta.inputImage")]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.metaHint,
													children: entry.input === void 0 || entry.input.length === 0 ? t("meta.undeclared") : t("meta.declaredInput", { value: entry.input.join(" + ") })
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: NearTokenSection_module_css_default.metaActions,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: NearTokenSection_module_css_default.buttonPrimary,
													disabled: saving,
													onClick: () => {
														saveEditor(entry);
													},
													children: saving ? t("meta.saving") : t("meta.save")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: NearTokenSection_module_css_default.button,
													disabled: saving || meta[entry.model] === void 0,
													onClick: () => {
														persistMeta(entry.model, void 0);
													},
													children: t("meta.clear")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: NearTokenSection_module_css_default.button,
													disabled: saving,
													onClick: () => {
														setEditing(void 0);
													},
													children: t("meta.cancel")
												})
											]
										})
									]
								})] }, entry.model)), tip === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NearTokenSection_module_css_default.tip,
									style: {
										top: tip.top,
										left: tip.left
									},
									role: "tooltip",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: NearTokenSection_module_css_default.tipTitle,
										children: t("whitelist.groupsTitle")
									}), tip.entry.groups.map((group) => {
										const parsed = parseGroupLabel(group.group);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: NearTokenSection_module_css_default.tipRow,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: NearTokenSection_module_css_default.tipGroup,
												children: [parsed.badges.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTag, {
													text: badge.text,
													tone: badge.tone
												}, badge.text)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: NearTokenSection_module_css_default.tipGroupName,
													children: parsed.label
												})]
											}), group.ratio === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RatioChip, { ratio: group.ratio })]
										}, group.group);
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: NearTokenSection_module_css_default.hint,
								children: t("whitelist.hint")
							}),
							notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: NearTokenSection_module_css_default.notice,
								children: notice
							})
						]
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NearTokenSection_module_css_default.notice,
						children: error
					})
				] })]
			});
		}
		/**
		* The image-generation card: the `generate_image` tool's switch and, per picture
		* model, the group its requests route through.
		*
		* Unlike the whitelist this block saves on a button, not on every click: the two
		* members describe one setting, and a group choice made before the model is
		* checked would otherwise be written as nothing.
		* @param props - the injected route carrier and translate.
		* @returns the image-generation block.
		*/
		function ImageGeneration({ api, t }) {
			const [state, setState] = (0, react.useState)(void 0);
			const [enabled, setEnabled] = (0, react.useState)(false);
			const [selection, setSelection] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(false);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [saved, setSaved] = (0, react.useState)(false);
			/** Whether the controls are showing; the card opens collapsed. */
			const [open, setOpen] = (0, react.useState)(false);
			/** Publish one host answer into the controls. */
			const adopt = (0, react.useCallback)((next) => {
				setState(next);
				setEnabled(next.enabled);
				setSelection({ ...next.selection });
				setDirty(false);
			}, []);
			const load = (0, react.useCallback)(async () => {
				try {
					adopt(await api.images());
				} catch (failure) {
					setError(t("images.failed", { message: messageOf(failure) }));
				}
			}, [
				adopt,
				api,
				t
			]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const models = state?.models ?? [];
			const enabledCount = Object.keys(selection).length;
			/** Check or uncheck one model; the first group of a newly checked model is its route. */
			const toggle = (model, groups) => {
				setSaved(false);
				setDirty(true);
				setSelection((current) => {
					if (current[model] !== void 0) {
						const next = { ...current };
						delete next[model];
						return next;
					}
					const first = groups[0]?.group;
					return first === void 0 ? current : {
						...current,
						[model]: first
					};
				});
			};
			const chooseGroup = (model, group) => {
				setSaved(false);
				setDirty(true);
				setSelection((current) => ({
					...current,
					[model]: group
				}));
			};
			const save = async () => {
				setBusy(true);
				setError(void 0);
				setSaved(false);
				try {
					await api.saveImages({
						enabled,
						models: selection
					});
					setSaved(true);
					setDirty(false);
				} catch (failure) {
					setError(t("images.failed", { message: messageOf(failure) }));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: NearTokenSection_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: NearTokenSection_module_css_default.cardToggle,
					"aria-expanded": open,
					"aria-label": t(open ? "card.collapse" : "card.expand"),
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NearTokenSection_module_css_default.name,
							children: t("images.title")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: NearTokenSection_module_css_default.count,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.countTotal,
									children: t("images.count", { total: String(models.length) })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.countDot,
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: NearTokenSection_module_css_default.countPicked,
									children: t("images.picked", { selected: String(enabledCount) })
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
							className: open ? `${NearTokenSection_module_css_default.chevron} ${NearTokenSection_module_css_default.chevronOpen}` : NearTokenSection_module_css_default.chevron,
							size: 14
						})
					]
				}), !open ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: NearTokenSection_module_css_default.intro,
					children: t("images.intro")
				}), state === void 0 ? error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: NearTokenSection_module_css_default.hint,
					children: t("images.loading")
				}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: NearTokenSection_module_css_default.form,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: NearTokenSection_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: enabled,
								onChange: (event) => {
									setSaved(false);
									setDirty(true);
									setEnabled(event.target.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: NearTokenSection_module_css_default.rowName,
								children: t("images.enable")
							})]
						}),
						models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: NearTokenSection_module_css_default.hint,
							children: t("images.empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: NearTokenSection_module_css_default.list,
							children: models.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: NearTokenSection_module_css_default.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: selection[entry.model] !== void 0,
										onChange: () => {
											toggle(entry.model, entry.groups);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: NearTokenSection_module_css_default.rowName,
										children: entry.model
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										className: NearTokenSection_module_css_default.select,
										"aria-label": t("images.groupAria", { model: entry.model }),
										disabled: selection[entry.model] === void 0,
										value: selection[entry.model] ?? entry.groups[0]?.group ?? "",
										onChange: (event) => {
											chooseGroup(entry.model, event.target.value);
										},
										children: entry.groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: group.group,
											children: [group.group, group.ratio === void 0 ? "" : ` · ${group.ratio}`]
										}, group.group))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: NearTokenSection_module_css_default.rowMeta,
										children: t(entry.channel === "images" ? "images.channel.images" : entry.channel === "genai" ? "images.channel.genai" : "images.channel.chat")
									})
								]
							}, entry.model))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: NearTokenSection_module_css_default.toolbar,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: NearTokenSection_module_css_default.button,
								disabled: busy || !dirty,
								onClick: () => {
									save();
								},
								children: busy ? t("images.saving") : t("images.save")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: NearTokenSection_module_css_default.autosave,
								"aria-live": "polite",
								children: dirty ? t("images.dirty") : saved ? t("images.saved") : ""
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: NearTokenSection_module_css_default.hint,
							children: t("images.hint")
						}),
						error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: NearTokenSection_module_css_default.notice,
							children: error
						})
					]
				})] })]
			});
		}
		/**
		* Render one thrown value as the message the page shows.
		* @param error - whatever the call threw.
		* @returns the error's message, or its text.
		*/
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* `modelGroups` namespace dictionaries. Copy mirrors the built-in model seat so
		* the two readings of the same control stay identical; only the group keys are
		* new.
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"provider.account": "DeepSeek 账号",
			"trigger.fallback": "请选择模型",
			"trigger.loading": "正在加载模型…",
			"trigger.selectAria": "请选择模型",
			"trigger.aria": "选择模型，当前 {model}",
			"trigger.ariaEffort": "选择模型，当前 {model}，推理等级 {effort}",
			"menu.aria": "模型、分组与推理等级",
			"menu.model": "模型",
			"menu.group": "分组",
			"menu.effort": "推理等级",
			"effort.providerDefault": "Default",
			"status.loading": "正在刷新模型列表…",
			"error.action": "模型操作失败：{message}",
			"error.sessionInUse": "当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。",
			"action.reload": "重新加载",
			"warning.groupLoad": "{name} 加载失败：{message}",
			"search.placeholder": "搜索模型…",
			"search.clear": "清除搜索",
			"search.empty": "没有匹配的模型。",
			"empty.models": "暂无可用模型",
			"empty.groups": "当前模型没有其它分组。",
			"empty.efforts": "当前模型未提供推理等级。",
			"account.nav": "NearToken",
			"account.title": "NearToken 账号",
			"account.site": "站点",
			"account.connect": "连接 NearToken",
			"account.connecting": "正在发起…",
			"account.waiting": "已发起授权，请在浏览器中确认。",
			"account.userCode": "确认码",
			"account.openBrowser": "打开浏览器确认",
			"account.manualLink": "打不开浏览器时，手动打开下面的地址：",
			"account.copyLink": "复制链接",
			"account.copied": "已复制",
			"account.copyFailed": "复制失败，请手动选中上面的链接复制。",
			"account.openFailed": "未能打开浏览器（{message}）；请复制下面的地址，在自己的浏览器里访问。",
			"account.expiresIn": "本次确认 {minutes} 分钟内有效",
			"account.cancel": "取消",
			"account.cancelling": "正在取消…",
			"account.connected": "已接入",
			"account.disconnected": "未连接",
			"account.group": "用户分组",
			"account.balance": "剩余额度",
			"account.used": "已用额度",
			"account.vouchers": "代金券",
			"account.vouchersEmpty": "你还没有代金券，你可以通过{link}获得免费代金券",
			"account.vouchersInvite": "邀请计划",
			"account.refresh": "刷新余额",
			"account.refreshing": "正在刷新…",
			"account.token": "API 令牌",
			"account.signOut": "断开连接",
			"account.signingOut": "正在断开…",
			"account.loading": "正在读取连接状态…",
			"account.failed": "操作失败：{message}",
			"whitelist.title": "模型白名单",
			"whitelist.intro": "勾选要出现在 DSH 模型选择器里的模型；未勾选的不会出现。白名单写在插件配置里，重启后依然生效。",
			"whitelist.loading": "正在读取模型清单…",
			"whitelist.failed": "模型白名单操作失败：{message}",
			"whitelist.search": "搜索模型…",
			"whitelist.noMatch": "没有匹配的模型。",
			"whitelist.empty": "站点没有返回任何模型。",
			"whitelist.count": "{total} 个模型",
			"whitelist.picked": "已选 {selected}",
			"card.expand": "展开",
			"card.collapse": "收起",
			"whitelist.groupsCount": "{count} 个分组",
			"whitelist.minRatio": "最低",
			"whitelist.groupsTitle": "可用分组",
			"whitelist.selectAll": "全选",
			"whitelist.clear": "清空",
			"whitelist.reset": "全部显示",
			"whitelist.saving": "正在保存…",
			"whitelist.autoSaved": "已自动保存，模型选择器已刷新",
			"whitelist.hint": "勾选即自动保存；没勾选的不会出现在模型选择器里。「全部显示」会清空白名单。",
			"whitelist.keepOne": "至少要保留一个模型；想放开全部请点「全部显示」。",
			"whitelist.cleared": "已清空勾选；勾选要显示的模型后会立即保存。",
			"meta.edit": "覆盖",
			"meta.overridden": "已覆盖",
			"meta.editorTitle": "元信息覆盖",
			"meta.editorIntro": "填了的字段会盖过站点声明；留空的字段沿用站点声明或默认值。",
			"meta.contextWindow": "上下文（tokens）",
			"meta.maxTokens": "最大输出（tokens）",
			"meta.input": "输入类型",
			"meta.inputText": "文本",
			"meta.inputImage": "图像",
			"meta.declaredContext": "站点声明 {value}",
			"meta.declaredMaxTokens": "站点声明 {value}",
			"meta.declaredInput": "站点声明 {value}",
			"meta.undeclared": "站点未声明",
			"meta.save": "保存",
			"meta.clear": "清除覆盖",
			"meta.cancel": "取消",
			"meta.saving": "正在保存…",
			"meta.saved": "已保存，模型选择器已刷新",
			"meta.badNumber": "上下文与最大输出必须是正整数。",
			"meta.needModality": "输入类型至少勾选一项。",
			"images.title": "图像生成",
			"images.intro": "开启后模型可以调用 generate_image 工具生图。勾选要用的生图模型，并为每个模型指定走哪个分组（决定计费与可用性）。",
			"images.enable": "启用 generate_image 工具",
			"images.channel.images": "images 接口",
			"images.channel.genai": "gemini 接口",
			"images.channel.chat": "chat 接口",
			"images.save": "保存",
			"images.saving": "正在保存…",
			"images.saved": "已保存，工具已按新设置生效",
			"images.dirty": "有未保存的改动",
			"images.hint": "生图一次约 20-60 秒；不勾选的模型模型看不到也调不到。改完记得点保存。",
			"images.failed": "图像生成设置失败：{message}",
			"images.empty": "站点没有返回任何生图模型。",
			"images.loading": "正在读取生图模型…",
			"images.count": "{total} 个生图模型",
			"images.picked": "已启用 {selected}",
			"images.groupAria": "{model} 使用的分组"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"provider.account": "DeepSeek Account",
			"trigger.fallback": "Select model",
			"trigger.loading": "Loading models…",
			"trigger.selectAria": "Select model",
			"trigger.aria": "Select model, current {model}",
			"trigger.ariaEffort": "Select model, current {model}, reasoning effort {effort}",
			"menu.aria": "Model, group, and reasoning effort",
			"menu.model": "Model",
			"menu.group": "Group",
			"menu.effort": "Effort",
			"effort.providerDefault": "Default",
			"status.loading": "Refreshing model list…",
			"error.action": "Model operation failed: {message}",
			"error.sessionInUse": "This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.",
			"action.reload": "Reload",
			"warning.groupLoad": "{name} failed to load: {message}",
			"search.placeholder": "Search models…",
			"search.clear": "Clear search",
			"search.empty": "No matching models.",
			"empty.models": "No models available.",
			"empty.groups": "This model offers no other group.",
			"empty.efforts": "This model provides no reasoning effort levels.",
			"account.nav": "NearToken",
			"account.title": "NearToken account",
			"account.site": "Site",
			"account.connect": "Connect NearToken",
			"account.connecting": "Starting…",
			"account.waiting": "Authorization started. Confirm it in your browser.",
			"account.userCode": "Code",
			"account.openBrowser": "Open browser to confirm",
			"account.manualLink": "If the browser does not open, open this address yourself:",
			"account.copyLink": "Copy link",
			"account.copied": "Copied",
			"account.copyFailed": "Could not copy; select the link above and copy it yourself.",
			"account.openFailed": "Could not open your browser ({message}); copy the address below and open it yourself.",
			"account.expiresIn": "This confirmation is valid for {minutes} minutes",
			"account.cancel": "Cancel",
			"account.cancelling": "Cancelling…",
			"account.connected": "Connected",
			"account.disconnected": "Not connected",
			"account.group": "Group",
			"account.balance": "Balance",
			"account.used": "Used",
			"account.vouchers": "Vouchers",
			"account.vouchersEmpty": "You have no vouchers yet. Get free vouchers through the {link}.",
			"account.vouchersInvite": "referral program",
			"account.refresh": "Refresh balance",
			"account.refreshing": "Refreshing…",
			"account.token": "API token",
			"account.signOut": "Disconnect",
			"account.signingOut": "Disconnecting…",
			"account.loading": "Reading connection state…",
			"account.failed": "Failed: {message}",
			"whitelist.title": "Model whitelist",
			"whitelist.intro": "Check the models that should appear in the DSH model picker; unchecked models stay hidden. The list is stored in the plugin configuration and survives a restart.",
			"whitelist.loading": "Reading the model list…",
			"whitelist.failed": "Model whitelist failed: {message}",
			"whitelist.search": "Search models…",
			"whitelist.noMatch": "No matching models.",
			"whitelist.empty": "The site returned no models.",
			"whitelist.count": "{total} models",
			"whitelist.picked": "{selected} selected",
			"card.expand": "Expand",
			"card.collapse": "Collapse",
			"whitelist.groupsCount": "{count} groups",
			"whitelist.minRatio": "from",
			"whitelist.groupsTitle": "Available groups",
			"whitelist.selectAll": "Check all",
			"whitelist.clear": "Clear",
			"whitelist.reset": "Show all",
			"whitelist.saving": "Saving…",
			"whitelist.autoSaved": "Saved; the model picker has been refreshed",
			"whitelist.hint": "Every change saves itself; unchecked models stay out of the picker. \"Show all\" clears the whitelist.",
			"whitelist.keepOne": "Keep at least one model; use \"Show all\" to offer everything again.",
			"whitelist.cleared": "Boxes cleared; checking a model saves the list you want.",
			"meta.edit": "Override",
			"meta.overridden": "Overridden",
			"meta.editorTitle": "Meta overrides",
			"meta.editorIntro": "A filled field overrides the site's declaration; an empty one falls back to the site or the default.",
			"meta.contextWindow": "Context (tokens)",
			"meta.maxTokens": "Max output (tokens)",
			"meta.input": "Input types",
			"meta.inputText": "Text",
			"meta.inputImage": "Image",
			"meta.declaredContext": "site declares {value}",
			"meta.declaredMaxTokens": "site declares {value}",
			"meta.declaredInput": "site declares {value}",
			"meta.undeclared": "not declared by the site",
			"meta.save": "Save",
			"meta.clear": "Clear override",
			"meta.cancel": "Cancel",
			"meta.saving": "Saving…",
			"meta.saved": "Saved; the model picker has been refreshed",
			"meta.badNumber": "Context and max output must be positive integers.",
			"meta.needModality": "Keep at least one input type checked.",
			"images.title": "Image generation",
			"images.intro": "Once on, the model can call the generate_image tool. Check the picture models you want and pick the group each one bills to.",
			"images.enable": "Enable the generate_image tool",
			"images.channel.images": "images endpoint",
			"images.channel.genai": "gemini endpoint",
			"images.channel.chat": "chat endpoint",
			"images.save": "Save",
			"images.saving": "Saving…",
			"images.saved": "Saved; the tool now runs with these settings",
			"images.dirty": "Unsaved changes",
			"images.hint": "One picture takes 20-60 seconds; an unchecked model is invisible to the model and cannot be called. Remember to save.",
			"images.failed": "Image generation settings failed: {message}",
			"images.empty": "The site returned no picture models.",
			"images.loading": "Reading the picture models…",
			"images.count": "{total} picture models",
			"images.picked": "{selected} enabled",
			"images.groupAria": "Group used by {model}"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "modelGroups";
		/** Required services: the slot registry, locale, sessions, and the directory service. */
		const inject = [
			"slots",
			"locale",
			"sessions",
			"remote",
			"remote.session"
		];
		/**
		* Client plugin body: register the dictionaries, add the NearToken settings page,
		* then shadow the composer model seat over the shared model directory.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-neartoken-provider: dictionaries");
			const api = createNearTokenApi();
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "neartoken",
				order: -5,
				label: () => t("account.nav"),
				locale: NS,
				inject: () => ({
					api,
					t
				})
			}, NearTokenSection));
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;
				scope.slots.inject("conversation.input.model", () => scope.slots.register({
					name: "conversation.input.model",
					priority: -1,
					locale: NS,
					inject: (sessionId) => {
						const directory = models.directoryFor(sessionId);
						const available = sessions.subagentAddress(sessionId) === void 0;
						return {
							available,
							directory: directory.store,
							load: () => {
								if (available) directory.load().catch(() => {});
							},
							select: (selection) => available ? directory.select(selection) : Promise.resolve(void 0)
						};
					}
				}, ModelGroupSelect));
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map