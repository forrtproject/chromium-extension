"use strict";(()=>{var v={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",thinsp:" ",ensp:" ",emsp:" ",ndash:"\u2013",mdash:"\u2014",hellip:"\u2026",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D"},L=/<\/?([a-z][a-z0-9]*)[^<>]*>/gi,O=new Set(["sub","sup"]);function w(e){return e.replace(L,(t,n)=>O.has(n.toLowerCase())?"":"\0").replace(/\u0000+/g,(t,n,o)=>new RegExp("\\p{L}","u").test(o[n-1]??"")&&new RegExp("\\p{L}","u").test(o[n+t.length]??"")?" ":"")}function z(e){return e.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(t,n)=>{if(n[0]==="#"){let i=/^#x/i.test(n)?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return i>0&&i<=1114111?String.fromCodePoint(i):t}let o=n.toLowerCase();return Object.hasOwn(v,o)?v[o]:t})}function u(e){let t=e??"";for(let n=0;n<3;n++){let o=z(w(t));if(o===t)break;t=o}return w(t).replace(/[\s ]+/g," ").trim()}function x(e){if(!e)return null;try{let t=new URL(e);return t.protocol==="https:"||t.protocol==="http:"?t.href:null}catch{return null}}var $="https://forrt.org/chromium-extension/";function D(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t+"=".repeat((4-t.length%4)%4));return Uint8Array.from(n,o=>o.charCodeAt(0))}async function _(e,t){let n=new ReadableStream({start(l){l.enqueue(e),l.close()}}),o=[],i=n.pipeThrough(t).getReader();for(;;){let{done:l,value:s}=await i.read();if(l)break;s&&o.push(s)}let d=o.reduce((l,s)=>l+s.length,0),a=new Uint8Array(d),p=0;for(let l of o)a.set(l,p),p+=l.length;return a}var h=e=>typeof e=="object"&&e!==null,c=e=>typeof e=="string"?e:void 0,f=e=>typeof e=="number"&&Number.isFinite(e)&&e>=0?Math.floor(e):void 0,E=e=>e==="retraction"||e==="concern"?e:void 0,g=e=>Array.isArray(e)?e.filter(h):[],j=/^10\.\d+(?:\.\d+)*\/\S+$/,C=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,b=e=>{let t=c(e);return t!==void 0&&j.test(t)&&!C.test(t)?t:void 0},M=864e13,N=e=>{let t=f(e);return t!==void 0&&t<=M?t:void 0};function m(e){return`https://doi.org/${e.split("/").map(encodeURIComponent).join("/")}`}function R(e){return{title:c(e.title)??"",doi:b(e.doi),url:c(e.url),authors:c(e.authors),year:f(e.year),journal:c(e.journal),outcome:c(e.outcome)}}function I(e){let t=b(e.doi);return t?{title:c(e.title)??t,doi:t,replications:f(e.replications),reproductions:f(e.reproductions),inAtlas:e.inAtlas===!0?!0:void 0,notice:E(e.notice),comments:f(e.comments)}:null}function B(e){if(!h(e)||e.v!==1)return null;let t=c(e.title),n=N(e.generated);if(t===void 0||n===void 0)return null;let o=h(e.notice)?e.notice:null,i=o?b(o.doi):void 0,d=o?E(o.kind):void 0,a=h(e.pubpeer)?e.pubpeer:null;return{v:1,title:t,doi:c(e.doi),authors:c(e.authors),year:f(e.year),sourceUrl:c(e.sourceUrl),generated:n,notice:d?{kind:d,...i?{doi:i}:{}}:null,replications:g(e.replications).map(R),reproductions:g(e.reproductions).map(R),originals:g(e.originals).map(R),references:g(e.references).map(I).filter(p=>p!==null),pubpeer:a?{comments:f(a.comments)??0,url:c(a.url)??""}:null}}async function U(e){try{let t=await _(D(e),new DecompressionStream("deflate-raw"));return B(JSON.parse(new TextDecoder().decode(t)))}catch{return null}}function r(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function H(e){return e.trim().toLowerCase()==="success"?"successful":e}function q(e){let t=e.toLowerCase();return t.includes("success")||t.includes("replicated")||t==="yes"?"background:#d1fae5;color:#065f46;":t.includes("fail")||t==="no"?"background:#fee2e2;color:#991b1b;":"background:#fef8e8;color:#b8860b;"}function G(e){let t=x(e.url)??(e.doi?m(e.doi):null),n=t?`<a href="${r(t)}" target="_blank" rel="noopener">${r(u(e.title))}</a>`:r(u(e.title)),o=[e.authors,e.year?String(e.year):null,e.journal].filter(p=>!!p).join(" \xB7 "),i=e.outcome?`<span class="badge" style="${q(e.outcome)}">${r(H(e.outcome))}</span>`:"",d=e.doi?`<a class="meta-doi" href="${r(m(e.doi))}" target="_blank" rel="noopener">doi:${r(e.doi)}</a>`:"",a=[o?r(o):"",d].filter(Boolean).join(" \xB7 ");return`<li><div class="entry-head">${n}${i}</div>${a?`<div class="meta">${a}</div>`:""}</li>`}function y(e,t){return t.length===0?"":`<section>
      <h2>${r(e)} <span class="count">${t.length}</span></h2>
      <ul class="entries">${t.map(G).join("")}</ul>
    </section>`}function T(e){let t=[];return e.replications&&t.push(`<span class="tag tag-repl">${e.replications} replication${e.replications===1?"":"s"}</span>`),e.reproductions&&t.push(`<span class="tag tag-repro">${e.reproductions} reproduction${e.reproductions===1?"":"s"}</span>`),e.inAtlas&&t.push('<span class="tag tag-atlas">In the Atlas</span>'),e.notice==="retraction"&&t.push('<span class="tag tag-retracted">Retracted</span>'),e.notice==="concern"&&t.push('<span class="tag tag-concern">Concern</span>'),e.comments&&t.push(`<span class="tag tag-pubpeer">${e.comments} PubPeer comment${e.comments===1?"":"s"}</span>`),t.length===0?"":`<li>
      <div class="entry-head"><a href="${r(m(e.doi))}" target="_blank" rel="noopener">${r(u(e.title))}</a></div>
      <div class="tags">${t.join("")}</div>
    </li>`}function K(e){if(!e.notice)return"";let t=e.notice.kind==="retraction",n=t?"notice-retracted":"notice-concern",o=`<strong>${t?"This article has been retracted.":"This article has an expression of concern."}</strong>`,i=b(e.notice.doi);return i?`<a class="notice ${n}"
      href="${r(m(i))}" target="_blank" rel="noopener">
      ${o}
      <span>Read the notice \u2197</span>
    </a>`:`<div class="notice ${n}">${o}</div>`}var S=`
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
  .meta-doi { color: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; text-decoration: none; overflow-wrap: anywhere; }
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
`;function A(e){let t=e.replications.length,n=e.reproductions.length,o=e.originals.length,i=e.references.filter(s=>T(s)!==""),d=[t?{n:t,label:`Replication${t===1?"":"s"}`}:null,n?{n,label:`Reproduction${n===1?"":"s"}`}:null,o?{n:o,label:`Original stud${o===1?"y":"ies"}`}:null,e.pubpeer?.comments?{n:e.pubpeer.comments,label:`PubPeer comment${e.pubpeer.comments===1?"":"s"}`}:null].filter(s=>s!==null),a=x(e.sourceUrl),p=a?`<a href="${r(a)}" target="_blank" rel="noopener">${r(u(e.title))}</a>`:r(u(e.title)),l=[e.authors,e.year?String(e.year):null].filter(s=>!!s).join(" \xB7 ");return`<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">Meta Report</span>
    </div>
    <div class="head">
      <h1>${p}</h1>
      ${l?`<div class="byline">${r(l)}</div>`:""}
      ${e.doi?`<div class="doi">${r(e.doi)}</div>`:""}
    </div>
    ${K(e)}
    ${d.length?`<div class="stats">${d.map(s=>`<div class="stat"><b>${s.n}</b><span>${r(s.label)}</span></div>`).join("")}</div>`:""}
    ${y("Replications",e.replications)}
    ${y("Reproductions",e.reproductions)}
    ${y("Original papers",e.originals)}
    ${i.length?`<section>
      <h2>Flagged references <span class="count">${i.length}</span></h2>
      <ul class="entries">${i.map(T).join("")}</ul>
    </section>`:""}
    <div class="colophon">
      Compiled by <a href="${$}">FORRT ORE</a> on
      ${r(new Date(e.generated).toLocaleDateString(void 0,{dateStyle:"long"}))}
      from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.
      Replication evidence is a starting point for judgement, not a verdict.
    </div>
  </div>`}var k=document.getElementById("report");function J(){let e=document.createElement("style");e.textContent=S,document.head.appendChild(e)}function F(e){k.innerHTML=`<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Meta Report</span></div>
      <div class="head"><h1>${e}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`}async function P(){J();let e=location.hash.slice(1);if(!e){F("No report in this link");return}let t=await U(e);if(!t){F("This report link could not be read");return}document.title=`${u(t.title)} \u2014 FORRT ORE Meta Report`,k.innerHTML=A(t);let n=document.createElement("a");n.className="install",n.href=$,n.textContent="Get FORRT ORE \u2014 see this for every paper you read \u2192",k.appendChild(n)}P();window.addEventListener("hashchange",()=>void P());})();
