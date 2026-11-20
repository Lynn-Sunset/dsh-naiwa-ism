/**
 * GUI 控制条契约测试（G1–G8）：fake window.__ModuleLoader__ 上的注册形状、
 * client→host 命令通道的四种失败归一化、包清单与静态红线、中英字典一致性。
 *
 * 只依赖 node:test / node:assert/strict / node:fs / node:path / node:url，不 spawn 子进程。
 * 运行：node --test --test-isolation=none tests\gui.test.mjs …
 *
 * 不渲染组件：Node 里没有 React hook dispatcher；渲染属不可验证项（B1 只验证注册与 send）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'plugin')
const read = file => readFileSync(join(PLUGIN, file), 'utf8')

/* ------------------------------------------------------------------ */
/* fake window.__ModuleLoader__（必须先于 import client.js）            */
/* ------------------------------------------------------------------ */

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      registrations.push(spec)
    },
  },
}

await import('../plugin/client.js')

const spec = registrations[0]

/** 只实现 factory 实际用到的 React 面（createElement / useState）。 */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props === null ? {} : props, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
}

/** 取一个独立插件实例：每次 factory 调用都产出新的闭包，测试之间不共享状态。 */
function makePlugin() {
  return spec.factory(name => {
    assert.equal(name, 'react', 'factory must only require react')
    return fakeReact
  })
}

function fakeClientCtx() {
  const slots = {
    injected: [],
    registrations: [],
    setup: undefined,
    inject(name, setup) {
      this.injected.push(name)
      this.setup = setup
      return () => {}
    },
    declare() {
      return this.setup()
    },
    register(options, component) {
      this.registrations.push({ options, component })
      return () => {}
    },
  }
  const locale = {
    registered: [],
    register(ns, dicts) {
      this.registered.push({ ns, dicts })
      return () => {}
    },
  }
  const executed = []
  let next = { ok: true, value: { commandId: 'c1', result: { kind: 'success', text: 'ok' } } }
  let failure
  const remote = {
    commands: {
      async execute(sessionId, line, attachments) {
        executed.push({ sessionId, line, attachments })
        if (failure !== undefined) throw failure
        return next
      },
    },
  }
  const ctx = {
    effect(factory) {
      return factory() ?? (() => {})
    },
    slots,
    locale,
    remote,
  }
  return {
    ctx,
    slots,
    locale,
    executed,
    setResult: value => { next = value },
    failWith: error => { failure = error },
  }
}

/** 装配好并取到 dock 的 inject 面（send 函数）。 */
function mounted() {
  const plugin = makePlugin()
  const harness = fakeClientCtx()
  plugin.apply(harness.ctx)
  harness.slots.declare()
  const entry = harness.slots.registrations[0]
  return { plugin, harness, entry }
}

/* ------------------------------------------------------------------ */
/* G1–G8                                                               */
/* ------------------------------------------------------------------ */

test('G1 client.js 可被 fake loader 加载，factory 返回 { inject, apply }', () => {
  assert.equal(registrations.length, 1, 'client.js must register exactly one factory')
  assert.equal(spec.id, '@local/dsh-naiwa-ism')
  assert.equal(typeof spec.factory, 'function')
  const plugin = makePlugin()
  assert.ok(Array.isArray(plugin.inject))
  assert.deepEqual(plugin.inject, ['slots', 'remote', 'remote.commands', 'locale', 'sessions'])
  assert.equal(typeof plugin.apply, 'function')
})

test('G2 apply 注册 conversation.input.dock：name/id/order/locale/inject 齐全', () => {
  const plugin = makePlugin()
  const harness = fakeClientCtx()
  plugin.apply(harness.ctx)
  assert.deepEqual(harness.slots.injected, ['conversation.input.dock'])
  assert.equal(harness.slots.registrations.length, 0, 'list slot entry must wait for declare()')
  harness.slots.declare()
  assert.equal(harness.slots.registrations.length, 1)
  const { options, component } = harness.slots.registrations[0]
  assert.equal(options.name, 'conversation.input.dock')
  assert.equal(options.id, 'naiwa-control')
  assert.equal(options.order, 30)
  assert.equal(options.locale, 'naiwa-ism')
  assert.equal(typeof options.inject, 'function')
  assert.deepEqual(Object.keys(options).sort(), ['id', 'inject', 'locale', 'name', 'order'])
  assert.equal(typeof component, 'function')
  assert.equal(harness.locale.registered.length, 1, 'locale dictionary registered once by apply')
})

test('G3 inject(sessionId) 的 send 以该 sessionId 调 execute（attachments=[]）', async () => {
  const { entry, harness } = mounted()
  const props = entry.options.inject('s-1')
  assert.equal(props.sessionId, 's-1')
  assert.equal(typeof props.send, 'function')
  const outcome = await props.send('/naiwa strength off')
  assert.deepEqual(harness.executed, [{ sessionId: 's-1', line: '/naiwa strength off', attachments: [] }])
  assert.deepEqual(outcome, { ok: true, text: 'ok' })
  const second = entry.options.inject('s-2')
  await second.send('/naiwa status')
  assert.equal(harness.executed[1].sessionId, 's-2')
  assert.equal(harness.executed[1].line, '/naiwa status')
})

test('G4 send 失败四态归一化（host 错误 / value undefined / kind:error / 抛错）', async () => {
  const { entry, harness } = mounted()
  const props = entry.options.inject('s-1')

  harness.setResult({ ok: false, error: { code: 'x', message: 'boom' } })
  assert.deepEqual(await props.send('/naiwa status'), { ok: false, text: 'boom (x)' })

  harness.setResult({ ok: true, value: undefined })
  const unknown = await props.send('/naiwa status')
  assert.equal(unknown.ok, false)
  assert.ok(unknown.text.includes('unknown or malformed command'), unknown.text)
  assert.ok(unknown.text.includes('/naiwa status'))

  harness.setResult({ ok: true, value: { commandId: 'c2', result: { kind: 'error', text: '参数不合法：档位只能是 …' } } })
  assert.deepEqual(await props.send('/naiwa strength turbo'), { ok: false, text: '参数不合法：档位只能是 …' })

  harness.setResult({ ok: true, value: { commandId: 'c3', result: { kind: 'success' } } })
  assert.deepEqual(await props.send('/naiwa status'), { ok: true, text: 'ok' })

  harness.failWith(new Error('offline'))
  const thrown = await props.send('/naiwa status')
  assert.equal(thrown.ok, false)
  assert.ok(thrown.text.includes('command channel unavailable'), thrown.text)
  assert.ok(thrown.text.includes('offline'))
})

test('G5 注册与取 props 期间不发命令（无轮询、无挂载即发）', async () => {
  const { entry, harness } = mounted()
  assert.equal(harness.executed.length, 0, 'mount/registration must not send a command')
  const props = entry.options.inject('s-3')
  assert.equal(typeof props.send, 'function')
  assert.equal(harness.executed.length, 0, 'inject must not send a command')
  // 只等一个微任务窗口，确认没有延迟到「挂载后立刻」的自动请求。
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.executed.length, 0)
})

test('G6 package.json 的 dsh.client/exports/files 与磁盘一致', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation'])
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(existsSync(join(PLUGIN, 'client.js')), 'client.js must exist on disk')
  assert.ok(existsSync(join(PLUGIN, pkg.exports['./client'])))
  assert.ok(pkg.files.includes('client.js'), 'files must include client.js')
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'engines']) {
    assert.equal(pkg[field], undefined, `package.json must not declare ${field}`)
  }

  /* 每条 files 声明都必须展开到磁盘上真实存在的文件。 */
  const covered = new Set()
  for (const entry of pkg.files) {
    let expanded
    if (entry === 'docs') {
      expanded = readdirSync(join(PLUGIN, 'docs')).map(name => 'docs/' + name)
    } else if (entry.includes('*')) {
      const slash = entry.indexOf('/')
      const dir = entry.slice(0, slash)
      const suffix = entry.slice(slash + 1).replace('*', '')
      expanded = readdirSync(join(PLUGIN, dir)).filter(name => name.endsWith(suffix)).map(name => dir + '/' + name)
    } else {
      expanded = existsSync(join(PLUGIN, entry)) ? [entry] : []
    }
    assert.ok(expanded.length > 0, `files entry "${entry}" matches nothing on disk`)
    for (const file of expanded) {
      assert.ok(statSync(join(PLUGIN, file)).isFile(), `files entry "${entry}" expands to missing file ${file}`)
      covered.add(file)
    }
  }
  for (const file of ['index.js', 'client.js', 'lib/control.js', 'lib/state.js', 'cordis.patch.yml']) {
    assert.ok(covered.has(file), `runtime file ${file} is not covered by files`)
  }
})

test('G7 client.js 静态红线：classic script / 无 JSX / 无网络 / 无定时器（C10 授权的 head 样式注入除外）', () => {
  const source = read('client.js')
  const banned = [
    /^\s*(import|export)\s/mu,
    /<[A-Z]/u,
    /fetch\(/u,
    /setInterval/u,
    /setTimeout/u,
    /addEventListener/u,
    /window\.open/u,
  ]
  for (const pattern of banned) {
    assert.ok(!pattern.test(source), `client.js must not match ${String(pattern)}`)
  }
  assert.ok(source.includes('React.createElement'), 'client.js must build elements with React.createElement, not JSX')
  /* C10：用户明确授权注入全局 CSS/DOM。允许的范围只有 head 里的一个 style 节点，
   * 禁止碰 document.body / querySelector / 其他宿主 DOM。 */
  assert.ok(source.includes('createElement('), 'backdrop must create its own style node')
  assert.ok(source.includes('naiwa-ism-backdrop'), 'backdrop style id must be stable')
  assert.ok(source.includes('body::after'), 'backdrop css must paint via body::after')
  for (const forbidden of ['document.body', 'querySelector', 'innerHTML']) {
    assert.ok(!source.includes(forbidden), `client.js must not use ${forbidden}`)
  }
  for (const token of [
    'window.__ModuleLoader__.load',
    "'react'",
    'conversation.input.dock',
    'naiwa-control',
    'naiwa-ism',
    'remote.commands.execute',
  ]) {
    assert.ok(source.includes(token), `client.js must contain ${token}`)
  }
})

test('G8 locale 字典 zh/en 键集一致，NS 为 naiwa-ism', () => {
  const plugin = makePlugin()
  const harness = fakeClientCtx()
  plugin.apply(harness.ctx)
  assert.equal(harness.locale.registered.length, 1)
  const { ns, dicts } = harness.locale.registered[0]
  assert.equal(ns, 'naiwa-ism')
  assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh'])
  const zhKeys = Object.keys(dicts.zh).sort()
  const enKeys = Object.keys(dicts.en).sort()
  assert.deepEqual(enKeys, zhKeys, 'zh/en dictionaries must share one key set')
  for (const locale of ['zh', 'en']) {
    for (const [key, value] of Object.entries(dicts[locale])) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`)
      assert.ok(value.length > 0, `${locale}.${key} must be non-empty`)
    }
  }
  for (const key of ['strength.off', 'strength.naiwa', 'resident.on', 'resident.off', 'language.auto', 'language.zh', 'language.en', 'sync']) {
    assert.ok(zhKeys.includes(key), `dictionary missing ${key}`)
  }
})
