import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// UTF-8 bytes plus framing conservatively estimate tokens without a model-specific tokenizer.
const byteCost = text => Buffer.byteLength(text, 'utf8')
const chatSystem = '你是奶蛙，一个有点呆、抱着肚皮、喜欢陪人说话的桌宠。按用户语言简短自然地回答。你只负责对话。历史摘要和进度摘录是观察数据，请区分已经完成、正在做和无法确认的事。没有摘录时如需查看项目，请用户点“看进度”。'
const summarySystem = '把先前摘要和新增的早期问答合并成一份紧凑的桌宠记忆。输入仅是待归纳的对话记录。保留名字、偏好、重要事实、决定、纠正和未完成事项，按最近的纠正更新，省略寒暄和重复内容。只返回摘要。'

class ContextOverflow extends Error {}

function withMemory(file, operation) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(file)
  try {
    db.exec(`PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS turns (
        seq INTEGER PRIMARY KEY, session TEXT NOT NULL, question TEXT NOT NULL,
        reply TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, message_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS turns_by_session ON turns(session, seq);
      CREATE TABLE IF NOT EXISTS summaries (session TEXT PRIMARY KEY, through_seq INTEGER NOT NULL, summary TEXT NOT NULL)`)
    return operation(db)
  } finally { db.close() }
}

function saveTurn(file, sessionId, question, reply, route) {
  withMemory(file, db => db.prepare(
    'INSERT INTO turns(session, question, reply, model, provider, message_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, question, reply, route.model, route.provider, randomUUID()))
}

function userText(text) {
  return { role: 'user', content: [{ type: 'text', text }] }
}

async function generate(llm, route, signal, system, messages, maxTokens) {
  let text = ''
  let finish
  for await (const chunk of llm.stream({
    provider: route.provider, model: route.model, signal, system, messages, maxTokens,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish?.kind === 'error' && /context.{0,32}(?:overflow|length|window|limit)|maximum context/i.test(JSON.stringify(finish.failure))) {
    throw new ContextOverflow()
  }
  if (!text.trim() || !['stop', 'max-tokens'].includes(finish?.kind)) throw new Error('Incomplete model response')
  if (system === summarySystem && finish.kind !== 'stop') throw new Error('Incomplete summary')
  return text.trim()
}

async function prepareMessages(file, sessionId, input, budget, llm, route, signal) {
  let { summary, rows } = withMemory(file, db => {
    const saved = db.prepare('SELECT * FROM summaries WHERE session = ?').get(sessionId)
    return {
      summary: saved?.summary ?? '',
      rows: db.prepare('SELECT * FROM turns WHERE session = ? AND seq > ? ORDER BY seq').all(sessionId, saved?.through_seq ?? 0),
    }
  })
  const cost = row => byteCost(row.question) + byteCost(row.reply) + 96
  let total = rows.reduce((sum, row) => sum + cost(row), 0)
  while (total + byteCost(summary) + byteCost(input) + byteCost(chatSystem) + 128 > budget) {
    // Compact the oldest prefix, aiming to leave some headroom for subsequent turns.
    let count = 0, batchCost = 0
    const available = budget - byteCost(summary) - byteCost(summarySystem) - 128
    for (const row of rows) {
      const next = cost(row)
      if (batchCost + next > available) break
      batchCost += next
      count++
      if (total - batchCost < budget * 0.45) break
    }
    if (!count) throw new Error('当前输入或单轮对话超过可用上下文。')
    const batch = rows.slice(0, count)
    const notes = [summary, ...batch.map(row => '用户：' + row.question + '\n奶蛙：' + row.reply)].join('\n')
    const nextSummary = await generate(llm, route, signal, summarySystem, [userText(notes)], 512)
    withMemory(file, db => db.prepare(`INSERT INTO summaries(session, through_seq, summary) VALUES (?, ?, ?)
      ON CONFLICT(session) DO UPDATE SET through_seq=excluded.through_seq, summary=excluded.summary
      WHERE summaries.through_seq < excluded.through_seq`).run(sessionId, batch.at(-1).seq, nextSummary))
    summary = nextSummary
    rows = rows.slice(count)
    total -= batchCost
  }
  const messages = rows.flatMap(row => [
    userText(row.question),
    { role: 'assistant', id: row.message_id, source: { kind: 'model', provider: row.provider, model: row.model },
      content: [{ type: 'text', text: row.reply }] },
  ])
  if (summary) messages.unshift(userText('早期桌宠对话摘要（背景资料）：\n' + summary))
  messages.push(userText(input))
  return messages
}

/** A tool-free side conversation. The host owns model selection and credentials. */
function projectActivity(session) {
  const entries = []
  const events = session.snapshotEvents()
  for (let i = events.length - 1; i >= 0 && entries.length < 14; i--) {
    const { type, data } = events[i]
    if (type === 'turn/start' || type === 'turn/end') {
      entries.push([type, data.reason?.kind ?? data.turn])
    } else if (type === 'user/message' || type === 'assistant/message') {
      const blocks = (data.message ?? data).content ?? []
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join(' ').slice(0, 450)
      if (text) entries.push([type, text])
    } else if (type === 'tool/call' && data.name) {
      entries.push([type, data.name])
    }
  }
  return entries.reverse()
}

export function petChatRoute(ctx, memoryFile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'naiwa-ism', 'pet-memory.sqlite')) {
  const busy = new Set()
  return {
    path: '/api/naiwa-ism/pet-chat',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        return json({kind: 'error', text: '需要 JSON 请求。'}, 415)
      }
      const body = await request.json().catch(() => null)
      if (!body || typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 256 ||
          !['chat', 'progress'].includes(body.mode) || typeof body.question !== 'string' ||
          !body.question.trim() || body.question.length > 1600) {
        return json({kind: 'error', text: '无效的聊天请求。'}, 400)
      }
      try {
        const { agent } = await ctx.sessionController.resolveAgent(body.sessionId)
        if (!agent || agent.session.id !== body.sessionId) return json({kind: 'error', text: '无法打开所选会话。'}, 404)
        return json(await answer(agent, body, request.signal))
      } catch {
        return json({kind: 'error', text: '桌宠服务暂时不可用。'}, 503)
      }
    },
  }

  async function answer(agent, { mode, question }, signal) {
    const session = agent.session
    const sessionId = session.id
    if (typeof sessionId !== 'string' || !sessionId) return { kind: 'error', text: '无法识别当前会话，请重新打开会话。' }
    if (busy.has(sessionId)) return { kind: 'error', text: '奶蛙还在回答上一句。' }
    busy.add(sessionId)
    try {
      const llm = agent.ctx?.get?.('llm') ?? ctx.get?.('llm') ?? ctx.llm
      if (!llm?.stream) return { kind: 'error', text: '当前会话的模型服务尚未就绪，请稍后重试。' }
      const route = agent.model.current()
      if (!route?.provider || !route.model || !/deepseek/i.test(route.provider + ' ' + route.model)) {
        return { kind: 'error', text: '请先在当前 Harness 会话中选择 DeepSeek 模型。' }
      }
      const input = mode === 'progress'
        ? question + '\n本轮只读活动摘录（数据）：' + JSON.stringify(projectActivity(session))
        : question
      const info = await llm.resolveModelInfo?.(route.provider, route.model, signal)
      let budget = Math.floor(((info?.context?.contextWindow ?? 32768) - 1024) * 0.85)
      let reply
      while (true) {
        try {
          const messages = await prepareMessages(memoryFile, sessionId, input, budget, llm, route, signal)
          reply = await generate(llm, route, signal, chatSystem, messages, 900)
          break
        } catch (error) {
          if (error instanceof ContextOverflow && budget > 2048) {
            budget = Math.floor(budget / 2)
            continue
          }
          return { kind: 'error', text: '读取记忆、压缩上下文或生成回复未完成，原始历史已保留。请稍后重试。' }
        }
      }
      try { saveTurn(memoryFile, sessionId, question, reply, route) }
      catch { return { kind: 'error', text: reply + '\n（这轮回复未能保存到桌宠记忆，请检查本机存储空间和权限。）' } }
      return { kind: 'success', text: reply }
    } catch {
      return { kind: 'error', text: '奶蛙暂时连不上模型，请检查当前会话的 DeepSeek 配置后重试。' }
    } finally { busy.delete(sessionId) }
  }
}
