const fs = require('node:fs');
const path = require('node:path');

const MARKER = /<!-- flora-visual-review:([0-9a-f]{40}):(\d+):(\d+):([^ ]+):part=(\d+):total=(\d+) -->/;
const OWN_MARKER = /<!-- flora-visual-review:[0-9a-f]{40}:\d+:\d+:[^ ]+:part=\d+(?::total=\d+)? -->/;
const BASELINE_MARKER = /<!-- flora-visual-baselines:([0-9a-f]{40}):([0-9a-f]{40}):(\d+):(\d+):(\d+):([a-z0-9,-]+) -->/;
const BOT = 'github-actions[bot]';
const MAX_ATTACHMENTS = 40;

function readResults(file) {
  try {
    const raw = fs.readFileSync(file);
    if (raw.length > 100000) return null;
    const results = JSON.parse(raw.toString('utf8'));
    if (!Array.isArray(results) || results.length < 1 || results.length > 100 ||
        new Set(results.map(r => r?.name)).size !== results.length ||
        results.some(r => !/^[a-z0-9-]+$/.test(r?.name) ||
          !['pass', 'fail'].includes(r.status) || typeof r.detail !== 'string' ||
          (r.status === 'fail' && r.changed !== true))) return null;
    return results;
  } catch { return null; }
}

function imageFile(dir, name, kind) {
  const file = path.join(dir, `${name}.${kind}.png`);
  const bytes = fs.readFileSync(file);
  if (bytes.length > 20_000_000 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw new Error(`Invalid PNG for ${name}.${kind}`);
  return file;
}

function safeLabel(value) {
  return String(value).slice(0, 200).replace(/[&<>"'\r\n]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\r': '&#13;', '\n': '&#10;',
  })[c]);
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/').replace(/[()]/g, c => c === '(' ? '%28' : '%29');
}

function baselinePreviews(files, pr, results) {
  const screenshotPath = /^(tests\/visual\/(baselines|review-evidence)\/|docs\/img\/|assets\/icons\/).+\.(png|jpe?g|webp)$/i;
  return files.map(file => {
    const oldName = file.previous_filename ?? file.filename;
    const beforeExists = file.status !== 'added' && screenshotPath.test(oldName);
    const afterExists = file.status !== 'removed' && screenshotPath.test(file.filename);
    const fixture = /^tests\/visual\/baselines\/([a-z0-9-]+)\.png$/.exec(file.filename)?.[1];
    const sameCapture = file.status === 'modified' && fixture && results?.some(r => r.name === fixture && !r.changed);
    const before = `https://raw.githubusercontent.com/${pr.base.repo.full_name}/${pr.base.sha}/${encodePath(oldName)}`;
    const after = `https://raw.githubusercontent.com/${pr.head.repo.full_name}/${pr.head.sha}/${encodePath(file.filename)}`;
    const images = beforeExists && afterExists
      ? `| Base | PR |\n| --- | --- |\n| ![Base](${before}) | ![PR](${after}) |`
      : afterExists ? `![PR](${after})` : `Removed screenshot:\n\n![Base](${before})`;
    return `<details open><summary>${safeLabel(file.filename)}${sameCapture ? ' (committed PNG changed; renders match)' : ''}</summary>\n\n${images}\n\n</details>`;
  }).join('\n\n');
}

function legacyBodyWithoutBlock(body) {
  const start = '<!-- flora-visual:start -->', end = '<!-- flora-visual:end -->';
  const text = body ?? '';
  for (let to = text.indexOf(end); to >= 0; to = text.indexOf(end, to + end.length)) {
    const from = text.lastIndexOf(start, to);
    if (from >= 0 && text.slice(from, to).includes('<!-- flora-visual:evidence:') &&
        text.slice(from, to).includes('### Visual review')) {
      return (text.slice(0, from) + text.slice(to + end.length)).trimEnd();
    }
  }
  return text;
}

async function defaultPostComment({github, owner, repo, pull_number, body}) {
  const {data} = await github.rest.issues.createComment({owner, repo, issue_number: pull_number, body});
  return data;
}

/** Keep the latest images on one branch; old evidence stays reachable by its commit SHA. */
async function defaultStoreImages({github, owner, repo, pr, run, files}) {
  if (!files.length) return new Map();
  const unique = [...new Set(files)];
  const folder = `pr-${pr.number}/${pr.head.sha}-${run.id}-${run.run_attempt ?? 1}`;
  const tree = [];
  for (const file of unique) {
    const {data: blob} = await github.rest.git.createBlob({owner, repo,
      content: fs.readFileSync(file).toString('base64'), encoding: 'base64'});
    tree.push({path: `${folder}/${path.basename(file)}`, mode: '100644', type: 'blob', sha: blob.sha});
  }
  const {data: writtenTree} = await github.rest.git.createTree({owner, repo, tree});
  let parent, exists = true;
  try {
    const {data: ref} = await github.rest.git.getRef({owner, repo, ref: 'heads/visual-evidence'});
    parent = ref.object.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
    parent = pr.base.sha;
    exists = false;
  }
  const {data: commit} = await github.rest.git.createCommit({owner, repo,
    message: `Visual evidence for PR #${pr.number} at ${pr.head.sha.slice(0, 7)}`,
    tree: writtenTree.sha, parents: [parent]});
  if (exists) await github.rest.git.updateRef({owner, repo, ref: 'heads/visual-evidence', sha: commit.sha});
  else await github.rest.git.createRef({owner, repo, ref: 'refs/heads/visual-evidence', sha: commit.sha});
  return new Map(unique.map(file => [file,
    `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${encodePath(folder + '/' + path.basename(file))}`]));
}

function evidenceTime(evidence, ownComments) {
  const marker = MARKER.exec(evidence?.body ?? '');
  if (!marker) return NaN;
  const parts = ownComments.filter(part => {
    const other = MARKER.exec(part.body ?? '');
    return other && other[1] === marker[1] && other[2] === marker[2] &&
      other[3] === marker[3] && other[4] === marker[4] && other[6] === marker[6];
  });
  if (parts.length !== Number(marker[6]) ||
      new Set(parts.map(part => Number(MARKER.exec(part.body)[5]))).size !== Number(marker[6]) ||
      !parts.every(part => Number.isFinite(Date.parse(part.created_at)))) return NaN;
  return Math.max(...parts.map(part => Date.parse(part.created_at)));
}

async function visualDecision({comments, evidence, ownComments, github, owner, repo}) {
  const after = evidenceTime(evidence, ownComments);
  if (!Number.isFinite(after)) return {confirmedBy: null, decision: null};
  const decisions = comments.filter(comment => comment.user?.type === 'User' &&
    Number.isFinite(Date.parse(comment.created_at)) && Date.parse(comment.created_at) > after &&
    ['visuals ok', 'visuals not ok'].includes(String(comment.body ?? '').trim().toLowerCase()));
  const latest = new Map();
  for (const decision of decisions) {
    const prev = latest.get(decision.user.login);
    if (!prev || Date.parse(decision.created_at) > Date.parse(prev.created_at) ||
        (decision.created_at === prev.created_at && decision.id > prev.id))
      latest.set(decision.user.login, decision);
  }
  let confirmation = null, objection = false;
  for (const decision of latest.values()) {
    try {
      const {data: permission} = await github.rest.repos.getCollaboratorPermissionLevel({
        owner, repo, username: decision.user.login,
      });
      if (!['write', 'maintain', 'admin'].includes(permission.permission)) continue;
      if (decision.body.trim().toLowerCase() === 'visuals not ok') objection = true;
      else confirmation = decision;
    } catch { /* A former collaborator's comment cannot confirm this capture. */ }
  }
  return objection ? {confirmedBy: null, decision: null} :
    {confirmedBy: confirmation?.user.login ?? null, decision: confirmation};
}

async function commitApprovedBaselines({github, owner, repo, pr, run, results, reportDir, decision}) {
  const {data: fresh} = await github.rest.pulls.get({owner, repo, pull_number: pr.number});
  if (fresh.state !== 'open' || fresh.head.sha !== pr.head.sha ||
      fresh.head.repo.full_name !== `${owner}/${repo}`) return null;
  const {data: parent} = await github.rest.git.getCommit({owner, repo, commit_sha: pr.head.sha});
  const tree = [];
  for (const result of results.filter(r => r.changed)) {
    const file = imageFile(reportDir, result.name, 'actual');
    const {data: blob} = await github.rest.git.createBlob({owner, repo,
      content: fs.readFileSync(file).toString('base64'), encoding: 'base64'});
    tree.push({path: `tests/visual/baselines/${result.name}.png`,
      mode: '100644', type: 'blob', sha: blob.sha});
  }
  const {data: updatedTree} = await github.rest.git.createTree({owner, repo,
    base_tree: parent.tree.sha, tree});
  if (updatedTree.sha === parent.tree.sha) return {sha: pr.head.sha, changed: false};
  const {data: commit} = await github.rest.git.createCommit({owner, repo,
    message: `Update approved visual baselines for PR #${pr.number}\n\nCapture: ${run.id}/${run.run_attempt ?? 1}\nConfirmed-by: @${decision.user.login}`,
    tree: updatedTree.sha, parents: [pr.head.sha]});
  await github.rest.git.updateRef({owner, repo, ref: `heads/${pr.head.ref}`,
    sha: commit.sha, force: false});
  return {sha: commit.sha, changed: true};
}

function commentParts({pr, run, results, screenshotReview, setupReview, baselineFiles, captureFiles, listingIncomplete,
  reportDir, time}) {
  const parts = [];
  const changed = results.filter(r => r.changed);
  for (const r of changed) {
    const actual = imageFile(reportDir, r.name, 'actual');
    const beforeFile = path.join(reportDir, `${r.name}.before.png`);
    const before = fs.existsSync(beforeFile) ? imageFile(reportDir, r.name, 'before') : null;
    parts.push({attachments: before ? [before, actual] : [actual], text: before
      ? `<details open><summary>${safeLabel(r.name)} — base and PR</summary>\n\n| Base | PR |\n| --- | --- |\n| ![Base ${r.name}](${before}) | ![PR ${r.name}](${actual}) |\n\n</details>`
      : `<details open><summary>${safeLabel(r.name)} — new capture</summary>\n\n![PR ${r.name}](${actual})\n\n</details>`});
  }
  if (!changed.length && !baselineFiles.length && setupReview) {
    for (const r of results.slice(0, 4)) {
      const actual = imageFile(reportDir, r.name, 'actual');
      parts.push({attachments: [actual], text: `<details open><summary>${safeLabel(r.name)} — captured example</summary>\n\n![PR ${r.name}](${actual})\n\n</details>`});
    }
  }
  for (const file of baselineFiles) {
    parts.push({attachments: [], text: baselinePreviews([file], pr, results)});
  }
  const batches = [{attachments: [], sections: []}];
  for (const part of parts) {
    let batch = batches.at(-1);
    if (batch.attachments.length + part.attachments.length > MAX_ATTACHMENTS ||
        batch.sections.reduce((n, section) => n + section.length, 0) + part.text.length > 25000) {
      batch = {attachments: [], sections: []};
      batches.push(batch);
    }
    batch.attachments.push(...part.attachments);
    batch.sections.push(part.text);
  }
  const filesLink = `https://github.com/${pr.base.repo.full_name}/pull/${pr.number}/files`;
  const summary = `Captured ${results.length} fixtures; ${changed.length} base-to-PR visual changes.\n\n` +
    `Review required: ${[screenshotReview && 'screenshots', setupReview && 'capture setup'].filter(Boolean).join(' and ')}. ` +
    `Inspect the images below${setupReview ? ` and the [capture setup diff](${filesLink})` : ''}, then add a PR comment containing exactly **visuals ok**. ` +
    `The PR author or another collaborator with write access must comment after this evidence for commit ${pr.head.sha.slice(0, 7)}. ` +
    `${changed.length ? 'The action will commit approved captures as baseline PNGs in this PR and verify them in a fresh run. ' : ''}` +
    `To revoke it, edit or delete that comment, or comment **visuals not ok**.\n\n` +
    (listingIncomplete ? `**The PR lists ${pr.changed_files} changed files, but only ${pr._listedFiles} were returned. Review the full file list before commenting.**\n\n` : '') +
    (captureFiles.length ? `Capture setup files: ${captureFiles.slice(0, 20).map(f => `<code>${safeLabel(f.filename)}</code>`).join(', ')}` +
      (captureFiles.length > 20 ? `, and ${captureFiles.length - 20} more in the diff` : '') + `.\n\n` : '') +
    (!parts.length ? `Captured fixtures: ${results.map(r => `\`${r.name}\``).join(', ')}.\n\n` : '');
  return batches.map((batch, index) => ({
    attachments: batch.attachments,
    body: `### Visual review — ${pr.head.sha.slice(0, 7)}${batches.length > 1 ? ` (${index + 1}/${batches.length})` : ''}\n\n` +
      `<!-- flora-visual-review:${pr.head.sha}:${run.id}:${run.run_attempt ?? 1}:${time}:part=${index + 1}:total=${batches.length} -->\n\n` +
      (index === 0 ? summary : '') +
      (batch.sections.length ? `### Captured pages\n\n${batch.sections.join('\n\n')}\n\n` : '') +
      (index === 0 ? `[Capture logs](${run.html_url})` : ''),
  }));
}

module.exports = async ({github, context, postComment = defaultPostComment,
  storeImages = defaultStoreImages, now = () => new Date().toISOString()}) => {
  const {owner, repo} = context.repo;
  const pull_number = Number(process.env.VISUAL_PR);
  const run_id = Number(process.env.VISUAL_RUN_ID);
  const reportDir = process.env.VISUAL_REPORT_DIR;
  const {data: pr} = await github.rest.pulls.get({owner, repo, pull_number});
  const {data: run} = await github.rest.actions.getWorkflowRun({owner, repo, run_id});
  if (pr.state !== 'open' || pr.head.sha !== run.head_sha ||
      pr.head.repo?.full_name !== run.head_repository.full_name) return;

  const results = readResults(path.join(reportDir, 'results.json'));
  const captured = run.conclusion === 'success' && !!results;
  const files = await github.paginate(github.rest.pulls.listFiles, {owner, repo, pull_number});
  const screenshotPath = /^(tests\/visual\/(baselines|review-evidence)\/|docs\/img\/|assets\/icons\/).+\.(png|jpe?g|webp)$/i;
  const capturePath = /^(tests\/visual\/|tests\/fixtures\/(article-with-dois|doi-in-table|retracted)\.html$|\.github\/(workflows\/visual[^/]*\.yml|scripts\/visual-publish\.cjs)$|scripts\/(docs-screenshots|make-icons)\.ts$|package(?:-lock)?\.json$|esbuild\.config\.ts$|manifest\.json$|tsconfig[^/]*\.json$|\.npmrc$)/;
  const baselineFiles = files.filter(f => [f.filename, f.previous_filename].some(n => n && screenshotPath.test(n)));
  const captureFiles = files.filter(f => [f.filename, f.previous_filename].some(n => n && capturePath.test(n) && !screenshotPath.test(n)));
  const listingIncomplete = files.length < pr.changed_files;
  const screenshotReview = !!results?.some(r => r.changed) || baselineFiles.length > 0 || listingIncomplete;
  const setupReview = captureFiles.length > 0 || listingIncomplete;
  const needsApproval = screenshotReview || setupReview;
  const comments = await github.paginate(github.rest.issues.listComments, {owner, repo, issue_number: pull_number});
  const ownComments = comments.filter(c => c.user?.login === BOT && OWN_MARKER.test(c.body ?? ''));
  const receipt = comments.find(c => c.user?.login === BOT &&
    BASELINE_MARKER.exec(c.body ?? '')?.[2] === pr.head.sha);
  if (receipt && captured) {
    const marker = BASELINE_MARKER.exec(receipt.body);
    const oldEvidence = ownComments.find(c => c.id === Number(marker[5]) &&
      MARKER.exec(c.body ?? '')?.[1] === marker[1]);
    const {data: commit} = await github.rest.git.getCommit({owner, repo, commit_sha: pr.head.sha});
    if (oldEvidence && commit.parents?.[0]?.sha === marker[1] &&
        pr.head.repo.full_name === `${owner}/${repo}`) {
      const names = marker[6].split(',');
      let matches = names.length > 0 && new Set(names).size === names.length &&
        names.every(name => results.some(r => r.name === name)) &&
        results.filter(r => r.changed).every(r => names.includes(r.name));
      for (const name of matches ? names : []) {
        try {
          const {data: baseline} = await github.rest.repos.getContent({owner, repo,
            path: `tests/visual/baselines/${name}.png`, ref: pr.head.sha});
          if (baseline.encoding !== 'base64' || !Buffer.from(baseline.content, 'base64')
            .equals(fs.readFileSync(imageFile(reportDir, name, 'actual')))) matches = false;
        } catch { matches = false; }
      }
      if (matches) {
        const {confirmedBy} = await visualDecision({comments, evidence: oldEvidence,
          ownComments, github, owner, repo});
        await github.rest.repos.createCommitStatus({owner, repo, sha: pr.head.sha,
          context: 'Visual approval', target_url: receipt.html_url,
          state: confirmedBy ? 'success' : 'pending',
          description: confirmedBy ? `Visuals confirmed by @${confirmedBy}` :
            'Visual confirmation was revoked; comment visuals ok',
        });
        return;
      }
    }
  }
  const current = ownComments.find(c => {
    const m = MARKER.exec(c.body ?? '');
    if (m?.[1] !== pr.head.sha || Number(m[2]) !== run_id ||
        Number(m[3]) !== (run.run_attempt ?? 1) || Number(m[5]) !== 1 ||
        !c.body.includes('containing exactly **visuals ok**')) return false;
    const parts = ownComments.filter(part => {
      const other = MARKER.exec(part.body ?? '');
      return other && other[1] === m[1] && other[2] === m[2] && other[3] === m[3] &&
        other[4] === m[4] && other[6] === m[6];
    });
    return parts.length === Number(m[6]) &&
      new Set(parts.map(part => Number(MARKER.exec(part.body)[5]))).size === Number(m[6]) &&
      parts.every(part => Number.isFinite(Date.parse(part.created_at)));
  });
  const publish = context.eventName === 'workflow_dispatch' ||
    (context.eventName === 'workflow_run' && context.payload.workflow_run?.name === 'Visual evidence');
  let evidence = current;
  let postedComments = [];
  if (publish && !current) {
    const {data: fresh} = await github.rest.pulls.get({owner, repo, pull_number});
    if (fresh.head.sha !== pr.head.sha) return;
    if (captured && needsApproval) {
      const parts = commentParts({pr: {...pr, _listedFiles: files.length}, run, results, screenshotReview,
        setupReview, baselineFiles, captureFiles, listingIncomplete, reportDir, time: now()});
      const images = await storeImages({github, owner, repo, pr, run,
        files: parts.flatMap(part => part.attachments)});
      for (const part of parts) {
        let body = part.body;
        for (const file of part.attachments) {
          const url = images.get(file);
          if (!url) throw new Error(`No published image for ${path.basename(file)}`);
          body = body.replaceAll(`(${file})`, `(${url})`);
        }
        postedComments.push(await postComment({github, owner, repo, pull_number, body}));
      }
      evidence = postedComments[0];
    } else if (!captured) {
      const body = `### Visual capture failed — ${pr.head.sha.slice(0, 7)}\n\n` +
        `<!-- flora-visual-review:${pr.head.sha}:${run.id}:${run.run_attempt ?? 1}:${now()}:part=1:total=1 -->\n\n` +
        `The screenshots could not be captured. [Inspect the capture logs](${run.html_url}) and rerun the workflow.`;
      evidence = await postComment({github, owner, repo, pull_number, body, attachments: []});
    }
    for (const old of ownComments) await github.rest.issues.deleteComment({owner, repo, comment_id: old.id});
    const trimmed = legacyBodyWithoutBlock(fresh.body);
    if (trimmed !== fresh.body) {
      const {data: latest} = await github.rest.pulls.get({owner, repo, pull_number});
      if (latest.head.sha === pr.head.sha && latest.body === fresh.body)
        await github.rest.pulls.update({owner, repo, pull_number, body: trimmed});
    }
  }

  let confirmedBy = null, decision = null;
  if (captured && needsApproval && current) {
    const marker = MARKER.exec(evidence.body ?? '');
    if (marker?.[1] === pr.head.sha && Number(marker[2]) === run_id &&
        Number(marker[3]) === (run.run_attempt ?? 1)) {
      ({confirmedBy, decision} = await visualDecision({comments,
        evidence, ownComments, github, owner, repo}));
    }
  }
  if (confirmedBy && decision && results.some(r => r.changed)) {
    if (pr.head.repo.full_name !== `${owner}/${repo}`) {
      await github.rest.repos.createCommitStatus({owner, repo, sha: pr.head.sha,
        context: 'Visual approval', target_url: evidence.html_url, state: 'pending',
        description: 'Automatic baseline commit needs a branch in this repository'});
      return;
    }
    const saved = await commitApprovedBaselines({github, owner, repo, pr, run, results,
      reportDir, decision});
    if (!saved) return;
    if (saved.changed) {
      const names = results.filter(r => r.changed).map(r => r.name);
      await github.rest.repos.createCommitStatus({owner, repo, sha: saved.sha,
        context: 'Visual approval', target_url: evidence.html_url, state: 'pending',
        description: 'Verifying approved baselines committed to this PR'});
      try {
        const body = `### Approved visual baselines committed\n\n` +
          `<!-- flora-visual-baselines:${pr.head.sha}:${saved.sha}:${run.id}:${run.run_attempt ?? 1}:${evidence.id}:${names.join(',')} -->\n\n` +
          `@${confirmedBy} confirmed the [screenshots](${evidence.html_url}). ` +
          `[The updated baseline PNGs are now in this PR](https://github.com/${owner}/${repo}/commit/${saved.sha}). ` +
          `A new capture is checking that they render identically.`;
        const receipt = await postComment({github, owner, repo, pull_number, body});
        await github.rest.actions.createWorkflowDispatch({owner, repo,
          workflow_id: 'visual.yml', ref: pr.head.ref, inputs: {pr: String(pr.number)}});
        await github.rest.repos.createCommitStatus({owner, repo, sha: saved.sha,
          context: 'Visual approval', target_url: receipt.html_url, state: 'pending',
          description: 'Verifying approved baselines committed to this PR'});
      } catch (error) {
        await github.rest.repos.createCommitStatus({owner, repo, sha: saved.sha,
          context: 'Visual approval', target_url: evidence.html_url, state: 'failure',
          description: 'Baseline commit needs a new visual capture'});
        throw error;
      }
      return;
    }
  }
  await github.rest.repos.createCommitStatus({owner, repo, sha: pr.head.sha, context: 'Visual approval',
    target_url: evidence?.html_url ?? run.html_url,
    state: !captured || (needsApproval && !evidence) ? 'failure' :
      !needsApproval || confirmedBy ? 'success' : 'pending',
    description: !captured ? 'Visual capture failed' : !needsApproval ? 'No visual review needed' :
      !evidence ? 'Visual evidence missing; rerun publisher' : confirmedBy ? `Visuals confirmed by @${confirmedBy}` :
        'Review images, then comment visuals ok on this PR',
  });
};
