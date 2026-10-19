/**
 * The model-facing `generate_image` tool: one picture from a prompt, through
 * whichever picture model and group the operator enabled.
 *
 * The choice of model belongs to the operator, not to the caller: a profile
 * bills one group per model, and which group a picture costs from is a
 * deployment decision. So the tool advertises no model list of its own — it
 * calls the first enabled model unless the caller names one, and refuses a name
 * outside the enabled set with the enabled set spelled out.
 *
 * The result is the image itself, committed to the attachment store first: a
 * tool result must reference a durable object by the time the call is logged,
 * and the bytes only exist in this process until then.
 *
 * @module
 */
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
// Type-only: pulls the ctx.fs service face and the fs/observed event.
import type {} from '@deepseek-ai/dsh-fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
// Type-only: pulls the ctx.workingDirectory service face used for relative paths.
import type {} from '@deepseek-ai/dsh-working-directory'
import { sniffImageMediaType } from './images.ts'
import type { NearTokenImageClient } from './images.ts'

/** File extension per accepted media type, so a stored picture has a name that matches its bytes. */
const EXTENSIONS: Readonly<Record<ImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Slack between the generation budget and the tool-call deadline.
 *
 * The harness's timeout policy arms `timeoutMs` on `exec.signal` and, when it
 * fires, replaces the result with a bare "tool call timed out". Keeping our own
 * budget slightly shorter means the model usually gets the useful message — how
 * long it waited, and that `imageTimeoutMs` is the knob — while the policy still
 * catches a generation that ignores its abort.
 */
const DEADLINE_MARGIN_MS = 30_000

/** Most reference pictures one call may carry: each rides the prompt as base64. */
const MAX_REFERENCE_IMAGES = 4

/** Largest reference picture read from disk, before base64 expansion. */
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024

/** External facts the tool reads at call time. */
export interface ImageToolDeps {
  /** The stored setting: whether the tool is on, and each enabled model's group. */
  settings: () => { readonly enabled: boolean; readonly models: Readonly<Record<string, string>> }
  /** The generation client shared with the rest of the plugin. */
  client: NearTokenImageClient
  /** How long one generation may take, in milliseconds; also sizes the tool deadline. */
  timeoutMs: () => number
}

/**
 * Choose the model and group one call uses.
 * @param selection - the enabled models and their groups.
 * @param requested - the model the caller named, when it named one.
 * @returns the model and group to call.
 * @throws {Error} when nothing is enabled, or the named model is not among them.
 */
export function resolveImageModel(
  selection: Readonly<Record<string, string>>, requested?: string,
): { model: string; group: string } {
  const entries = Object.entries(selection)
  const [first] = entries
  if (first === undefined) {
    throw new Error('no image model is enabled: turn one on in Settings → NearToken → Image generation')
  }
  const hit = requested === undefined
    ? first
    : entries.find(([model]) => model === requested)
  if (hit === undefined) {
    throw new Error(
      `"${String(requested)}" is not an enabled image model; enabled models: ${entries.map(([model]) => model).join(', ')}`,
    )
  }
  return { model: hit[0], group: hit[1] }
}

/** The structured outcome declared by the `generate_image` output schema. */
export interface GeneratedImageValue {
  /** Bare model name that drew the picture. */
  model: string
  /** Group the request routed through. */
  group: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name: string
  }
  /** Where the picture was also written, when the caller named a path. */
  path?: string
}

/**
 * Format a generated picture as the model-facing envelope beside its image block.
 * @param value - the generated image outcome.
 * @returns the model-facing envelope; the picture itself rides the adjacent image block.
 */
export function formatGenerateImageOutput(value: GeneratedImageValue): string {
  return `<model>${value.model}</model>
<group>${value.group}</group>${value.path === undefined ? '' : `
<path>${value.path}</path>`}
<type>image</type>
<content>
${value.image.mediaType} image, ${String(value.image.width)}x${String(value.image.height)} px, ${String(value.image.bytes)} bytes, generated from the prompt
</content>`
}

/**
 * Project one generated picture into its model-facing envelope and image.
 * @param value - the generated image outcome.
 * @returns the two content blocks a tool result carries.
 */
function generateImageContent(value: GeneratedImageValue): ContentBlock[] {
  return [
    { type: 'text', text: formatGenerateImageOutput(value) },
    {
      type: 'image',
      attachment: {
        attachmentId: AttachmentId(value.image.attachmentId),
        mediaType: value.image.mediaType,
        bytes: value.image.bytes,
        width: value.image.width,
        height: value.image.height,
        name: value.image.name,
      },
    },
  ]
}

/**
 * Resolve options for a filesystem call in the session's current directory.
 * @param ctx - a context that may carry the working-directory service.
 * @param exec - the current tool execution.
 * @returns the resolution options, with no cwd when the service is absent.
 */
async function resolveOptions(
  ctx: Context, exec: ToolExecution,
): Promise<{ cwd?: string; signal?: AbortSignal }> {
  const workingDirectory = ctx.get('workingDirectory')
  const cwd = workingDirectory === undefined || exec.agent === undefined
    ? undefined
    : await workingDirectory.ensure(exec.agent, exec.signal)
  return { ...cwd === undefined ? {} : { cwd }, signal: exec.signal }
}

/**
 * Read the caller's reference pictures as data URLs, in the order given.
 * @param ctx - a context carrying `fs`.
 * @param exec - the current tool execution.
 * @param paths - model-supplied file paths.
 * @returns one data URL per picture.
 * @throws {Error} when a path cannot be read as a supported image.
 */
async function readReferences(
  ctx: Context, exec: ToolExecution, paths: readonly string[],
): Promise<readonly string[]> {
  if (paths.length === 0) return []
  if (paths.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`at most ${String(MAX_REFERENCE_IMAGES)} reference images per call; ${String(paths.length)} were given`)
  }
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('cannot read reference images: no filesystem service is mounted')
  const options = await resolveOptions(ctx, exec)
  const urls: string[] = []
  for (const requested of paths) {
    const target = await fs.resolve(requested, options)
    const info = await fs.stat(target, exec.signal)
    if (info === undefined) throw new Error(`cannot use "${target.displayPath}" as a reference image: not found`)
    if (info.type !== 'file') {
      throw new Error(`cannot use "${target.displayPath}" as a reference image: not a regular file`)
    }
    const bytes = await fs.readBytes(target, exec.signal, MAX_REFERENCE_BYTES)
    const mediaType = sniffImageMediaType(bytes)
    if (mediaType === undefined) {
      throw new Error(`cannot use "${target.displayPath}" as a reference image: not a PNG/JPEG/WebP/GIF file`)
    }
    urls.push(`data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`)
  }
  return urls
}

/**
 * Write a generated picture beside the transcript copy.
 *
 * The file is created exclusively: an existing path is a refusal, never an
 * overwrite, because the caller cannot see what it would destroy. Only a local
 * backend can receive bytes — `ctx.fs` writes text, so the bytes go through the
 * host's own file API against the path the backend resolved.
 * @param ctx - a context carrying `fs`.
 * @param exec - the current tool execution.
 * @param requested - the model-supplied destination path.
 * @param bytes - the picture to write.
 * @returns the resolved display path the file was written to.
 * @throws {Error} when the destination exists or cannot hold bytes.
 */
async function writePicture(
  ctx: Context, exec: ToolExecution, requested: string, bytes: Uint8Array,
): Promise<string> {
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('cannot write the picture: no filesystem service is mounted')
  const target = await fs.resolve(requested, await resolveOptions(ctx, exec))
  const existing = await fs.stat(target, exec.signal)
  if (existing !== undefined) {
    throw new Error(`cannot write "${target.displayPath}": the path already exists; name a new file`)
  }
  if (!fs.fileUrl(target).startsWith('file:')) {
    throw new Error(
      `cannot write "${target.displayPath}": this filesystem backend does not accept a local file;`
      + ' the picture stays in the transcript as an attachment',
    )
  }
  await writeFile(fs.processPath(target), bytes, { flag: 'wx' })
  const written = await fs.stat(target, exec.signal)
  if (written !== undefined) ctx.emit('fs/observed', target, { kind: 'present', version: written.version }, exec)
  return target.displayPath
}

/**
 * Register the `generate_image` tool.
 * @param ctx - a context carrying `tools` and `attachments`.
 * @param deps - the stored setting and the generation client.
 * @returns the registration's disposer.
 */
export function registerGenerateImageTool(ctx: Context, deps: ImageToolDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one image from a text prompt with the configured image model '
      + '(the gpt-image, nano-banana, and gemini image families) and return the image itself. '
      + 'One call takes 20-60 seconds. Write the prompt as a full description of the picture you want; '
      + 'quoted text that must appear in the image is rendered by the model, but long lines may smear. '
      + 'Pass images to edit or compose from existing files and say what to keep and what to change; '
      + 'the first reference picture also sets the output aspect ratio. '
      + 'The available models are the ones the operator enabled in Settings → NearToken → Image generation.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the picture should show. Detailed prompts work better than short ones.' },
      model: { type: 'string', description: 'Enabled image model to use; omit to use the first enabled model.' },
      size: { type: 'string', description: 'Requested size such as "1024x1024". Image-generation models only; a chat-completions model refuses it.' },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'auto'],
        description: 'Rendering quality: low is faster and cheaper, high costs more. Image-generation models only.',
      },
      background: {
        type: 'string',
        enum: ['transparent', 'opaque', 'auto'],
        description: 'Transparent output is for logos and cut-outs. Image-generation models only.',
      },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reference pictures to edit or compose from, as file paths read through the workspace. '
          + 'Put the picture that should set the aspect ratio first.',
      },
      path: {
        type: 'string',
        description: 'Also write the picture to this path (relative to the workspace or absolute). '
          + 'The file must not exist yet. Omit to keep the image only in the transcript.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', required: true, description: 'Bare model name that drew the picture.' },
          group: { type: 'string', required: true, description: 'Catalog group the request routed through.' },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string', required: true },
            },
          },
          path: { type: 'string', description: 'Where the picture was also written, when the caller named a path.' },
        },
      },
      render: (_args, value) => generateImageContent(value),
      presentationMeta: (_args, value) => ({ model: value.model, group: value.group }),
    },
    // One picture routinely takes 20-60 seconds, and a slow group can take
    // minutes, so the deadline the timeout policy arms is the generation budget
    // plus a margin rather than any default.
    timeoutMs: deps.timeoutMs() + DEADLINE_MARGIN_MS,
    // Two pictures can be drawn at once: each call owns its own request and
    // writes content-addressed attachments.
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<GeneratedImageValue> {
      const settings = deps.settings()
      if (!settings.enabled) {
        throw new Error('image generation is off: turn it on in Settings → NearToken → Image generation')
      }
      const { model, group } = resolveImageModel(settings.models, args.model)
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('cannot generate an image: no attachment service is mounted')
      // References are read and encoded before the request: a missing file must
      // fail without spending a generation.
      const references = await readReferences(ctx, exec, args.images ?? [])
      const generated = await deps.client.generate({
        model,
        group,
        prompt: args.prompt,
        ...args.size === undefined ? {} : { size: args.size },
        ...args.quality === undefined ? {} : { quality: args.quality },
        ...args.background === undefined ? {} : { background: args.background },
        ...references.length === 0 ? {} : { images: references },
        signal: exec.signal,
      })
      const name = `${model}.${EXTENSIONS[generated.mediaType]}`
      const ref = await attachments.saveImage({
        data: generated.bytes,
        mediaType: generated.mediaType,
        name,
      })
      // The transcript copy is committed before the file is written, so a
      // refused path still leaves the picture in the result.
      const written = args.path === undefined
        ? undefined
        : await writePicture(ctx, exec, args.path, generated.bytes)
      return {
        model: generated.model,
        group: generated.group,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          name: ref.name ?? name,
        },
        ...written === undefined ? {} : { path: written },
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Generate image${args.model === undefined ? '' : ` with ${args.model}`}`,
        kind: 'other',
        rawInput: args.prompt,
      }
    },
  }))
}
