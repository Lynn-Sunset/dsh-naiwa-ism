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
  value.beats.forEach((beat, index) => {
    lines.push((index + 1) + '. ' + beat.name + '：' + beat.text)
  })
  lines.push('箴言：' + value.maxim)
  lines.push('关键词：' + value.keywords.join(' / '))
  if (value.notes.length > 0) {
    lines.push('边界：' + value.notes.join('；'))
  }
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
 * 节奏重写 → 文本块（直接给重排后的正文，不附加说明）。
 * @param {unknown} args 调用参数（仅用于签名对齐）。
 * @param {object} value canonical value。
 * @returns {{ type: 'text', text: string }[]} 内容块。
 */
export function renderSpeak(args, value) {
  return [{ type: 'text', text: value.text }]
}
