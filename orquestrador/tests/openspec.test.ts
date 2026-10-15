import { describe, expect, test } from 'claude-code/testing'

import { changeDir, openSpecView, parseEvidence, parseProposal, parseTaskItems, parseTasks, tasksForPhase } from '../hooks/openspec'

const TASKS = [
  '# Tasks: demo',
  '- [x] 0.1 before any section',
  '## 1. Setup',
  '- [x] 1.1 done',
  '- [ ] 1.2 open',
  '  - [X] 1.2.a nested, upper-case mark',
  '## 2. Notes',
  'prose only, no boxes',
  '## 3. **API** work',
  '- [ ] 3.1 open',
].join('\n')

describe('parseTasks', () => {
  test('counts boxes per section, drops sections without boxes and strips markdown', () => {
    const tasks = parseTasks(TASKS)
    expect(tasks.sections).toEqual([
      { title: 'Geral', done: 1, total: 1 },
      { title: '1. Setup', done: 2, total: 3 },
      { title: '3. API work', done: 0, total: 1 },
    ])
    expect([tasks.done, tasks.total]).toEqual([3, 5])
  })

  test('an empty file has nothing to count', () => {
    expect(parseTasks('')).toEqual({ sections: [], done: 0, total: 0 })
  })
})

describe('parseProposal', () => {
  test('takes the title and the first prose paragraph of Why, past sub-headings and tables', () => {
    const text = [
      '# Proposal: A terminal state',
      '',
      '**Change ID:** `x`',
      '',
      '## Why',
      '',
      '### Hypothesis',
      '',
      '| a | b |',
      '',
      'The owner reported **18** products stuck in `PENDING`.',
      '',
      '## What changes',
      'Later.',
    ].join('\n')
    expect(parseProposal(text)).toEqual({
      title: 'A terminal state',
      summary: 'The owner reported 18 products stuck in PENDING.',
    })
  })

  test('without a Why section it falls back to the first prose paragraph, past metadata', () => {
    expect(parseProposal('# T\n\n**Owner:** me\n\nPlain intro [link](x).').summary).toBe('Plain intro link.')
  })

  test('clips a long summary', () => {
    const summary = parseProposal(`## Why\n\n${'a'.repeat(900)}`).summary ?? ''
    expect(summary.length).toBe(420)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('parseEvidence', () => {
  const summary = (rows: string) => `## Verification\n\n\`\`\`\n== check summary ==\n${rows}\n\`\`\`\n`

  test('missing, stub and recorded', () => {
    expect(parseEvidence(undefined).state).toBe('missing')
    expect(parseEvidence('This is a **pre-execution stub**.').state).toBe('stub')
    expect(parseEvidence('## A\n## B\nnotes').state).toBe('recorded')
  })

  test('the last check.sh summary decides green or failing, even over an earlier stub line', () => {
    expect(parseEvidence(`Not run yet.\n${summary('PASS  repo:guard  0s\nPASS  api:test  3s')}`)).toEqual({
      state: 'green',
      summary: 'Último check.sh verde: 2 verificações passaram.',
    })
    const failing = parseEvidence(`${summary('PASS  a  0s')}\n${summary('PASS  a 0s\nFAIL  api:test  9s')}`)
    expect(failing.state).toBe('failing')
    expect(failing.summary).toContain('api:test')
  })
})

describe('openSpecView and changeDir', () => {
  test('a change with only tasks.md still reads', () => {
    const view = openSpecView({ tasks: TASKS, proposal: undefined, evidence: undefined })
    expect([view.done, view.total, view.evidence, view.proposalTitle]).toEqual([3, 5, 'missing', undefined])
  })

  test('a relative changePath lands under the coordinator checkout', () => {
    expect(changeDir('openspec/changes/x/', '/repo')).toBe('/repo/openspec/changes/x')
    expect(changeDir('./openspec/changes/x', '/repo')).toBe('/repo/openspec/changes/x')
    expect(changeDir('/abs/x', '/repo')).toBe('/abs/x')
  })
})

describe('tasks per phase', () => {
  const items = parseTaskItems(
    '## 4. Loja\n- [x] 4.1 Checkout\n- [ ] **4.2** Consentimento\n- [ ] 4.10 Testes\n- [ ] sem número\n## 5. Fim\n- [x] 5.1 Evidência\n',
  )

  test('reads each numbered box and skips the unnumbered one', () => {
    expect(items.map(i => i.id)).toEqual(['4.1', '4.2', '4.10', '5.1'])
    expect(items[1]).toEqual({ id: '4.2', text: 'Consentimento', done: false })
  })

  test('a range, a whole section, a single id and a list all resolve', () => {
    expect(tasksForPhase('4.1–4.2', items).map(i => i.id)).toEqual(['4.1', '4.2'])
    expect(tasksForPhase('4.2-4.10', items).map(i => i.id)).toEqual(['4.2', '4.10'])
    expect(tasksForPhase('4.x', items).map(i => i.id)).toEqual(['4.1', '4.2', '4.10'])
    expect(tasksForPhase('5.1, 4.1', items).map(i => i.id)).toEqual(['4.1', '5.1'])
    expect(tasksForPhase(undefined, items)).toEqual([])
    expect(tasksForPhase('9.x', items)).toEqual([])
  })
})
