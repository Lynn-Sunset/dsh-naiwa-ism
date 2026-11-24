/**
 * 控制面测试（C1–C13）：/naiwa 命令与 naiwa_config 工具共用同一 applyOperation，
 * 状态落盘/读回/坏文件/写失败/reset/常驻开关/卸载。
 *
 * 只依赖 node:test / node:assert/strict / node:fs / node:os / node:path，不 spawn 子进程。
 * 运行：node --test --test-isolation=none tests\control.test.mjs …
 *
 * 状态文件一律落在 mkdtemp 出来的临时目录（config.stateFile 覆盖），不碰真机插件状态。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../plugin/index.js'
import { VERSION } from '../plugin/lib/corpus.js'

/* ------------------------------------------------------------------ */
/* fake host ctx                                                       */
/* ------------------------------------------------------------------ */

function fakeHostCtx() {
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
    inject(keys, setup) { setup(this) },
    connection: { fetch: { register: () => () => {} } },
    effect(factory, label) {
      const dispose = factory()
      effects.push({ label, dispose })
      return dispose
    },
    systemPrompt: {
      getSectionOrder: () => 0,
      section(definition) {
        /* 真实 SystemPrompt 对同名 section 抛错（NamedEntries）：重注册必须先撤后注册。 */
        if (sections.some(entry => entry.name === definition.name)) {
          throw new Error('prompt section "' + definition.name + '" is already registered')
        }
        sections.push(definition)
        return () => { remove(sections, definition) }
      },
    },
    tools: {
      register(definition) {
        if (!definition.output || typeof definition.output.render !== 'function' || definition.output.schema === undefined) {
          throw new TypeError('tool ' + definition.name + ' must declare output { schema, render }')
        }
        if (tools.some(entry => entry.name === definition.name)) {
          throw new Error('tool "' + definition.name + '" is already registered')
        }
        tools.push(definition)
        return () => {
          remove(tools, definition)
          unregistered.add(definition.name)
        }
      },
    },
    commands: {
      register(definition) {
        if (commands.some(entry => entry.name === definition.name)) {
          throw new Error('command "' + definition.name + '" is already registered')
        }
        commands.push(definition)
        return () => { remove(commands, definition) }
      },
    },
  }
  return { ctx, sections, tools, commands, effects, unregistered }
}

function tempStateFile() {
  const dir = mkdtempSync(join(tmpdir(), 'naiwa-control-'))
  return join(dir, 'settings.json')
}

const invoke = (definition, rawInput) => definition.handler({
  commandId: 'test', agent: {}, rawInput, attachments: [], signal: new AbortController().signal,
})

const toolOf = (harness, name) => harness.tools.find(definition => definition.name === name)

/* ------------------------------------------------------------------ */
/* C1–C13                                                              */
/* ------------------------------------------------------------------ */

test('C1 apply 装配：section / 四工具 / 命令 / 三个 effect', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })

  assert.equal(harness.sections.length, 1)
  const section = harness.sections[0]
  assert.equal(section.name, 'naiwa-ism:persona')
  assert.equal(section.order, 1)
  assert.equal(section.interpolate, false)
  assert.equal(typeof section.text, 'string')
  assert.ok(section.text.includes('当前档位：奶蛙'))

  assert.equal(harness.tools.length, 4)
  assert.deepEqual(
    harness.tools.map(definition => definition.name).sort(),
    ['naiwa_art', 'naiwa_config', 'naiwa_gloss', 'naiwa_speak'],
  )

  assert.deepEqual(harness.commands.map(command => command.name), ['naiwa'])
  const command = harness.commands[0]
  assert.equal(command.name, 'naiwa')
  assert.equal(typeof command.description, 'string')
  assert.ok(command.description.length > 0)
  assert.equal(typeof command.input.hint, 'string')
  assert.ok(command.input.hint.trim().length > 0)

  assert.deepEqual(harness.effects.map(effect => effect.label), [
    'naiwa-ism:persona',
    'naiwa-ism:tools',
    'naiwa-ism:command',
    'naiwa-ism:pet-chat',
  ])
})

test('C2 status：裸 /naiwa 与 status 都返回四字段与来源文本', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const command = harness.commands[0]
  for (const rawInput of ['', ' status']) {
    const result = invoke(command, rawInput)
    assert.equal(result.kind, 'success')
    for (const marker of [
      '奶蛙控制：',
      '档位=奶蛙',
      '常驻=开',
      '语言=跟随用户',
      '咒语=（空）',
      '持久化=无状态文件（config 默认）',
    ]) {
      assert.ok(result.text.includes(marker), `status text missing ${marker}: ${result.text}`)
    }
  }
  assert.ok(!existsSync(file), 'reading status must not create the state file')
})

test('C3 strength off：内存 + 原子写（无 .tmp 残留）+ section 撤销', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const command = harness.commands[0]

  const result = invoke(command, ' strength off')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('档位已设为 关闭'), result.text)
  assert.ok(result.text.includes('已写入 state/settings.json'), result.text)

  assert.ok(existsSync(file), 'state file must exist after a successful write')
  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(persisted.strength, 'off')
  assert.equal(persisted.resident, true)
  assert.equal(persisted.language, 'auto')
  assert.equal(persisted.spell, '')
  assert.ok(!existsSync(file + '.tmp'), 'atomic write must not leave a .tmp file')

  assert.equal(harness.sections.length, 0, 'off must unregister the persona section')

  const back = invoke(command, ' strength naiwa')
  assert.equal(back.kind, 'success')
  assert.equal(harness.sections.length, 1)
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'))
})

test('C4 非法参数：kind:error、不动状态、不落盘', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const command = harness.commands[0]
  const before = harness.sections[0]
  for (const rawInput of [' strength turbo', ' resident maybe', ' language fr', ' bogus', ' strength', ' resident', ' language']) {
    const result = invoke(command, rawInput)
    assert.equal(result.kind, 'error', `${rawInput} must be an error`)
    assert.ok(
      result.text.startsWith('参数不合法：') || result.text.includes('未知子命令'),
      `unexpected error text for ${rawInput}: ${result.text}`,
    )
    assert.ok(result.text.includes('语法：/naiwa'), result.text)
  }
  assert.ok(!existsSync(file), 'invalid input must not write the state file')
  assert.equal(harness.sections[0], before, 'invalid input must not touch the persona section')
  const status = invoke(command, ' status')
  assert.ok(status.text.includes('档位=奶蛙'), status.text)
})

test('C5 reset：回落 config 默认（奶蛙）并删除状态文件', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const command = harness.commands[0]
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'))

  assert.equal(invoke(command, ' strength off').kind, 'success')
  assert.ok(existsSync(file))
  assert.equal(harness.sections.length, 0)

  const result = invoke(command, ' reset')
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('已重置为 config 默认'), result.text)
  assert.ok(result.text.includes('档位=奶蛙'), result.text)
  assert.ok(!existsSync(file), 'reset must delete the state file')
  assert.equal(harness.sections.length, 1)
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'), harness.sections[0].text.slice(-80))

  const status = invoke(command, ' status')
  assert.ok(status.text.includes('持久化=无状态文件（config 默认）'), status.text)
})

test('C6 写失败：退化为内存态、如实报错、section 撤销、工具 applied:true persisted:false', async () => {
  const root = mkdtempSync(join(tmpdir(), 'naiwa-blocked-'))
  const blocker = join(root, 'state')
  writeFileSync(blocker, 'not a directory', 'utf8')
  const file = join(blocker, 'settings.json')

  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const command = harness.commands[0]

  const result = invoke(command, ' strength off')
  assert.equal(result.kind, 'success', 'in-memory change still succeeds')
  assert.ok(result.text.includes('状态文件写入失败：'), result.text)
  assert.ok(result.text.includes('仅在内存中'), result.text)
  assert.ok(!result.text.includes('已写入 state/settings.json'), 'must not claim it persisted')
  assert.equal(harness.sections.length, 0, 'off must unregister even when persistence fails')
  assert.ok(!existsSync(file))

  const tool = toolOf(harness, 'naiwa_config')
  const value = await tool.execute({ action: 'set', field: 'strength', value: 'naiwa' })
  assert.equal(value.applied, true)
  assert.equal(value.persisted, false)
  assert.equal(value.strength, 'naiwa')
  assert.ok(value.message.includes('状态文件写入失败：'), value.message)
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'))
})

test('C7 重载恢复：二次 apply 从状态文件读回 off，section 不注册', () => {
  const file = tempStateFile()
  const first = fakeHostCtx()
  apply(first.ctx, { stateFile: file })
  assert.equal(invoke(first.commands[0], ' strength off').kind, 'success')

  const second = fakeHostCtx()
  apply(second.ctx, { stateFile: file })
  assert.equal(second.sections.length, 0, 'off must persist across reload')
  assert.equal(second.tools.length, 4)
  assert.equal(second.commands.length, 1)

  const status = invoke(second.commands[0], ' status')
  assert.ok(status.text.includes('档位=关闭'), status.text)
  assert.ok(status.text.includes('持久化=从 state/settings.json 载入'), status.text)
})

test('C8 坏 JSON：apply 不抛、按默认注册、status 报加载失败', () => {
  const file = tempStateFile()
  writeFileSync(file, '{not json', 'utf8')

  const harness = fakeHostCtx()
  assert.doesNotThrow(() => apply(harness.ctx, { stateFile: file }))
  assert.equal(harness.sections.length, 1)
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'))
  assert.equal(harness.tools.length, 4)

  const status = invoke(harness.commands[0], ' status')
  assert.equal(status.kind, 'success')
  assert.ok(status.text.includes('状态文件加载失败：'), status.text)
  assert.equal(readFileSync(file, 'utf8'), '{not json', 'reading must not rewrite the broken file')
})

test('C9 工具同源：set/get 走同一 applyOperation，立即影响 section 与状态', async () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const tool = toolOf(harness, 'naiwa_config')

  const set = await tool.execute({ action: 'set', field: 'strength', value: 'off' })
  assert.equal(set.action, 'set')
  assert.equal(set.applied, true)
  assert.equal(set.persisted, true)
  assert.equal(set.strength, 'off')
  assert.equal(set.version, VERSION)
  assert.ok(set.message.includes('关闭'), set.message)
  assert.equal(harness.sections.length, 0, 'off must unregister the section')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).strength, 'off')

  const get = await tool.execute({ action: 'get' })
  assert.equal(get.action, 'get')
  assert.equal(get.applied, false)
  assert.equal(get.strength, 'off')
  assert.equal(get.persisted, true)
  assert.equal(get.version, VERSION)
  assert.ok(get.message.includes('奶蛙控制：'), get.message)

  const back = await tool.execute({ action: 'set', field: 'strength', value: 'naiwa' })
  assert.equal(back.strength, 'naiwa')
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'))
})

test('C10 工具错误：非法 field / action 返回 applied:false 且不抛', async () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const tool = toolOf(harness, 'naiwa_config')

  const badField = await tool.execute({ action: 'set', field: 'nope', value: 'x' })
  assert.equal(badField.applied, false)
  assert.ok(badField.message.includes('field 只能是'), badField.message)

  const badAction = await tool.execute({ action: 'nope' })
  assert.equal(badAction.applied, false)
  assert.ok(badAction.message.includes('action 只能是'), badAction.message)

  const badValue = await tool.execute({ action: 'set', field: 'strength', value: 'turbo' })
  assert.equal(badValue.applied, false)
  assert.ok(badValue.message.includes('参数不合法：'), badValue.message)

  assert.ok(!existsSync(file), 'rejected calls must not write the state file')
  assert.equal(badField.strength, 'naiwa')
})

test('C11 常驻开关：off 撤 section 但保留四工具与命令，on 再注册', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const command = harness.commands[0]

  const off = invoke(command, ' resident off')
  assert.equal(off.kind, 'success')
  assert.equal(harness.sections.length, 0)
  assert.equal(harness.tools.length, 4)
  assert.deepEqual(harness.commands.map(command => command.name), ['naiwa'])

  const on = invoke(command, ' resident on')
  assert.equal(on.kind, 'success')
  assert.equal(harness.sections.length, 1)
  assert.ok(harness.sections[0].text.includes('当前档位：奶蛙'))
})

test('C12 canonical value 通过自身 output.schema；render 返回非空 text 块', async () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  const tool = toolOf(harness, 'naiwa_config')
  const schema = tool.output.schema

  const values = [
    await tool.execute({ action: 'get' }),
    await tool.execute({ action: 'set', field: 'language', value: 'zh' }),
    await tool.execute({ action: 'set', field: 'nope' }),
  ]
  for (const value of values) {
    const errors = schemaErrors(value, schema)
    assert.deepEqual(errors, [], `schema errors: ${errors.join(' | ')}`)
    const blocks = tool.output.render({}, value)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].type, 'text')
    assert.ok(typeof blocks[0].text === 'string' && blocks[0].text.length > 0)
    assert.ok(blocks[0].text.includes('奶蛙控制'), blocks[0].text)
  }
})

test('C13 卸载：三个 effect disposer 后四工具注销、命令与 section 清空', () => {
  const file = tempStateFile()
  const harness = fakeHostCtx()
  apply(harness.ctx, { stateFile: file })
  assert.equal(harness.effects.length, 4)
  for (const effect of harness.effects) effect.dispose()
  assert.equal(harness.sections.length, 0)
  assert.equal(harness.commands.length, 0)
  assert.equal(harness.unregistered.size, 4)
  for (const name of ['naiwa_gloss', 'naiwa_art', 'naiwa_speak', 'naiwa_config']) {
    assert.ok(harness.unregistered.has(name), `${name} must be disposed`)
  }
})

/* ------------------------------------------------------------------ */
/* 简易 JSON Schema 子集校验器（type/required/additionalProperties/enum/const） */
/* ------------------------------------------------------------------ */

function schemaErrors(value, schema) {
  const errors = []
  for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push('missing ' + key)
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push('unexpected ' + key)
  }
  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!Object.hasOwn(value, key)) continue
    const actual = value[key]
    if (rule.type === 'string' && typeof actual !== 'string') errors.push(key + ' not string')
    if (rule.type === 'boolean' && typeof actual !== 'boolean') errors.push(key + ' not boolean')
    if (rule.enum !== undefined && !rule.enum.includes(actual)) errors.push(key + ' not in enum')
    if (Object.hasOwn(rule, 'const') && actual !== rule.const) errors.push(key + ' const mismatch')
  }
  return errors
}

test('奶龙可用中文命令选择，重启后恢复，工具可切回奶蛙', async () => {
  const stateFile = tempStateFile()
  const first = fakeHostCtx()
  apply(first.ctx, {stateFile})
  assert.equal(invoke(first.commands[0], 'strength 奶龙').kind, 'success')
  assert.match(first.sections[0].text, /异星幼龙/)
  assert.doesNotMatch(first.sections[0].text, /蛙腔/)
  const second = fakeHostCtx()
  apply(second.ctx, {stateFile})
  const tool = toolOf(second, 'naiwa_config')
  assert.equal((await tool.execute({action:'get'})).strength, 'nailoong')
  invoke(second.commands[0], 'language en')
  assert.match(second.sections[0].text, /Answer in English/)
  await tool.execute({action:'set',field:'strength',value:'naiwa'})
  assert.match(second.sections[0].text, /当前档位：奶蛙/)
  assert.doesNotMatch(second.sections[0].text, /异星幼龙/)
})
