const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({github, context}) => {
  const {owner, repo} = context.repo;
  const pull_number = Number(process.env.VISUAL_PR);
  const run_id = Number(process.env.VISUAL_RUN_ID);
  // Resolved outside the read below so a missing setting fails the step loudly
  // instead of being reported as a capture failure.
  const resultsPath = path.join(process.env.VISUAL_REPORT_DIR, 'results.json');
  const {data: pr} = await github.rest.pulls.get({owner, repo, pull_number});
  const {data: run} = await github.rest.actions.getWorkflowRun({owner, repo, run_id});
  if (pr.state !== 'open' || pr.head.sha !== run.head_sha || pr.head.repo?.full_name !== run.head_repository.full_name) return;
  // A later checkbox click may arrive before this worker. Do not overwrite it.
  if (context.eventName === 'pull_request_target' && context.payload?.action === 'edited' &&
      context.payload.pull_request?.body !== pr.body) return;
  let results;
  try {
    const raw = fs.readFileSync(resultsPath, 'utf8');
    if (raw.length > 100000) throw new Error('Oversized results');
    results = JSON.parse(raw);
    if (!Array.isArray(results) || results.length === 0 || results.length > 100 ||
        new Set(results.map(r => r?.name)).size !== results.length ||
        results.some(r => !/^[a-z0-9-]+$/.test(r.name) ||
          !['pass', 'fail'].includes(r.status) || typeof r.detail !== 'string' ||
          (r.status === 'fail' && r.changed !== true))) results = undefined;
  } catch { results = undefined; }
  const captured = run.conclusion === 'success' && !!results;
  const changed = captured ? results.filter(r => r.changed) : [];
  const files = await github.paginate(github.rest.pulls.listFiles, {owner, repo, pull_number});
  const screenshotPath = /^(tests\/visual\/(baselines|review-evidence)\/|docs\/img\/).+\.(png|jpe?g|webp)$/i;
  const baselineFiles = files.filter(f => [f.filename, f.previous_filename].some(name => name && screenshotPath.test(name)));
  // A PR controls its capture job and artifacts. Changes to that machinery
  // cannot certify themselves as unchanged and bypass human review.
  const capturePath = /^(tests\/visual\/|tests\/fixtures\/(article-with-dois|doi-in-table|retracted)\.html$|\.github\/(workflows\/visual[^/]*\.yml|scripts\/visual-publish\.cjs)$|scripts\/docs-screenshots\.ts$|package(?:-lock)?\.json$|esbuild\.config\.ts$|manifest\.json$|tsconfig[^/]*\.json$|\.npmrc$)/;
  const captureFiles = files.filter(f => [f.filename, f.previous_filename].some(name => name && capturePath.test(name) && !screenshotPath.test(name)));
  // A short file listing means the evidence below may miss changed files, so
  // both checklists fall back to human review.
  const listingIncomplete = files.length < pr.changed_files;
  const screenshotReview = changed.length > 0 || baselineFiles.length > 0 || listingIncomplete;
  const setupReview = captureFiles.length > 0 || listingIncomplete;
  const needsApproval = screenshotReview || setupReview;
  const artifacts = await github.rest.actions.listWorkflowRunArtifacts({owner, repo, run_id});
  const artifact = artifacts.data.artifacts.find(a => a.name === 'visual-report' && !a.expired);
  const link = artifact ? `${run.html_url}/artifacts/${artifact.id}` : run.html_url;
  const start = '<!-- flora-visual:start -->', end = '<!-- flora-visual:end -->';
  const heading = '### Visual review';
  const evidenceMarker = '<!-- flora-visual:evidence:';
  const evidence = `${evidenceMarker}${pr.head.sha}:${run_id}:${run.run_attempt ?? 1}:${run.updated_at} -->`;
  const screenshotLabel = 'I checked the changed screenshots and they look right.';
  const setupLabel = 'I checked the screenshot test setup changes.';
  // The author's own prose may quote either marker, so a pair is managed only
  // when its contents carry the generated heading and evidence marker. Marker
  // pairs are scanned in order and the first signed one is the managed block;
  // any other prose is never rewritten.
  const managedRange = body => {
    const text = body ?? '';
    for (let to = text.indexOf(end); to >= 0; to = text.indexOf(end, to + end.length)) {
      const from = text.lastIndexOf(start, to);
      if (from >= 0) {
        const inner = text.slice(from, to);
        if (inner.includes(heading) && inner.includes(evidenceMarker)) return {from, to};
      }
    }
    return undefined;
  };
  const managed = body => {
    const range = managedRange(body);
    return range ? body.slice(range.from, range.to) : '';
  };
  const currentEvidence = body => managed(body).includes(evidence);
  const checked = (body, label) => currentEvidence(body) && managed(body).split('\n')
    .some(line => line === `- [x] ${label}` || line === `- [X] ${label}`);
  let screenshotsChecked = false, setupChecked = false;
  if (captured && needsApproval) {
    // The checked text alone cannot grant approval. Keep only a trusted receipt
    // for this capture, or an explicit checkbox edit by a human collaborator.
    const receiptPrefix = `Visual checklist ${run_id}/${run.run_attempt ?? 1}: `;
    const {data: previous} = await github.rest.repos.getCombinedStatusForRef({owner, repo, ref: pr.head.sha});
    const receipt = previous.statuses.find(status => status.context === 'Visual approval' &&
      ['pending', 'success'].includes(status.state) && status.target_url === link &&
      status.description?.startsWith(receiptPrefix) &&
      /^screenshots=[01] setup=[01]$/.test(status.description.slice(receiptPrefix.length)));
    screenshotsChecked = checked(pr.body, screenshotLabel) && !!receipt?.description.includes('screenshots=1');
    setupChecked = checked(pr.body, setupLabel) && !!receipt?.description.includes('setup=1');
    const event = context.payload;
    const before = event?.changes?.body?.from;
    const validEdit = context.eventName === 'pull_request_target' && event?.action === 'edited' &&
      event.pull_request?.number === pull_number && event.pull_request.body === pr.body &&
      typeof before === 'string' && currentEvidence(before) && event.sender?.type === 'User';
    if (validEdit) {
      const {data: permission} = await github.rest.repos.getCollaboratorPermissionLevel({owner, repo, username: event.sender.login});
      if (['admin', 'maintain', 'write'].includes(permission.permission)) {
        // Each box is confirmed by the edit that ticks it. A box the edit
        // leaves alone keeps whatever the trusted receipt recorded for it.
        if (checked(pr.body, screenshotLabel) && !checked(before, screenshotLabel)) screenshotsChecked = true;
        if (checked(pr.body, setupLabel) && !checked(before, setupLabel)) setupChecked = true;
      }
    }
  }
  const approved = (!screenshotReview || screenshotsChecked) && (!setupReview || setupChecked);
  const conclusion = !captured ? 'failure' : needsApproval && !approved ? 'action_required' : 'success';
  const filesLink = `https://github.com/${owner}/${repo}/pull/${pull_number}/files`;
  const incompleteNote = listingIncomplete
    ? `**This PR changes ${pr.changed_files} files but only ${files.length} could be listed.** The evidence below may be incomplete, so both boxes need checking against [Files changed](${filesLink}).`
    : '';
  const summary = captured
    ? [captureFiles.length > 0 ? `[Check the screenshot test setup changes](${filesLink}) to make sure the report still covers the intended pages.` : '',
      incompleteNote].filter(Boolean).join('\n\n')
    : '**Screenshots could not be captured.** Check the capture logs and rerun before completing the checklist.';
  const checklist = captured && needsApproval
    ? 'Tick the relevant boxes after checking the evidence. Anyone with write access, including the PR author, can do this. New commits or captures reset the checklist.\n\n' +
      (screenshotReview ? `- [${screenshotsChecked ? 'x' : ' '}] ${screenshotLabel}\n` : '') +
      (setupReview ? `- [${setupChecked ? 'x' : ' '}] ${setupLabel}\n` : '')
    : captured ? 'No visual checks are needed for this change.' : '';
  const htmlLabel = s => String(s).slice(0, 200).replace(/[&<>"'\r\n]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\r': '&#13;', '\n': '&#10;',
  })[char]);
  // Reserve space for the author's text and the review instructions/status.
  const previewLimit = Math.max(0, Math.min(20000, 28000 - summary.length,
    62000 - (pr.body ?? '').length - summary.length));
  let previewChars = 0, omittedPreviews = 0;
  const regeneratedTitle = 'Regenerated baselines';
  const groups = {'Changed visuals': [], 'New visuals': [], 'Removed visuals': [], [regeneratedTitle]: []};
  if (changed.length) groups['Changed visuals'].push(
    `[Open the before/after report for changed example pages](${link}) — open index.html after downloading.`);
  // Markdown image URLs stop at whitespace and unescaped brackets/parentheses.
  const encodePath = p => p.split('/').map(encodeURIComponent).join('/')
    .replace(/[()]/g, c => (c === '(' ? '%28' : '%29'));
  baselineFiles.forEach(f => {
    // A regenerated baseline differs in Git while this run rendered the base and
    // head UI identically, so it is grouped apart from real visual changes.
    const fixture = /^tests\/visual\/baselines\/([a-z0-9-]+)\.png$/.exec(f.filename)?.[1];
    const regenerated = captured && f.status === 'modified' && !f.previous_filename && !!fixture &&
      results.some(r => r.name === fixture && r.changed === false);
    const oldName = f.previous_filename ?? f.filename;
    const beforeExists = f.status !== 'added' && screenshotPath.test(oldName);
    const afterExists = f.status !== 'removed' && screenshotPath.test(f.filename);
    const beforePath = encodePath(oldName);
    const before = `https://raw.githubusercontent.com/${pr.base.repo.full_name}/${pr.base.sha}/${beforePath}`;
    const after = `https://raw.githubusercontent.com/${pr.head.repo.full_name}/${pr.head.sha}/${encodePath(f.filename)}`;
    const category = regenerated ? regeneratedTitle
      : !beforeExists ? 'New visuals' : !afterExists ? 'Removed visuals' : 'Changed visuals';
    const images = beforeExists && afterExists
      ? `| Committed base | Committed PR |\n| --- | --- |\n| ![Before](${before}) | ![After](${after}) |`
      : afterExists ? `![After](${after})` : `Removed screenshot:\n\n![Before](${before})`;
    const preview = `\n<details open><summary>${htmlLabel(f.filename)}</summary>\n\n${images}\n\n</details>`;
    if (previewChars + preview.length > previewLimit) { omittedPreviews++; return; }
    previewChars += preview.length;
    if (category === regeneratedTitle && !groups[category].length) groups[category].push(
      'CI rendered the base and PR builds identically for these fixtures; only the committed PNGs differ.');
    groups[category].push(preview);
  });
  const baselineEvidence = Object.entries(groups).filter(([, entries]) => entries.length)
    .map(([title, entries]) => `#### ${title}\n\n${entries.join('\n')}`).join('\n\n') +
    (omittedPreviews ? `\n${omittedPreviews} additional screenshot previews omitted to keep this description within GitHub's limit. [Review all screenshot files](https://github.com/${owner}/${repo}/pull/${pull_number}/files).` : '');
  const block = `${start}\n${heading}\n\n${evidence}\n${summary}\n\n${checklist}\n${baselineEvidence}\n\n${changed.length ? '' : `[Download visual report](${link}) — open index.html after downloading.\n\n`}[Capture logs](${run.html_url})\n${end}`;
  const {data: fresh} = await github.rest.pulls.get({owner, repo, pull_number});
  if (fresh.head.sha !== pr.head.sha || fresh.body !== pr.body) return;
  const body = fresh.body ?? '';
  const range = managedRange(body);
  const next = range ? body.slice(0, range.from) + block + body.slice(range.to + end.length) : body + '\n\n' + block;
  if (next.length <= 65000) await github.rest.pulls.update({owner, repo, pull_number, body: next});
  else console.warn('Visual evidence did not fit the existing PR description; see the status report and Files changed.');
  await github.rest.repos.createCommitStatus({owner, repo, sha: pr.head.sha,
    context: 'Visual approval', target_url: link,
    state: conclusion === 'success' ? 'success' : conclusion === 'failure' ? 'failure' : 'pending',
    description: !captured ? 'Visual capture failed' : needsApproval ?
      `Visual checklist ${run_id}/${run.run_attempt ?? 1}: screenshots=${Number(screenshotsChecked)} setup=${Number(setupChecked)}` : 'No visual changes to check'});
};
