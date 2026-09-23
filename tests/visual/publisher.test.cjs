const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const publish = require('../../.github/scripts/visual-publish.cjs');

const HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
const CAPTURED_AT = '2026-09-23T00:00:00Z';
const POSTED_AT = '2026-09-23T00:05:00Z';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const SETUP_FILE = {filename: 'tests/visual/run.ts', status: 'modified'};

function comment({head = HEAD, run = 123, attempt = 1, time = POSTED_AT, id = 42,
  part = 1, total = 1, created = time} = {}) {
  return {id, html_url: `https://github.com/o/r/pull/215#issuecomment-${id}`,
    created_at: created,
    user: {login: 'github-actions[bot]', type: 'Bot'},
    body: `### Visual review\n<!-- flora-visual-review:${head}:${run}:${attempt}:${time}:part=${part}:total=${total}:mode=comment -->\n\n` +
      (part === 1 ? 'Add a PR comment containing exactly **visuals ok**.' : '')};
}

function decision({id = 60, user = 'maintainer', body = 'visuals ok',
  created = '2026-09-23T00:06:00Z'} = {}) {
  return {id, user: {login: user, type: 'User'}, body, created_at: created};
}

async function scenario({changed = false, files = [], comments = [], failure = false,
  event = 'Visual evidence', head = HEAD, runHead = head, attempt = 1, changedFiles = files.length,
  results, authorBody = 'Author description.', permission = 'write', storeDefault = false,
  branchExists = false, evidenceRace = false, racedReads = {}, baselineBytes = PNG,
  headRepo = 'o/r'} = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flora-publisher-test-'));
  const previous = {VISUAL_PR: process.env.VISUAL_PR, VISUAL_RUN_ID: process.env.VISUAL_RUN_ID,
    VISUAL_REPORT_DIR: process.env.VISUAL_REPORT_DIR};
  process.env.VISUAL_PR = '215';
  process.env.VISUAL_RUN_ID = '123';
  process.env.VISUAL_REPORT_DIR = temp;
  const rows = results ?? [{name: 'fixture', status: 'pass', detail: '0 px differ', changed}];
  if (!failure) {
    fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify(rows));
    for (const row of rows) {
      fs.writeFileSync(path.join(temp, `${row.name}.actual.png`), PNG);
      fs.writeFileSync(path.join(temp, `${row.name}.before.png`), PNG);
    }
  }
  const pr = {number: 215, state: 'open', changed_files: changedFiles, body: authorBody,
    user: {login: 'pr-author'},
    head: {sha: head, ref: 'feature', repo: {full_name: headRepo}},
    base: {sha: 'c'.repeat(40), repo: {full_name: 'o/r'}}};
  const run = {id: 123, head_sha: runHead, head_repository: {full_name: headRepo},
    conclusion: failure ? 'failure' : 'success', run_attempt: attempt,
    updated_at: CAPTURED_AT, html_url: 'https://github.com/o/r/actions/runs/123'};
  const posted = [], deleted = [], bodyUpdates = [], statuses = [], stored = [], gitCalls = [], dispatches = [];
  let prReads = 0;
  let refReads = 0, refWrites = 0;
  const readPr = () => {
    const override = racedReads[++prReads] ?? {};
    return {...pr, ...override, head: override.head ? {...pr.head, ...override.head} : pr.head};
  };
  const methods = {files: () => files, comments: () => comments};
  const github = {paginate: async method => methods[method](), rest: {
    pulls: {get: async () => ({data: readPr()}), listFiles: 'files',
      update: async input => {bodyUpdates.push(input.body); return {data: {...pr, body: input.body}};}},
    actions: {getWorkflowRun: async () => ({data: run}),
      createWorkflowDispatch: async input => {dispatches.push(input);}},
    issues: {listComments: 'comments', deleteComment: async input => {deleted.push(input.comment_id);},
      createComment: async input => ({data: {...comment({id: 80}), body: input.body}})},
    repos: {createCommitStatus: async input => {statuses.push(input);},
      getCollaboratorPermissionLevel: async () => ({data: {permission}}),
      getContent: async () => ({data: {encoding: 'base64', content: baselineBytes.toString('base64')}})},
    git: {
      getCommit: async () => ({data: {tree: {sha: 'parent-tree'}, parents: [{sha: HEAD}]}}),
      createBlob: async input => {gitCalls.push(['blob', input]); return {data: {sha: `blob-${gitCalls.length}`}};},
      createTree: async input => {gitCalls.push(['tree', input]); return {data: {sha: 'tree-sha'}};},
      getRef: async () => {
        if (branchExists) return {data: {object: {sha: (evidenceRace && refReads++ ? 'f' : 'd').repeat(40)}}};
        const error = new Error('missing'); error.status = 404; throw error;
      },
      createCommit: async input => {gitCalls.push(['commit', input]); return {data: {sha: 'e'.repeat(40)}};},
      createRef: async input => {gitCalls.push(['ref', input]);},
      updateRef: async input => {
        gitCalls.push(['update', input]);
        if (evidenceRace && refWrites++ === 0) {
          const error = new Error('non-fast-forward'); error.status = 422; throw error;
        }
      },
    },
  }};
  let result;
  try {
    const options = {github, context: {repo: {owner: 'o', repo: 'r'},
      eventName: event === 'Visual evidence' ? 'workflow_run' : 'issue_comment',
      payload: event === 'Visual evidence' ? {workflow_run: {name: event}} : {issue: {number: 215}}},
      now: () => POSTED_AT,
      postComment: async input => {
        posted.push(input);
        return {...comment({id: 81 + posted.length}), body: input.body};
      }};
    if (!storeDefault) options.storeImages = async input => {
      stored.push(input);
      return new Map(input.files.map(file => [file,
        `https://raw.githubusercontent.com/o/r/${'e'.repeat(40)}/${path.basename(file)}`]));
    };
    await publish(options);
    result = {posted, deleted, bodyUpdates, stored, gitCalls, dispatches, status: statuses.at(-1)};
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(temp, {recursive: true, force: true});
  }
  return result;
}

test('visual evidence is reviewed in the PR', async t => {
  await t.test('unmodified visuals need no review comment', async () => {
    const result = await scenario();
    assert.equal(result.status.state, 'success');
    assert.equal(result.posted.length, 0);
  });

  await t.test('changed capture posts inline before/after images and waits for a review', async () => {
    const result = await scenario({changed: true});
    assert.equal(result.status.state, 'pending');
    assert.equal(result.status.target_url, 'https://github.com/o/r/pull/215#issuecomment-82');
    assert.equal(result.posted.length, 1);
    assert.equal(result.stored[0].files.length, 2);
    assert.match(result.posted[0].body, /\| Base \| PR \|/);
    assert.match(result.posted[0].body, /raw\.githubusercontent\.com\/o\/r\//);
    assert.doesNotMatch(result.posted[0].body, /\/private\/tmp\//);
    assert.match(result.posted[0].body, /containing exactly \*\*visuals ok\*\*/);
    assert.doesNotMatch(result.posted[0].body, /Download visual report|artifacts\/123/);
  });

  await t.test('only a fresh authorized human comment clears the pending status', async () => {
    const confirmed = await scenario({files: [SETUP_FILE], event: 'Visual comment',
      comments: [comment(), decision()]});
    assert.equal(confirmed.posted.length, 0);
    assert.equal(confirmed.status.state, 'success');
    assert.match(confirmed.status.description, /maintainer/);
    for (const candidate of [
      decision({created: '2026-09-23T00:04:00Z'}),
      decision({body: 'Looks good, visuals ok'}),
      {...decision(), user: {login: 'bot', type: 'Bot'}},
    ]) {
      assert.equal((await scenario({files: [SETUP_FILE], event: 'Visual comment',
        comments: [comment(), candidate]})).status.state, 'pending');
    }
    assert.equal((await scenario({files: [SETUP_FILE], event: 'Visual comment',
      comments: [comment(), decision()], permission: 'read'})).status.state, 'pending');
    assert.equal((await scenario({files: [SETUP_FILE], event: 'Visual comment',
      comments: [comment(), decision({body: '  VISUALS OK  '})]})).status.state, 'success');
    assert.equal((await scenario({files: [SETUP_FILE], event: 'Visual comment',
      comments: [comment(), decision({created: POSTED_AT})]})).status.state, 'success');
    assert.equal((await scenario({files: [SETUP_FILE], event: 'Visual comment',
      comments: [comment(), decision({user: 'pr-author'})]})).status.state, 'success');
  });

  await t.test('editing, deleting, or objecting revokes visual confirmation', async () => {
    for (const comments of [
      [comment()],
      [comment(), decision({body: 'Needs work'})],
      [comment(), decision(), decision({id: 61, body: 'visuals not ok', created: '2026-09-23T00:07:00Z'})],
      [comment(), decision(), decision({id: 61, user: 'second-maintainer', body: 'visuals not ok',
        created: '2026-09-23T00:07:00Z'})],
    ]) {
      const result = await scenario({files: [SETUP_FILE], event: 'Visual comment', comments});
      assert.equal(result.status.state, 'pending');
    }
  });

  await t.test('author confirmation commits captured PNGs to the PR and verifies the next run', async () => {
    const approved = await scenario({changed: true, event: 'Visual comment',
      comments: [comment(), decision({user: 'pr-author'})]});
    assert.equal(approved.status.sha, 'e'.repeat(40));
    assert.equal(approved.status.state, 'pending');
    assert.equal(approved.dispatches.length, 1);
    assert.equal(approved.dispatches[0].ref, 'feature');
    assert.equal(approved.dispatches[0].inputs.pr, '215');
    const tree = approved.gitCalls.find(([name]) => name === 'tree')[1];
    assert.equal(tree.base_tree, 'parent-tree');
    assert.equal(tree.tree[0].path, 'tests/visual/baselines/fixture.png');
    assert.match(approved.posted[0].body, /Approved visual baselines committed/);
    const receipt = {...comment({id: 99}), body: approved.posted[0].body};
    const next = await scenario({changed: true, head: 'e'.repeat(40),
      comments: [comment(), decision({user: 'pr-author'}), receipt]});
    assert.equal(next.status.state, 'success');
    assert.equal(next.posted.length, 0);
    const revoked = await scenario({changed: true, head: 'e'.repeat(40),
      event: 'Visual comment', comments: [comment(), receipt]});
    assert.equal(revoked.status.state, 'pending');
    const mismatch = await scenario({changed: true, head: 'e'.repeat(40),
      comments: [comment(), decision({user: 'pr-author'}), receipt],
      baselineBytes: Buffer.from('different')});
    assert.equal(mismatch.status.state, 'pending');
    assert.equal(mismatch.posted.length, 1);
    const fork = await scenario({changed: true, event: 'Visual comment', headRepo: 'fork/r',
      comments: [comment(), decision({user: 'pr-author'})]});
    assert.equal(fork.status.state, 'pending');
    assert.match(fork.status.description, /same repository|this repository/);
    assert.equal(fork.dispatches.length, 0);
  });

  await t.test('new capture or commit requires new evidence and confirmation', async () => {
    for (const options of [{attempt: 2}, {head: NEW_HEAD}]) {
      const result = await scenario({files: [SETUP_FILE], event: 'Visual comment',
        comments: [comment(), decision()],
        ...options});
      assert.equal(result.status.state, 'failure');
    }
    assert.equal((await scenario({changed: true, runHead: NEW_HEAD})).status, undefined);
  });

  await t.test('committed images and setup diff appear in the comment', async () => {
    const result = await scenario({files: [
      {filename: 'tests/visual/baselines/new.png', status: 'added'},
      {filename: 'tests/visual/run.ts', status: 'modified'},
    ]});
    assert.equal(result.status.state, 'pending');
    assert.match(result.posted[0].body, /raw\.githubusercontent\.com\/o\/r\//);
    assert.match(result.posted[0].body, /capture setup diff/);
    assert.match(result.posted[0].body, /tests\/visual\/run\.ts/);
    assert.equal(result.stored[0].files.length, 0);
  });

  await t.test('setup-only changes show captured examples and incomplete listings require review', async () => {
    const setup = await scenario({files: [{filename: 'tests/visual/run.ts', status: 'modified'}]});
    assert.equal(setup.status.state, 'pending');
    assert.equal(setup.stored[0].files.length, 1);
    const incomplete = await scenario({changedFiles: 3});
    assert.equal(incomplete.status.state, 'pending');
    assert.match(incomplete.posted[0].body, /only 0 were returned/);
  });

  await t.test('large visual changes are split into complete PR comment parts', async () => {
    const rows = Array.from({length: 25}, (_, i) => ({name: `page-${i}`, status: 'pass',
      detail: 'changed', changed: true}));
    const result = await scenario({results: rows});
    assert.equal(result.posted.length, 2);
    assert.equal(result.stored[0].files.length, 50);
    assert.equal((result.posted[0].body.match(/raw\.githubusercontent\.com/g) ?? []).length, 40);
    assert.equal((result.posted[1].body.match(/raw\.githubusercontent\.com/g) ?? []).length, 10);
    assert.match(result.posted[0].body, /\(1\/2\)/);
    assert.match(result.posted[1].body, /\(2\/2\)/);
    assert.equal(result.status.state, 'pending');
    const incomplete = await scenario({results: rows, event: 'Visual comment',
      comments: [comment({total: 2}), decision()]});
    assert.equal(incomplete.status.state, 'failure');
    const complete = await scenario({results: rows, event: 'Visual comment',
      comments: [comment({total: 2}), comment({id: 43, part: 2, total: 2}), decision()]});
    assert.equal(complete.status.state, 'pending');
    assert.equal(complete.dispatches.length, 1);
  });

  await t.test('failed or malformed captures cannot be approved', async () => {
    const failure = await scenario({failure: true});
    assert.equal(failure.status.state, 'failure');
    assert.match(failure.posted[0].body, /Visual capture failed/);
    const duplicate = await scenario({results: [
      {name: 'same', status: 'pass', detail: '0 px differ'},
      {name: 'same', status: 'pass', detail: '0 px differ'},
    ]});
    assert.equal(duplicate.status.state, 'failure');
  });

  await t.test('image storage writes a commit on the evidence branch', async () => {
    const result = await scenario({changed: true, storeDefault: true});
    assert.deepEqual(result.gitCalls.map(([name]) => name), ['blob', 'blob', 'tree', 'commit', 'ref']);
    const tree = result.gitCalls.find(([name]) => name === 'tree')[1].tree;
    assert.equal(tree.length, 2);
    assert.ok(tree.every(entry => entry.path.startsWith(`pr-215/${HEAD}-123-1/`)));
    assert.match(result.posted[0].body, new RegExp(`raw\\.githubusercontent\\.com/o/r/${'e'.repeat(40)}/pr-215/`));
    const next = await scenario({changed: true, storeDefault: true, branchExists: true});
    assert.deepEqual(next.gitCalls.map(([name]) => name), ['blob', 'blob', 'tree', 'commit', 'update']);
    assert.deepEqual(next.gitCalls.find(([name]) => name === 'commit')[1].parents, ['d'.repeat(40)]);
    assert.equal(next.gitCalls.find(([name]) => name === 'tree')[1].base_tree, 'parent-tree');
    const raced = await scenario({changed: true, storeDefault: true,
      branchExists: true, evidenceRace: true});
    assert.deepEqual(raced.gitCalls.filter(([name]) => name === 'commit')
      .map(([, input]) => input.parents[0]), ['d'.repeat(40), 'f'.repeat(40)]);
    assert.equal(raced.gitCalls.filter(([name]) => name === 'update').length, 2);
  });

  await t.test('replaces old bot evidence and removes the PR-body checklist', async () => {
    const body = 'Author text.\n\n<!-- flora-visual:start -->\n### Visual review\n' +
      '<!-- flora-visual:evidence:old:123:1:old -->\n- [ ] checkbox\n<!-- flora-visual:end -->';
    const legacy = {...comment({run: 99, id: 8})};
    legacy.body = legacy.body.replace(':total=1:mode=comment', '');
    const result = await scenario({changed: true,
      comments: [comment({run: 99, id: 7}), legacy], authorBody: body});
    assert.deepEqual(result.deleted, [7, 8]);
    assert.equal(result.bodyUpdates.length, 1);
    assert.equal(result.bodyUpdates[0], 'Author text.');
  });

  await t.test('replaces current-head evidence that still asks for an approval review', async () => {
    const old = {...comment({id: 7})};
    old.body = old.body.replace(':mode=comment', '').replace('Add a PR comment containing exactly **visuals ok**.',
      'Submit a GitHub **Approve** review.');
    const result = await scenario({changed: true, comments: [old]});
    assert.equal(result.posted.length, 1);
    assert.deepEqual(result.deleted, [7]);
    assert.match(result.posted[0].body, /containing exactly \*\*visuals ok\*\*/);
  });

  await t.test('a moved head or concurrent PR-body edit is preserved', async () => {
    const moved = await scenario({changed: true, racedReads: {2: {head: {sha: NEW_HEAD}}}});
    assert.equal(moved.posted.length, 0);
    assert.equal(moved.status, undefined);
    const body = 'Author text.\n\n<!-- flora-visual:start -->\n### Visual review\n' +
      '<!-- flora-visual:evidence:old:123:1:old -->\nold\n<!-- flora-visual:end -->';
    const edited = await scenario({changed: true, authorBody: body,
      racedReads: {3: {body: body + '\nNew author note.'}}});
    assert.equal(edited.posted.length, 1);
    assert.equal(edited.bodyUpdates.length, 0);
    assert.equal(edited.status.state, 'pending');
  });
});
