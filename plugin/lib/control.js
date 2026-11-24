/**
 * 奶蛙控制面：/naiwa 命令与 naiwa_config 工具共用的解析、校验、状态操作与文案。
 *
 * 纯逻辑 + 注入 state 读写；不读环境、不取时间（保持 tests/files.test.mjs F4 的
 * 零依赖/确定性扫描：宿主侧源码不得出现时间函数与环境变量读取）。
 *
 * 状态优先级：state 文件 > cordis.patch.yml 的 config 默认。
 * 单一操作面：`applyOperation` 同时服务命令与工具，文案只有一个来源。
 *
 * @module @local/dsh-naiwa-ism/lib/control
 */

import { SPELL_MAX_LENGTH, VERSION, normalizeConfig } from './corpus.js'
import { clearState, loadState, saveState } from './state.js'

/** 合法档位（规范值）：关闭 / 奶蛙 / 奶龙。 */
export const STRENGTHS = ['off', 'naiwa', 'nailoong']
/** 合法语言。 */
export const LANGUAGES = ['auto', 'zh', 'en']
/** 工具 field 合法值。 */
export const CONTROL_FIELDS = ['strength', 'resident', 'language', 'spell']

const STRENGTH_LABELS = { off: '关闭', naiwa: '奶蛙', nailoong: '奶龙' }
const LANGUAGE_LABELS = { auto: '跟随用户', zh: '中文', en: 'English' }
const STRENGTH_ALIASES = {
  off: 'off', naiwa: 'naiwa', nailoong: 'nailoong', nailong: 'nailoong', 奶龙: 'nailoong', 关闭: 'off', 奶蛙: 'naiwa',
  /* 旧值兼容：一律落到 naiwa。 */
  restrained: 'naiwa', feral: 'naiwa', 克制: 'naiwa', 全蛙: 'naiwa', 狂妄: 'naiwa',
}
const RESIDENT_ALIASES = { on: true, off: false, true: true, false: false, 开: true, 关: false }
const LANGUAGE_ALIASES = { auto: 'auto', zh: 'zh', en: 'en', 中文: 'zh', 英文: 'en' }

/** 命令语法提示（错误文案与 input.hint 共用）。 */
export const SYNTAX_HINT = 'status | strength <off|naiwa|nailoong> | resident <on|off> | language <auto|zh|en> | spell <文本> | reset'

const INVALID = '参数不合法：'

/**
 * 创建控制对象：加载状态文件，并把文件值合并到 config 默认之上。
 * @param {{ defaults: object, filePath: string, onChange?: () => void }} options defaults 为 normalizeConfig 结果。
 * @returns {object} 控制对象。
 */
export function createControl(options) {
  const defaults = normalizeConfig(options !== null && typeof options === 'object' ? options.defaults : undefined)
  const loaded = loadState(options.filePath)
  return {
    defaults: defaults,
    filePath: options.filePath,
    loadError: loaded.error,
    loadedFile: loaded.raw !== undefined,
    lastWrite: undefined,
    onChange: typeof options.onChange === 'function' ? options.onChange : function () {},
    state: normalizeConfig(loaded.raw === undefined ? {} : loaded.raw, defaults),
  }
}

/**
 * 解析命令名之后的原始输入。
 * @param {unknown} rawInput 原始输入（可能带前导空白）。
 * @returns {{ kind: string, value?: string, raw?: string }} 操作。
 */
export function parseOperation(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : ''
  if (text.length === 0) return { kind: 'status' }
  const space = text.indexOf(' ')
  const verb = space === -1 ? text : text.slice(0, space)
  const rest = space === -1 ? '' : text.slice(space + 1).trim()
  if (verb === 'status') return { kind: 'status' }
  if (verb === 'reset') return { kind: 'reset' }
  if (verb === 'strength') return { kind: 'strength', value: rest }
  if (verb === 'resident') return { kind: 'resident', value: rest }
  if (verb === 'language') return { kind: 'language', value: rest }
  if (verb === 'spell') return { kind: 'spell', value: rest }
  return { kind: 'unknown', raw: text }
}

/**
 * 执行一个操作：校验、改内存、落盘、通知重注册 section。
 * @param {object} control createControl 的返回值。
 * @param {{ kind: string, value?: string, raw?: string }} op parseOperation 的结果。
 * @returns {{ ok: boolean, changed: boolean, persisted: boolean, kind: string, text: string }} 结果。
 */
export function applyOperation(control, op) {
  if (op.kind === 'status') {
    return { ok: true, changed: false, persisted: false, kind: 'status', text: formatStatus(control) }
  }
  if (op.kind === 'unknown') {
    return fail(INVALID + '未知子命令「' + op.raw + '」。语法：/naiwa ' + SYNTAX_HINT)
  }
  if (op.kind === 'reset') {
    control.state = normalizeConfig({}, control.defaults)
    const cleared = clearState(control.filePath)
    if (cleared.ok) {
      /* 文件确实删掉了：状态回到「无状态文件」而不是「已写入」。 */
      control.lastWrite = undefined
      control.loadedFile = false
    } else {
      control.lastWrite = cleared
    }
    control.onChange()
    const summary = '已重置为 config 默认：' + describeState(control.state) + '。'
    return cleared.ok
      ? { ok: true, changed: true, persisted: true, kind: 'reset', text: summary + '状态文件已删除。' }
      : { ok: true, changed: true, persisted: false, kind: 'reset', text: summary + cleared.error + '；本次运行按默认值，进程重启后旧状态会回来。' }
  }
  if (op.kind === 'strength') {
    const next = STRENGTH_ALIASES[op.value]
    if (!STRENGTHS.includes(next)) return fail(INVALID + '档位只能是 off / naiwa / nailoong（或 关闭 / 奶蛙 / 奶龙）。语法：/naiwa ' + SYNTAX_HINT)
    return commit(control, { strength: next }, '档位已设为 ' + STRENGTH_LABELS[next] + '。', 'strength')
  }
  if (op.kind === 'resident') {
    const next = RESIDENT_ALIASES[op.value]
    if (next === undefined) return fail(INVALID + '常驻只能是 on / off（或 开 / 关）。语法：/naiwa ' + SYNTAX_HINT)
    return commit(control, { resident: next }, '常驻已' + (next ? '开启' : '关闭') + '。', 'resident')
  }
  if (op.kind === 'language') {
    const next = LANGUAGE_ALIASES[op.value]
    if (next === undefined) return fail(INVALID + '语言只能是 auto / zh / en（或 中文 / 英文）。语法：/naiwa ' + SYNTAX_HINT)
    return commit(control, { language: next }, '语言已设为 ' + LANGUAGE_LABELS[next] + '。', 'language')
  }
  if (op.kind === 'spell') {
    const raw = typeof op.value === 'string' ? op.value.trim() : ''
    const next = raw.length > SPELL_MAX_LENGTH ? raw.slice(0, SPELL_MAX_LENGTH) : raw
    return commit(control, { spell: next }, next.length > 0 ? '咒语已更新。' : '咒语已清空。', 'spell')
  }
  return fail(INVALID + '未知操作。语法：/naiwa ' + SYNTAX_HINT)
}

/**
 * 渲染当前设置的一行文本（status 命令与工具 get 共用）。
 * @param {object} control 控制对象。
 * @returns {string} 文本。
 */
export function formatStatus(control) {
  const persistence = control.lastWrite === undefined
    ? (control.loadedFile ? '从 state/settings.json 载入' : '无状态文件（config 默认）')
    : (control.lastWrite.ok ? '已写入 state/settings.json' : '未写入（仅内存）：' + control.lastWrite.error)
  let text = '奶蛙控制：' + describeState(control.state) + '；持久化=' + persistence + '。'
  if (control.loadError !== undefined) {
    text += '\n状态文件加载失败：' + control.loadError + '；本次运行按 config 默认。'
  }
  return text
}

/**
 * 状态四字段的一句话描述。
 * @param {{ strength: string, resident: boolean, language: string, spell: string }} state 已归一化状态。
 * @returns {string} 文本。
 */
export function describeState(state) {
  return '档位=' + STRENGTH_LABELS[state.strength]
    + '；常驻=' + (state.resident ? '开' : '关')
    + '；语言=' + LANGUAGE_LABELS[state.language]
    + '；咒语=' + (state.spell.length > 0 ? state.spell : '（空）')
}

/** 参数错误结果。 */
function fail(text) {
  return { ok: false, changed: false, persisted: false, kind: 'error', text: text }
}

/** 合法修改：改内存 → 落盘 → 通知 → 返回带持久化状态的文本。 */
function commit(control, patch, message, kind) {
  Object.assign(control.state, patch)
  const written = saveState(control.filePath, control.state)
  control.lastWrite = written
  if (written.ok) control.loadedFile = true
  control.onChange()
  const status = written.ok
    ? '持久化：已写入 state/settings.json。'
    : written.error + '；改动仅在内存中，进程重启会丢失。'
  return { ok: true, changed: true, persisted: written.ok, kind: kind, text: message + status }
}

/**
 * /naiwa 命令定义。
 * @param {object} control 控制对象。
 * @returns {object} ctx.commands.register 的定义。
 */
export function buildNaiwaCommand(control) {
  return {
    name: 'naiwa',
    description: '查看或修改奶蛙控制状态（档位/常驻/语言/咒语）。改动立即影响下一次 system prompt 组装，状态落在插件自有 state 文件；写失败会如实报告并仅在内存生效。',
    input: { hint: SYNTAX_HINT },
    handler(invocation) {
      const raw = invocation !== null && typeof invocation === 'object' && typeof invocation.rawInput === 'string'
        ? invocation.rawInput
        : ''
      const result = applyOperation(control, parseOperation(raw))
      return result.ok
        ? { kind: 'success', text: result.text }
        : { kind: 'error', text: result.text }
    },
  }
}

/** naiwa_config 的 output.schema（只用 DSH JSON Schema 子集关键词）。 */
const CONFIG_OUTPUT = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['get', 'set'] },
    applied: { type: 'boolean' },
    strength: { type: 'string', enum: STRENGTHS },
    resident: { type: 'boolean' },
    language: { type: 'string', enum: ['auto', 'zh', 'en'] },
    spell: { type: 'string' },
    persisted: { type: 'boolean' },
    message: { type: 'string' },
    version: { type: 'string', const: VERSION },
  },
  required: ['action', 'applied', 'strength', 'resident', 'language', 'spell', 'persisted', 'message', 'version'],
  additionalProperties: false,
}

/**
 * 把操作结果投影成 canonical value（字段顺序固定、无额外键）。
 * @param {object} control 控制对象。
 * @param {'get'|'set'} action 工具动作。
 * @param {boolean} applied 是否真的改了状态。
 * @param {{ persisted: boolean, text: string }} result applyOperation 结果或读取结果。
 * @returns {object} canonical value。
 */
function canonical(control, action, applied, result) {
  const persisted = action === 'set'
    ? result.persisted === true
    : control.lastWrite !== undefined && control.lastWrite.ok === true
  return {
    action: action,
    applied: applied,
    strength: control.state.strength,
    resident: control.state.resident,
    language: control.state.language,
    spell: control.state.spell,
    persisted: persisted,
    message: result.text,
    version: VERSION,
  }
}

/**
 * naiwa_config 工具定义（与 /naiwa 共用 applyOperation 与同一状态）。
 * @param {object} control 控制对象。
 * @returns {object} ctx.tools.register 的定义。
 */
export function buildConfigTool(control) {
  return {
    name: 'naiwa_config',
    description: '读取或修改奶蛙插件的控制状态（档位/常驻/语言/咒语），与 /naiwa 命令共用同一实现与同一状态：改动立即影响下一次 system prompt 组装并持久化到插件自有 state 文件；写失败会如实报告并退化为内存态。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'], description: 'get=读取当前控制状态；set=修改一个字段。' },
        field: { type: 'string', enum: CONTROL_FIELDS, description: 'set 时要修改的字段；get 时忽略。' },
        value: { type: 'string', description: 'set 的新值：strength=off|naiwa|nailoong（或关闭|奶蛙|奶龙）；resident=on|off；language=auto|zh|en；spell=任意文本，空串清空。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: CONFIG_OUTPUT,
      render(_args, value) {
        /* get 的 message 已是完整 status（自带「奶蛙控制：」前缀），不重复拼一遍。 */
        const head = '奶蛙控制：' + describeState({
          strength: value.strength,
          resident: value.resident,
          language: value.language,
          spell: value.spell,
        }) + '。'
        return [{ type: 'text', text: value.message.startsWith('奶蛙控制：') ? value.message : head + value.message }]
      },
    },
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      if (input.action === 'get') {
        return canonical(control, 'get', false, { persisted: false, text: formatStatus(control) })
      }
      if (input.action !== 'set') {
        return canonical(control, 'set', false, { persisted: false, text: INVALID + 'action 只能是 get / set。' })
      }
      if (!CONTROL_FIELDS.includes(input.field)) {
        return canonical(control, 'set', false, { persisted: false, text: INVALID + 'field 只能是 strength / resident / language / spell。' })
      }
      const value = typeof input.value === 'string' ? input.value : ''
      const result = applyOperation(control, parseOperation(input.field + ' ' + value))
      return canonical(control, 'set', result.ok === true, result)
    },
  }
}
