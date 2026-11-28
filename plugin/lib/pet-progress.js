// The host assigns monotonic seqs and pairs tool results by callId within a turn.
function clipped(text, limit) {
  if (text.length <= limit) return text
  const head = Math.floor(limit / 3)
  return text.slice(0, head) + '\n…\n' + text.slice(-(limit - head))
}

function content(data) {
  return ((data.message ?? data).content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
}

function argsText(data) {
  return typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})
}

function commandLabel(call) {
  if (!call) return ''
  try {
    const args = JSON.parse(argsText(call))
    const label = args.command ?? args.cmd ?? args.script ?? args.path ?? args.query
    if (typeof label === 'string') return clipped(label, 160)
  } catch { /* An incomplete call can still be shown verbatim. */ }
  return clipped(argsText(call), 160)
}

export function sessionActivity(events) {
  const calls = new Map(), entries = [], steps = []
  let goal = '', currentTurn
  for (const [index, event] of events.entries()) {
    const {type, data} = event
    const seq = event.seq ?? index
    if (data.turn !== undefined) currentTurn = data.turn
    if (type === 'turn/start' || type === 'turn/end') {
      entries.push([type, data.turn, data.reason?.kind])
      if (type === 'turn/end') {
        for (const [key, pending] of calls) {
          if (pending.call.turn !== data.turn) continue
          steps[pending.step].status = 'unconfirmed'
          calls.delete(key)
        }
      }
    } else if (type === 'user/message' || type === 'assistant/message') {
      const text = clipped(content(data), 450)
      if (text) entries.push([type, text])
      if (type === 'user/message' && text) goal = text
    } else if (type === 'todo/write') {
      entries.push([type, data.todos.slice(0, 8).map(t => [t.status, clipped(t.content, 250)])])
    } else if (type === 'goal/change') {
      entries.push([type, data.operation, data.goal?.phase, data.goal?.objective && clipped(data.goal.objective, 450)])
    } else if (type === 'tool/call' || type === 'tool/result') {
      const result = type === 'tool/result'
      const id = data.callId ?? data.message?.toolCallId ?? data.message?.source?.callId ?? data.message?.callId
      const key = JSON.stringify([data.turn, id])
      const previous = result && id != null ? calls.get(key) : undefined
      const call = result ? previous?.call : data
      const output = result ? content(data).trimEnd() : ''
      const marker = /\[(?:exit code:\s*|shell exited: code\s+)(-?\d+)\]$/i.exec(output)
      const failed = result && (data.error || data.message?.isError || (marker && Number(marker[1]) !== 0))
      const tail = output.slice(-350)
      const interrupted = /(?:^|\n)\[(?:timed out after |stopped: |(?:shell )?killed by signal: )[^\]]+\](?:\n\[exit code: -?\d+\])?$/.test(tail)
      const ongoing = /(?:^|\n)(?:\[still running after [^\]]+\]|started background job \S+)$/.test(tail)
      const status = !result || ongoing ? 'running' : interrupted ? 'interrupted' : failed ? 'failed' : 'completed'
      const reason = [data.error?.code ?? data.error?.name, data.error?.reason].filter(Boolean).join(' · ')
      const step = {tool:call?.name ?? 'tool', command:commandLabel(call), status, turn:data.turn,
        callSeq:result ? previous?.seq : seq, resultSeq:result ? seq : undefined,
        output:clipped([output, reason].filter(Boolean).join('\n'), 600)}
      // Emit a paired record at result time, including for interleaved parallel calls.
      if (previous) { entries[previous.entry] = null; steps[previous.step] = null; calls.delete(key) }
      if (!result) calls.set(key, {call, seq, entry:entries.length, step:steps.length})
      entries.push([type, step])
      steps.push(step)
    }
  }
  const recent = steps.filter(Boolean)
  const evidence = recent.slice(-3)
  const failed = recent.findLast(s => s.turn === currentTurn && s.status === 'failed')
  if (failed && !evidence.includes(failed)) evidence.unshift(failed)
  return {entries:entries.filter(Boolean), evidence:evidence.reverse(), goal}
}

export function originalToolLog(events, seq) {
  const event = events.find((e, i) => (e.seq ?? i) === seq)
  if (event?.type === 'tool/call') return argsText(event.data)
  if (event?.type === 'tool/result') {
    const {error} = event.data
    return [content(event.data), error && JSON.stringify(error)].filter(Boolean).join('\n')
  }
}
