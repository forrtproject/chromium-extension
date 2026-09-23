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

function comment({head = HEAD, run = 123, attempt = 1, time = POSTED_AT, id = 42} = {}) {
  return {id, html_url: `https://github.com/o/r/pull/215#issuecomment-${id}`,
    user: {login: 'github-actions[bot]', type: 'Bot'},
    body: `### Visual review\n<!-- flora-visual-review:${head}:${run}:${attempt}:${time}:part=1 -->`};
}

async function scenario({changed = false, files = [], reviews = [], comments = [], failure = false,
  event = 'Visual evidence', head = HEAD, runHead = head, attempt = 1, changedFiles = files.length,
  results, authorBody = 'Author description.', permission = 'write'} = {}) {
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
    head: {sha: head, repo: {full_name: 'o/r'}},
    base: {sha: 'c'.repeat(40), repo: {full_name: 'o/r'}}};
  const run = {id: 123, head_sha: runHead, head_repository: {full_name: 'o/r'},
    conclusion: failure ? 'failure' : 'success', run_attempt: attempt,
    updated_at: CAPTURED_AT, html_url: 'https://github.com/o/r/actions/runs/123'};
  const posted = [], deleted = [], bodyUpdates = [], statuses = [];
  const methods = {files: () => files, comments: () => comments, reviews: () => reviews};
  const github = {paginate: async method => methods[method](), rest: {
    pulls: {get: async () => ({data: pr}), listFiles: 'files', listReviews: 'reviews',
      update: async input => {bodyUpdates.push(input.body); return {data: {...pr, body: input.body}};}},
    actions: {getWorkflowRun: async () => ({data: run})},
    issues: {listComments: 'comments', deleteComment: async input => {deleted.push(input.comment_id);},
      createComment: async input => ({data: {...comment({id: 80}), body: input.body}})},
    repos: {createCommitStatus: async input => {statuses.push(input);},
      getCollaboratorPermissionLevel: async () => ({data: {permission}})},
  }};
  let result;
  try {
    await publish({github, context: {repo: {owner: 'o', repo: 'r'},
      eventName: 'workflow_run', payload: {workflow_run: {name: event}}},
      now: () => POSTED_AT,
      postComment: async input => {
        posted.push(input);
        return {...comment({id: 81 + posted.length}), body: input.body};
      }});
    result = {posted, deleted, bodyUpdates, status: statuses.at(-1)};
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
    assert.equal(result.posted[0].attachments.length, 2);
    assert.match(result.posted[0].body, /\| Base \| PR \|/);
    assert.match(result.posted[0].body, /submit a GitHub \*\*Approve\*\* review/);
    assert.doesNotMatch(result.posted[0].body, /Download visual report|artifacts\/123/);
  });

  await t.test('fresh authorized approval clears the pending status', async () => {
    const approved = await scenario({changed: true, event: 'Visual review decision',
      comments: [comment()], reviews: [{user: {login: 'maintainer', type: 'User'},
        commit_id: HEAD, submitted_at: '2026-09-23T00:06:00Z', state: 'APPROVED'}]});
    assert.equal(approved.posted.length, 0);
    assert.equal(approved.status.state, 'success');
    assert.match(approved.status.description, /maintainer/);
    for (const review of [
      {user: {login: 'maintainer', type: 'User'}, commit_id: HEAD, submitted_at: '2026-09-23T00:04:00Z', state: 'APPROVED'},
      {user: {login: 'maintainer', type: 'User'}, commit_id: NEW_HEAD, submitted_at: '2026-09-23T00:06:00Z', state: 'APPROVED'},
      {user: {login: 'bot', type: 'Bot'}, commit_id: HEAD, submitted_at: '2026-09-23T00:06:00Z', state: 'APPROVED'},
    ]) {
      assert.equal((await scenario({changed: true, event: 'Visual review decision',
        comments: [comment()], reviews: [review]})).status.state, 'pending');
    }
    assert.equal((await scenario({changed: true, event: 'Visual review decision',
      comments: [comment()], permission: 'read', reviews: [{user: {login: 'reader', type: 'User'},
        commit_id: HEAD, submitted_at: '2026-09-23T00:06:00Z', state: 'APPROVED'}]})).status.state, 'pending');
    assert.equal((await scenario({changed: true, event: 'Visual review decision',
      comments: [comment({time: '2026-09-23T00:05:00.500Z'})], reviews: [{user: {login: 'maintainer', type: 'User'},
        commit_id: HEAD, submitted_at: '2026-09-23T00:05:00Z', state: 'APPROVED'}]})).status.state, 'success');
  });

  await t.test('later change request or dismissed approval revokes that reviewer', async () => {
    const approval = {user: {login: 'maintainer', type: 'User'}, commit_id: HEAD,
      submitted_at: '2026-09-23T00:06:00Z', state: 'APPROVED'};
    for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) {
      const result = await scenario({changed: true, event: 'Visual review decision', comments: [comment()],
        reviews: [approval, {...approval, submitted_at: '2026-09-23T00:07:00Z', state}]});
      assert.equal(result.status.state, 'pending');
    }
  });

  await t.test('new capture or commit requires new evidence and approval', async () => {
    for (const options of [{attempt: 2}, {head: NEW_HEAD}]) {
      const result = await scenario({changed: true, event: 'Visual review decision',
        comments: [comment()], reviews: [{user: {login: 'maintainer', type: 'User'},
          commit_id: options.head ?? HEAD, submitted_at: '2026-09-23T00:06:00Z', state: 'APPROVED'}],
        ...options});
      assert.equal(result.status.state, 'pending');
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
    assert.equal(result.posted[0].attachments.length, 0);
  });

  await t.test('setup-only changes show captured examples and incomplete listings require review', async () => {
    const setup = await scenario({files: [{filename: 'tests/visual/run.ts', status: 'modified'}]});
    assert.equal(setup.status.state, 'pending');
    assert.equal(setup.posted[0].attachments.length, 1);
    const incomplete = await scenario({changedFiles: 3});
    assert.equal(incomplete.status.state, 'pending');
    assert.match(incomplete.posted[0].body, /only 0 were returned/);
  });

  await t.test('large visual changes are split into complete PR comment parts', async () => {
    const rows = Array.from({length: 25}, (_, i) => ({name: `page-${i}`, status: 'pass',
      detail: 'changed', changed: true}));
    const result = await scenario({results: rows});
    assert.equal(result.posted.length, 2);
    assert.deepEqual(result.posted.map(p => p.attachments.length), [40, 10]);
    assert.match(result.posted[0].body, /\(1\/2\)/);
    assert.match(result.posted[1].body, /\(2\/2\)/);
    assert.equal(result.status.state, 'pending');
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

  await t.test('replaces old bot evidence and removes the PR-body checklist', async () => {
    const body = 'Author text.\n\n<!-- flora-visual:start -->\n### Visual review\n' +
      '<!-- flora-visual:evidence:old:123:1:old -->\n- [ ] checkbox\n<!-- flora-visual:end -->';
    const result = await scenario({changed: true, comments: [comment({run: 99, id: 7})], authorBody: body});
    assert.deepEqual(result.deleted, [7]);
    assert.equal(result.bodyUpdates.length, 1);
    assert.equal(result.bodyUpdates[0], 'Author text.');
  });
});
