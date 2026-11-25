/**
 * 文件与元数据测试（F1–F8），附带在真实 execute 输出上跑的风格红线。
 *
 * 只依赖 node:test / node:assert/strict / node:fs / node:path，不 spawn 子进程。
 * 运行：node --test tests
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { buildToolDefinitions } from '../plugin/lib/tools.js'
import { DICTIONARY_WORDS, TECH_MARKERS, VERSION, buildPersonaText, normalizeConfig } from '../plugin/lib/corpus.js'

const PLUGIN_ROOT = fileURLToPath(new URL('../plugin/', import.meta.url))

const read = file => readFile(join(PLUGIN_ROOT, file), 'utf8')
const readJson = async file => JSON.parse(await read(file))

async function exists(file) {
  try {
    const info = await stat(join(PLUGIN_ROOT, file))
    return info.isFile()
  } catch {
    return false
  }
}

/** 把 `files` 里的一条声明展开成实际文件列表。 */
async function expandFilesEntry(entry) {
  if (entry === 'docs') {
    const names = await readdir(join(PLUGIN_ROOT, 'docs'))
    return names.map(name => 'docs/' + name)
  }
  if (entry.includes('*')) {
    const slash = entry.indexOf('/')
    const dir = entry.slice(0, slash)
    const suffix = entry.slice(slash + 1).replace('*', '')
    const names = await readdir(join(PLUGIN_ROOT, dir))
    return names.filter(name => name.endsWith(suffix)).map(name => dir + '/' + name)
  }
  return (await exists(entry)) ? [entry] : []
}

/** §4.1 的运行时文件清单（必须全部被 files 覆盖、且在磁盘存在）。 */
const RUNTIME_FILES = [
  'index.js',
  'client.js',
  'lib/corpus.js',
  'lib/hash.js',
  'lib/tools.js',
  'lib/render.js',
  'lib/state.js',
  'lib/control.js',
  'cordis.patch.yml',
  'locale/en.json',
  'locale/zh.json',
  'icon.png',
  'README.md',
  'docs/DETAIL.md',
  'docs/DETAIL.zh.md',
  'docs/preview.svg',
]

const SAMPLE_URL = 'https://example.com/recursion'
const INLINE_CODE = '`const f = n => n <= 1 ? 1 : n * f(n - 1)`'
const CODE_BLOCK = '```js\nconst answer = 42\nconsole.log(answer)\n```'

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const entry of value) collectStrings(entry, out)
  else if (value !== null && typeof value === 'object') for (const entry of Object.values(value)) collectStrings(entry, out)
  return out
}

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

/* ------------------------------------------------------------------ */
/* F1–F7 静态文件与元数据                                              */
/* ------------------------------------------------------------------ */

test('F1 package.json / locale 可解析；exports 完整；无依赖与 engines', async () => {
  const pkg = await readJson('package.json')
  assert.equal(pkg.name, '@local/dsh-naiwa-ism')
  assert.equal(pkg.version, '1.5.0')
  assert.equal(pkg.type, 'module')
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'engines']) {
    assert.equal(pkg[field], undefined, `package.json must not declare ${field}`)
  }
  // B5 强制：GUI 客户端半要求 package.json 声明 dsh.client（platform=web），
  // 而第一增量的 deepEqual({ bundle: ... }) 无法容纳该键。这里改为同时锁定
  // bundle patch 与 client 声明（更强，不是放宽）；spec §7.4 漏算了这一行。
  assert.deepEqual(pkg.dsh, {
    bundle: { patch: './cordis.patch.yml' },
    client: { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-renderer'] },
  })
  assert.ok(await exists('cordis.patch.yml'))
  for (const key of ['.', './locale/*.json', './icon', './package.json']) {
    assert.equal(typeof pkg.exports[key], 'string', `exports missing ${key}`)
  }
  const en = await readJson('locale/en.json')
  const zh = await readJson('locale/zh.json')
  assert.equal(typeof en.meta.title, 'string')
  assert.equal(typeof zh.meta.title, 'string')
})

test('F2 files 覆盖全部运行时文件且每个条目都在磁盘存在', async () => {
  const pkg = await readJson('package.json')
  const covered = new Set()
  for (const entry of pkg.files) {
    const expanded = await expandFilesEntry(entry)
    assert.ok(expanded.length > 0, `files entry "${entry}" matches nothing on disk`)
    for (const file of expanded) {
      assert.ok(await exists(file), `files entry "${entry}" expands to missing file ${file}`)
      covered.add(file)
    }
  }
  for (const file of RUNTIME_FILES) {
    assert.ok(covered.has(file), `runtime file ${file} is not covered by package.json files`)
  }
})

test('F3 cordis.patch.yml：恰好一条 insert、四个 config 键、无 !!js', async () => {
  const patch = await read('cordis.patch.yml')
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
  assert.equal((patch.match(/insert:/g) ?? []).length, 1)
  assert.ok(patch.includes('id: naiwa-ism'))
  assert.ok(patch.includes("name: '@local/dsh-naiwa-ism'"))
  for (const line of ['strength: naiwa', 'resident: true', 'language: auto', "spell: ''"]) {
    assert.ok(patch.includes(line), `patch missing config line: ${line}`)
  }
  assert.ok(!patch.includes('!!js'))
})

test('F4 源码零依赖/确定性禁词扫描', async () => {
  const sources = ['index.js', 'lib/corpus.js', 'lib/hash.js', 'lib/tools.js', 'lib/render.js', 'lib/state.js', 'lib/control.js']
  const forbidden = ['@deepseek-ai/', 'require(', 'Math.random', 'Date.now', 'new Date(', 'process.env']
  for (const file of sources) {
    const source = await read(file)
    for (const token of forbidden) {
      assert.ok(!source.includes(token), `${file} must not contain ${token}`)
    }
  }
})

test('F5 icon.png：合法 PNG、256×256、<256KiB', async () => {
  const info = await stat(join(PLUGIN_ROOT, 'icon.png'))
  assert.ok(info.isFile())
  assert.ok(info.size < 262144, `icon too large: ${info.size} bytes`)
  const bytes = readFileSync(join(PLUGIN_ROOT, 'icon.png'))
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'icon must be a PNG',
  )
  assert.equal(bytes.readUInt32BE(16), 256, 'icon width must be 256')
  assert.equal(bytes.readUInt32BE(20), 256, 'icon height must be 256')
})

test('F6 DETAIL 各恰好一行图片；preview.svg 640×300 自包含', async () => {
  for (const file of ['docs/DETAIL.md', 'docs/DETAIL.zh.md']) {
    const text = await read(file)
    const lines = text.split(/\r?\n/u).filter(line => line.trim().length > 0)
    assert.equal(lines.length, 1, `${file} must contain exactly one non-empty line`)
    assert.match(lines[0], /^!\[[^\]]+\]\(preview\.svg\)$/u, `${file} must be one Markdown image line`)
    assert.equal((text.match(/!\[/gu) ?? []).length, 1)
  }
  const preview = await read('docs/preview.svg')
  assert.ok(preview.slice(0, 200).includes('<svg'))
  assert.ok(preview.includes('viewBox="0 0 640 300"'))
  for (const token of ['<text', '<script', 'href="http']) {
    assert.ok(!preview.includes(token), `preview must not contain ${token}`)
  }
})

test('F7 locale 双语齐全、标题不同、meta.detail 指向存在文件', async () => {
  const en = await readJson('locale/en.json')
  const zh = await readJson('locale/zh.json')
  for (const locale of [en, zh]) {
    assert.ok(typeof locale.meta.title === 'string' && locale.meta.title.length > 0)
    assert.ok(typeof locale.meta.description === 'string' && locale.meta.description.length > 0)
    assert.ok(typeof locale.meta.detail === 'string' && locale.meta.detail.length > 0)
    assert.ok(await exists(locale.meta.detail), `meta.detail ${locale.meta.detail} must exist`)
  }
  assert.notEqual(en.meta.title, zh.meta.title)
})

/* ------------------------------------------------------------------ */
/* F8 §8 风格红线：在真实 execute 输出上断言                           */
/* ------------------------------------------------------------------ */

async function realOutputs() {
  const byName = Object.fromEntries(buildToolDefinitions().map(definition => [definition.name, definition]))
  const run = (name, args) => byName[name].execute(args, {})
  return {
    glossNaiwa: await run('naiwa_gloss', { subject: '周一早上的闹钟' }),
    glossRestrained: await run('naiwa_gloss', { subject: '解释一下递归', tone: 'restrained' }),
    artSticker: await run('naiwa_art', { subject: '一颗放在玻璃杯里的鸡蛋' }),
    artPoster: await run('naiwa_art', { subject: '一杯凉掉的咖啡', format: 'poster' }),
    artIcon: await run('naiwa_art', { subject: '周一早上的闹钟', format: 'icon' }),
    speakTech: await run('naiwa_speak', {
      text: '先看这段代码：\n' + CODE_BLOCK + '\n递归函数需要有终止条件，否则调用栈会溢出。示例：'
        + INLINE_CODE + '，详见 ' + SAMPLE_URL + '。',
    }),
    speakNaiwa: await run('naiwa_speak', { text: '周一早上的闹钟响了，我把它按掉，然后继续睡，结果迟到了。' }),
  }
}

test('F8 风格红线 R1–R7 全部通过', async () => {
  const outputs = await realOutputs()
  const allStrings = Object.values(outputs).flatMap(value => collectStrings(value))
  const persona = buildPersonaText(normalizeConfig({}))

  // R1 不用 emoji 代替语言
  for (const text of [...allStrings, persona]) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), `R1 emoji in: ${text.slice(0, 40)}`)
  }

  // R2 不写成卖萌吉祥物（规格强制人格正文含否定指令「不撒娇」，先剥掉允许的否定说法）
  const sellingCute = /宝宝|撒娇|爱你|小奶蛙|可爱吉祥物|萌物/u
  for (const text of allStrings) assert.ok(!sellingCute.test(text), `R2 in: ${text.slice(0, 40)}`)
  assert.ok(!sellingCute.test(persona.replace(/不撒娇|不卖萌|不是吉祥物/gu, '')))
  assert.ok(persona.includes('不是吉祥物'))
  assert.ok(persona.includes('看破红尘'))

  // R3 过期热词
  const hot = /yyds|绝绝子|栓q|666|破防了|awsl|芭比q|小镇做题家/iu
  for (const text of [...allStrings, persona]) assert.ok(!hot.test(text), `R3 in: ${text.slice(0, 40)}`)

  // R4 不羞辱真实个体
  const insult = /傻逼|脑残|弱智|废物|垃圾人|丑逼/u
  for (const text of allStrings) {
    assert.ok(!insult.test(text), `R4 in: ${text.slice(0, 40)}`)
    assert.ok(!/@[A-Za-z0-9_]{2,}/u.test(text))
  }

  // R5 技术内容不被风格吃掉
  assert.ok((outputs.glossRestrained.beats.map(beat => beat.text).join('') + outputs.glossRestrained.maxim)
    .replace(/[^哟齁哈哒噜嘶]/gu, '').length <= 1)
  assert.ok(outputs.glossRestrained.notes.length > 0)
  assert.equal(outputs.speakTech.mode, 'restrained')
  assert.deepEqual(outputs.speakTech.protected, countProtected(
    '先看这段代码：\n' + CODE_BLOCK + '\n递归函数需要有终止条件，否则调用栈会溢出。示例：'
      + INLINE_CODE + '，详见 ' + SAMPLE_URL + '。',
  ))
  for (const marker of ['函数', '递归', '安全', '医疗', '法律', 'api', 'json', 'sql']) {
    assert.ok(TECH_MARKERS.includes(marker))
  }

  // R6 不追求精致/高级（禁词只允许出现在 Avoid 段）
  for (const key of ['artSticker', 'artPoster', 'artIcon']) {
    const promptEn = outputs[key].prompt_en
    assert.ok(!/photorealistic|8k|cinematic|studio lighting/iu.test(promptEn), `R6 ${key}`)
    const [head, avoidPart = ''] = promptEn.split('Avoid:')
    assert.ok(!/depth of field|premium/iu.test(head), `R6 head ${key}`)
    assert.ok(/depth of field/iu.test(avoidPart))
    assert.ok(/premium/iu.test(avoidPart))
    for (const term of ['精致', '对称', '景深', '高级感']) assert.ok(outputs[key].avoid.includes(term))
  }

  // R7 不复制真实版权形象
  for (const key of ['artSticker', 'artPoster', 'artIcon']) {
    assert.ok(!/奶龙|nailong/iu.test(outputs[key].prompt_zh))
    assert.ok(!/奶龙|nailong/iu.test(outputs[key].prompt_en))
  }
  assert.ok((persona.match(/奶龙/gu) ?? []).length <= 2)

  // 版本标识必须出现在每个工具的 canonical value 里（探针要能复述）
  for (const value of Object.values(outputs)) assert.equal(value.version, VERSION)
  for (const word of DICTIONARY_WORDS.slice(0, 3)) assert.ok(persona.includes(word + '｜'))
})
