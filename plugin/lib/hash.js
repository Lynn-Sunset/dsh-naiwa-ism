/**
 * 确定性哈希与输入规范化。
 *
 * 规则：FNV-1a 32 位（按 UTF-16 码元），`pick` 用字段名做独立取池。
 * 这里没有任何时间源、随机源或环境读取，因此同一输入永远得到同一结果。
 *
 * @module @local/dsh-naiwa-ism/lib/hash
 */

/**
 * FNV-1a 32 位哈希，按 UTF-16 码元遍历。
 * @param {string} input 参与哈希的文本。
 * @returns {number} 0..2^32-1 的整数。
 */
export function fnv1a(input) {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 从池中按 `seedText + NUL + field` 稳定取一项。
 * @template T
 * @param {string} seedText 规范化后的种子文本。
 * @param {string} field 字段名，保证各字段之间不相关。
 * @param {readonly T[]} pool 候选池，必须非空。
 * @returns {T} 选中的项。
 */
export function pick(seedText, field, pool) {
  return pool[fnv1a(seedText + '\u0000' + field) % pool.length]
}

/**
 * 规范化工具对象：必须是非空字符串，空白折叠为单个空格。
 * @param {unknown} value 模型传入的对象。
 * @returns {string} 规范化后的对象文本。
 */
export function normalizeSubject(value) {
  if (typeof value !== 'string') {
    throw new Error('subject must be a non-empty string')
  }
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) {
    throw new Error('subject must be a non-empty string')
  }
  return normalized
}

/**
 * 校验待重排文本：必须是非空字符串；返回原文，不做空白折叠。
 * @param {unknown} value 模型传入的原文。
 * @returns {string} 原样文本。
 */
export function normalizeText(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('text must be a non-empty string')
  }
  return value
}
