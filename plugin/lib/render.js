/**
 * 三个工具的 render：把 canonical value 投影成模型可见的 ContentBlock[]。
 * 纯函数，可重放；不做二次计算、不读外部状态。
 *
 * @module @local/dsh-naiwa-ism/lib/render
 */

/**
 * 五拍叙事 → 文本块。
 * @param {unknown} args 调用参数（仅用于签名对齐）。
 * @param {object} value canonical value。
 * @returns {{ type: 'text', text: string }[]} 内容块。
 */
export function renderGloss(args, value) {
  const lines = [value.version + '｜' + value.subject + '｜' + value.tone]
  lines.push('备注：' + value.notes.join('；'))
  value.beats.forEach((beat, index) => {
    lines.push((index + 1) + '. ' + beat.name + '：' + beat.text)
  })
  if (Array.isArray(value.exemplar) && value.exemplar.length > 0) {
    lines.push('语感示例（题目不同，只学语气，勿复述）：')
    for (const line of value.exemplar) lines.push('· ' + line)
  }
  lines.push('箴言：' + value.maxim)
  lines.push('候选词：' + value.keywords.join(' / '))
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 美术指导 → 文本块。
 * @param {unknown} args 调用参数（仅用于签名对齐）。
 * @param {object} value canonical value。
 * @returns {{ type: 'text', text: string }[]} 内容块。
 */
export function renderArt(args, value) {
  const palette = value.palette
  const lines = [
    value.version + '｜' + value.subject,
    '形体：' + value.form,
    '眼睛：' + value.eyes,
    '嘴：' + value.mouth,
    '材质：' + value.material,
    '退化感：' + value.decay,
    '构图：' + value.composition,
    '配色：primary ' + palette.primary + ' / accent ' + palette.accent + ' / ink ' + palette.ink
      + ' / background ' + palette.background + ' / hint ' + palette.hint,
    '中文提示词：' + value.prompt_zh,
    '英文提示词：' + value.prompt_en,
    '避免：' + value.avoid.join('、'),
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 节奏重写指引 → 文本块。
 * @param {unknown} args 调用参数（仅用于签名对齐）。
 * @param {object} value canonical value。
 * @returns {{ type: 'text', text: string }[]} 内容块。
 */
export function renderSpeak(args, value) {
  const actionLabels = { keep: '保留', split: '拆短' }
  const lines = [value.version + '｜节奏重排指引｜' + value.mode + '｜' + value.intensity]
  lines.push('做法：' + value.policy)
  lines.push('逐句计划：')
  value.plan.forEach((item, index) => {
    lines.push((index + 1) + '. [' + (actionLabels[item.action] ?? item.action) + '] ' + item.text + '（可见长度 ' + item.length + '）')
  })
  if (value.tails.length > 0) {
    lines.push('可用尾音（最多两处，可不用）：' + value.tails.join(' / '))
  }
  lines.push('语感示例（题目不同，只学节奏，勿复述）：')
  lines.push('原句：' + value.example.original)
  lines.push('重排：' + value.example.rewritten)
  lines.push('备注：' + value.notes.join('；'))
  return [{ type: 'text', text: lines.join('\n') }]
}
