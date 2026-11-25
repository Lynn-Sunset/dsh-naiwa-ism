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
import { petChatRoute } from '../plugin/lib/pet-chat.js'

function petChatCommand(ctx, file) {
  let current
  const route = petChatRoute({...ctx, sessionController: {resolveAgent: async id => ({agent: current?.session.id === id ? current : undefined})}}, file)
  return {async handler({agent, rawInput}) {
    current = agent
    const request = new Request('http://localhost' + route.path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sessionId: agent.session.id, ...JSON.parse(rawInput)})})
    return (await route.fetch(request)).json()
  }}
}

test('闲聊与看进度都读取当前会话的近期活动，切换会话不带入旧记录', async t => {
  const requests = []
  let reads = 0
  const command = petChatCommand({ llm: { async *stream(request) {
    requests.push(request)
    yield { type: 'text-delta', text: '在呢。' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } }, temporaryMemory(t))
  const session = { id: 'one', snapshotEvents() {
    reads++
    return [{type:'tool/result',data:{message:{callId:'test-1',content:[{type:'text',text:'68 tests passed'}]}}}, { type: 'assistant/message', data: { message: { content: [{type:'text', text:'代码已提交'}] } } }]
  } }
  const agent = { session, model: {current: () => ({provider:'deepseek-official', model:'deepseek-v4-flash'})} }
  const ask = (mode, question) => command.handler({agent, rawInput: JSON.stringify({mode, question})})
  assert.equal((await ask('chat','你好')).text, '在呢。')
  await ask('chat','还记得吗')
  assert.equal(reads, 2)
  assert.match(JSON.stringify(requests[1].messages), /68 tests passed/)
  assert.equal(requests[1].messages.length, 3)
  assert.deepEqual(requests[1].messages[1].source, {kind:'model', provider:'deepseek-official', model:'deepseek-v4-flash'})
  assert.ok(requests[1].messages[1].id)
  await ask('progress','到哪里了')
  assert.equal(reads, 3)
  assert.match(JSON.stringify(requests[2].messages), /代码已提交/)
  agent.session = {id:'two'}
  await ask('chat','另一个会话')
  assert.equal(requests[3].messages.length, 1)
  assert.doesNotMatch(JSON.stringify(requests[3].messages), /68 tests passed|代码已提交/)
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

test('会话记录随模型窗口扩展，保留较早的活动并按时间排序', async t => {
  let input
  let contextWindow = 131072
  const command = petChatCommand({llm: {
    resolveModelInfo: async () => ({context: {contextWindow}}),
    async *stream(request) {
      input = request.messages.at(-1).content[0].text
      yield {type:'text-delta', text:'收到'}
      yield {type:'finish', reason:{kind:'stop'}}
    },
  }}, temporaryMemory(t))
  const events = Array.from({length:400}, (_, i) => ({
    type:'user/message', data:{content:[{type:'text', text:'event-' + i + ' ' + 'x'.repeat(60)}]},
  }))
  const agent = {session:{id:'long', snapshotEvents:() => events},
    model:{current:() => ({provider:'deepseek-official', model:'deepseek-v4-flash'})}}
  for (const mode of ['chat', 'progress']) {
    const reply = await command.handler({agent, rawInput:JSON.stringify({mode, question:'进度？'})})
    assert.equal(reply.kind, 'success')
    const ids = Array.from(input.matchAll(/event-(\d+) /g), m => Number(m[1]))
    assert.equal(ids.at(-1), 399)
    if (mode === 'chat') assert.deepEqual(ids, events.map((_, i) => i))
    else {
      assert.ok(ids[0] > 0)
      assert.deepEqual(ids, events.slice(ids[0]).map((_, i) => i + ids[0]))
    }
    contextWindow = 4096
  }
})

test('图片单独发送时使用宿主附件引用，纯文字模型给出可重试提示', async t => {
  const ref = {attachmentId:'test-image'}
  let parts, request, modalities = ['text', 'image']
  const store = {async admitPromptContent(input) { parts = input; return [{type:'image', attachment:ref}] }}
  const command = petChatCommand({get:key => key === 'attachments' ? store : undefined, llm:{
    resolveModelInfo:async () => ({inputModalities:modalities}),
    async *stream(input) {
      request = input
      yield {type:'text-delta', text:'看到了'}
      yield {type:'finish', reason:{kind:'stop'}}
    },
  }}, temporaryMemory(t))
  const agent = {session:{id:'image-session'}, model:{current:()=>({provider:'deepseek',model:'vision'})}}
  const image = {name:'screen.png', mediaType:'image/png', data:'aQ=='}
  const ask = () => command.handler({agent,rawInput:JSON.stringify({mode:'chat', question:'', image})})
  assert.equal((await ask()).kind,'success')
  assert.deepEqual(parts,[{type:'image', ...image}])
  assert.deepEqual(request.messages.at(-1).content.at(-1),{type:'image',attachment:ref})
  modalities = ['text']
  request = undefined
  assert.match((await ask()).text,/仅支持文字/)
  assert.equal(request,undefined)
})

test('实时查询只执行声明的联网工具，拒绝模型伪造的写文件调用', async t => {
  const searches = []
  const web = {searchReady:async () => true, fetchReady:async () => true,
    async search(request) {
      searches.push(request)
      return {content:'深圳：多云', sources:[]}
    },
    async fetch({url}) { return {url, statusCode:200, body:{content:'天气预报'}} },
  }
  let rounds = 0
  const command = petChatCommand({get:key => key === 'web' ? web : undefined,
    llm:{async *stream(request) {
      if (++rounds === 1) {
        assert.deepEqual(request.tools.map(t => t.name), ['web_search','web_fetch'])
        for (const [id,name,args] of [['1','web_search',{query:'深圳今日天气'}],['2','write_file',{path:'test'}],
          ['3','web_fetch',{url:'file:///local'}],['4','web_fetch',{url:'https://example.org/forecast'}]]) {
          yield {type:'block-end',block:{type:'tool-call', id, name, arguments:JSON.stringify(args)}}
        }
        yield {type:'finish',reason:{kind:'tool-calls'}}
      } else {
        const results = request.messages.slice(-4)
        assert.deepEqual(results.map(r => r.isError),[false,true,true,false])
        assert.match(results[0].content[0].text,/多云/)
        assert.match(results[3].content[0].text,/天气预报/)
        yield {type:'text-delta',text:'深圳多云'}
        yield {type:'finish',reason:{kind:'stop'}}
      }
    }}},temporaryMemory(t))
  const agent = {session:{id:'weather'},model:{current:()=>({provider:'deepseek',model:'vision'})}}
  const reply = await command.handler({agent,rawInput:JSON.stringify({mode:'chat',question:'深圳今天的天气？'})})
  assert.equal(reply.text,'深圳多云')
  assert.deepEqual(searches,[{query:'深圳今日天气',maxResults:5,llmProvider:'deepseek'}])
})
