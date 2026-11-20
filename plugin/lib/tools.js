/**
 * 三个确定性工具：naiwa_gloss / naiwa_art / naiwa_speak。
 *
 * 每个工具返回 canonical JSON value（只回值，不回内容块），
 * 由 output.render 做纯投影。所有选择都由 FNV-1a 稳定哈希决定。
 *
 * @module @local/dsh-naiwa-ism/lib/tools
 */

import { fnv1a, normalizeSubject, normalizeText, pick } from './hash.js'
import { renderArt, renderGloss, renderSpeak } from './render.js'
import {
  AFTER_TEMPLATES,
  ART_DECAYS,
  ART_FORMATS,
  AVOID,
  AVOID_EN,
  BEAT_NAMES,
  COMPOSITIONS,
  COMPOSITIONS_EN,
  DECAYS,
  DICTIONARY_WORDS,
  DIMENSION_TEMPLATES,
  EYES,
  FORMS,
  FORMAT_LABELS_EN,
  FORMAT_LABELS_ZH,
  HINTS,
  LAUGH_TEMPLATES,
  LOSS_TEMPLATES,
  LUMPS,
  MATERIALS,
  MAXIMS,
  MELT_TEMPLATES,
  MOUTHS,
  NOISES,
  PALETTE,
  POOLS,
  RESTRAINED_BEATS,
  RESTRAINED_KEYWORDS,
  RESTRAINED_MAXIM,
  RESTRAINED_NOTE,
  SHAPES,
  SPEAK_TAILS,
  TECH_MARKERS,
  VERSION,
} from './corpus.js'

/** 把 `{key}` 槽位替换成已取好的值；单遍替换，不重复扫描插入值。 */
function fill(template, slots) {
  return template.replace(/\{([a-z]+)\}/gu, (match, key) => (
    Object.hasOwn(slots, key) ? String(slots[key]) : match
  ))
}

/** 取 3 个互不相同的关键词；不足 3 个时按池顺序补齐。 */
function pickKeywords(base, pool) {
  const chosen = []
  for (let index = 0; index < 3; index += 1) {
    const word = pick(base, 'kw.' + index, pool)
    if (!chosen.includes(word)) chosen.push(word)
  }
  for (const word of pool) {
    if (chosen.length >= 3) break
    if (!chosen.includes(word)) chosen.push(word)
  }
  return chosen.slice(0, 3)
}

/** 去掉句末标点，供把整句嵌进提示词模板时使用。 */
function trimEnd(text) {
  return text.replace(/[。；，、\s]+$/u, '')
}

/** 五拍叙事器的参数 schema（原始 JSON Schema）。 */
const GLOSS_PARAMETERS = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: '要转写的对象：物品、事件、概念或任务。' },
    tone: {
      type: 'string',
      enum: ['naiwa', 'restrained'],
      description: 'naiwa=常态奶蛙腔（默认）；restrained=绷住模式，用于技术、医疗、法律、安全等必须保住事实的场合。',
    },
    seed: { type: 'string', description: '可选。同 subject 想换一种说法时给不同 seed；省略时只按 subject 做稳定哈希。' },
  },
  required: ['subject'],
  additionalProperties: false,
}

/** 五拍叙事器的输出 schema：DSH 强制子集（无 minItems / pattern）。 */
const GLOSS_OUTPUT = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    tone: { type: 'string', enum: ['naiwa', 'restrained'] },
    beats: {
      type: 'array',
      description: '恰好五拍，顺序固定：降维、失控、大笑、融化、余韵（schema 子集无 minItems，由测试断言）。',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['降维', '失控', '大笑', '融化', '余韵'] },
          text: { type: 'string' },
        },
        required: ['name', 'text'],
        additionalProperties: false,
      },
    },
    maxim: { type: 'string', description: '一句箴言。' },
    keywords: { type: 'array', items: { type: 'string' }, description: '3 个蛙语关键词，取自蛙语词典。' },
    notes: { type: 'array', items: { type: 'string' }, description: '边界说明；常态为空数组。' },
    version: { type: 'string', const: VERSION },
  },
  required: ['subject', 'tone', 'beats', 'maxim', 'keywords', 'notes', 'version'],
  additionalProperties: false,
}

/** 美术指导的参数 schema。 */
const ART_PARAMETERS = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: '要出图的对象。' },
    seed: { type: 'string', description: '可选；换构图/材质变体的稳定种子。' },
    format: {
      type: 'string',
      enum: ['sticker', 'poster', 'icon'],
      description: 'sticker=白底贴纸（默认）；poster=竖幅；icon=36×36 小图标。',
    },
  },
  required: ['subject'],
  additionalProperties: false,
}

/** 美术指导的输出 schema。 */
const ART_OUTPUT = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    palette: {
      type: 'object',
      properties: {
        primary: { type: 'string' },
        accent: { type: 'string' },
        ink: { type: 'string' },
        background: { type: 'string' },
        hint: { type: 'string' },
      },
      required: ['primary', 'accent', 'ink', 'background', 'hint'],
      additionalProperties: false,
    },
    form: { type: 'string' },
    eyes: { type: 'string' },
    mouth: { type: 'string' },
    material: { type: 'string' },
    decay: { type: 'string' },
    composition: { type: 'string' },
    prompt_zh: { type: 'string' },
    prompt_en: { type: 'string' },
    avoid: { type: 'array', items: { type: 'string' } },
    version: { type: 'string', const: VERSION },
  },
  required: [
    'subject', 'palette', 'form', 'eyes', 'mouth', 'material', 'decay',
    'composition', 'prompt_zh', 'prompt_en', 'avoid', 'version',
  ],
  additionalProperties: false,
}

/** 节奏重写器的参数 schema。 */
const SPEAK_PARAMETERS = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '要重排的原文。' },
    intensity: {
      type: 'string',
      enum: ['mild', 'full'],
      description: 'mild=只拆句读、零尾音；full=拆句读并加最多两处尾音（默认）。',
    },
  },
  required: ['text'],
  additionalProperties: false,
}

/** 节奏重写器的输出 schema。 */
const SPEAK_OUTPUT = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '重排后的正文；受保护片段逐字保留。' },
    mode: { type: 'string', enum: ['naiwa', 'restrained'] },
    protected: {
      type: 'object',
      properties: {
        codeBlocks: { type: 'integer' },
        inlineCode: { type: 'integer' },
        urls: { type: 'integer' },
      },
      required: ['codeBlocks', 'inlineCode', 'urls'],
      additionalProperties: false,
    },
    version: { type: 'string', const: VERSION },
  },
  required: ['text', 'mode', 'protected', 'version'],
  additionalProperties: false,
}

/** 受保护片段正则在 protectSegments 内按顺序使用。 */
const PLACEHOLDER = /\u0000P\d+\u0000/gu

/**
 * 把代码块、行内代码、URL 换成占位符，并记录各自的匹配数。
 * @param {string} text 原文。
 * @returns {{ out: string, store: string[], counts: { codeBlocks: number, inlineCode: number, urls: number } }} 保护结果。
 */
function protectSegments(text) {
  const store = []
  const counts = { codeBlocks: 0, inlineCode: 0, urls: 0 }
  const slots = [
    ['codeBlocks', /```[\s\S]*?```/gu],
    ['inlineCode', /`[^`\n]+`/gu],
    ['urls', /(?:https?:\/\/|www\.)[^\s，。；、）)\]】」』"'<>]+/gu],
  ]
  let out = text
  for (const [kind, pattern] of slots) {
    out = out.replace(pattern, match => {
      const placeholder = '\u0000P' + store.length + '\u0000'
      store.push(match)
      counts[kind] += 1
      return placeholder
    })
  }
  return { out, store, counts }
}

/**
 * 还原占位符。占位符只在本函数内出现，输出前必须全部消失。
 * @param {string} text 含占位符的文本。
 * @param {string[]} store 被保护的片段。
 * @returns {string} 还原后的文本。
 */
function restoreSegments(text, store) {
  return text.replace(/\u0000P(\d+)\u0000/gu, (match, index) => store[Number(index)])
}

/** 去掉占位符后的可见长度。 */
function visibleLength(segment) {
  return segment.replace(PLACEHOLDER, '').length
}

/**
 * 按 `。！？换行` 切句，保留每个分隔符。
 * @param {string} text 待切文本。
 * @returns {string[]} 句子数组。
 */
function splitSentences(text) {
  const sentences = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '。' || char === '！' || char === '？' || char === '\n') {
      sentences.push(text.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < text.length) sentences.push(text.slice(start))
  return sentences
}

/**
 * 可见长度超过 20 的句子把句内逗号/分号改成句号；否则原样。
 * @param {string} sentence 单句。
 * @returns {string} 重排后的句子。
 */
function rewriteSentence(sentence) {
  if (visibleLength(sentence) <= 20) return sentence
  return sentence.split('，').join('。').split('；').join('。')
}

/**
 * 在句子边界插入最多两处尾音；位置与尾音都由稳定哈希决定。
 * @param {string} seedText 原文。
 * @param {string[]} sentences 句子数组。
 * @returns {string} 拼接后的正文。
 */
function addTails(seedText, sentences) {
  const tails = new Map()
  const wanted = Math.min(2, sentences.length)
  for (let index = 0; index < wanted; index += 1) {
    const tail = pick(seedText, 'tau.' + index, SPEAK_TAILS)
    let position = fnv1a(seedText + '\u0000tau.at.' + index) % sentences.length
    while (tails.has(position)) position = (position + 1) % sentences.length
    tails.set(position, tail)
  }
  let out = ''
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]
    const tail = tails.get(index)
    if (tail === undefined) {
      out += sentence
      continue
    }
    const needsStop = !/[。！？\n]$/u.test(sentence)
    out += sentence + (needsStop ? '。' : '') + tail
  }
  return out
}

/** 五拍叙事器正文。 */
function buildGloss(args) {
  const subject = normalizeSubject(args.subject)
  const seed = typeof args.seed === 'string' ? args.seed : ''
  const tone = args.tone === 'restrained' ? 'restrained' : 'naiwa'
  const base = subject + '\u0000' + seed

  if (tone === 'restrained') {
    return {
      subject,
      tone,
      beats: RESTRAINED_BEATS.map(beat => ({ name: beat.name, text: fill(beat.text, { s: subject }) })),
      maxim: RESTRAINED_MAXIM,
      keywords: pickKeywords(base, RESTRAINED_KEYWORDS),
      notes: [RESTRAINED_NOTE],
      version: VERSION,
    }
  }

  const dimension = fill(pick(base, 'beats.0', DIMENSION_TEMPLATES), {
    s: subject,
    shape: pick(base, 'beats.0.shape', SHAPES),
    lump: pick(base, 'beats.0.lump', LUMPS),
  })
  const loss = fill(pick(base, 'beats.1', LOSS_TEMPLATES), {
    s: subject,
    decay: pick(base, 'beats.1.decay', DECAYS),
    noise: pick(base, 'beats.1.noise', NOISES),
  })
  const laugh = pick(base, 'beats.2', LAUGH_TEMPLATES)
  const melt = fill(pick(base, 'beats.3', MELT_TEMPLATES), {
    s: subject,
    pool: pick(base, 'beats.3.pool', POOLS),
  })
  const after = pick(base, 'beats.4', AFTER_TEMPLATES)

  return {
    subject,
    tone,
    beats: [
      { name: BEAT_NAMES[0], text: dimension },
      { name: BEAT_NAMES[1], text: loss },
      { name: BEAT_NAMES[2], text: laugh },
      { name: BEAT_NAMES[3], text: melt },
      { name: BEAT_NAMES[4], text: after },
    ],
    maxim: pick(base, 'maxim', MAXIMS),
    keywords: pickKeywords(base, DICTIONARY_WORDS),
    notes: [],
    version: VERSION,
  }
}

/** 美术指导正文。 */
function buildArt(args) {
  const subject = normalizeSubject(args.subject)
  const seed = typeof args.seed === 'string' ? args.seed : ''
  const format = ART_FORMATS.includes(args.format) ? args.format : 'sticker'
  const base = subject + '\u0000' + seed

  const hint = pick(base, 'palette.hint', HINTS)
  const form = fill(pick(base, 'form', FORMS), { s: subject })
  const eyes = pick(base, 'eyes', EYES)
  const mouth = pick(base, 'mouth', MOUTHS)
  const material = pick(base, 'material', MATERIALS)
  const decay = pick(base, 'decay', ART_DECAYS)
  const composition = pick(base, 'composition.' + format, COMPOSITIONS[format])
  const compositionEn = pick(base, 'compositionEn.' + format, COMPOSITIONS_EN[format])
  const hexes = [PALETTE.primary, PALETTE.accent, PALETTE.ink, PALETTE.background, hint].join(' / ')

  const promptZh = '「' + subject + '」的奶蛙化' + FORMAT_LABELS_ZH[format] + '：'
    + trimEnd(form) + '；' + trimEnd(eyes) + '；' + trimEnd(mouth)
    + '；材质：' + trimEnd(material)
    + '；必须有退化感（' + trimEnd(decay) + '）'
    + '；构图：' + trimEnd(composition)
    + '。配色：主色 ' + PALETTE.primary + '、辅色 ' + PALETTE.accent + '、糊边黑 ' + PALETTE.ink
    + '、底 ' + PALETTE.background + '、提示色 ' + hint
    + '。避免：' + AVOID.join('、') + '。' + VERSION

  const promptEn = 'A naiwa-ism ' + FORMAT_LABELS_EN[format] + ' of "' + subject + '": '
    + 'a pear-shaped yellow soft body, head merged into the torso, a short duck-bill snout, '
    + 'small half-lidded eyes that have already seen through everything, a flat mouth that breaks into '
    + 'a laugh only on purpose, short arms folded over a pale belly, three-toed feet; '
    + 'cheap plastic under a jelly skin with cracks and patches; '
    + 'required low-resolution AI artifacts, compression blocks and blurred edges; palette ' + hexes
    + '; ' + compositionEn + '. Avoid: ' + AVOID_EN.join(', ') + '.'

  return {
    subject,
    palette: {
      primary: PALETTE.primary,
      accent: PALETTE.accent,
      ink: PALETTE.ink,
      background: PALETTE.background,
      hint,
    },
    form,
    eyes,
    mouth,
    material,
    decay,
    composition,
    prompt_zh: promptZh,
    prompt_en: promptEn,
    avoid: AVOID.slice(),
    version: VERSION,
  }
}

/** 节奏重写正文。 */
function buildSpeak(args) {
  const original = normalizeText(args.text)
  const intensity = args.intensity === 'mild' ? 'mild' : 'full'
  const { out, store, counts } = protectSegments(original)
  const scan = out.replace(PLACEHOLDER, '\u0000').toLowerCase()
  const mode = TECH_MARKERS.some(marker => scan.includes(marker)) ? 'restrained' : 'naiwa'
  const sentences = splitSentences(out).map(rewriteSentence)

  let body
  if (intensity === 'full' && mode === 'naiwa') {
    body = addTails(original, sentences)
  } else {
    body = sentences.join('')
    if (intensity === 'full' && mode === 'restrained') {
      const trimmed = body.replace(/\s+$/u, '')
      const needsStop = !/[。！？]$/u.test(trimmed)
      body = trimmed + (needsStop ? '。' : '') + '齁。'
    }
  }

  return {
    text: restoreSegments(body, store),
    mode,
    protected: {
      codeBlocks: counts.codeBlocks,
      inlineCode: counts.inlineCode,
      urls: counts.urls,
    },
    version: VERSION,
  }
}

/** 五拍叙事器定义。 */
const glossTool = {
  name: 'naiwa_gloss',
  description: '把任意对象转写成奶蛙主义五拍叙事：降维 → 失控 → 大笑 → 融化 → 余韵，并给出箴言与蛙语关键词。tone 为 restrained 时进入绷住模式：只给可安全承载事实的骨架与边界说明，不写玩笑拍。适合在需要用奶蛙视角讲一件事时调用；同输入同输出。',
  parameters: GLOSS_PARAMETERS,
  output: { schema: GLOSS_OUTPUT, render: renderGloss },
  async execute(args) {
    const input = args !== null && typeof args === 'object' ? args : {}
    return buildGloss(input)
  },
}

/** 美术指导定义。 */
const artTool = {
  name: 'naiwa_art',
  description: '把一个对象转成奶蛙美术指导：形体、眼睛、嘴、材质、退化感、构图、五色配色（hex）、中英双语出图提示词与禁忌清单。奶蛙造型由「失败生成的黄色软体」这一公开符号抽象而来，不引用任何真实版权形象。同输入同输出。',
  parameters: ART_PARAMETERS,
  output: { schema: ART_OUTPUT, render: renderArt },
  async execute(args) {
    const input = args !== null && typeof args === 'object' ? args : {}
    return buildArt(input)
  },
}

/** 节奏重写器定义。 */
const speakTool = {
  name: 'naiwa_speak',
  description: '把一段话按奶蛙节奏重排：拆长句、加最多两处尾音（哟齁齁/齁/哈），不改任何实词、不改语序含义。代码块、行内代码、URL 逐字保留。文本命中技术/医疗/法律/安全等标记时自动进入绷住模式（mode: "restrained"），只在结尾留一个尾音。不替代事实性回答。',
  parameters: SPEAK_PARAMETERS,
  output: { schema: SPEAK_OUTPUT, render: renderSpeak },
  async execute(args) {
    const input = args !== null && typeof args === 'object' ? args : {}
    return buildSpeak(input)
  },
}

/**
 * 构建三个工具定义（每次调用返回新数组，互不共享可变状态）。
 * @returns {object[]} 工具定义数组。
 */
export function buildToolDefinitions() {
  return [glossTool, artTool, speakTool].map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: tool.output,
    execute: tool.execute,
  }))
}
