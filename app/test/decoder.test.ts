import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Decoder, newTurn, callSubject } from '@/wire/decoder'

const fixture = readFileSync(join(__dirname, 'fixtures/stream.jsonl'), 'utf8').split('\n').filter(Boolean)

describe('decoder', () => {
  it('turns a captured claude stream into one text step with usage', () => {
    const t = newTurn('Reply with exactly: hi')
    const d = new Decoder(t)
    for (const l of fixture) d.feed(l)
    expect(t.session).toBe('51a6dbcf-8dbb-470f-9149-33df44269df5')
    expect(t.steps).toHaveLength(1)
    expect(t.steps[0]).toMatchObject({ kind: 'text', text: 'hi' })
    expect(t.usage?.output).toBe(4)
    expect(t.usage?.costUsd).toBeGreaterThan(0)
    expect(t.error).toBeUndefined()
  })

  it('builds a tool call from deltas and closes it with the tool result', () => {
    const t = newTurn('x')
    const d = new Decoder(t)
    const lines = [
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"aws glue ' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'get-jobs"}' } } },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'aws glue get-jobs' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '{"Jobs":[]}' }], is_error: false }] } },
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'No jobs.' } } },
      { type: 'result', usage: { output_tokens: 9 }, total_cost_usd: 0.01, is_error: false },
    ]
    for (const l of lines) d.feed(JSON.stringify(l))
    expect(t.steps).toHaveLength(2)
    const call = t.steps[0]
    expect(call.kind).toBe('call')
    if (call.kind !== 'call') throw new Error()
    expect(call.done).toBe(true)
    expect(call.result).toBe('{"Jobs":[]}')
    expect(callSubject(call)).toBe('aws glue get-jobs')
    expect(t.steps[1]).toMatchObject({ kind: 'text', text: 'No jobs.' })
    expect(t.usage?.output).toBe(9)
  })

  it('ignores garbage lines and reports an error result', () => {
    const t = newTurn('x')
    const d = new Decoder(t)
    d.feed('not json')
    d.feed(JSON.stringify({ type: 'result', is_error: true, result: 'boom' }))
    expect(t.steps).toHaveLength(0)
    expect(t.error).toBe('boom')
  })
})
