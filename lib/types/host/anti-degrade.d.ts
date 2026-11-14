/**
 * The anti-degradation switch: one paragraph of the harness system prompt,
 * retold in Chinese for a Gemini model.
 *
 * The harness explains how to read `@`-prefixed paths in one English paragraph
 * composed by `@deepseek-ai/dsh-file-reference`. Gemini models from the fourth
 * generation onward follow that paragraph closely enough to lose quality on the
 * rest of the system prompt, while the same guidance in Chinese costs nothing.
 *
 * With the switch on, every occurrence of that paragraph in a Gemini-4 request
 * body — the system instruction, the conversation itself, and the tool
 * descriptions — is replaced with its Chinese translation. The replacement is a
 * plain substring on the SERIALIZED body: the request graph holds objects the
 * harness handed over frozen (a tool's `parameters` schema among them), and
 * writing a member back — even with the value it already had — throws
 * "Cannot assign to read only property". A harness that rewords the paragraph
 * simply stops being rewritten, which is the safe failure (a request the model
 * already handles) rather than a half-translated one.
 *
 * @module
 */
/**
 * The file-reference guidance exactly as the harness composes it.
 *
 * One literal on purpose: the whole swap is a substring match against it, so a
 * wording change upstream surfaces as "nothing was replaced" instead of as a
 * partially rewritten request.
 */
export declare const FILE_REFERENCE_GUIDANCE = "Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @\"...\" quotes a path containing spaces.";
/** The same guidance in Chinese, every rule and the tool name preserved. */
export declare const FILE_REFERENCE_GUIDANCE_ZH = "\u4EE5 @ \u4E3A\u524D\u7F00\u7684 token \u662F\u7528\u6237\u663E\u5F0F\u5F15\u7528\u7684\u8DEF\u5F84\u3002\u76F8\u5BF9\u8DEF\u5F84\u4ECE\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\u89E3\u6790\uFF1B\u7EDD\u5BF9\u8DEF\u5F84\u6807\u8BC6\u4E3B\u673A\u4E0A\u7684\u6587\u4EF6\u6216\u76EE\u5F55\u3002\u672B\u5C3E\u659C\u6760\u8868\u793A\u76EE\u5F55\uFF1A\u5F53\u5176\u5185\u5BB9\u91CD\u8981\u65F6\uFF0C\u5217\u51FA\u8BE5\u76EE\u5F55\u3002\u5176\u4ED6\u5747\u4E3A\u6587\u4EF6\uFF1A\u9700\u8981\u5176\u5185\u5BB9\u65F6\u4F7F\u7528 read \u5DE5\u5177\uFF0C\u5E76\u4E14\u5728\u8BFB\u53D6\u4E4B\u524D\u4E0D\u8981\u58F0\u79F0\u5DF2\u68C0\u67E5\u8FC7\u5B83\u3002@\u201C\u2026\u201D \u7528\u4E8E\u5F15\u7528\u5305\u542B\u7A7A\u683C\u7684\u8DEF\u5F84\u3002";
/**
 * Rewrite one serialized request body so its file-reference guidance is Chinese.
 *
 * Done on the body text rather than on the request messages because the guidance
 * travels in whichever member each wire chose — `systemInstruction` here, a
 * `system` role message there — and because a JSON document is the one shape no
 * caller can hand over frozen.
 * @param json - the body `JSON.stringify` produced; read, never mutated.
 * @returns the body carrying the Chinese guidance, or the same string when the
 * paragraph is absent.
 */
export declare function translateGuidance(json: string): string;
