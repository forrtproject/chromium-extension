"use strict";(()=>{var g="https://forrt.org/chromium-extension/";function y(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t+"=".repeat((4-t.length%4)%4));return Uint8Array.from(n,i=>i.charCodeAt(0))}async function $(e,t){let n=new ReadableStream({start(o){o.enqueue(e),o.close()}}),i=[],a=n.pipeThrough(t).getReader();for(;;){let{done:o,value:d}=await a.read();if(o)break;d&&i.push(d)}let s=i.reduce((o,d)=>o+d.length,0),c=new Uint8Array(s),l=0;for(let o of i)c.set(o,l),l+=o.length;return c}async function h(e){try{let t=await $(y(e),new DecompressionStream("deflate-raw")),n=JSON.parse(new TextDecoder().decode(t));return n.v===1&&typeof n.title=="string"?n:null}catch{return null}}function r(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function v(e){let t=e.toLowerCase();return t.includes("success")||t.includes("replicated")||t==="yes"?"background:#d1fae5;color:#065f46;":t.includes("fail")||t==="no"?"background:#fee2e2;color:#991b1b;":"background:#fef8e8;color:#b8860b;"}function w(e){let t=e.url??(e.doi?`https://doi.org/${e.doi}`:null),n=t?`<a href="${r(t)}" target="_blank" rel="noopener">${r(e.title)}</a>`:r(e.title),i=[e.authors,e.year?String(e.year):null,e.journal].filter(s=>!!s).join(" \xB7 "),a=e.outcome?`<span class="badge" style="${v(e.outcome)}">${r(e.outcome)}</span>`:"";return`<li><div class="entry-head">${n}${a}</div>${i?`<div class="meta">${r(i)}</div>`:""}</li>`}function p(e,t){return t.length===0?"":`<section>
      <h2>${r(e)} <span class="count">${t.length}</span></h2>
      <ul class="entries">${t.map(w).join("")}</ul>
    </section>`}function f(e){let t=[];return e.replications&&t.push(`<span class="tag tag-repl">${e.replications} replication${e.replications===1?"":"s"}</span>`),e.reproductions&&t.push(`<span class="tag tag-repro">${e.reproductions} reproduction${e.reproductions===1?"":"s"}</span>`),e.inAtlas&&t.push('<span class="tag tag-atlas">In the Atlas</span>'),e.notice==="retraction"&&t.push('<span class="tag tag-retracted">Retracted</span>'),e.notice==="concern"&&t.push('<span class="tag tag-concern">Concern</span>'),e.comments&&t.push(`<span class="tag tag-pubpeer">${e.comments} PubPeer comment${e.comments===1?"":"s"}</span>`),t.length===0?"":`<li>
      <div class="entry-head"><a href="https://doi.org/${r(e.doi)}" target="_blank" rel="noopener">${r(e.title)}</a></div>
      <div class="tags">${t.join("")}</div>
    </li>`}function k(e){if(!e.notice)return"";let t=e.notice.kind==="retraction";return`<a class="notice ${t?"notice-retracted":"notice-concern"}"
      href="https://doi.org/${r(e.notice.doi)}" target="_blank" rel="noopener">
      <strong>${t?"This article has been retracted.":"This article has an expression of concern."}</strong>
      <span>Read the notice \u2197</span>
    </a>`}var m=`
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1f2328; background: #f6f7f9; line-height: 1.5;
  }
  .sheet { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }
  .masthead { background: linear-gradient(135deg,#853953,#612D53); color: #fff;
    padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .masthead .brand { background: rgba(255,255,255,0.2); font-weight: 700; font-size: 13px;
    padding: 3px 9px; border-radius: 5px; letter-spacing: 0.3px; }
  .masthead .what { font-size: 14px; font-weight: 500; }
  .head { padding: 24px; border-bottom: 1px solid #e8e8e8; }
  .head h1 { margin: 0 0 6px; font-size: 22px; line-height: 1.3; color: #853953; }
  .head h1 a { color: inherit; text-decoration: none; }
  .head .byline { font-size: 13px; color: #5f6368; }
  .head .doi { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #5f6368; margin-top: 6px; }
  .stats { display: flex; gap: 12px; padding: 20px 24px; flex-wrap: wrap; }
  .stat { flex: 1; min-width: 120px; background: #f9f0f4; border: 1px solid #d4a5b8;
    border-radius: 8px; padding: 14px; text-align: center; }
  .stat b { display: block; font-size: 24px; font-weight: 600; color: #853953; line-height: 1; }
  .stat span { font-size: 11px; color: #612D53; font-weight: 500; }
  .notice { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin: 0 24px 20px; padding: 12px 14px; border-radius: 8px; text-decoration: none;
    font-size: 13px; }
  .notice-retracted { background: #fdecef; border: 1px solid #f5a3b4; border-left: 4px solid #FF1744; color: #a30d2d; }
  .notice-concern { background: #fff7ed; border: 1px solid #fdba74; border-left: 4px solid #ea580c; color: #9a3412; }
  section { border-top: 1px solid #e8e8e8; padding: 18px 24px; }
  section h2 { margin: 0 0 12px; font-size: 12px; font-weight: 600; color: #5f6368;
    text-transform: uppercase; letter-spacing: 0.5px; }
  section h2 .count { color: #853953; }
  .entries { list-style: none; margin: 0; padding: 0; }
  .entries li { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
  .entries li:last-child { border-bottom: 0; }
  .entry-head { display: flex; align-items: flex-start; gap: 8px; }
  .entry-head a { font-size: 13px; font-weight: 500; color: #853953; text-decoration: none; }
  .badge { flex-shrink: 0; font-size: 10px; font-weight: 600; padding: 1px 8px; border-radius: 10px; }
  .meta { font-size: 11px; color: #5f6368; margin-top: 2px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .tag { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 10px; }
  .tag-repl { background: #e0f2fe; color: #0369a1; }
  .tag-repro { background: #ede9fe; color: #6d28d9; }
  .tag-atlas { background: #fef9c3; color: #854d0e; }
  .tag-retracted { background: #FF1744; color: #fff; }
  .tag-concern { background: #fff7ed; color: #9a3412; border: 1px solid #ea580c; }
  .tag-pubpeer { background: #e6efec; color: #446058; }
  .colophon { padding: 18px 24px; border-top: 1px solid #e8e8e8; font-size: 11px; color: #5f6368; }
  .colophon a { color: #853953; }
  .install { display: block; margin: 20px auto 0; max-width: 760px; text-align: center;
    padding: 14px; background: #fff; border: 1px solid #d4a5b8; border-radius: 10px;
    font-size: 13px; color: #853953; text-decoration: none; font-weight: 600; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; max-width: none; }
    .install { display: none; }
    a { text-decoration: none; color: inherit; }
    section { break-inside: avoid; }
  }
`;function b(e){let t=e.replications.length,n=e.reproductions.length,i=e.originals.length,a=e.references.filter(o=>f(o)!==""),s=[t?{n:t,label:`Replication${t===1?"":"s"}`}:null,n?{n,label:`Reproduction${n===1?"":"s"}`}:null,i?{n:i,label:`Original stud${i===1?"y":"ies"}`}:null,e.pubpeer?.comments?{n:e.pubpeer.comments,label:`PubPeer comment${e.pubpeer.comments===1?"":"s"}`}:null].filter(o=>o!==null),c=e.sourceUrl?`<a href="${r(e.sourceUrl)}" target="_blank" rel="noopener">${r(e.title)}</a>`:r(e.title),l=[e.authors,e.year?String(e.year):null].filter(o=>!!o).join(" \xB7 ");return`<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">Meta Report</span>
    </div>
    <div class="head">
      <h1>${c}</h1>
      ${l?`<div class="byline">${r(l)}</div>`:""}
      ${e.doi?`<div class="doi">${r(e.doi)}</div>`:""}
    </div>
    ${k(e)}
    ${s.length?`<div class="stats">${s.map(o=>`<div class="stat"><b>${o.n}</b><span>${r(o.label)}</span></div>`).join("")}</div>`:""}
    ${p("Replications",e.replications)}
    ${p("Reproductions",e.reproductions)}
    ${p("Original papers",e.originals)}
    ${a.length?`<section>
      <h2>Flagged references <span class="count">${a.length}</span></h2>
      <ul class="entries">${a.map(f).join("")}</ul>
    </section>`:""}
    <div class="colophon">
      Compiled by <a href="${g}">FORRT ORE</a> on
      ${r(new Date(e.generated).toLocaleDateString(void 0,{dateStyle:"long"}))}
      from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.
      Replication evidence is a starting point for judgement, not a verdict.
    </div>
  </div>`}var u=document.getElementById("report");function T(){let e=document.createElement("style");e.textContent=m,document.head.appendChild(e)}function x(e){u.innerHTML=`<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Meta Report</span></div>
      <div class="head"><h1>${e}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`}async function R(){T();let e=location.hash.slice(1);if(!e){x("No report in this link");return}let t=await h(e);if(!t){x("This report link could not be read");return}document.title=`${t.title} \u2014 FORRT ORE Meta Report`,u.innerHTML=b(t);let n=document.createElement("a");n.className="install",n.href=g,n.textContent="Get FORRT ORE \u2014 see this for every paper you read \u2192",u.appendChild(n)}R();window.addEventListener("hashchange",()=>void R());})();
