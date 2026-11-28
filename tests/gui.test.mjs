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
import { createHash } from 'node:crypto'
import { createContext, runInContext } from 'node:vm'
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

test('the Web bundle registers on both initial load and same-page reload', () => {
  const loaded = []
  const context = createContext({ window: { __ModuleLoader__: { load: spec => loaded.push(spec.id) } } })
  const script = read('client.js')
  runInContext(script, context)
  runInContext(script, context)
  assert.deepEqual(loaded, ['@local/dsh-naiwa-ism', '@local/dsh-naiwa-ism'])
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

test('桌宠通过独立接口闲聊和查进度，失败也不发送会话命令', async t => {
  const { entry, harness } = mounted()
  const props = entry.options.inject('s-1')
  let offline = false
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(path, 'api/naiwa-ism/pet-chat')
    assert.equal(init.method, 'POST')
    calls.push(JSON.parse(init.body))
    if (offline) throw new Error('offline')
    return Response.json({kind:'success', text:'在呢'})
  })
  for (const mode of ['chat', 'progress']) {
    assert.deepEqual(await props.ask(mode, '你好'), {ok:true, text:'在呢'})
    assert.deepEqual(calls.at(-1), {sessionId:'s-1', mode, question:'你好'})
  }
  offline = true
  assert.equal((await props.ask('chat', '再试试')).ok, false)
  assert.deepEqual(harness.executed, [])
})

test('流式聊天可读取跨字节的数据，断流后提示重试', async t => {
  const props = mounted().entry.options.inject('s-1')
  let frames = [{type:'status',stage:'reading'},{type:'delta',text:'奶蛙'},{type:'done',kind:'success',text:'奶蛙',seq:12}]
  t.mock.method(globalThis,'fetch',async (_, init) => {
    assert.equal(init.headers.Accept,'application/x-ndjson')
    return new Response(new ReadableStream({start(controller) {
      for (const byte of Buffer.from(frames.map(JSON.stringify).join('\n') + '\n')) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    }}),{headers:{'Content-Type':'application/x-ndjson'}})
  })
  const events = []
  const ask = () => props.ask('chat','你好',undefined,e => events.push(e))
  assert.equal((await ask()).seq,12)
  assert.deepEqual(events,frames.slice(0,2))
  frames = frames.slice(0,2)
  assert.deepEqual(await ask(),{ok:false,text:'发送中断，请重试。'})
})

test('普通回复正常结束即跳，目标完成与同一回合结束只跳一次', () => {
  const completed = [], turns = []
  let seq = 0, next, update
  const source = {getSnapshot:() => ({entries:[], change:next}),subscribe(fn) { update = fn }}
  const ctx = {get:() => ({binding:() => ({eventSource:source})})}
  makePlugin().themeModel.sound.watch(ctx,'one',() => turns.push(seq),n => completed.push(n))
  const append = (type,data) => {
    next = {kind:'append',entries:[{event:{seq:++seq,type,data}}]}
    update()
  }
  append('turn/end',{reason:{kind:'completed'}})
  append('todo/write',{todos:[{status:'completed'}]})
  append('turn/end',{reason:{kind:'error'}})
  append('turn/start',{})
  append('todo/write',{todos:[{status:'completed'}]})
  append('turn/end',{reason:{kind:'completed'}})
  append('goal/change',{operation:'complete'})
  append('turn/end',{reason:{kind:'completed'}})
  append('turn/start',{})
  append('turn/end',{reason:{kind:'cancelled'}})
  append('turn/start',{})
  append('turn/end',{reason:{kind:'completed'}})
  update()
  assert.deepEqual(completed,[1,6,7,12])
  assert.deepEqual(turns,[1,6,8,12])
})

test('图片从面板真实发送入口进入宿主附件服务', async t => {
  const {petChatRoute} = await import('../plugin/lib/pet-chat.js')
  const {mkdtempSync, rmSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'pet-image-route-'))
  t.after(() => rmSync(dir, {recursive:true, force:true}))
  const image = {name:'image.png', mediaType:'image/png', data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII='}
  const block = {type:'image', attachment:{attachmentId:'screen'}}
  const store = {async admitPromptContent(parts) {
    assert.deepEqual(parts,[{type:'image', ...image}])
    return [block]
  }}
  let sawImage = false
  const host = petChatRoute({
    sessionController:{resolveAgent:async id => ({agent:{session:{id}, model:{current:()=>({provider:'deepseek',model:'vision'})}}})},
    get:key => key === 'attachments' ? store : undefined,
    llm:{async *stream(request) {
      sawImage = true
      assert.deepEqual(request.messages.at(-1).content.at(-1),block)
      yield {type:'text-delta',text:'收到图片'}
      yield {type:'finish',reason:{kind:'stop'}}
    }},
  },join(dir,'memory.sqlite'))
  const props = mounted().entry.options.inject('image-session')
  t.mock.method(globalThis,'fetch',async (path, init) => {
    const request = new Request(new URL(path,'http://localhost'),init)
    assert.equal(new URL(request.url).pathname,host.path)
    assert.equal(JSON.parse(init.body).mode,'chat')
    return host.fetch(request)
  })
  assert.deepEqual(await props.ask('chat','',image),{ok:true,text:'收到图片'})
  assert.ok(sawImage)
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
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-renderer'])
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

test('G7 classic script 只使用桌宠接口，定时器和事件监听限于框内手势', () => {
  const source = read('client.js')
  const banned = [
    /^\s*(import|export)\s/mu,
    /<[A-Z]/u,
    /fetch\((?!'api\/naiwa-ism\/pet-chat')/u,
    /setInterval/u,
    /^(?!\s*drag\.timer = setTimeout\().*\bsetTimeout\(/mu,
    /^(?!\s*box\.addEventListener\('(?:touchmove|click)').*\baddEventListener\(/mu,
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
  for (const key of ['strength.off', 'strength.naiwa', 'strength.nailoong', 'resident.on', 'resident.off', 'language.auto', 'language.zh', 'language.en', 'sync']) {
    assert.ok(zhKeys.includes(key), `dictionary missing ${key}`)
  }
})
test('桌宠可从面板切换三种动作，恢复上次选择，并在关闭和卸载时清理', async () => {
  const settings = new Map()
  const node = () => ({
    children: [],
    focus() {},
    append(...children) { children.forEach(child => this.appendChild(child)) },
    replaceChildren(...children) { this.children = []; this.append(...children) },
    attrs: new Map(),
    hasAttribute(k) { return this.attrs.has(k) },
    setAttribute(k,v) { this.attrs.set(k,v) },
    removeAttribute(k) { this.attrs.delete(k) },
    style: { setProperty() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
    addEventListener(type, fn) { this['on' + type] = fn },
    animate() { return this.clock = { cancel() {} } },
    appendChild(child) { child.parent = this; this.children.push(child) },
    get parentElement() { return this.parent },
    get firstChild() { return this.children[0] },
    get lastChild() { return this.children.at(-1) },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this) },
  })
  const doc = { head: node(), body: node(), createElement: tag => Object.assign(node(), {tag}) }
  const backgroundChanges = []
  doc.body.classList = {
    add: name => backgroundChanges.push(name),
    remove: name => backgroundChanges.push(name),
  }
  const played = []
  let bundle, component, dispose, celebrate, nextReply
  const questions = []
  let longPress
  const react = {
    ...fakeReact,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useEffect(fn) { fn() },
    useState: initial => [initial === false ? true : typeof initial === 'function' ? initial() : initial, () => {}],
  }
  const context = createContext({
    document: doc, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: () => ({transform:'matrix(-1, 0, 0, 1, 0, 0)'}),
    setTimeout(fn) { longPress = fn; return 1 },
    clearTimeout() { longPress = undefined },
    FileReader: class {
      readAsDataURL(file) { this.result = 'data:' + file.type + ';base64,aQ=='; this.onload() }
    },
    Audio: class {
      constructor(src) { this.src = src }
      play() { played.push(this.src); return Promise.resolve() }
      pause() {}
    },
    localStorage: { getItem: key => settings.get(key), setItem: (key, value) => settings.set(key, value) },
    window: { __ModuleLoader__: { load: spec => { bundle = spec } } },
  })
  runInContext(read('client.js'), context)
  function install() {
    const harness = fakeClientCtx()
    harness.ctx.effect = (fn, name) => { const undo = fn(); if (name === 'naiwa-ism:pet') dispose = undo }
    bundle.factory(() => react).apply(harness.ctx)
    harness.slots.declare()
    component = harness.slots.registrations[0].component
  }
  function select(mode) {
    const rendered = component({ t: key => key, sessionId: 'demo', watchEnd: (_, done) => { celebrate = done }, ask: async (mode, question, image) => {
      questions.push(image ? {mode, question, image} : {mode, question})
      if (nextReply) return nextReply
      return {ok: true, text: '**已完成**\n- 修复 `finalize`\n- 发布 **1.0.4**'}
    } })
    const row = rendered.children[1].children.find(child => child?.props.key === 'pet')
    row.children.find(child => child.props.key === mode).props.onClick()
  }
  install()
  assert.equal(doc.body.children.length, 0)
  const animations = new Set()
  for (const mode of ['cycle', 'ballet', 'laugh', 'hop']) {
    select(mode)
    assert.equal(doc.body.children.length, 1)
    assert.equal(doc.head.children.length, 1)
    const picture = doc.body.firstChild.firstChild
    const bytes = Buffer.from(picture.firstChild.srcset.split(',')[1], 'base64')
    assert.ok(bytes.includes(Buffer.from('ANMF')))
    assert.equal(picture.firstChild.media, '(prefers-reduced-motion: no-preference)')
    assert.ok(!Buffer.from(picture.lastChild.src.split(',')[1], 'base64').includes(Buffer.from('ANMF')))
    animations.add(picture.firstChild.srcset)
    assert.equal(settings.get('naiwa-ism:pet'), mode)
  }
  assert.equal(animations.size, 4)
  select('cycle')
  const rider = doc.body.firstChild
  const jump = rider.lastChild
  assert.equal(jump.className, 'naiwa-jump')
  const sheet = readFileSync(join(PLUGIN, 'docs', 'celebration-jump.webp'))
  assert.equal(jump.style.backgroundImage, 'url("data:image/webp;base64,' + sheet.toString('base64') + '")')
  celebrate(552)
  assert.ok(rider.hasAttribute('data-celebrating'))
  assert.equal(jump.style.transform, 'matrix(-1, 0, 0, 1, 0, 0)')
  jump.onanimationend({animationName:'naiwa-jump-poses'})
  assert.ok(rider.hasAttribute('data-celebrating'))
  jump.onanimationend({animationName:'naiwa-jump-arc'})
  assert.equal(rider.hasAttribute('data-celebrating'),false)
  assert.equal(rider.attrs.get('data-action'),'cycle')
  select('hop')
  const last = doc.body.firstChild.firstChild.firstChild.srcset
  const pet = doc.body.firstChild
  const pointer = { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 12 }
  pet.onpointerdown(pointer)
  pet.onpointermove({ ...pointer, clientX: 41 })
  pet.onpointerup(pointer)
  pet.onclick({ detail: 1 })
  assert.equal(pet.attrs.has('data-placed'), true)
  assert.equal(pet.attrs.has('data-reacting'), false)
  assert.equal(played.length, 0, 'dragging is silent')
  pet.onpointerdown(pointer)
  pet.onpointerup(pointer)
  pet.onclick({ detail: 1 })
  const box = doc.body.children[1]
  const header = box.firstChild
  box.getBoundingClientRect = () => ({left: 60, top: 100, width: 420, height: 300})
  const [, picker, log, form] = box.children
  const [input, actions] = form.children
  for (const target of [header.firstChild, log.firstChild, input, actions.firstChild, header.lastChild, box]) {
    const grab = {...pointer, target, clientX:70, clientY:115, preventDefault() {}}
    box.onpointerdown(grab)
    box.onpointermove({...grab, clientX:72})
    assert.equal(box.attrs.has('data-dragging'), false)
    box.onpointermove({...grab, clientX:2000, clientY:-50})
    assert.equal(box.style.left, '574px')
    assert.equal(box.style.top, '6px')
    box.onpointermove({...grab, clientX:310, clientY:245})
    box.onpointerup(grab)
    let blocked = false
    const click = {detail:1, preventDefault() {}, stopImmediatePropagation() { blocked = true }}
    box.onclick(click)
    assert.ok(blocked)
    blocked = false
    box.onpointerdown(grab)
    box.onpointerup(grab)
    box.onclick(click)
    assert.equal(blocked,false)
  }
  assert.match(log.firstChild.textContent, /想跟我聊/)
  const touch = {...pointer, target:log.firstChild, pointerType:'touch', preventDefault() {}}
  box.onpointerdown(touch)
  box.onpointermove({...touch, clientY:60})
  assert.equal(longPress,undefined)
  let prevented = false
  const swipe = {cancelable:true,preventDefault() { prevented = true }}
  box.ontouchmove(swipe)
  assert.equal(prevented,false)
  box.onpointerdown(touch)
  longPress()
  assert.equal(box.attrs.has('data-dragging'),true)
  box.ontouchmove(swipe)
  assert.equal(prevented,true)
  box.onpointercancel(touch)
  assert.equal(box.attrs.has('data-dragging'),false)
  assert.deepEqual(questions, [])
  function renderPanel() {
    return component({t:key => key, sessionId:'demo', ask:async () => ({ok:true,text:'ok'})}).children[1]
  }
  function pickLanguage(code) {
    renderPanel().children.find(row => row?.props.key === 'ui-language').children
      .find(chip => chip.props.key === code).props.onClick()
  }
  pickLanguage('en')
  assert.equal(renderPanel().children.some(row => row?.props.key === 'language'), false)
  assert.equal(settings.get('naiwa-ism:ui-language'), 'en')
  assert.equal(renderPanel().children.find(row => row?.props.key === 'strength').children[0].children[0], 'Persona')
  assert.equal(actions.firstChild.textContent, 'Check progress')
  pickLanguage('zh')
  assert.equal(renderPanel().children.some(row => row?.props.key === 'language'), false)
  assert.equal(actions.firstChild.textContent, '看进度')
  input.value = '你好'
  input.oninput()
  assert.ok(pet.hasAttribute('data-reacting'))
  form.onsubmit({ preventDefault() {} })
  assert.equal(pet.hasAttribute('data-celebrating'),false)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(pet.hasAttribute('data-celebrating'))
  assert.equal(pet.hasAttribute('data-reacting'),false)
  jump.onanimationend({animationName:'naiwa-jump-arc'})
  const [speaker, title, list] = log.lastChild.children
  assert.equal(box.style.left, '300px')
  assert.equal(box.style.top, '230px')
  assert.equal(speaker.textContent, '奶蛙')
  assert.equal(title.tag, 'h4')
  assert.equal(title.firstChild.textContent, '已完成')
  assert.equal(list.tag, 'ul')
  assert.equal(list.children.length, 2)
  assert.equal(list.firstChild.lastChild.tag, 'code')
  assert.equal(list.firstChild.lastChild.textContent, 'finalize')
  assert.equal(list.lastChild.lastChild.tag, 'strong')
  assert.deepEqual(questions[0], {mode:'chat', question:'你好'})
  actions.firstChild.onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(questions[1].mode, 'progress')
  assert.ok(pet.hasAttribute('data-celebrating'))
  jump.onanimationend({animationName:'naiwa-jump-arc'})
  const file = {name:'screen.png', type:'image/png'}
  input.onpaste({clipboardData:{files:[file]}, preventDefault() {}})
  assert.match(form.children[2].textContent, /screen.png/)
  form.onsubmit({preventDefault() {}})
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(questions[2])), {mode:'chat',question:'',image:{mediaType:'image/png',data:'aQ==',name:'screen.png'}})
  assert.equal(form.children[2].hidden,true)
  assert.ok(pet.hasAttribute('data-celebrating'))
  jump.onanimationend({animationName:'naiwa-jump-arc'})
  assert.equal(settings.get('naiwa-ism:pet'), 'hop')
  assert.equal(pet.firstChild.firstChild.srcset, last)
  nextReply = {ok:false,text:'发送中断，请重试。'}
  input.value = '重试'
  form.onsubmit({preventDefault() {}})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pet.hasAttribute('data-celebrating'),false)
  let finish
  nextReply = new Promise(resolve => { finish = resolve })
  form.onsubmit({preventDefault() {}})
  component({t:key => key, sessionId:'other', ask:async () => ({ok:true,text:'ok'})})
  picker.value = 'other'
  picker.onchange()
  finish({ok:true,text:'上一会话的回复'})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pet.hasAttribute('data-celebrating'),false)
  pet.onclick({ detail: 0 })
  select('cycle')
  assert.equal(pet.firstChild.clock.onfinish, null)
  assert.equal(pet.attrs.has('data-placed'), false)
  select('hop')
  dispose()
  assert.equal(doc.body.children.length, 0)
  install()
  assert.equal(doc.body.firstChild.firstChild.firstChild.srcset, last)
  select('off')
  assert.equal(doc.body.children.length, 0)
  assert.equal(doc.head.children.length, 0)
  assert.deepEqual(backgroundChanges, [], 'pet interaction must leave the backdrop alone')
  assert.equal(played.length, 2)
  assert.equal(played[0], played[1])
  const wave = Buffer.from(played[0].split(',')[1], 'base64')
  assert.equal(createHash('sha256').update(wave).digest('hex'), 'd046f1f8b4a351c5c860e5a2a2090cb50e3686b60744db1b09801166f4c6fe22')
})
