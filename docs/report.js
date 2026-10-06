"use strict";(()=>{var h={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",thinsp:" ",ensp:" ",emsp:" ",ndash:"\u2013",mdash:"\u2014",hellip:"\u2026",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D"},v=/<\/?([a-z][a-z0-9]*)[^<>]*>/gi,k=new Set(["sub","sup"]);function m(e){return e.replace(v,(t,n)=>k.has(n.toLowerCase())?"":"\0").replace(/\u0000+/g,(t,n,o)=>new RegExp("\\p{L}","u").test(o[n-1]??"")&&new RegExp("\\p{L}","u").test(o[n+t.length]??"")?" ":"")}function T(e){return e.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(t,n)=>{if(n[0]==="#"){let a=/^#x/i.test(n)?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return a>0&&a<=1114111?String.fromCodePoint(a):t}let o=n.toLowerCase();return Object.hasOwn(h,o)?h[o]:t})}function s(e){let t=e??"";for(let n=0;n<3;n++){let o=T(m(t));if(o===t)break;t=o}return m(t).replace(/[\s ]+/g," ").trim()}var u="https://forrt.org/chromium-extension/";function E(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t+"=".repeat((4-t.length%4)%4));return Uint8Array.from(n,o=>o.charCodeAt(0))}async function S(e,t){let n=new ReadableStream({start(r){r.enqueue(e),r.close()}}),o=[],a=n.pipeThrough(t).getReader();for(;;){let{done:r,value:d}=await a.read();if(r)break;d&&o.push(d)}let l=o.reduce((r,d)=>r+d.length,0),p=new Uint8Array(l),c=0;for(let r of o)p.set(r,c),c+=r.length;return p}async function b(e){try{let t=await S(E(e),new DecompressionStream("deflate-raw")),n=JSON.parse(new TextDecoder().decode(t));return n.v===1&&typeof n.title=="string"?n:null}catch{return null}}function i(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function P(e){let t=e.toLowerCase();return t.includes("success")||t.includes("replicated")||t==="yes"?"background:#d1fae5;color:#065f46;":t.includes("fail")||t==="no"?"background:#fee2e2;color:#991b1b;":"background:#fef8e8;color:#b8860b;"}function O(e){let t=e.url??(e.doi?`https://doi.org/${e.doi}`:null),n=t?`<a href="${i(t)}" target="_blank" rel="noopener">${i(s(e.title))}</a>`:i(s(e.title)),o=[e.authors,e.year?String(e.year):null,e.journal].filter(l=>!!l).join(" \xB7 "),a=e.outcome?`<span class="badge" style="${P(e.outcome)}">${i(e.outcome)}</span>`:"";return`<li><div class="entry-head">${n}${a}</div>${o?`<div class="meta">${i(o)}</div>`:""}</li>`}function g(e,t){return t.length===0?"":`<section>
      <h2>${i(e)} <span class="count">${t.length}</span></h2>
      <ul class="entries">${t.map(O).join("")}</ul>
    </section>`}function x(e){let t=[];return e.replications&&t.push(`<span class="tag tag-repl">${e.replications} replication${e.replications===1?"":"s"}</span>`),e.reproductions&&t.push(`<span class="tag tag-repro">${e.reproductions} reproduction${e.reproductions===1?"":"s"}</span>`),e.inAtlas&&t.push('<span class="tag tag-atlas">In the Atlas</span>'),e.notice==="retraction"&&t.push('<span class="tag tag-retracted">Retracted</span>'),e.notice==="concern"&&t.push('<span class="tag tag-concern">Concern</span>'),e.comments&&t.push(`<span class="tag tag-pubpeer">${e.comments} PubPeer comment${e.comments===1?"":"s"}</span>`),t.length===0?"":`<li>
      <div class="entry-head"><a href="https://doi.org/${i(e.doi)}" target="_blank" rel="noopener">${i(s(e.title))}</a></div>
      <div class="tags">${t.join("")}</div>
    </li>`}function U(e){if(!e.notice)return"";let t=e.notice.kind==="retraction";return`<a class="notice ${t?"notice-retracted":"notice-concern"}"
      href="https://doi.org/${i(e.notice.doi)}" target="_blank" rel="noopener">
      <strong>${t?"This article has been retracted.":"This article has an expression of concern."}</strong>
      <span>Read the notice \u2197</span>
    </a>`}var R=`
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
`;function $(e){let t=e.replications.length,n=e.reproductions.length,o=e.originals.length,a=e.references.filter(r=>x(r)!==""),l=[t?{n:t,label:`Replication${t===1?"":"s"}`}:null,n?{n,label:`Reproduction${n===1?"":"s"}`}:null,o?{n:o,label:`Original stud${o===1?"y":"ies"}`}:null,e.pubpeer?.comments?{n:e.pubpeer.comments,label:`PubPeer comment${e.pubpeer.comments===1?"":"s"}`}:null].filter(r=>r!==null),p=e.sourceUrl?`<a href="${i(e.sourceUrl)}" target="_blank" rel="noopener">${i(s(e.title))}</a>`:i(s(e.title)),c=[e.authors,e.year?String(e.year):null].filter(r=>!!r).join(" \xB7 ");return`<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">Meta Report</span>
    </div>
    <div class="head">
      <h1>${p}</h1>
      ${c?`<div class="byline">${i(c)}</div>`:""}
      ${e.doi?`<div class="doi">${i(e.doi)}</div>`:""}
    </div>
    ${U(e)}
    ${l.length?`<div class="stats">${l.map(r=>`<div class="stat"><b>${r.n}</b><span>${i(r.label)}</span></div>`).join("")}</div>`:""}
    ${g("Replications",e.replications)}
    ${g("Reproductions",e.reproductions)}
    ${g("Original papers",e.originals)}
    ${a.length?`<section>
      <h2>Flagged references <span class="count">${a.length}</span></h2>
      <ul class="entries">${a.map(x).join("")}</ul>
    </section>`:""}
    <div class="colophon">
      Compiled by <a href="${u}">FORRT ORE</a> on
      ${i(new Date(e.generated).toLocaleDateString(void 0,{dateStyle:"long"}))}
      from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.
      Replication evidence is a starting point for judgement, not a verdict.
    </div>
  </div>`}var f=document.getElementById("report");function A(){let e=document.createElement("style");e.textContent=R,document.head.appendChild(e)}function y(e){f.innerHTML=`<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Meta Report</span></div>
      <div class="head"><h1>${e}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`}async function w(){A();let e=location.hash.slice(1);if(!e){y("No report in this link");return}let t=await b(e);if(!t){y("This report link could not be read");return}document.title=`${s(t.title)} \u2014 FORRT ORE Meta Report`,f.innerHTML=$(t);let n=document.createElement("a");n.className="install",n.href=u,n.textContent="Get FORRT ORE \u2014 see this for every paper you read \u2192",f.appendChild(n)}w();window.addEventListener("hashchange",()=>void w());})();
