/**
 * 桩测试：fake ctx 上的行为证据（T1–T15 + R1–R7 红线）。
 *
 * 只依赖 node:test / node:assert/strict，不 spawn 子进程。
 * 运行：node --test tests
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../plugin/index.js'
import {
  AVOID,
  DICTIONARY_WORDS,
  TECH_MARKERS,
  VERSION,
  buildPersonaText,
  normalizeConfig,
} from '../plugin/lib/corpus.js'

/* ------------------------------------------------------------------ */
/* fake ctx（照 design/spec.md §6.2 的形状）                           */
/* ------------------------------------------------------------------ */

function fakeCtx() {
  const sections = []
  const tools = []
  const commands = []
  const effects = []
  const unregistered = new Set()
  function remove(list, value) {
    const index = list.indexOf(value)
    if (index >= 0) list.splice(index, 1)
  }
  const ctx = {
    effect(factory, label) {
      const dispose = factory()
      const wrapped = () => {
        if (typeof dispose === 'function') dispose()
      }
      effects.push({ label, dispose: wrapped })
      return wrapped
    },
    systemPrompt: {
      getSectionOrder: name => (name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : 0),
      section(section) {
        sections.push(section)
        return () => { remove(sections, section) }
      },
    },
    tools: {
      register(definition) {
        if (definition.output === undefined
          || typeof definition.output.render !== 'function'
          || definition.output.schema === undefined) {
          throw new TypeError(`tool ${definition.name} must declare output { schema, render }`)
        }
        tools.push(definition)
        return () => {
          unregistered.add(definition.name)
        }
      },
    },
    commands: {
      register(definition) {
        commands.push(definition)
        return () => { remove(commands, definition) }
      },
    },
  }
  return { ctx, sections, tools, commands, effects, unregistered }
}

/**
 * 测试隔离（不是断言变更）：每次 apply 用独立临时目录里的 state 文件，
 * 否则真机 plugin/state/settings.json 会让 T4 的 resident:false → sections 0 不稳定。
 * @param {object} overrides 额外的 config 键。
 * @returns {object} 带 stateFile 的 config。
 */
function isolatedConfig(overrides) {
  return { ...overrides, stateFile: join(mkdtempSync(join(tmpdir(), 'naiwa-test-')), 'settings.json') }
}

/* ------------------------------------------------------------------ */
/* JSON Schema 子集校验器（type/properties/required/additionalProperties */
/* /items/enum/const；约 50 行）                                       */
/* ------------------------------------------------------------------ */

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'description', 'title', 'default', 'examples',
])

function collectIllegalSchemaKeywords(node, path = 'schema', bad = []) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    bad.push(`${path}: not a schema object`)
    return bad
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) bad.push(`${path}.${key}: unsupported keyword`)
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    collectIllegalSchemaKeywords(child, `${path}.properties.${key}`, bad)
  }
  if (node.items !== undefined) collectIllegalSchemaKeywords(node.items, `${path}.items`, bad)
  if (Array.isArray(node.oneOf)) {
    node.oneOf.forEach((child, index) => collectIllegalSchemaKeywords(child, `${path}.oneOf[${index}]`, bad))
  }
  return bad
}

function validateAgainstSchema(value, schema, path = '$') {
  const errors = []
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`]
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: missing required property`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateAgainstSchema(value[key], child, `${path}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${path}.${key}: unexpected property`)
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`]
    if (schema.items !== undefined) {
      value.forEach((entry, index) => errors.push(...validateAgainstSchema(entry, schema.items, `${path}[${index}]`)))
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: expected string`)
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${path}: expected integer`)
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`)
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${path}: const mismatch`)
  if (Object.hasOwn(schema, 'enum') && !(schema.enum ?? []).includes(value)) errors.push(`${path}: enum mismatch`)
  return errors
}

/* ------------------------------------------------------------------ */
/* 公共夹具与工具                                                      */
/* ------------------------------------------------------------------ */

const FIXTURES = {
  glossNaiwa: { subject: '周一早上的闹钟' },
  glossRestrained: { subject: '解释一下递归', tone: 'restrained' },
  artSticker: { subject: '一颗放在玻璃杯里的鸡蛋' },
  artPoster: { subject: '一杯凉掉的咖啡', format: 'poster' },
  artIcon: { subject: '周一早上的闹钟', format: 'icon' },
  speakNaiwa: { text: '周一早上的闹钟响了，我把它按掉，然后继续睡，结果迟到了。' },
}

const CODE_BLOCK = '```js\nconst answer = 42\nconsole.log(answer)\n```'
const INLINE_CODE = '`const f = n => n <= 1 ? 1 : n * f(n - 1)`'
const SAMPLE_URL = 'https://example.com/recursion'
const SPEAK_TECH = '先看这段代码：\n' + CODE_BLOCK
  + '\n递归函数需要有终止条件，否则调用栈会溢出。示例：' + INLINE_CODE + '，详见 ' + SAMPLE_URL + '。'
FIXTURES.speakTech = { text: SPEAK_TECH }

const ONOMATOPOEIA = /[哟齁哈哒噜嘶]/gu
const countOnomatopoeia = text => (text.match(ONOMATOPOEIA) ?? []).length

/** 独立数一遍受保护片段（顺序同规格：代码块 → 行内代码 → URL）。 */
function countProtected(text) {
  const fenced = /```[\s\S]*?```/gu
  const inline = /`[^`\n]+`/gu
  const url = /(?:https?:\/\/|www\.)[^\s，。；、）)\]】」』"'<>]+/gu
  const fencedMatches = text.match(fenced) ?? []
  const afterFenced = text.split(fenced).join('')
  const inlineMatches = afterFenced.match(inline) ?? []
  const afterInline = afterFenced.split(inline).join('')
  const urlMatches = afterInline.match(url) ?? []
  return { codeBlocks: fencedMatches.length, inlineCode: inlineMatches.length, urls: urlMatches.length }
}

/** 递归收集 JSON 值里的全部字符串。 */
function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const entry of value) collectStrings(entry, out)
  else if (value !== null && typeof value === 'object') for (const entry of Object.values(value)) collectStrings(entry, out)
  return out
}

let shared = null

/** 共享一个默认配置的 harness，供只读断言使用。 */
function sharedHarness() {
  if (shared === null) {
    const harness = fakeCtx()
    apply(harness.ctx, isolatedConfig({}))
    const tools = Object.fromEntries(harness.tools.map(definition => [definition.name, definition]))
    shared = { ...harness, byName: tools }
  }
  return shared
}

async function execute(toolName, args) {
  const tool = sharedHarness().byName[toolName]
  assert.ok(tool, `tool ${toolName} must be registered`)
  return tool.execute(args, {})
}

/* ------------------------------------------------------------------ */
/* T1–T15                                                              */
/* ------------------------------------------------------------------ */

test('T1 apply 注册唯一人格 section：name/order/interpolate', () => {
  const harness = fakeCtx()
  apply(harness.ctx, isolatedConfig({}))
  assert.equal(harness.sections.length, 1)
  const section = harness.sections[0]
  assert.equal(section.name, 'naiwa-ism:persona')
  assert.equal(section.order, 1)
  assert.equal(section.interpolate, false)
  assert.equal(typeof section.text, 'string')
  assert.ok(section.text.length > 0)
})

test('T2 默认注入文本长度 ∈ [1500,3000] 且含版本/教义/示例/绷住模式', () => {
  const text = buildPersonaText(normalizeConfig({}))
  console.log('[measure] default injected persona text length = ' + text.length)
  assert.ok(text.length >= 1500 && text.length <= 3000, `injected length ${text.length} outside [1500,3000]`)
  for (const marker of [
    VERSION,
    '抽象', '与世无争', '看破红尘', '英雄主义',
    '绷住模式', '周一早上的闹钟', '解释一下递归',
  ]) {
    assert.ok(text.includes(marker), `persona text must contain ${marker}`)
  }
  assert.ok(!text.includes('`'), 'injected text must not contain a backtick')
  assert.ok(!text.includes('${'), 'injected text must not contain an interpolation opener')
})

test('T3 蛙语词典行数 ≥ 30', () => {
  const text = buildPersonaText(normalizeConfig({}))
  const lines = text.match(/^[^\n｜]{1,8}｜[^\n｜]{1,20}｜例：/gmu) ?? []
  assert.ok(lines.length >= 30, `dictionary lines = ${lines.length}`)
  for (const word of DICTIONARY_WORDS) {
    assert.ok(text.includes(word + '｜'), `dictionary line for ${word}`)
  }
})

test('T4 两档：off 不注入文本、naiwa 有正文；resident:false 关 section 不关工具', () => {
  assert.equal(buildPersonaText(normalizeConfig({ strength: 'off' })), '', 'off must build no persona text')
  const naiwa = buildPersonaText(normalizeConfig({ strength: 'naiwa' }))
  assert.ok(naiwa.length > 1500, 'naiwa persona text must be substantial')
  assert.ok(naiwa.includes('当前档位：奶蛙'), 'naiwa persona must carry its strength line')

  const harness = fakeCtx()
  apply(harness.ctx, isolatedConfig({ resident: false }))
  assert.equal(harness.sections.length, 0)
  assert.equal(harness.tools.length, 4) // B3 强制：第四工具 naiwa_config

  const offHarness = fakeCtx()
  apply(offHarness.ctx, isolatedConfig({ strength: 'off' }))
  assert.equal(offHarness.sections.length, 0, 'strength=off must not register a persona section')
  assert.equal(offHarness.tools.length, 4, 'strength=off must keep the tools')
})

test('T4b config 归一化：非法值回落，spell 追加并截断', () => {
  const coerced = normalizeConfig({ strength: 'nope', resident: 'yes', language: 'fr', spell: '  你好  ' })
  assert.deepEqual(coerced, { strength: 'naiwa', resident: true, language: 'auto', spell: '你好' })
  const longSpell = 'x'.repeat(200)
  assert.equal(normalizeConfig({ spell: longSpell }).spell.length, 120)
  const withSpell = buildPersonaText(normalizeConfig({ spell: '{{不插值}}' }))
  assert.ok(withSpell.includes('自定义咒语：{{不插值}}'))
})

test('T5 恰好三个工具，描述非空且 ≥ 40 字符', () => {
  const harness = sharedHarness()
  assert.equal(harness.tools.length, 4) // B3 强制：第四工具 naiwa_config
  assert.deepEqual(harness.tools.map(tool => tool.name).sort(), ['naiwa_art', 'naiwa_config', 'naiwa_gloss', 'naiwa_speak']) // B3 强制：第四工具 naiwa_config
  for (const tool of harness.tools) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length >= 40, `${tool.name} description too short`)
  }
})

test('T6 parameters 对象根；output.schema 只用 DSH 子集关键词', () => {
  for (const tool of sharedHarness().tools) {
    assert.equal(tool.parameters.type, 'object', `${tool.name} parameters must be object root`)
    assert.ok(Array.isArray(tool.parameters.required), `${tool.name} parameters required`)
    const expected = tool.name === 'naiwa_speak' ? 'text' : tool.name === 'naiwa_config' ? 'action' : 'subject' // B3 强制：控制工具必填 action
    assert.ok(tool.parameters.required.includes(expected), `${tool.name} must require ${expected}`)
    const bad = collectIllegalSchemaKeywords(tool.output.schema)
    assert.deepEqual(bad, [], `${tool.name} output.schema: ${bad.join(' | ')}`)
    const badParameters = collectIllegalSchemaKeywords(tool.parameters)
    assert.deepEqual(badParameters, [], `${tool.name} parameters: ${badParameters.join(' | ')}`)
  }
})

test('T7 每个工具 ≥1 个 canonical value 通过自身 output.schema', async () => {
  const cases = [
    ['naiwa_gloss', FIXTURES.glossNaiwa],
    ['naiwa_gloss', FIXTURES.glossRestrained],
    ['naiwa_art', FIXTURES.artSticker],
    ['naiwa_art', FIXTURES.artPoster],
    ['naiwa_art', FIXTURES.artIcon],
    ['naiwa_speak', FIXTURES.speakTech],
    ['naiwa_speak', FIXTURES.speakNaiwa],
  ]
  for (const [toolName, args] of cases) {
    const tool = sharedHarness().byName[toolName]
    const value = await tool.execute(args, {})
    const errors = validateAgainstSchema(value, tool.output.schema)
    assert.deepEqual(errors, [], `${toolName}(${JSON.stringify(args)}) schema errors: ${errors.join(' | ')}`)
  }
  // 校验器自检：坏值必须被抓到，否则上面的断言没有意义。
  const gloss = sharedHarness().byName.naiwa_gloss
  const good = await gloss.execute(FIXTURES.glossNaiwa, {})
  const broken = { ...good }
  delete broken.maxim
  assert.notDeepEqual(validateAgainstSchema(broken, gloss.output.schema), [])
})

test('T8 gloss：五拍写作指引、语感示例、3 个候选词、notes 非空', async () => {
  for (const subject of ['周一早上的闹钟', '拖延', '一杯凉掉的咖啡']) {
    const value = await execute('naiwa_gloss', { subject })
    assert.equal(value.tone, 'naiwa')
    assert.equal(value.beats.length, 5, `subject ${subject} must yield exactly 5 beats`)
    assert.deepEqual(value.beats.map(beat => beat.name), ['降维', '失控', '大笑', '融化', '余韵'])
    for (const beat of value.beats) assert.ok(beat.text.length > 0)
    assert.ok(value.beats[0].text.includes(subject), 'first beat must name the subject')
    assert.equal(value.exemplar.length, 5, 'exemplar must hold five register samples')
    for (const line of value.exemplar) assert.ok(!line.includes(subject), 'exemplar must not be about the subject')
    assert.equal(value.keywords.length, 3)
    for (const word of value.keywords) assert.ok(DICTIONARY_WORDS.includes(word), `${word} not in dictionary`)
    assert.ok(value.notes.length > 0, 'notes must explain the brief is not the answer')
    assert.ok(value.notes.join('').includes('不要复述'), 'notes must forbid copying the exemplar')
    assert.equal(value.version, VERSION)
  }
})

test('T9 gloss restrained：notes 非空、拟声 ≤1、第三拍不写玩笑', async () => {
  const value = await execute('naiwa_gloss', { subject: '解释一下递归', tone: 'restrained' })
  assert.equal(value.tone, 'restrained')
  assert.ok(value.notes.length >= 1)
  assert.ok(value.notes[0].includes('绷住模式'))
  const beatsAndMaxim = value.beats.map(beat => beat.text).join('') + value.maxim
  assert.ok(countOnomatopoeia(beatsAndMaxim) <= 1, 'restrained beats+maxim onomatopoeia must be ≤ 1')
  assert.ok(value.beats[2].text.includes('不写玩笑'))
  for (const word of value.keywords) assert.ok(DICTIONARY_WORDS.includes(word))
})

test('T10 art：5 个 hex、中英提示词关键词、7 条禁忌', async () => {
  for (const [fixture, format] of [
    [FIXTURES.artSticker, 'sticker'],
    [FIXTURES.artPoster, 'poster'],
    [FIXTURES.artIcon, 'icon'],
  ]) {
    const value = await execute('naiwa_art', fixture)
    for (const [key, color] of Object.entries(value.palette)) {
      assert.match(color, /^#[0-9a-f]{6}$/i, `palette.${key} invalid: ${color}`)
    }
    assert.ok(value.prompt_zh.includes(value.subject))
    assert.ok(value.prompt_zh.includes('避免'))
    assert.ok(value.prompt_en.includes('Avoid'))
    assert.ok(value.prompt_en.includes('yellow soft body'))
    assert.ok(value.prompt_en.includes('low-resolution'))
    if (format !== 'icon') assert.ok(value.prompt_en.includes('sticker'))
    assert.equal(value.avoid.length, 7)
    for (const term of ['精致', '对称', '景深', '高级感']) assert.ok(value.avoid.includes(term))
    for (const term of ['低分辨率', 'AI 伪影', '压缩块', '糊边']) {
      assert.ok(value.decay.includes(term), `decay must mention ${term}`)
    }
    for (const phrase of ['梨形', '尖吻', '三趾']) {
      assert.ok(value.form.includes(phrase), `form must mention ${phrase}`)
    }
    assert.ok(value.eyes.includes('半睁'))
    assert.ok(value.eyes.includes('小'))
    assert.ok(value.mouth.includes('平线'))
    assert.ok(value.mouth.includes('笑'))
  }
  const icon = await execute('naiwa_art', FIXTURES.artIcon)
  assert.ok(icon.composition.includes('36×36'))
  assert.ok(icon.composition.includes('无文字'))
})

test('T11 speak：逐句计划、受保护片段计数、restrained 拟声 ≤1', async () => {
  const value = await execute('naiwa_speak', FIXTURES.speakTech)
  assert.equal(value.mode, 'restrained')
  assert.deepEqual(value.protected, countProtected(SPEAK_TECH))
  const planText = value.plan.map(item => item.text).join('')
  assert.ok(planText.includes(CODE_BLOCK), 'fenced code block must appear verbatim in the plan')
  assert.ok(planText.includes(INLINE_CODE), 'inline code must appear verbatim in the plan')
  assert.ok(planText.includes(SAMPLE_URL), 'URL must appear verbatim in the plan')
  assert.ok(!planText.includes('\u0000'), 'plan must not contain placeholder residue')
  assert.ok(value.example.rewritten.length > 0)
  assert.ok(value.notes.join('').includes('不要复述'))
  assert.ok(countOnomatopoeia(JSON.stringify(value)) <= 1, 'restrained guidance onomatopoeia must be ≤ 1')
})

test('T12 确定性：同参两次 deep-equal；不同 seed 不同结果', async () => {
  for (const [toolName, args] of [
    ['naiwa_gloss', FIXTURES.glossNaiwa],
    ['naiwa_art', FIXTURES.artSticker],
    ['naiwa_speak', FIXTURES.speakTech],
    ['naiwa_speak', FIXTURES.speakNaiwa],
  ]) {
    const first = await execute(toolName, args)
    const second = await execute(toolName, args)
    assert.deepEqual(first, second, `${toolName} must be deterministic`)
  }
  const seedA = await execute('naiwa_gloss', { subject: '周一早上的闹钟', seed: 'a' })
  const seedB = await execute('naiwa_gloss', { subject: '周一早上的闹钟', seed: 'b' })
  assert.notDeepEqual(seedA, seedB, 'different seeds should change the gloss')
})

test('T13 render 纯投影：text 块非空，含五拍名 / ≥4 hex / 正文', async () => {
  const glossValue = await execute('naiwa_gloss', FIXTURES.glossNaiwa)
  const glossBlocks = sharedHarness().byName.naiwa_gloss.output.render(FIXTURES.glossNaiwa, glossValue)
  assert.equal(glossBlocks.length, 1)
  assert.equal(glossBlocks[0].type, 'text')
  for (const name of ['降维', '失控', '大笑', '融化', '余韵']) assert.ok(glossBlocks[0].text.includes(name))

  const artValue = await execute('naiwa_art', FIXTURES.artSticker)
  const artBlocks = sharedHarness().byName.naiwa_art.output.render(FIXTURES.artSticker, artValue)
  assert.equal(artBlocks[0].type, 'text')
  assert.ok((artBlocks[0].text.match(/#[0-9a-f]{6}/gi) ?? []).length >= 4)

  const speakValue = await execute('naiwa_speak', FIXTURES.speakTech)
  const speakBlocks = sharedHarness().byName.naiwa_speak.output.render(FIXTURES.speakTech, speakValue)
  assert.equal(speakBlocks[0].type, 'text')
  assert.ok(speakBlocks[0].text.includes(speakValue.policy))
})

test('T14 生命周期：两个 effect disposer 依次执行后三个工具注销', () => {
  const harness = fakeCtx()
  apply(harness.ctx, isolatedConfig({}))
  assert.equal(harness.effects.length, 3) // B3/B4 强制：命令必须独立 effect 才随插件卸载
  assert.deepEqual(harness.effects.map(effect => effect.label), ['naiwa-ism:persona', 'naiwa-ism:tools', 'naiwa-ism:command']) // B3/B4 强制：命令 effect
  harness.effects[0].dispose()
  harness.effects[1].dispose()
  assert.equal(harness.unregistered.size, 4) // B3 强制：第四工具 naiwa_config
  for (const name of ['naiwa_gloss', 'naiwa_art', 'naiwa_speak', 'naiwa_config']) { // B3 强制：第四工具 naiwa_config
    assert.ok(harness.unregistered.has(name), `${name} must be disposed`)
  }
})

test('T15 空 subject / 空 text 拒绝', async () => {
  await assert.rejects(() => execute('naiwa_gloss', { subject: '   ' }), /subject must be a non-empty string/)
  await assert.rejects(() => execute('naiwa_art', {}), /subject must be a non-empty string/)
  await assert.rejects(() => execute('naiwa_gloss', { subject: 42 }), /subject must be a non-empty string/)
  await assert.rejects(() => execute('naiwa_speak', { text: '  \n ' }), /text must be a non-empty string/)
})

/* ------------------------------------------------------------------ */
/* R1–R7 风格红线：作用在真实 execute 输出上                          */
/* ------------------------------------------------------------------ */

async function allOutputs() {
  return {
    glossNaiwa: await execute('naiwa_gloss', FIXTURES.glossNaiwa),
    glossRestrained: await execute('naiwa_gloss', FIXTURES.glossRestrained),
    artSticker: await execute('naiwa_art', FIXTURES.artSticker),
    artPoster: await execute('naiwa_art', FIXTURES.artPoster),
    artIcon: await execute('naiwa_art', FIXTURES.artIcon),
    speakTech: await execute('naiwa_speak', FIXTURES.speakTech),
    speakNaiwa: await execute('naiwa_speak', FIXTURES.speakNaiwa),
  }
}

test('R1 不用 emoji 代替语言', async () => {
  const outputs = await allOutputs()
  const strings = [...Object.values(outputs).flatMap(value => collectStrings(value)), buildPersonaText(normalizeConfig({}))]
  for (const text of strings) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), `emoji found in: ${text.slice(0, 40)}`)
  }
})

test('R2 不把奶蛙写成卖萌吉祥物（注入文本只允许规格强制的否定句）', async () => {
  const outputs = await allOutputs()
  const banned = /宝宝|撒娇|爱你|小奶蛙|可爱吉祥物|萌物/u
  for (const text of Object.values(outputs).flatMap(value => collectStrings(value))) {
    assert.ok(!banned.test(text), `banned selling-cute term in tool output: ${text.slice(0, 40)}`)
  }
  const persona = buildPersonaText(normalizeConfig({}))
  // 规格强制的逐字人格正文里有一句否定指令「不撒娇」；红线禁止的是卖萌行为本身。
  // 因此先去掉允许的否定说法，再断言其余文本零命中。
  const withoutNegations = persona.replace(/不撒娇|不卖萌|不是吉祥物/gu, '')
  assert.ok(!banned.test(withoutNegations), 'persona must not contain selling-cute terms outside mandated negations')
  assert.ok(persona.includes('不是吉祥物'))
  assert.ok(persona.includes('看破红尘'))
})

test('R3 不堆砌过期热词', async () => {
  const outputs = await allOutputs()
  const hot = /yyds|绝绝子|栓q|666|破防了|awsl|芭比q|小镇做题家/iu
  for (const text of Object.values(outputs).flatMap(value => collectStrings(value))) {
    assert.ok(!hot.test(text), `hot word found: ${text.slice(0, 40)}`)
  }
  assert.ok(!hot.test(buildPersonaText(normalizeConfig({}))))
})

test('R4 不羞辱真实个体、不出歧视性词汇', async () => {
  const outputs = await allOutputs()
  const insult = /傻逼|脑残|弱智|废物|垃圾人|丑逼/u
  for (const text of Object.values(outputs).flatMap(value => collectStrings(value))) {
    assert.ok(!insult.test(text), `insult found: ${text.slice(0, 40)}`)
    assert.ok(!/@[A-Za-z0-9_]{2,}/u.test(text), 'targeted @handle attack pattern found')
  }
})

test('R5 技术内容不被风格吃掉', async () => {
  const outputs = await allOutputs()
  const restrained = outputs.glossRestrained
  assert.ok(countOnomatopoeia(JSON.stringify(restrained)) <= 1)
  assert.ok(restrained.notes.length > 0)
  assert.equal(outputs.speakTech.mode, 'restrained')
  assert.deepEqual(outputs.speakTech.protected, countProtected(SPEAK_TECH))
  const speakPlanText = outputs.speakTech.plan.map(item => item.text).join('')
  assert.ok(speakPlanText.includes(CODE_BLOCK))
  assert.ok(speakPlanText.includes(SAMPLE_URL))
  // 技术标记表本身必须覆盖规格里的类别
  for (const marker of ['函数', '递归', '安全', '医疗', '法律', 'api', 'json', 'sql']) {
    assert.ok(TECH_MARKERS.includes(marker), `TECH_MARKERS missing ${marker}`)
  }
})

test('R6 出图不追求精致/高级（禁词只允许出现在 Avoid 段）', async () => {
  const outputs = await allOutputs()
  for (const key of ['artSticker', 'artPoster', 'artIcon']) {
    const promptEn = outputs[key].prompt_en
    assert.ok(!/photorealistic|8k|cinematic|studio lighting/iu.test(promptEn))
    const [head, avoidPart = ''] = promptEn.split('Avoid:')
    assert.ok(!/depth of field|premium/iu.test(head), `${key} prompt head must not ask for depth-of-field/premium`)
    assert.ok(/depth of field/iu.test(avoidPart))
    assert.ok(/premium/iu.test(avoidPart))
    for (const term of ['精致', '对称', '景深', '高级感']) assert.ok(outputs[key].avoid.includes(term))
  }
  assert.equal(AVOID.length, 7)
})

test('R7 不复制真实版权形象', async () => {
  const outputs = await allOutputs()
  for (const key of ['artSticker', 'artPoster', 'artIcon']) {
    assert.ok(!/奶龙|nailong/iu.test(outputs[key].prompt_zh))
    assert.ok(!/奶龙|nailong/iu.test(outputs[key].prompt_en))
  }
  const persona = buildPersonaText(normalizeConfig({}))
  const mentions = persona.match(/奶龙/gu) ?? []
  assert.ok(mentions.length <= 2, `persona 奶龙 mentions = ${mentions.length}`)
})
