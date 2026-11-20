/**
 * 奶蛙控制状态持久化：读、原子写、删除。
 *
 * 只用 node 内建模块；不取时间、不读环境（保持 tests/files.test.mjs F4 的零依赖/确定性扫描）。
 * 状态文件默认位于包根 state/settings.json（由 import.meta.url 定位，不猜 cwd）。
 *
 * @module @local/dsh-naiwa-ism/lib/state
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 默认状态文件绝对路径：<package>/state/settings.json。 */
export const DEFAULT_STATE_FILE = fileURLToPath(new URL('../state/settings.json', import.meta.url))

/**
 * 解析状态文件路径：显式覆盖（测试/多实例）优先，否则用包内默认路径。
 * @param {unknown} override config.stateFile 的原始值。
 * @returns {string} 绝对路径。
 */
export function resolveStatePath(override) {
  if (typeof override === 'string' && override.trim().length > 0) return override.trim()
  return DEFAULT_STATE_FILE
}

/**
 * 读取状态文件。
 * @param {string} filePath 状态文件绝对路径。
 * @returns {{ raw: object | undefined, error: string | undefined }} 解析对象（可能 undefined）与人类可读错误。
 */
export function loadState(filePath) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { raw: undefined, error: undefined }
    }
    return { raw: undefined, error: '状态文件读取失败：' + describe(error) }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_error) {
    return { raw: undefined, error: '状态文件不是合法 JSON，已忽略' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { raw: undefined, error: '状态文件不是 JSON 对象，已忽略' }
  }
  return { raw: parsed, error: undefined }
}

/**
 * 原子写状态文件：写临时文件再 rename 覆盖（失败时清理临时文件）。
 * @param {string} filePath 目标路径。
 * @param {{ strength: string, resident: boolean, language: string, spell: string }} state 已归一化状态。
 * @returns {{ ok: boolean, error: string | undefined }} 写盘结果。
 */
export function saveState(filePath, state) {
  const data = {
    strength: state.strength,
    resident: state.resident,
    language: state.language,
    spell: state.spell,
  }
  const tempPath = filePath + '.tmp'
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
    renameSync(tempPath, filePath)
    return { ok: true, error: undefined }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true })
    } catch (_cleanupError) {
      /* 清理失败不影响主错误。 */
    }
    return { ok: false, error: '状态文件写入失败：' + describe(error) }
  }
}

/**
 * 删除状态文件（/naiwa reset 用）。
 * @param {string} filePath 目标路径。
 * @returns {{ ok: boolean, error: string | undefined }} 删除结果。
 */
export function clearState(filePath) {
  try {
    rmSync(filePath, { force: true })
    return { ok: true, error: undefined }
  } catch (error) {
    return { ok: false, error: '状态文件删除失败：' + describe(error) }
  }
}

/**
 * 把任意错误渲染成短文本。
 * @param {unknown} error 抛出的值。
 * @returns {string} 文本。
 */
function describe(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }
  return String(error)
}
