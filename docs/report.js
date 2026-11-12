"use strict";(()=>{var v={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",thinsp:" ",ensp:" ",emsp:" ",ndash:"\u2013",mdash:"\u2014",hellip:"\u2026",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D"},P=/<\/?([a-z][a-z0-9]*)[^<>]*>/gi,O=new Set(["sub","sup"]);function w(e){return e.replace(P,(n,t)=>O.has(t.toLowerCase())?"":"\0").replace(/\u0000+/g,(n,t,o)=>new RegExp("\\p{L}","u").test(o[t-1]??"")&&new RegExp("\\p{L}","u").test(o[t+n.length]??"")?" ":"")}function j(e){return e.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(n,t)=>{if(t[0]==="#"){let r=/^#x/i.test(t)?parseInt(t.slice(2),16):parseInt(t.slice(1),10);return r>0&&r<=1114111?String.fromCodePoint(r):n}let o=t.toLowerCase();return Object.hasOwn(v,o)?v[o]:n})}function u(e){let n=e??"";for(let t=0;t<3;t++){let o=j(w(n));if(o===n)break;n=o}return w(n).replace(/[\s ]+/g," ").trim()}function b(e){if(!e)return null;try{let n=new URL(e);return n.protocol==="https:"||n.protocol==="http:"?n.href:null}catch{return null}}var $="https://forrt.org/chromium-extension/";function z(e){let n=e.replace(/-/g,"+").replace(/_/g,"/"),t=atob(n+"=".repeat((4-n.length%4)%4));return Uint8Array.from(t,o=>o.charCodeAt(0))}async function D(e,n){let t=new ReadableStream({start(a){a.enqueue(e),a.close()}}),o=[],r=t.pipeThrough(n).getReader();for(;;){let{done:a,value:i}=await r.read();if(a)break;i&&o.push(i)}let d=o.reduce((a,i)=>a+i.length,0),l=new Uint8Array(d),p=0;for(let a of o)l.set(a,p),p+=a.length;return l}var m=e=>typeof e=="object"&&e!==null,c=e=>typeof e=="string"?e:void 0,f=e=>typeof e=="number"&&Number.isFinite(e)&&e>=0?Math.floor(e):void 0,U=e=>e==="retraction"||e==="concern"?e:void 0,h=e=>Array.isArray(e)?e.filter(m):[],_=/^10\.\d+(?:\.\d+)*\/\S+$/,C=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,g=e=>{let n=c(e);return n!==void 0&&_.test(n)&&!C.test(n)?n:void 0},N=864e13,I=e=>{let n=f(e);return n!==void 0&&n<=N?n:void 0};function x(e){return`https://doi.org/${e.split("/").map(encodeURIComponent).join("/")}`}function R(e){return{title:c(e.title)??"",doi:g(e.doi),url:c(e.url),authors:c(e.authors),year:f(e.year),journal:c(e.journal),outcome:c(e.outcome)}}function M(e){let n=g(e.doi);return n?{title:c(e.title)??n,doi:n,replications:f(e.replications),reproductions:f(e.reproductions),inAtlas:e.inAtlas===!0?!0:void 0,notice:U(e.notice),comments:f(e.comments)}:null}function B(e){if(!m(e)||e.v!==1)return null;let n=c(e.title),t=I(e.generated);if(n===void 0||t===void 0)return null;let o=m(e.notice)?e.notice:null,r=o?g(o.doi):void 0,d=o?U(o.kind):void 0,l=m(e.pubpeer)?e.pubpeer:null;return{v:1,title:n,doi:g(e.doi),authors:c(e.authors),year:f(e.year),sourceUrl:c(e.sourceUrl),generated:t,notice:d?{kind:d,...r?{doi:r}:{}}:null,replications:h(e.replications).map(R),reproductions:h(e.reproductions).map(R),originals:h(e.originals).map(R),references:h(e.references).map(M).filter(p=>p!==null),pubpeer:l?{comments:f(l.comments)??0,url:c(l.url)??""}:null}}async function E(e){try{let n=await D(z(e),new DecompressionStream("deflate-raw"));return B(JSON.parse(new TextDecoder().decode(n)))}catch{return null}}function s(e){return e.replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]??n)}function H(e){let n=e.split(",").map(t=>t.trim()).filter(Boolean);return n.map((t,o)=>{let r=t.toLowerCase();return r==="success"?"successful":r==="not checked"&&n.length===2?o===0?"computation not checked":"robustness not checked":t})}function q(e){let n=e.toLowerCase();return n.includes("success")||n.includes("replicated")||n==="yes"?"background:#d1fae5;color:#065f46;":n.includes("fail")||n==="no"?"background:#fee2e2;color:#991b1b;":"background:#fef8e8;color:#b8860b;"}function G(e){let n=g(e.doi),t=b(e.url)??(n?x(n):null),o=t?`<a href="${s(t)}" target="_blank" rel="noopener">${s(u(e.title))}</a>`:s(u(e.title)),r=[e.authors,e.year?String(e.year):null,e.journal].filter(i=>!!i).join(" \xB7 "),d=e.outcome?H(e.outcome):[],l=d.length>0?`<span class="badges">${d.map(i=>`<span class="badge" style="${q(i)}">${s(i)}</span>`).join("")}</span>`:"",p=n?`<a class="meta-doi" href="${s(x(n))}" target="_blank" rel="noopener">doi:${s(n)}</a>`:"",a=[r?s(r):"",p].filter(Boolean).join(" \xB7 ");return`<li><div class="entry-head">${o}${l}</div>${a?`<div class="meta">${a}</div>`:""}</li>`}function y(e,n){return n.length===0?"":`<section>
      <h2>${s(e)} <span class="count">${n.length}</span></h2>
      <ul class="entries">${n.map(G).join("")}</ul>
    </section>`}function T(e){let n=[];return e.replications&&n.push(`<span class="tag tag-repl">${e.replications} replication${e.replications===1?"":"s"}</span>`),e.reproductions&&n.push(`<span class="tag tag-repro">${e.reproductions} reproduction${e.reproductions===1?"":"s"}</span>`),e.inAtlas&&n.push('<span class="tag tag-atlas">In the FLoRA Replication Atlas</span>'),e.notice==="retraction"&&n.push('<span class="tag tag-retracted">Retracted</span>'),e.notice==="concern"&&n.push('<span class="tag tag-concern">Concern</span>'),e.comments&&n.push(`<span class="tag tag-pubpeer">${e.comments} PubPeer comment${e.comments===1?"":"s"}</span>`),n.length===0?"":`<li>
      <div class="entry-head"><a href="${s(x(e.doi))}" target="_blank" rel="noopener">${s(u(e.title))}</a></div>
      <div class="tags">${n.join("")}</div>
    </li>`}function K(e){if(!e.notice)return"";let n=e.notice.kind==="retraction",t=n?"notice-retracted":"notice-concern",o=`<strong>${n?"This article has been retracted.":"This article has an expression of concern."}</strong>`,r=g(e.notice.doi);return r?`<a class="notice ${t}"
      href="${s(x(r))}" target="_blank" rel="noopener">
      ${o}
      <span>Read the notice \u2197</span>
    </a>`:`<div class="notice ${t}">${o}</div>`}var A=`
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
  .badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; flex-shrink: 0; max-width: 45%; }
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
`;function S(e){let n=e.replications.length,t=e.reproductions.length,o=e.originals.length,r=e.references.filter(i=>T(i)!==""),d=[n?{n,label:`Replication${n===1?"":"s"}`}:null,t?{n:t,label:`Reproduction${t===1?"":"s"}`}:null,o?{n:o,label:`Original stud${o===1?"y":"ies"}`}:null,e.pubpeer?.comments?{n:e.pubpeer.comments,label:`PubPeer comment${e.pubpeer.comments===1?"":"s"}`}:null].filter(i=>i!==null),l=b(e.sourceUrl),p=l?`<a href="${s(l)}" target="_blank" rel="noopener">${s(u(e.title))}</a>`:s(u(e.title)),a=[e.authors,e.year?String(e.year):null].filter(i=>!!i).join(" \xB7 ");return`<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">Report</span>
    </div>
    <div class="head">
      <h1>${p}</h1>
      ${a?`<div class="byline">${s(a)}</div>`:""}
      ${e.doi?`<div class="doi">${s(e.doi)}</div>`:""}
    </div>
    ${K(e)}
    ${d.length?`<div class="stats">${d.map(i=>`<div class="stat"><b>${i.n}</b><span>${s(i.label)}</span></div>`).join("")}</div>`:""}
    ${y("Replications",e.replications)}
    ${y("Reproductions",e.reproductions)}
    ${y("Original papers",e.originals)}
    ${r.length?`<section>
      <h2>Flagged references <span class="count">${r.length}</span></h2>
      <ul class="entries">${r.map(T).join("")}</ul>
    </section>`:""}
    <div class="colophon">
      Compiled by <a href="${$}">FORRT ORE</a> on
      ${s(new Date(e.generated).toLocaleDateString(void 0,{dateStyle:"long"}))}
      from FLoRA, Retraction Watch, Unpaywall and PubPeer.
      Replication evidence is a starting point for judgement, not a verdict.
    </div>
  </div>`}var k=document.getElementById("report");function J(){let e=document.createElement("style");e.textContent=A,document.head.appendChild(e)}function F(e){k.innerHTML=`<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Report</span></div>
      <div class="head"><h1>${e}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`}async function L(){J();let e=location.hash.slice(1);if(!e){F("No report in this link");return}let n=await E(e);if(!n){F("This report link could not be read");return}document.title=`${u(n.title)} \u2014 FORRT ORE report`,k.innerHTML=S(n);let t=document.createElement("a");t.className="install",t.href=$,t.textContent="Get FORRT ORE \u2014 see this for every paper you read \u2192",k.appendChild(t)}L();window.addEventListener("hashchange",()=>void L());})();
