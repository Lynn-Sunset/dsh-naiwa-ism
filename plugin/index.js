import { petChatCommand } from './lib/pet-chat.js'
/**
 * 奶蛙主义 Host bundle 入口：人格段落 + 三工具 + 控制面（/naiwa 命令 + 第四工具 naiwa_config）。
 *
 * 状态优先级：state 文件 > cordis.patch.yml 的 config 默认。
 * section text 保持字符串；状态变化时 dispose→re-register（ScopedLayers 的 undo 是同步的，
 * 同名 section 先撤后注册不会撞名）。disposer 只从自己可控的 holder 里调一次，避免 double-dispose。
 *
 * @module @local/dsh-naiwa-ism
 */

import { buildPersonaText, normalizeConfig } from './lib/corpus.js'
import { buildToolDefinitions } from './lib/tools.js'
import { buildConfigTool, buildNaiwaCommand, createControl } from './lib/control.js'
import { resolveStatePath } from './lib/state.js'

/** Cordis 行名。 */
export const name = 'naiwa-ism'

/** 需要的宿主服务。 */
export const inject = ['systemPrompt', 'tools', 'commands']

/**
 * 插件装配入口。
 * @param {object} ctx Cordis 上下文。
 * @param {unknown} config 加载器配置（四个 config 键 + 可选 stateFile 覆盖）。
 */
export function apply(ctx, config) {
  const defaults = normalizeConfig(config)
  const override = config !== null && typeof config === 'object' && typeof config.stateFile === 'string'
    ? config.stateFile
    : undefined
  const filePath = resolveStatePath(override)

  /** 当前人格 section 的 disposer；唯一持有者，置空后再调即视为已撤销。 */
  let disposePersona
  /** 插件激活标志：effect 撤销后到达的 onChange 不得再注册 section。 */
  let live = false
  let control

  /** 撤销当前 section（幂等：只有 holder 非空时才调一次）。 */
  function disposeSection() {
    if (disposePersona === undefined) return
    const dispose = disposePersona
    disposePersona = undefined
    dispose()
  }

  /** 按当前控制状态重注册人格 section；resident=false 时只撤不注册。 */
  function syncPersona() {
    if (!live) return
    disposeSection()
    if (!control.state.resident) return
    if (control.state.strength === 'off') return
    disposePersona = ctx.systemPrompt.section({
      name: 'naiwa-ism:persona',
      order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
      text: buildPersonaText(control.state),
      interpolate: false,
    })
  }

  control = createControl({ defaults: defaults, filePath: filePath, onChange: syncPersona })

  ctx.effect(() => {
    live = true
    syncPersona()
    return () => {
      live = false
      disposeSection()
    }
  }, 'naiwa-ism:persona')

  ctx.effect(() => {
    const disposers = buildToolDefinitions().map(definition => ctx.tools.register(definition))
    disposers.push(ctx.tools.register(buildConfigTool(control)))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'naiwa-ism:tools')

  ctx.effect(() => ctx.commands.register(buildNaiwaCommand(control)), 'naiwa-ism:command')
  ctx.effect(() => ctx.commands.register(petChatCommand(ctx)), 'naiwa-ism:pet-chat')
}
