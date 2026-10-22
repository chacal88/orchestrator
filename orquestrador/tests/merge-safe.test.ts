import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState, OrchestrationRun } from '../types'
import { parseFlow, startFlow } from '../hooks/flow'
import { findAgent } from '../hooks/flow-files'
import { defaultFlows } from '../hooks/flows/index'
import { mergeCalls, mergeSelector, opaqueMerge } from '../hooks/gates'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const BASE = '/h/.claude/orquestrador'

type World = { disk: Map<string, string>; heads: Record<string, string>; ran: string[] }

/** A coordinator at /w on main, an in-memory disk, `gh pr view <n>` answering from `heads`. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), heads: {}, ran: [] }
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($, e) => ({ value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => ({ value: w.disk.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...w.disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: now, isLink: false })) as never,
  }))
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv[0] === 'git' && argv.includes('branch')) return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } as never }
    if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'view') {
      const head = w.heads[String(argv[3])]
      return { value: (head === undefined ? { exitCode: 1, stdout: '', stderr: 'offline' } : { exitCode: 0, stdout: `${head}\n`, stderr: '' }) as never }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('tool.list', () => ({ value: [] as never }))
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'Bash') w.ran.push(String(input.command))
    return { result: 'ok', text: 'ok' } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

/** The change `demo` orchestrated, with its final gates pending and its flow on QA, the PR step citing #801. */
const orchestrated = (w: World, finalGates: string[] | undefined = ['check']) => {
  const run: OrchestrationRun = {
    change: 'demo', changePath: 'openspec/changes/demo', coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
    waves: [{
      title: undefined, summary: undefined, jira: undefined,
      phases: [{ id: 'A', title: 'Base', status: 'running', icon: undefined, tasks: '1.x', session: 'fase-a', dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: undefined }],
    }],
    ownerQuestions: [], finalGates, updatedAt: 1,
  }
  w.disk.set(`${BASE}/runs/demo.json`, JSON.stringify(run))
  const def = defaultFlows().find(f => f.id === 'rapido')!
  const { state } = startFlow(def, { change: 'demo', coordinatorCwd: '/w', changePath: 'openspec/changes/demo', visual: false }, 1)
  const parked: FlowState = { ...state, current: 'qa', records: { pr: { outcome: 'aberto', by: 'session', at: 5, note: 'PR aberto #801' } } }
  w.disk.set(`${BASE}/flows/demo.json`, JSON.stringify(parked))
  w.heads = { '801': 'claude/demo-pr', '805': 'claude/product-feed-purpose' }
}

const merge = async ($: Engine, command: string) => ((await $.tool.call({ tool: 'Bash', command } as never)) as Reply).deny

const ADMIN = /`--admin` skips the branch protection/
const GATES = /final gates of demo not passed: check \(pending\)/
const BLIND = /takes an argument from a variable or `\$\(…\)`: the mod cannot see what it carries/

// 6.1 — `--admin` read from the command as the shell runs it

test('--admin in quotes is refused', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'gh pr merge 805 "--admin"')).toMatch(ADMIN)
  expect(await merge($, "gh pr merge 805 '--admin' --squash")).toMatch(ADMIN)
})

test('--admin inside bash -c, sh -c and eval is refused', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'bash -c "gh pr merge 805 --admin"')).toMatch(ADMIN)
  expect(await merge($, "sh -c 'gh pr merge 805 --squash --admin'")).toMatch(ADMIN)
  expect(await merge($, 'eval "gh pr merge 805 --admin"')).toMatch(ADMIN)
  expect(await merge($, 'bash -lc "cd /w && gh pr merge 805 --admin"')).toMatch(ADMIN)
})

test('--admin after a line continuation is refused', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'gh pr merge 805 \\\n  --admin')).toMatch(ADMIN)
  expect(await merge($, 'gh pr merge 805 --squash \\\n  --delete-branch \\\n  --admin')).toMatch(ADMIN)
})

test('a merge with $VAR or $(…) in its arguments is refused: the mod cannot see what it carries', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'gh pr merge 805 $FLAGS')).toMatch(BLIND)
  expect(await merge($, 'gh pr merge 805 "$(echo --admin)"')).toMatch(BLIND)
  expect(await merge($, 'gh pr merge $PR --squash')).toMatch(BLIND)
  expect(await merge($, 'gh pr merge 805 `cat flags`')).toMatch(BLIND)
  // a merge run from a command substitution is still read
  expect(await merge($, 'echo $(gh pr merge 805 --admin)')).toMatch(ADMIN)
})

test('a plain merge still passes, and text that only mentions a merge is not one', async ($, on) => {
  const w = world(on)
  orchestrated(w, undefined)
  expect(await merge($, 'gh pr merge 805 --squash')).toBeUndefined()
  expect(await merge($, 'gh pr merge 805 --squash --delete-branch 2>&1')).toBeUndefined()
  expect(await merge($, 'echo "gh pr merge 805 --admin"')).toBeUndefined()
  expect(await merge($, "git commit -m 'gh pr merge 805 --admin is refused'")).toBeUndefined()
  expect(await merge($, "cat <<'EOF' > notes.md\ngh pr merge 805 --admin\nEOF")).toBeUndefined()
  expect(w.ran).toContain('gh pr merge 805 --squash')
})

// 6.2 — the other ways to merge a PR

test('gh with flags before pr is read as the same merge: review, gates and --admin', async ($, on) => {
  orchestrated(world(on))
  expect(await merge($, 'gh -R o/r pr merge 801 --squash')).toMatch(GATES)
  expect(await merge($, 'gh --repo o/r pr merge 801 --squash')).toMatch(GATES)
  expect(await merge($, 'gh --repo=o/r pr merge 805 --admin')).toMatch(ADMIN)
  expect(await merge($, 'gh -R o/r pr merge 805 --squash')).toBeUndefined()
})

test('gh api pulls/<n>/merge is a merge of PR <n>, whatever the method', async ($, on) => {
  orchestrated(world(on))
  expect(await merge($, 'gh api -X PUT repos/o/r/pulls/801/merge -f merge_method=squash')).toMatch(GATES)
  expect(await merge($, 'gh api --method PUT /repos/o/r/pulls/801/merge')).toMatch(GATES)
  expect(await merge($, 'gh api repos/{owner}/{repo}/pulls/801/merge')).toMatch(GATES)
  expect(await merge($, 'gh api -X PUT repos/o/r/pulls/$N/merge')).toMatch(BLIND)
  // another PR's merge through the API is not the change's
  expect(await merge($, 'gh api -X PUT repos/o/r/pulls/805/merge')).toBeUndefined()
})

test("gh api graphql with mergePullRequest is taken as the change's merge: its PR is a node id", async ($, on) => {
  orchestrated(world(on))
  const mutation = `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "PR_kw"}) { clientMutationId } }'`
  expect(await merge($, mutation)).toMatch(GATES)
})

test('the same rules hold inside bash -c, sh -c and eval', async ($, on) => {
  orchestrated(world(on))
  expect(await merge($, 'bash -c "gh -R o/r pr merge 801 --squash"')).toMatch(GATES)
  expect(await merge($, "sh -c 'gh api -X PUT repos/o/r/pulls/801/merge'")).toMatch(GATES)
  expect(await merge($, `eval "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'"`)).toMatch(GATES)
})

test('a gh api call that merges nothing passes', async ($, on) => {
  orchestrated(world(on))
  expect(await merge($, 'gh api repos/o/r/pulls/801')).toBeUndefined()
  expect(await merge($, 'gh api repos/o/r/pulls/801/files')).toBeUndefined()
  expect(await merge($, "gh api graphql -f query='{ repository(owner: \"o\", name: \"r\") { mergeCommitAllowed } }'")).toBeUndefined()
  expect(await merge($, 'gh api repos/o/r/branches/main/protection')).toBeUndefined()
})

// 8.1 — a merge the mod cannot read is refused, not let through

const OPAQUE = /runs a `gh` merge the mod cannot read/

test('a gh merge behind another program is refused: the guard fails closed', async ($, on) => {
  orchestrated(world(on), undefined)
  for (const command of [
    'echo 805 | xargs gh pr merge --admin',
    'find . -maxdepth 0 -exec gh pr merge 805 --admin \\;',
    'timeout 30 gh pr merge 805 --admin',
    'nice gh pr merge 805 --admin',
    'env -u X gh pr merge 805 --admin',
    'sudo -u root gh pr merge 805 --admin',
    'command -p gh pr merge 805 --admin',
  ]) expect(await merge($, command)).toMatch(OPAQUE)
})

test('a gh merge from a script on stdin or under a variable name is refused', async ($, on) => {
  orchestrated(world(on), undefined)
  for (const command of [
    "bash <<'EOF'\ngh pr merge 805 --admin\nEOF",
    "echo 'gh pr merge 805 --admin' | sh",
    "cat <<'EOF' | bash\ngh pr merge 805 --admin\nEOF",
    'G=gh; $G pr merge 805 --admin',
    '"$(command -v gh)" pr merge 805 --admin',
  ]) expect(await merge($, command)).toMatch(OPAQUE)
})

test('a gh call that only reads, and text that only mentions a merge, still pass', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'gh pr view 805 --json mergeable,mergeStateStatus')).toBeUndefined()
  expect(await merge($, 'cd /w && gh pr checks 805 && git log --oneline -1')).toBeUndefined()
  expect(await merge($, 'grep -n "gh pr merge" README.md')).toBeUndefined()
  expect(await merge($, "git commit -m \"$(cat <<'EOF'\ndocs: gh pr merge needs the review\nEOF\n)\"")).toBeUndefined()
  // outside an orchestrated checkout nothing is held back
  expect(opaqueMerge('timeout 30 gh pr merge 805')).toBe('timeout 30 gh pr merge 805')
  expect(opaqueMerge('gh pr view 805 --json mergeable')).toBeUndefined()
})

// guarda-merge-leitura — a loop or a reader is no hidden merge

test('a loop that only reads PRs, and other readers around gh, pass', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'for n in 12 13 14; do gh pr view $n --json mergeable,headRefName; done')).toBeUndefined()
  expect(await merge($, 'while read n; do gh pr view "$n" --json mergeStateStatus; done < prs.txt')).toBeUndefined()
  expect(await merge($, 'gh pr list --json number,mergeable | jq ".[] | .number"')).toBeUndefined()
  // a script file written and run on the same line, with no readable merge, is still refused
  expect(await merge($, "cat > m.sh <<'EOF'\ngh pr merge 805 --admin\nEOF\nbash m.sh")).toMatch(OPAQUE)
  expect(await merge($, "cat > m.py <<'EOF'\nimport os; os.system('gh pr merge 805 --admin')\nEOF\npython3 m.py")).toMatch(OPAQUE)
  // a loop that merges is still refused
  expect(await merge($, 'for n in 805; do gh pr merge $n --admin; done')).toBeDefined()
  expect(await merge($, 'for n in 805; do echo $n | xargs gh pr merge --admin; done')).toMatch(OPAQUE)
})

// 9.1 — a readable merge does not cover a hidden one beside it

test('a hidden merge next to a readable one is still refused, command by command', async ($, on) => {
  orchestrated(world(on), undefined)
  expect(await merge($, 'gh pr merge 805 --squash && echo 805 | xargs gh pr merge --admin')).toMatch(OPAQUE)
  expect(await merge($, 'cp a b; gh pr merge 805 --squash; timeout 5 gh pr merge 805 --admin')).toMatch(OPAQUE)
  expect(await merge($, "gh pr merge 805 --squash\nbash <<'EOF'\ngh pr merge 805 --admin\nEOF")).toMatch(OPAQUE)
  expect(await merge($, 'gh pr merge 805 --squash && G=gh && $G pr merge 805 --admin')).toMatch(OPAQUE)
  // a readable merge with ordinary commands around it passes
  expect(await merge($, 'git pull && gh pr merge 805 --squash && npm test')).toBeUndefined()
  expect(await merge($, 'gh pr merge 805 --squash && bash scripts/after-merge-check.sh')).toBeUndefined()
})

// 9.2 — git runs commands of its own

test('a git that runs a command is not inert: alias with !, rebase --exec, filter-branch, bisect run', async ($, on) => {
  orchestrated(world(on), undefined)
  for (const command of [
    "git -c alias.x='!gh pr merge 805 --admin' x",
    "git rebase -i main --exec 'gh pr merge 805 --admin'",
    "git rebase main -x 'gh pr merge 805 --admin'",
    "git filter-branch --tree-filter 'gh pr merge 805 --admin' HEAD",
    "git bisect run sh -c 'gh pr merge 805 --admin'",
  ]) expect(await merge($, command)).toMatch(OPAQUE)
  expect(await merge($, "git commit -m 'gh pr merge needs the review'")).toBeUndefined()
  expect(await merge($, 'git log --grep "gh pr merge" --oneline')).toBeUndefined()
  expect(await merge($, 'git add -A && git commit -m "merge gh docs" && git push')).toBeUndefined()
})

test('the merge calls a command line runs, and the PR each names', () => {
  expect(mergeCalls('gh pr merge 5 --squash').map(c => [c.via, c.selector, c.admin, c.dynamic])).toEqual([['pr', '5', false, false]])
  expect(mergeCalls('gh -R o/r pr merge feat/x -d').map(c => c.selector)).toEqual(['feat/x'])
  expect(mergeCalls('gh api -X PUT repos/o/r/pulls/12/merge').map(c => [c.via, c.selector])).toEqual([['api', '12']])
  expect(mergeCalls('git pull && bash -c "gh pr merge 3" && gh pr merge 4 --admin').map(c => [c.selector, c.admin])).toEqual([
    ['3', false],
    ['4', true],
  ])
  expect(mergeCalls('gh pr view 5 && gh pr checks 5')).toEqual([])
  expect(mergeSelector('gh pr merge --squash')).toBeUndefined()
})

// 6.3 — agent names

test('an agent name that is not lowercase words joined by hyphens fails the parse, naming the step', () => {
  const parse = (agent: string) =>
    parseFlow({ id: 'x', title: 'X', steps: [{ id: 'a', title: 'A', kind: 'session', agent, outcomes: { ok: 'fim' } }] }, 'x.json')
  expect((parse('../x') as { error?: string }).error).toBe(
    'x.json: step "a": `agent` "../x" must be lowercase words joined by hyphens (a-z, 0-9, -), the name of a file in agents/.',
  )
  expect((parse('Revisor') as { error?: string }).error).toMatch(/step "a": `agent` "Revisor"/)
  expect((parse('a--b') as { error?: string }).error).toMatch(/lowercase words/)
  expect((parse('revisor-codigo-2') as { error?: string }).error).toBeUndefined()
})

test('findAgent builds no path from a name that is not one', async () => {
  const asked: string[] = []
  const engine = {
    session: { root: async () => '/w' },
    plugin: { root: '/p' },
    fs: {
      exists: async (path: string) => {
        asked.push(path)
        return true
      },
    },
  } as never
  expect(await findAgent(engine, '../x')).toBeUndefined()
  expect(await findAgent(engine, 'x/../../etc')).toBeUndefined()
  expect(asked).toEqual([])
  expect(await findAgent(engine, 'revisor')).toEqual({ source: 'project', path: '/w/.orquestrador/agents/revisor.md' })
})
