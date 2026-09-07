const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const publish = require('../../.github/scripts/visual-publish.cjs');

// Exercise the publisher through its GitHub API boundary, without network calls.
const SCREENSHOTS = 'I checked the changed screenshots and they look right.';
const SETUP = 'I checked the screenshot test setup changes.';
const CAPTURE_TIME = '2026-09-06T10:00:00Z';

function evidence({screenshots = false, setup = false, screenshotRequired = true,
  setupRequired = false, head = 'abc', attempt = 1, updatedAt = CAPTURE_TIME} = {}) {
  return `Keep this author paragraph.\n\n<!-- flora-visual:start -->
<!-- flora-visual:evidence:${head}:123:${attempt}:${updatedAt} -->
${screenshotRequired ? `- [${screenshots ? 'x' : ' '}] ${SCREENSHOTS}` : ''}
${setupRequired ? `- [${setup ? 'x' : ' '}] ${SETUP}` : ''}
<!-- flora-visual:end -->`;
}

function edit(from, body, extra = {}) {
  return {from, body, sender: {login: 'reviewer', type: 'User'}, ...extra};
}

async function scenario({changed = false, files = [], failure = false,
  stale = false, permission = 'write', results, authorBody, edited, changedFiles,
  previousStatuses = [], attempt = 1, updatedAt = CAPTURE_TIME, artifactId = 1,
  raced} = {}) {
  fs.writeFileSync('visual-report/results.json', JSON.stringify(results ?? [{
    name: 'fixture', status: changed ? 'fail' : 'pass', detail: '120 px differ',
    ...(changed ? {changed: true} : {}),
  }]));
  const pr = {
    number: 215, state: 'open', user: {login: 'author'}, changed_files: changedFiles ?? files.length,
    head: {sha: 'abc', repo: {full_name: 'o/r'}},
    base: {sha: 'def', repo: {full_name: 'o/r'}},
    body: authorBody ?? edited?.body ?? 'Keep this author paragraph.',
  };
  const run = {
    head_sha: stale ? 'old' : 'abc', head_repository: {full_name: 'o/r'},
    conclusion: failure ? 'failure' : 'success', run_attempt: attempt,
    updated_at: updatedAt, html_url: 'https://github.com/o/r/actions/runs/123',
  };
  let body, state, status, reads = 0;
  const github = {
    rest: {
      pulls: {
        // `raced` stands for a concurrent change landing between the initial
        // read and the publisher's re-read.
        get: async () => ({data: reads++ === 0 || !raced ? pr : {...pr, ...raced}}),
        listFiles: 'files',
        update: async input => { body = input.body; },
      },
      actions: {
        getWorkflowRun: async () => ({data: run}),
        listWorkflowRunArtifacts: async () => ({data: {artifacts: [{id: artifactId, name: 'visual-report'}]}}),
      },
      repos: {
        getCollaboratorPermissionLevel: async () => ({data: {permission}}),
        getCombinedStatusForRef: async input => {
          assert.equal(input.ref, pr.head.sha);
          return {data: {statuses: previousStatuses}};
        },
        createCommitStatus: async input => { state = input.state; status = input; },
      },
    },
    paginate: async method => { assert.equal(method, 'files'); return files; },
  };
  const context = {repo: {owner: 'o', repo: 'r'}, eventName: 'workflow_run', payload: {}};
  if (edited) {
    context.eventName = edited.eventName ?? 'pull_request_target';
    context.payload = {
      action: edited.action ?? 'edited', sender: edited.sender,
      pull_request: {number: edited.number ?? 215, body: edited.body},
      changes: {body: {from: edited.from}},
    };
  }
  await publish({github, context});
  const authorText = pr.body.split('<!-- flora-visual:start -->')[0];
  if (body) assert.ok(body.startsWith(authorText), 'preserve the author description');
  return {state, body, status};
}

test('visual publication policy', async t => {
  const previousCwd = process.cwd();
  const previousEnv = {VISUAL_PR: process.env.VISUAL_PR, VISUAL_RUN_ID: process.env.VISUAL_RUN_ID,
    VISUAL_REPORT_DIR: process.env.VISUAL_REPORT_DIR};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flora-publisher-'));
  t.after(() => {
    process.chdir(previousCwd);
    fs.rmSync(root, {recursive: true, force: true});
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.chdir(root);
  fs.mkdirSync('visual-report');
  process.env.VISUAL_PR = '215';
  process.env.VISUAL_RUN_ID = '123';
  process.env.VISUAL_REPORT_DIR = 'visual-report';

  await t.test('accepts only a current authorized human checkbox transition', async () => {
    const unchecked = evidence(), checked = evidence({screenshots:true});
    assert.equal((await scenario()).state,'success');
    assert.equal((await scenario({changed:true})).state,'pending');
    assert.equal((await scenario({results:[{name:'fixture',status:'pass',detail:'Raw change within local budget',changed:true}]})).state,'pending');
    assert.equal((await scenario({changed:true,edited:edit(unchecked,checked)})).state,'success');
    assert.equal((await scenario({changed:true,edited:edit(unchecked,checked,{sender:{login:'author',type:'User'}})})).state,'success');
    assert.equal((await scenario({changed:true,edited:edit(unchecked,checked),permission:'read'})).state,'pending');
    assert.equal((await scenario({changed:true,edited:edit(unchecked,checked,{sender:{login:'automation',type:'Bot'}})})).state,'pending');
    assert.equal((await scenario({changed:true,edited:edit(unchecked,checked,{eventName:'pull_request'})})).state,'pending');
    assert.equal((await scenario({changed:true,edited:edit(unchecked,checked,{number:999})})).state,'pending');
    assert.equal((await scenario({changed:true,authorBody:checked})).state,'pending');
    assert.equal((await scenario({changed:true,edited:edit(checked,checked)})).state,'pending');
    const superseded = await scenario({changed:true,edited:edit(unchecked,checked),authorBody:unchecked});
    assert.equal(superseded.state,undefined);
    assert.equal(superseded.body,undefined);
    assert.equal((await scenario({changed:true,edited:edit(evidence({head:'old'}),checked)})).state,'pending');
  });

  await t.test('preserves partial approval only for the same capture and allows revocation', async () => {
    const files = [{filename:'tests/visual/run.ts',status:'modified'}];
    const unchecked = evidence({setupRequired:true});
    const partial = evidence({screenshots:true,setupRequired:true});
    const complete = evidence({screenshots:true,setup:true,setupRequired:true});
    const first = await scenario({changed:true,files,edited:edit(unchecked,partial)});
    assert.equal(first.state,'pending');
    assert.equal(first.status.description,'Visual checklist 123/1: screenshots=1 setup=0');
    const held = await scenario({changed:true,files,authorBody:partial,previousStatuses:[first.status]});
    assert.equal(held.state,'pending');
    assert.equal(held.status.description,first.status.description);
    const second = await scenario({changed:true,files,edited:edit(partial,complete),previousStatuses:[first.status]});
    assert.equal(second.state,'success');
    assert.equal(second.status.description,'Visual checklist 123/1: screenshots=1 setup=1');
    const uncheckedScreenshot = evidence({setup:true,setupRequired:true});
    for (const permission of ['write','read']) {
      const revoked = await scenario({changed:true,files,edited:edit(complete,uncheckedScreenshot),previousStatuses:[second.status],permission});
      assert.equal(revoked.state,'pending');
      assert.match(revoked.status.description,/screenshots=0/);
    }
    assert.equal((await scenario({changed:true,files,authorBody:complete,previousStatuses:[second.status],attempt:2})).state,'pending');
    assert.equal((await scenario({changed:true,files,authorBody:complete,previousStatuses:[second.status],updatedAt:'2026-09-06T11:00:00Z'})).state,'pending');
    assert.equal((await scenario({changed:true,files,authorBody:complete,previousStatuses:[second.status],artifactId:2})).state,'pending');
    assert.equal((await scenario({changed:true,files,authorBody:complete,previousStatuses:[second.status],failure:true})).state,'failure');
  });

  await t.test('handles rapid checkbox clicks without erasing the later edit', async () => {
    const files = [{filename:'tests/visual/run.ts',status:'modified'}];
    const unchecked = evidence({setupRequired:true});
    const partial = evidence({screenshots:true,setupRequired:true});
    const complete = evidence({screenshots:true,setup:true,setupRequired:true});
    const superseded = await scenario({changed:true,files,edited:edit(unchecked,partial),authorBody:complete});
    assert.equal(superseded.body,undefined);
    assert.equal(superseded.status,undefined);
    // An edit promotes only the box it ticks; the other keeps its receipt state.
    const latest = await scenario({changed:true,files,edited:edit(partial,complete)});
    assert.equal(latest.state,'pending');
    assert.equal(latest.status.description,'Visual checklist 123/1: screenshots=0 setup=1');
    const withReceipt = await scenario({changed:true,files,edited:edit(partial,complete),
      previousStatuses:[{context:'Visual approval',state:'pending',target_url:'https://github.com/o/r/actions/runs/123/artifacts/1',
        description:'Visual checklist 123/1: screenshots=1 setup=0'}]});
    assert.equal(withReceipt.state,'success');
    assert.equal(withReceipt.status.description,'Visual checklist 123/1: screenshots=1 setup=1');
    const proseOnly = await scenario({changed:true,files,edited:edit(complete,complete + '\nMore context.')});
    assert.equal(proseOnly.state,'pending');
    const untrusted = await scenario({changed:true,files,edited:edit(partial,complete),permission:'read'});
    assert.equal(untrusted.state,'pending');
    // A new head commit between the two reads means the checked body no longer
    // describes the current capture, so nothing is written.
    const newHead = await scenario({changed:true,files,edited:edit(partial,complete),
      raced:{head:{sha:'zzz',repo:{full_name:'o/r'}}}});
    assert.equal(newHead.body,undefined);
    assert.equal(newHead.status,undefined);
    const malformedReceipt = {...latest.status,description:'Visual checklist 123/1: screenshots=10 setup=1'};
    const malformed = await scenario({changed:true,files,authorBody:complete,previousStatuses:[malformedReceipt]});
    assert.equal(malformed.state,'pending');
    assert.equal(malformed.status.description,'Visual checklist 123/1: screenshots=0 setup=0');
  });

  await t.test('rejects failed, stale and duplicate evidence', async () => {
    assert.equal((await scenario({failure:true,edited:edit(evidence(),evidence({screenshots:true}))})).state,'failure');
    assert.equal((await scenario({stale:true})).state,undefined);
    const duplicate = [{name:'fixture',status:'pass',detail:'0 px differ'},{name:'fixture',status:'pass',detail:'0 px differ'}];
    assert.equal((await scenario({results:duplicate})).state,'failure');
  });

  await t.test('requires review only for screenshots and capture inputs', async () => {
    const baseline=await scenario({files:[{filename:'tests/visual/baselines/fixture.png',status:'modified'}]});
    assert.equal(baseline.state,'pending'); assert.match(baseline.body,/raw.githubusercontent.com/);
    assert.match(baseline.body,/Download visual report.*actions\/runs\/123\/artifacts\/1/);
    const setupOnly = await scenario({files:[{filename:'tests/visual/run.ts',status:'modified'}]});
    assert.equal(setupOnly.state,'pending');
    assert.match(setupOnly.body,/Download visual report.*actions\/runs\/123\/artifacts\/1/);
    for (const filename of ['tsconfig.json', 'tsconfig.visual.json', '.npmrc', 'scripts/docs-screenshots.ts']) {
      assert.equal((await scenario({files:[{filename,status:'modified'}]})).state,'pending');
    }
    const setupFrom = evidence({screenshotRequired:false,setupRequired:true});
    const setupTo = evidence({screenshotRequired:false,setupRequired:true,setup:true});
    assert.equal((await scenario({files:[{filename:'package.json',status:'modified'}],edited:edit(setupFrom,setupTo)})).state,'success');
    assert.equal((await scenario({files:[{filename:'tests/visual/baselines/fixture.png',status:'modified'}],edited:edit(evidence(),evidence({screenshots:true}))})).state,'success');
    assert.equal((await scenario({files:[{filename:'tests/fixtures/no-dois.html',status:'modified'}]})).state,'success');
    for (const name of ['article-with-dois','doi-in-table','retracted']) {
     assert.equal((await scenario({files:[{filename:`tests/fixtures/${name}.html`,status:'modified'}]})).state,'pending');
    }
    assert.equal((await scenario({files:[{filename:'tests/fixtures/no-longer-used.html',previous_filename:'tests/fixtures/retracted.html',status:'renamed'}]})).state,'pending');
  });

  await t.test('preserves screenshot rename evidence and escapes labels', async () => {
    const movedOut = await scenario({files:[{filename:'archive/old.png',previous_filename:'docs/img/popup.png',status:'renamed'}]});
    assert.equal(movedOut.state,'pending'); assert.match(movedOut.body,/!\[Before\].*def\/docs\/img\/popup.png/);
    assert.match(movedOut.body,/Removed screenshot/); assert.doesNotMatch(movedOut.body,/!\[After\]/);
    const movedIn = await scenario({files:[{filename:'docs/img/new.png',previous_filename:'archive/new.png',status:'renamed'}]});
    assert.equal(movedIn.state,'pending'); assert.match(movedIn.body,/#### New visuals/); assert.doesNotMatch(movedIn.body,/!\[Before\]/);
    assert.match(movedIn.body,/!\[After\].*abc\/docs\/img\/new.png/);
    assert.doesNotMatch(movedIn.body,/Committed base|\| --- \|/);
    const renamed = await scenario({files:[{filename:'docs/img/new.png',previous_filename:'docs/img/old.png',status:'renamed'}]});
    assert.match(renamed.body,/#### Changed visuals/);
    assert.match(renamed.body,/!\[Before\].*def\/docs\/img\/old.png/); assert.match(renamed.body,/!\[After\].*abc\/docs\/img\/new.png/);
    const escaped = await scenario({files:[{filename:'docs/img/a<b&c>.png',status:'added'}]});
    assert.match(escaped.body,/<summary>docs\/img\/a&lt;b&amp;c&gt;.png<\/summary>/);
    assert.match(escaped.body,/abc\/docs\/img\/a%3Cb%26c%3E.png/);
  });

  await t.test('groups regenerated baselines apart from changed and new visuals', async () => {
    const result = await scenario({results:[
      {name:'changed-page',status:'fail',detail:'pixel change',changed:true},
      {name:'unchanged-page',status:'pass',detail:'0 px differ',changed:false},
    ],files:[
      {filename:'docs/img/new.png',status:'added'},
      {filename:'docs/img/changed.png',status:'modified'},
      {filename:'tests/visual/baselines/unchanged-page.png',status:'modified'},
      {filename:'tests/visual/baselines/changed-page.png',status:'modified'},
      {filename:'tests/visual/baselines/uncaptured-page.png',status:'modified'},
    ]});
    assert.match(result.body,/#### Changed visuals/);
    assert.match(result.body,/#### New visuals/);
    assert.match(result.body,/Open the before\/after report for changed example pages/);
    assert.doesNotMatch(result.body,/See others/i);
    assert.match(result.body, /<summary>tests\/visual\/baselines\/changed-page.png<\/summary>/);
    assert.match(result.body, /<summary>tests\/visual\/baselines\/uncaptured-page.png<\/summary>/);
    // The fixture CI rendered identically stays visible, in the last group.
    assert.match(result.body,/#### Regenerated baselines[\s\S]*rendered the base and PR builds identically[\s\S]*unchanged-page\.png/);
    const order = ['#### Changed visuals','#### New visuals','#### Regenerated baselines'].map(h => result.body.indexOf(h));
    assert.deepEqual(order, [...order].sort((a,b) => a-b));
    assert.ok(order.every(i => i >= 0));
    assert.equal(result.state, 'pending');
    assert.equal((result.body.match(/!\[After\]/g) ?? []).length,5);
    assert.equal((result.body.match(/!\[Before\]/g) ?? []).length,4);
  });

  await t.test('keeps author prose that quotes the start marker', async () => {
    const quoted = body => `Intro.\n\n<!-- flora-visual:start -->\n\nAuthor notes about the managed block.\n\n${body}`;
    const unchecked = quoted(evidence()), checked = quoted(evidence({screenshots:true}));
    const published = await scenario({changed:true,edited:edit(unchecked,checked)});
    // Only one marker pair is managed, so the quoted marker and the prose
    // after it survive publication.
    assert.equal(published.state,'success');
    assert.ok(published.body.startsWith('Intro.\n\n<!-- flora-visual:start -->\n\nAuthor notes about the managed block.\n\nKeep this author paragraph.\n\n'));
    assert.equal((published.body.match(/<!-- flora-visual:end -->/g) ?? []).length,1);
  });

  await t.test('keeps author prose that quotes the end marker after the block', async () => {
    const trailing = body => `${body}\n\nTrailing author notes.\n\n<!-- flora-visual:end -->\n\nMore prose.`;
    const unchecked = trailing(evidence()), checked = trailing(evidence({screenshots:true}));
    const published = await scenario({changed:true,edited:edit(unchecked,checked)});
    assert.equal(published.state,'success');
    assert.ok(published.body.includes('Trailing author notes.\n\n<!-- flora-visual:end -->\n\nMore prose.'));
    assert.ok(published.body.includes('### Visual review'));
    assert.equal((published.body.match(/### Visual review/g) ?? []).length,1);
  });

  await t.test('escapes parentheses in screenshot URLs', async () => {
    const parens = await scenario({files:[{filename:'docs/img/a(b).png',status:'added'}]});
    assert.match(parens.body,/abc\/docs\/img\/a%28b%29\.png/);
    assert.doesNotMatch(parens.body,/img\/a\(b\)\.png\)/);
  });

  await t.test('demands review when the file listing is shorter than the PR', async () => {
    const short = await scenario({files:[],changedFiles:5});
    assert.equal(short.state,'pending');
    assert.match(short.body,/only 0 could be listed/);
    assert.match(short.body,new RegExp(`- \\[ \\] ${SCREENSHOTS.replace(/\./g,'\\.')}`));
    assert.match(short.body,new RegExp(`- \\[ \\] ${SETUP.replace(/\./g,'\\.')}`));
    const complete = await scenario({files:[{filename:'README.md',status:'modified'}],changedFiles:1});
    assert.equal(complete.state,'success');
    assert.doesNotMatch(complete.body,/could be listed/);
  });

  await t.test('bounds inline previews without dropping approval requirements', async () => {
    const longFiles = Array.from({length:100},(_,i)=>({filename:`docs/img/${i}-${'&'.repeat(500)}.png`,status:'added'}));
    const bounded = await scenario({files:longFiles});
    assert.equal(bounded.state,'pending'); assert.ok(bounded.body.length<25000);
    assert.match(bounded.body,/additional screenshot previews omitted/);
    assert.match(bounded.body,/Review all screenshot files/);
    const fullBody = await scenario({files:longFiles,authorBody:'a'.repeat(63000)});
    assert.equal(fullBody.state,'pending'); assert.ok(fullBody.body.length<=65000); assert.match(fullBody.body,/additional screenshot previews omitted/);
    for (const failure of [false, true]) {
      const oversized = await scenario({changed:true, failure, authorBody:'a'.repeat(65000)});
      assert.equal(oversized.body, undefined); // no update: preserve the author's description
      assert.equal(oversized.state, failure ? 'failure' : 'pending');
    }
  });
});
