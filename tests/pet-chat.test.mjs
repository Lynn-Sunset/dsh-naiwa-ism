import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'

function temporaryMemory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'naiwa-memory-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'pet.sqlite')
}
import assert from 'node:assert/strict'
import { petChatCommand } from '../plugin/lib/pet-chat.js'

test('闲聊只携带本会话的桌宠历史，进度查询才读取项目活动', async t => {
  const requests = []
  let reads = 0
  const command = petChatCommand({ llm: { async *stream(request) {
    requests.push(request)
    yield { type: 'text-delta', text: '在呢。' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }, temporaryMemory(t))
  const session = { id: 'one', snapshotEvents() {
    reads++
    return [{ type: 'assistant/message', data: { message: { content: [{type:'text', text:'代码已提交'}] } } }]
  } }
  const agent = { session, model: {current: () => ({provider:'deepseek-official', model:'deepseek-v4-flash'})} }
  const ask = (mode, question) => command.handler({agent, rawInput: JSON.stringify({mode, question})})
  assert.equal((await ask('chat','你好')).text, '在呢。')
  await ask('chat','还记得吗')
  assert.equal(reads, 0)
  assert.equal(requests[1].messages.length, 3)
  assert.deepEqual(requests[1].messages[1].source, {kind:'model', provider:'deepseek-official', model:'deepseek-v4-flash'})
  assert.ok(requests[1].messages[1].id)
  await ask('progress','到哪里了')
  assert.equal(reads, 1)
  assert.match(JSON.stringify(requests[2].messages), /代码已提交/)
  agent.session = {id:'two'}
  await ask('chat','另一个会话')
  assert.equal(requests[3].messages.length, 1)
  assert.equal(requests[3].tools, undefined)
})


test('重新加载后用稳定会话 ID 恢复超过 64 轮，其他会话保持独立', async t => {
  const file = temporaryMemory(t)
  let last
  const ctx = {llm: {async *stream(request) {
    last = request.messages
    yield {type:'text-delta', text:'收到'}
    yield {type:'finish', reason:{kind:'stop'}}
  }}}
  function ask(command, id, question) {
    const agent = {session:{id}, model:{current:()=>({provider:'deepseek-official',model:'deepseek-v4-flash'})}}
    return command.handler({agent,rawInput:JSON.stringify({mode:'chat',question})})
  }
  const first = petChatCommand(ctx, file)
  for (let i = 0; i < 66; i++) assert.equal((await ask(first, 'project-a', '问题' + i)).kind, 'success')
  const restarted = petChatCommand(ctx, file)
  await ask(restarted, 'project-b', '你好')
  assert.equal(last.length, 1)
  await ask(restarted, 'project-a', '接着聊')
  assert.equal(last.length, 133)
  assert.equal(last[0].content[0].text, '问题0')
  assert.equal(last.at(-3).content[0].text, '问题65')
})


test('摘要失败不推进检查点；重试、再次压缩和重启均保留原文', async t => {
  const file = temporaryMemory(t)
  let fail = true
  let summaries = 0
  let last
  const llm = {
    resolveModelInfo: async () => ({context: {contextWindow: 4500}}),
    async *stream(request) {
      const compressing = request.system.startsWith('把先前摘要')
      if (compressing && fail) {
        yield {type:'finish', reason: {kind:'error', failure:{message:'offline'}}}
        return
      }
      if (compressing) summaries++
      else last = request.messages
      yield {type:'text-delta', text:compressing ? '喜欢蓝色单车' : '收到'}
      yield {type:'finish', reason:{kind:'stop'}}
    },
  }
  const agent = {session:{id:'persistent'},model:{current:()=>({provider:'deepseek-official', model:'deepseek-v4-flash'})}}
  let command = petChatCommand({llm}, file)
  const ask = question => command.handler({agent,rawInput:JSON.stringify({mode:'chat',question})})
  const db = () => new DatabaseSync(file, {readOnly:true})
  let i = 0
  const question = i => i + '我喜欢蓝色单车'.repeat(48)
  while (i < 20 && (await ask(question(i))).kind === 'success') i++
  assert.ok(i > 0 && i < 20)
  let probe = db()
  assert.equal(probe.prepare('SELECT count(*) AS n FROM turns').get().n, i)
  assert.equal(probe.prepare('SELECT count(*) AS n FROM summaries').get().n, 0)
  probe.close()
  fail = false
  for (; i < 24; i++) assert.equal((await ask(question(i))).kind, 'success')
  assert.ok(summaries > 1)
  command = petChatCommand({llm}, file)
  assert.equal((await ask('还记得吗')).kind, 'success')
  assert.match(last[0].content[0].text, /早期桌宠对话摘要.*|喜欢蓝色单车/)
  assert.equal(last.at(-3).content[0].text, question(23))
  probe = db()
  assert.equal(probe.prepare('SELECT count(*) AS n FROM turns').get().n, 25)
  assert.equal(probe.prepare('SELECT question FROM turns ORDER BY seq LIMIT 1').get().question, question(0))
  probe.close()
})
