/**
 * 奶蛙叠层皮肤与壁纸契约测试（T1–T9）：theme.overrideTokens 叠层、WCAG 对比度、
 * 两态开关与刷新重放、双模配对、四类降级、字典/模型、两张壁纸的静态构成。
 *
 * 只依赖 node:test / node:assert/strict / node:fs / node:path / node:url，不 spawn 子进程。
 * 运行：node --test --test-isolation=none tests\control.test.mjs tests\files.test.mjs
 *        tests\gui.test.mjs tests\stub.test.mjs tests\theme.test.mjs
 *
 * 独立注册：`../plugin/client.js?theme-contract` 的 ESM 缓存键含 query，与 gui.test.mjs
 * 的无 query 注册互不覆盖（同进程两份模块实例，各自读自己的 fake loader）。
 *
 * 与 design/theme-spec.md §2.3/§3 的两处已知偏差（manager 裁决优先，见
 * evidence/theme-test-report.txt §4）：
 *   1) 存储缺失按 'on'（默认开启），不是 spec 旧措辞的 'off'；
 *      依据：合同 C3′（contract revision 6，2026-11-20T13:47:30Z）与 m-9 的 manager 裁决。
 *   2) 因此 T3/T4 的「缺失」分支期望 1 次安装，不是 0 次。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'plugin')
const read = file => readFileSync(join(PLUGIN, file), 'utf8')

/* ------------------------------------------------------------------ */
/* fake window.__ModuleLoader__（必须先于 import client.js?theme-contract） */
/* ------------------------------------------------------------------ */

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      registrations.push(spec)
    },
  },
}

/** 可注入的 localStorage：记录读写次数，可按用例抛错。 */
function makeStorage(initial, behavior) {
  const map = new Map(Object.entries(initial === undefined ? {} : initial))
  const calls = { get: 0, set: 0, readKeys: [] }
  const options = behavior === undefined ? {} : behavior
  return {
    map,
    calls,
    getItem(key) {
      calls.readKeys.push(key)
      calls.get += 1
      if (options.throwGet === true) throw new Error('storage get denied')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      calls.set += 1
      if (options.throwSet === true) throw new Error('storage set denied')
      map.set(key, String(value))
    },
  }
}

globalThis.localStorage = makeStorage()

await import('../plugin/client.js?theme-contract')

const spec = registrations[0]

/** 只实现 factory/组件实际用到的 React 面（本文件不渲染组件）。 */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props === null ? {} : props, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

/** 每个插件实例一份新闭包：模拟一次页面加载。 */
function makePlugin() {
  return spec.factory(name => {
    assert.equal(name, 'react', 'factory must only require react')
    return fakeReact
  })
}

/* ------------------------------------------------------------------ */
/* fake client ctx：theme 服务 + effect + locale + slots               */
/* ------------------------------------------------------------------ */

function makeTheme(behavior) {
  const options = behavior === undefined ? {} : behavior
  const stats = { overrides: [], disposers: 0, register: 0, setTheme: 0 }
  const theme = {
    overrideTokens(source, pairs) {
      stats.overrides.push({ source, pairs })
      if (options.throwOverride === true) throw new Error('overrideTokens refused')
      return function disposer() {
        stats.disposers += 1
      }
    },
    register() {
      stats.register += 1
      return () => {}
    },
    setTheme() {
      stats.setTheme += 1
    },
  }
  return { theme, stats }
}

function makeHarness(behavior) {
  const options = behavior === undefined ? {} : behavior
  const { theme, stats } = makeTheme(options)
  const effects = []
  const localeRegistrations = []
  const slots = {
    injected: [],
    setup: undefined,
    inject(name, setup) {
      slots.injected.push(name)
      slots.setup = setup
      return () => {}
    },
    register() {
      return () => {}
    },
  }
  const ctx = {
    effect(factory, label) {
      const dispose = factory()
      const entry = { label, dispose: typeof dispose === 'function' ? dispose : () => {} }
      effects.push(entry)
      return entry.dispose
    },
    locale: {
      register(ns, dicts) {
        localeRegistrations.push({ ns, dicts })
        return () => {}
      },
    },
    slots,
    remote: {
      commands: {
        async execute() {
          return { ok: true, value: { result: { kind: 'success', text: 'ok' } } }
        },
      },
    },
    get(name) {
      if (options.noGet === true) return undefined
      if (options.getReturnsUndefined === true) return undefined
      return name === 'theme' ? theme : undefined
    },
    inject(names, callback) {
      if (options.noInject === true) return () => {}
      stats.injectedWith = names
      if (options.injectNeverFires === true) return () => {}
      callback({ theme })
      return () => {}
    },
  }
  return { ctx, theme, stats, effects, localeRegistrations, slots }
}

/** 一次页面加载：apply 后返回实例与可观测的 fake 服务。 */
function pageLoad(behavior) {
  const options = behavior === undefined ? {} : behavior
  const storage = options.storage === undefined ? makeStorage() : options.storage
  globalThis.localStorage = storage
  const harness = makeHarness(options)
  const plugin = makePlugin()
  plugin.apply(harness.ctx)
  return { harness, plugin, storage }
}

/* ------------------------------------------------------------------ */
/* spec §1 的 14 对 token（逐字）与 WCAG 工具                          */
/* ------------------------------------------------------------------ */

const EXPECTED_PAIRS = {
  '--dsw-alias-bg-base': { light: '#FBF3DC', dark: '#14140F' },
  '--dsw-alias-bg-layer-1': { light: '#FFFCF0', dark: '#1B1B14' },
  '--dsw-alias-bg-layer-2': { light: '#F5EBCB', dark: '#24241A' },
  '--dsw-alias-bg-overlay': { light: '#FFF7E6', dark: '#1F1F16' },
  '--dsw-alias-border-l1': { light: '#E8DCB8', dark: '#35352A' },
  '--dsw-alias-border-l2': { light: '#D9C99C', dark: '#45452F' },
  '--dsw-alias-brand-primary': { light: '#8A6A00', dark: '#F5C518' },
  '--dsw-alias-label-primary': { light: '#1A1A1A', dark: '#F4EDD6' },
  '--dsw-alias-label-secondary': { light: '#5C5443', dark: '#B9B098' },
  '--dsw-alias-state-error-primary': { light: '#B33225', dark: '#FF7A6B' },
  '--dsw-alias-state-idle-primary': { light: '#6F6751', dark: '#9C9782' },
  '--dsw-alias-state-success-primary': { light: '#35704A', dark: '#7DD68F' },
  '--dsw-alias-state-warn-primary': { light: '#8A5F00', dark: '#E8B84B' },
  '--dsw-specific-sidebar-fill': { light: '#F2E7C4', dark: '#11110C' },
}

const HEX = /^#[0-9A-F]{6}$/i
const round2 = value => Math.round(value * 100) / 100

/** WCAG 2.x 相对亮度 / 对比度（测试内独立重算，不信任实现里的常数）。 */
function channel(value) {
  const channelValue = value / 255
  return channelValue <= 0.03928 ? channelValue / 12.92 : Math.pow((channelValue + 0.055) / 1.055, 2.4)
}

function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a, b) {
  const first = luminance(a)
  const second = luminance(b)
  const high = Math.max(first, second)
  const low = Math.min(first, second)
  return (high + 0.05) / (low + 0.05)
}

/* ------------------------------------------------------------------ */
/* T1–T7                                                              */
/* ------------------------------------------------------------------ */

test('T1 叠层契约（C1′）：恰一次 overrideTokens，14 个 --dsw-* 双 hex，register/setTheme 为 0', () => {
  assert.equal(registrations.length, 1, 'client.js?theme-contract must register exactly one factory')
  const storage = makeStorage({ 'naiwa-ism:skin': 'on' })
  const { harness, plugin } = pageLoad({ storage })

  assert.equal(harness.stats.overrides.length, 1, 'exactly one overrideTokens call on load with skin=on')
  const call = harness.stats.overrides[0]
  assert.equal(typeof call.source, 'string')
  assert.equal(call.source, 'naiwa-ism')
  assert.deepEqual(Object.keys(call.pairs).sort(), Object.keys(EXPECTED_PAIRS).sort(), 'token key set must be the 14 spec keys')
  assert.equal(Object.keys(call.pairs).length, 14)
  for (const [name, pair] of Object.entries(call.pairs)) {
    assert.match(name, /^--dsw-/u, `token ${name} must start with --dsw-`)
    assert.deepEqual(Object.keys(pair).sort(), ['dark', 'light'], `token ${name} must have exactly {light,dark}`)
    assert.match(pair.light, HEX, `token ${name}.light must be #RRGGBB`)
    assert.match(pair.dark, HEX, `token ${name}.dark must be #RRGGBB`)
  }
  assert.equal(harness.stats.register, 0, 'theme.register must never be called')
  assert.equal(harness.stats.setTheme, 0, 'theme.setTheme must never be called')
  assert.equal(typeof plugin.themeModel.skin.layer, 'function', 'layer disposer must be retained')
  assert.ok(harness.effects.some(effect => effect.label === 'naiwa-ism:skin-layer'), 'skin layer must live in a ctx.effect')
})

test('T2 对比度（C2）：浅 15.71/6.76/4.58，深 15.77/8.56/11.33，自检黑白=21', () => {
  assert.equal(round2(contrast('#000000', '#FFFFFF')), 21, 'WCAG self-check black/white must be 21')
  assert.equal(round2(contrast('#FBF3DC', '#FBF3DC')), 1, 'WCAG self-check same color must be 1')

  const pairs = makePlugin().themeModel.PAIRS
  const lightBase = pairs['--dsw-alias-bg-base'].light
  const darkBase = pairs['--dsw-alias-bg-base'].dark
  const lightLayer2 = pairs['--dsw-alias-bg-layer-2'].light
  const darkLayer2 = pairs['--dsw-alias-bg-layer-2'].dark

  assert.equal(round2(contrast(pairs['--dsw-alias-label-primary'].light, lightBase)), 15.71)
  assert.equal(round2(contrast(pairs['--dsw-alias-label-secondary'].light, lightBase)), 6.76)
  assert.equal(round2(contrast(pairs['--dsw-alias-brand-primary'].light, lightBase)), 4.58)
  assert.equal(round2(contrast(pairs['--dsw-alias-label-primary'].dark, darkBase)), 15.77)
  assert.equal(round2(contrast(pairs['--dsw-alias-label-secondary'].dark, darkBase)), 8.56)
  assert.equal(round2(contrast(pairs['--dsw-alias-brand-primary'].dark, darkBase)), 11.33)

  const modes = {
    light: { base: lightBase, layer2: lightLayer2 },
    dark: { base: darkBase, layer2: darkLayer2 },
  }
  for (const [mode, backgrounds] of Object.entries(modes)) {
    const current = Object.fromEntries(Object.entries(pairs).map(([name, pair]) => [name, pair[mode]]))
    assert.ok(contrast(current['--dsw-alias-label-primary'], backgrounds.base) >= 7, `${mode} label-primary >= 7`)
    assert.ok(contrast(current['--dsw-alias-label-secondary'], backgrounds.base) >= 4.5, `${mode} label-secondary >= 4.5`)
    assert.ok(contrast(current['--dsw-alias-brand-primary'], backgrounds.base) >= 3, `${mode} brand-primary >= 3`)
    const readable = [
      '--dsw-alias-label-secondary',
      '--dsw-alias-state-error-primary',
      '--dsw-alias-state-idle-primary',
      '--dsw-alias-state-success-primary',
      '--dsw-alias-state-warn-primary',
    ]
    for (const name of readable) {
      for (const surface of ['base', 'layer2']) {
        assert.ok(contrast(current[name], backgrounds[surface]) >= 4.5,
          `${mode} ${name} on ${surface} must be >= 4.5 (got ${round2(contrast(current[name], backgrounds[surface]))})`)
      }
    }
  }
})

test('T3 两态开关与持久化（C3′）：默认开启，关→disposer+off，再开→第二次安装', () => {
  /* 存储缺失：manager 裁决 C3′ 按 'on' 处理（默认开启）。 */
  const storage = makeStorage()
  const { harness, plugin } = pageLoad({ storage })
  assert.equal(harness.stats.overrides.length, 1, 'missing storage must default to on (C3′ adjudication)')
  assert.equal(plugin.themeModel.skin.on, true)
  assert.equal(plugin.themeModel.bridge.on, true)
  assert.equal(storage.map.has('naiwa-ism:skin'), false, 'load must not invent a stored preference')

  /* chip 点击 → bridge.toggle()：off=disposer + 'off'，再 on=第二次安装 + 'on'。 */
  plugin.themeModel.bridge.toggle()
  assert.equal(harness.stats.disposers, 1, 'off must call the layer disposer')
  assert.equal(storage.map.get('naiwa-ism:skin'), 'off')
  assert.equal(plugin.themeModel.bridge.on, false)

  plugin.themeModel.bridge.toggle()
  assert.equal(harness.stats.overrides.length, 2, 'second on must install the layer again')
  assert.equal(storage.map.get('naiwa-ism:skin'), 'on')
  assert.equal(plugin.themeModel.bridge.on, true)

  /* 直接状态机（themeModel.setSkin 是 chip 的唯一实现）：1 次安装 + 'on' + skin.on 真。 */
  const direct = makeTheme()
  const state = { bound: true, on: false, layer: null, theme: direct.theme }
  const directStorage = makeStorage()
  const model = makePlugin().themeModel
  assert.equal(model.setSkin(state, direct.theme, true, directStorage), true)
  assert.equal(direct.stats.overrides.length, 1)
  assert.equal(directStorage.map.get('naiwa-ism:skin'), 'on')
  assert.equal(state.on, true)
  assert.equal(model.setSkin(state, direct.theme, false, directStorage), false)
  assert.equal(direct.stats.disposers, 1)
  assert.equal(directStorage.map.get('naiwa-ism:skin'), 'off')
  assert.equal(state.on, false)
})

test('T4 刷新重放（C3′ 核心）：两次加载 on 各装 1 次、off 两次 0 次、缺失按 on 各 1 次', () => {
  const cases = [
    { label: 'stored on', initial: { 'naiwa-ism:skin': 'on' }, expected: 1 },
    { label: 'stored off', initial: { 'naiwa-ism:skin': 'off' }, expected: 0 },
    { label: 'missing (default on)', initial: {}, expected: 1 },
  ]
  for (const testCase of cases) {
    const storage = makeStorage(testCase.initial)
    const first = pageLoad({ storage })
    const second = pageLoad({ storage })
    assert.equal(first.harness.stats.overrides.length, testCase.expected, `${testCase.label}: first load override count`)
    assert.equal(second.harness.stats.overrides.length, testCase.expected, `${testCase.label}: second load override count`)
    assert.equal(first.plugin.themeModel.skin.on, testCase.expected === 1, `${testCase.label}: first load skin.on`)
    assert.equal(second.plugin.themeModel.skin.on, testCase.expected === 1, `${testCase.label}: second load skin.on`)
    for (const load of [first, second]) {
      for (const call of load.harness.stats.overrides) {
        assert.equal(call.source, 'naiwa-ism')
        assert.equal(Object.keys(call.pairs).length, 14)
      }
    }
  }
})

test('T5 双模配对逐字：14 对 light/dark 与 spec §1 相同，14/14 light≠dark', () => {
  const pairs = makePlugin().themeModel.PAIRS
  assert.equal(Object.keys(pairs).length, 14)
  assert.deepEqual(Object.keys(pairs).sort(), Object.keys(EXPECTED_PAIRS).sort())
  let differing = 0
  for (const [name, expected] of Object.entries(EXPECTED_PAIRS)) {
    assert.deepEqual(pairs[name], expected, `token ${name} must match spec §1 verbatim`)
    if (expected.light !== expected.dark) differing += 1
  }
  assert.equal(differing, 14, 'every pair must differ between light and dark')
})

test('T6 四类降级不抛（C3′/C6）：无 get/inject、无 theme、overrideTokens 抛错、setItem 抛错', () => {
  /* (a) 旧 fake ctx：既无 ctx.get 也无 ctx.inject。 */
  {
    const storage = makeStorage({ 'naiwa-ism:skin': 'on' })
    globalThis.localStorage = storage
    const effects = []
    const bare = {
      effect(factory) {
        const dispose = factory()
        effects.push(typeof dispose === 'function' ? dispose : () => {})
        return effects[effects.length - 1]
      },
      locale: { register: () => () => {} },
      slots: { inject: () => () => {} },
      remote: { commands: { async execute() { return { ok: true, value: { result: { kind: 'success' } } } } } },
    }
    const plugin = makePlugin()
    assert.doesNotThrow(() => plugin.apply(bare))
    assert.deepEqual(storage.calls.readKeys, ['naiwa-ism:pet'], 'only the independent pet setting is read')
    assert.equal(storage.calls.set, 0, 'no theme attach => no storage write')
    assert.equal(plugin.themeModel.bridge.available, false, 'chip must stay hidden without theme service')
    assert.equal(plugin.themeModel.skin.on, false)
  }

  /* (b) theme 服务缺席：inject 回调永不触发。 */
  {
    const storage = makeStorage({ 'naiwa-ism:skin': 'on' })
    const load = pageLoad({ storage, getReturnsUndefined: true, injectNeverFires: true })
    assert.equal(load.harness.stats.overrides.length, 0)
    assert.equal(load.plugin.themeModel.bridge.available, false)
    assert.equal(load.plugin.themeModel.skin.on, false)
  }

  /* (c) overrideTokens 抛错：apply 不抛、skin.on 假、不写 'on'。 */
  {
    const storage = makeStorage()
    const load = pageLoad({ storage, throwOverride: true })
    assert.equal(load.harness.stats.overrides.length, 1)
    assert.equal(load.plugin.themeModel.skin.on, false)
    assert.equal(load.plugin.themeModel.bridge.on, false)
    assert.equal(storage.calls.set, 0, 'failed install must not persist on')
    assert.equal(storage.map.has('naiwa-ism:skin'), false)
  }

  /* (d) setItem 抛错：切换仍在内存生效、不抛。 */
  {
    const direct = makeTheme()
    const state = { bound: true, on: false, layer: null, theme: direct.theme }
    const storage = makeStorage({}, { throwSet: true })
    const model = makePlugin().themeModel
    assert.doesNotThrow(() => model.setSkin(state, direct.theme, true, storage))
    assert.equal(state.on, true, 'in-memory toggle must still succeed when storage throws')
    assert.equal(direct.stats.overrides.length, 1)
    assert.equal(state.layer !== null, true)
  }
})

test('T7 文案与两态模型（C3′）：zh/en 含 skin 四键且键集一致，themeModel 三态判定', () => {
  const load = pageLoad({ storage: makeStorage({ 'naiwa-ism:skin': 'on' }) })
  assert.equal(load.harness.localeRegistrations.length, 1)
  const { ns, dicts } = load.harness.localeRegistrations[0]
  assert.equal(ns, 'naiwa-ism')
  assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts.zh).sort(), 'zh/en dictionaries must share one key set')
  for (const locale of ['zh', 'en']) {
    for (const key of ['skin.group', 'skin.on', 'skin.off', 'title.skin', 'label.sound', 'sound.on', 'sound.off', 'title.sound']) {
      assert.ok(Object.hasOwn(dicts[locale], key), `${locale} dictionary missing ${key}`)
      assert.equal(typeof dicts[locale][key], 'string')
      assert.ok(dicts[locale][key].length > 0, `${locale}.${key} must be non-empty`)
    }
  }
  assert.ok(dicts.zh['title.skin'].includes('皮肤'), 'zh title.skin must explain the skin semantics')

  const model = load.plugin.themeModel
  assert.equal(model.SKIN_KEY, 'naiwa-ism:skin')
  assert.equal(model.SOURCE, 'naiwa-ism')
  assert.equal(model.readStored(makeStorage({ 'naiwa-ism:skin': 'on' })), 'on')
  assert.equal(model.readStored(makeStorage({ 'naiwa-ism:skin': 'off' })), 'off')
  assert.equal(model.readStored(makeStorage()), 'on', 'missing storage must read as on (C3′ adjudication)')
  assert.equal(model.readStored(makeStorage({ 'naiwa-ism:skin': 'garbage' })), 'on')
  assert.equal(model.readStored(makeStorage({}, { throwGet: true })), 'on', 'throwing storage must degrade to default on')

  /* C10（用户 2026-11-20 授权全局 CSS/DOM）：断言注入内容与可卸载形状，不渲染。 */
  assert.equal(model.backdrop.id, 'naiwa-ism-backdrop')
  const css = model.backdrop.css()
  for (const token of ['body::after', 'data:image/svg+xml;base64', 'body[data-ds-dark-theme]', 'z-index:2147483000', 'body.naiwa-laughing']) {
    assert.ok(css.includes(token), `backdrop css missing ${token}`)
  }
  assert.ok((css.match(/data:image\/svg\+xml;base64,/gu) ?? []).length >= 2, 'backdrop must carry both idle and laugh images')
  const appended = []
  const fakeDoc = {
    head: { appendChild(node) { appended.push(node); node.parentNode = { removeChild() {} } } },
    createElement() { return { textContent: '', setAttribute() {} } },
  }
  const node = model.backdrop.install(fakeDoc)
  assert.ok(node !== null && appended.length === 1, 'install must append exactly one style node')
  assert.equal(node.textContent, css)
  model.backdrop.remove()
  assert.equal(appended.length, 1, 'remove must not append again')

  /* C11（用户 2026-11-20）：每轮结束随机播放奶蛙音效。 */
  assert.equal(model.sound.key, 'naiwa-ism:sound')
  assert.ok(Array.isArray(model.sound.clips), 'sound model must expose the clip pack')
  assert.ok(model.sound.clips.length >= 4, 'sound pack must hold at least 4 clips')
  for (const clip of model.sound.clips) {
    assert.ok(
      clip.startsWith('data:audio/wav;base64,') || clip.startsWith('data:audio/mpeg;base64,'),
      'every clip must be an audio data uri',
    )
    assert.ok(clip.length > 1000, 'embedded clip must not be empty')
  }
  assert.equal(typeof model.sound.play, 'function')
  assert.equal(typeof model.sound.watch, 'function')
  assert.equal(model.sound.read(makeStorage({ 'naiwa-ism:sound': 'off' })), 'off')
  assert.equal(model.sound.read(makeStorage()), 'on')
  assert.equal(model.sound.read(makeStorage({}, { throwGet: true })), 'on', 'sound preference must degrade to on')
})

/* ------------------------------------------------------------------ */
/* T8–T9 壁纸                                                          */
/* ------------------------------------------------------------------ */

const WALLPAPERS = [
  { file: 'docs/wallpaper-light.svg', prefix: 'wall-light-', bg: '#FBF3DC' },
  { file: 'docs/wallpaper-ink.svg', prefix: 'wall-ink-', bg: '#14140F' },
]

const BANNED = ['<text', '<tspan', '<script', '<style', 'href', '<image', 'foreignObject', 'url(http', 'xlink', 'data:']

test('T8 壁纸尺寸/自包含（C4）：2560×1440、≤262144B、无 text/script/外链', () => {
  for (const wallpaper of WALLPAPERS) {
    const path = join(PLUGIN, wallpaper.file)
    const info = statSync(path)
    assert.ok(info.isFile(), `${wallpaper.file} must exist as a file`)
    assert.ok(info.size <= 262144, `${wallpaper.file} must be <= 262144 bytes, got ${info.size}`)
    const svg = read(wallpaper.file)
    assert.ok(svg.startsWith('<svg'), `${wallpaper.file} must start with <svg`)
    assert.ok(svg.trimEnd().endsWith('</svg>'), `${wallpaper.file} must end with </svg>`)
    for (const token of ['viewBox="0 0 2560 1440"', 'width="2560"', 'height="1440"']) {
      assert.ok(svg.includes(token), `${wallpaper.file} missing ${token}`)
    }
    for (const banned of BANNED) {
      assert.ok(!svg.includes(banned), `${wallpaper.file} must not contain ${banned}`)
    }
  }
})

test('T9 壁纸构成（C4 美术）：配色、path/ellipse、模糊/噪点/pattern、id 前缀', () => {
  for (const wallpaper of WALLPAPERS) {
    const svg = read(wallpaper.file)
    for (const color of [wallpaper.bg, '#F5C518', '#7DF9AA']) {
      assert.ok(svg.toUpperCase().includes(color.toUpperCase()), `${wallpaper.file} must use ${color}`)
    }
    assert.ok((svg.match(/<path/gu) ?? []).length >= 6, `${wallpaper.file} must contain >= 6 <path`)
    assert.ok((svg.match(/<ellipse/gu) ?? []).length >= 2, `${wallpaper.file} must contain >= 2 <ellipse`)
    assert.ok(svg.includes('feGaussianBlur'), `${wallpaper.file} must contain feGaussianBlur`)
    assert.ok(svg.includes('feTurbulence'), `${wallpaper.file} must contain feTurbulence`)
    assert.ok(svg.includes('<pattern'), `${wallpaper.file} must contain <pattern`)

    const ids = [...svg.matchAll(/\sid="([^"]+)"/gu)].map(match => match[1])
    assert.ok(ids.length >= 3, `${wallpaper.file} must declare filter/gradient/pattern ids`)
    for (const id of ids) {
      assert.ok(id.startsWith(wallpaper.prefix), `${wallpaper.file} id ${id} must start with ${wallpaper.prefix}`)
    }
    const refs = [...svg.matchAll(/url\(#([^)]+)\)/gu)].map(match => match[1])
    assert.ok(refs.length >= 2, `${wallpaper.file} must reference its own defs`)
    for (const ref of refs) {
      assert.ok(ref.startsWith(wallpaper.prefix), `${wallpaper.file} url(#${ref}) must point at its own prefix`)
      assert.ok(ids.includes(ref), `${wallpaper.file} url(#${ref}) must reference a declared id`)
    }
  }
  const light = read('docs/wallpaper-light.svg')
  const ink = read('docs/wallpaper-ink.svg')
  assert.notEqual(light, ink, 'the two wallpapers must be distinct compositions')
  assert.ok(light.includes('#FBF3DC') && light.includes('#1A1A1A'), 'light wallpaper is cream with ink edges')
  assert.ok(ink.includes('#14140F') && ink.includes('wall-ink-vignette'), 'ink wallpaper is dark with a vignette')
})
