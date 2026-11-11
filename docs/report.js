"use strict";(()=>{var U={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",thinsp:" ",ensp:" ",emsp:" ",ndash:"\u2013",mdash:"\u2014",hellip:"\u2026",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D"},Y=/<\/?([a-z][a-z0-9]*)[^<>]*>/gi,W=new Set(["sub","sup"]);function C(e){return e.replace(Y,(t,n)=>W.has(n.toLowerCase())?"":"\0").replace(/\u0000+/g,(t,n,r)=>new RegExp("\\p{L}","u").test(r[n-1]??"")&&new RegExp("\\p{L}","u").test(r[n+t.length]??"")?" ":"")}function Q(e){return e.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(t,n)=>{if(n[0]==="#"){let i=/^#x/i.test(n)?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return i>0&&i<=1114111?String.fromCodePoint(i):t}let r=n.toLowerCase();return Object.hasOwn(U,r)?U[r]:t})}function m(e){let t=e??"";for(let n=0;n<3;n++){let r=Q(C(t));if(r===t)break;t=r}return C(t).replace(/[\s ]+/g," ").trim()}function E(e){if(!e)return null;try{let t=new URL(e);return t.protocol==="https:"||t.protocol==="http:"?t.href:null}catch{return null}}var T=class extends Error{},N=new Map;function X(e){let t=N.get(e);if(t)return t;let n=0,r=o=>{throw new T(`${o} at ${n} in ${JSON.stringify(e)}`)},i=()=>{for(;n<e.length&&/\s/.test(e[n]);)n++},c=()=>{i();let o=/^[^\s{},]+/.exec(e.slice(n));return o||r("expected a name"),n+=o[0].length,o[0]},d=(o,l)=>{let R=[],f="",L=()=>{f&&R.push({kind:"text",text:f}),f=""};for(;n<e.length;){let b=e[n];if(b==="'"){let h=e[n+1];if(h==="'"){f+="'",n+=2;continue}if(h==="{"||h==="}"||h==="#"){let g=e.indexOf("'",n+1);if(g<0){f+=e.slice(n+1),n=e.length;continue}f+=e.slice(n+1,g),n=g+1;continue}f+=b,n++;continue}if(b==="}"){l||r("unmatched }");break}if(b==="#"&&o){L(),R.push({kind:"pound"}),n++;continue}if(b==="{"){L(),n++;let h=c();if(i(),e[n]==="}"){n++,R.push({kind:"arg",name:h});continue}e[n]!==","&&r("expected , or }"),n++;let g=c();g!=="plural"&&g!=="select"&&r(`unsupported argument type ${g}`),i(),e[n]!==","&&r("expected ,"),n++;let v={};for(;;){if(i(),e[n]==="}"){n++;break}let J=c();i(),e[n]!=="{"&&r("expected { after option"),n++,v[J]=d(g==="plural",!0),e[n]!=="}"&&r("unclosed option"),n++}v.other||r(`${g} needs an "other" option`),R.push({kind:g,name:h,options:v});continue}f+=b,n++}return L(),R},s=d(!1,!1);return n<e.length&&r("trailing input"),N.set(e,s),s}var F=new Map;function Z(e,t){let n=F.get(e);return n||(n=new Intl.PluralRules(e),F.set(e,n)),n.select(t)}function P(e,t={},n="en"){let r=(i,c)=>{let d="";for(let s of i)if(s.kind==="text")d+=s.text;else if(s.kind==="pound")d+=c==null?"#":c.toLocaleString(n);else if(s.kind==="arg"){let o=t[s.name];d+=o==null?`{${s.name}}`:typeof o=="number"?o.toLocaleString(n):o}else if(s.kind==="plural"){let o=Number(t[s.name]??0),l=s.options[`=${o}`]??s.options[Z(n,o)]??s.options.other;d+=r(l,o)}else{let o=s.options[String(t[s.name])]??s.options.other;d+=r(o,c)}return d};return r(X(e),null)}var j="en",ee={};function _(){return j}function D(e,t,n){let r=ee[e];if(r!=null)try{return P(r,n,j)}catch{}return P(t,n,"en")}function u(e,t,n){return D(e,t,n)}var te={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},ne=e=>e.replace(/[&<>"']/g,t=>te[t]);function z(e,t,n){let r={};for(let[i,c]of Object.entries(n??{}))r[i]=typeof c=="string"?ne(c):c;return D(e,t,r)}var O="https://forrt.org/chromium-extension/";function re(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t+"=".repeat((4-t.length%4)%4));return Uint8Array.from(n,r=>r.charCodeAt(0))}async function oe(e,t){let n=new ReadableStream({start(o){o.enqueue(e),o.close()}}),r=[],i=n.pipeThrough(t).getReader();for(;;){let{done:o,value:l}=await i.read();if(o)break;l&&r.push(l)}let c=r.reduce((o,l)=>o+l.length,0),d=new Uint8Array(c),s=0;for(let o of r)d.set(o,s),s+=o.length;return d}var $=e=>typeof e=="object"&&e!==null,p=e=>typeof e=="string"?e:void 0,x=e=>typeof e=="number"&&Number.isFinite(e)&&e>=0?Math.floor(e):void 0,H=e=>e==="retraction"||e==="concern"?e:void 0,k=e=>Array.isArray(e)?e.filter($):[],ie=/^10\.\d+(?:\.\d+)*\/\S+$/,se=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,y=e=>{let t=p(e);return t!==void 0&&ie.test(t)&&!se.test(t)?t:void 0},ae=864e13,ce=e=>{let t=x(e);return t!==void 0&&t<=ae?t:void 0};function w(e){return`https://doi.org/${e.split("/").map(encodeURIComponent).join("/")}`}function S(e){return{title:p(e.title)??"",doi:y(e.doi),url:p(e.url),authors:p(e.authors),year:x(e.year),journal:p(e.journal),outcome:p(e.outcome)}}function le(e){let t=y(e.doi);return t?{title:p(e.title)??t,doi:t,replications:x(e.replications),reproductions:x(e.reproductions),inAtlas:e.inAtlas===!0?!0:void 0,notice:H(e.notice),comments:x(e.comments)}:null}function de(e){if(!$(e)||e.v!==1)return null;let t=p(e.title),n=ce(e.generated);if(t===void 0||n===void 0)return null;let r=$(e.notice)?e.notice:null,i=r?y(r.doi):void 0,c=r?H(r.kind):void 0,d=$(e.pubpeer)?e.pubpeer:null;return{v:1,title:t,doi:y(e.doi),authors:p(e.authors),year:x(e.year),sourceUrl:p(e.sourceUrl),generated:n,notice:c?{kind:c,...i?{doi:i}:{}}:null,replications:k(e.replications).map(S),reproductions:k(e.reproductions).map(S),originals:k(e.originals).map(S),references:k(e.references).map(le).filter(s=>s!==null),pubpeer:d?{comments:x(d.comments)??0,url:p(d.url)??""}:null}}async function q(e){try{let t=await oe(re(e),new DecompressionStream("deflate-raw"));return de(JSON.parse(new TextDecoder().decode(t)))}catch{return null}}function a(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function ue(e){let t=e.split(",").map(n=>n.trim()).filter(Boolean);return t.map((n,r)=>{let i=n.toLowerCase();return i==="success"?"successful":i==="not checked"&&t.length===2?r===0?"computation not checked":"robustness not checked":n})}function pe(e){let t=e.toLowerCase();return t.includes("success")||t.includes("replicated")||t==="yes"?"background:#d1fae5;color:#065f46;":t.includes("fail")||t==="no"?"background:#fee2e2;color:#991b1b;":"background:#fef8e8;color:#b8860b;"}function ge(e){let t=y(e.doi),n=E(e.url)??(t?w(t):null),r=n?`<a href="${a(n)}" target="_blank" rel="noopener">${a(m(e.title))}</a>`:a(m(e.title)),i=[e.authors,e.year?String(e.year):null,e.journal].filter(l=>!!l).join(" \xB7 "),c=e.outcome?ue(e.outcome):[],d=c.length>0?`<span class="badges">${c.map(l=>`<span class="badge" style="${pe(l)}">${a(l)}</span>`).join("")}</span>`:"",s=t?`<a class="meta-doi" href="${a(w(t))}" target="_blank" rel="noopener">doi:${a(t)}</a>`:"",o=[i?a(i):"",s].filter(Boolean).join(" \xB7 ");return`<li><div class="entry-head">${r}${d}</div>${o?`<div class="meta">${o}</div>`:""}</li>`}function A(e,t){return t.length===0?"":`<section>
      <h2>${a(e)} <span class="count">${t.length}</span></h2>
      <ul class="entries">${t.map(ge).join("")}</ul>
    </section>`}function I(e){let t=[],n=(r,i)=>`<span class="tag tag-${r}">${a(i)}</span>`;return e.replications&&t.push(n("repl",u("report.tag.replications","{count, plural, one {# replication} other {# replications}}",{count:e.replications}))),e.reproductions&&t.push(n("repro",u("report.tag.reproductions","{count, plural, one {# reproduction} other {# reproductions}}",{count:e.reproductions}))),e.inAtlas&&t.push(n("atlas",u("report.tag.inAtlas","In the Atlas"))),e.notice==="retraction"&&t.push(n("retracted",u("report.tag.retracted","Retracted"))),e.notice==="concern"&&t.push(n("concern",u("report.tag.concern","Concern"))),e.comments&&t.push(n("pubpeer",u("report.tag.pubpeerComments","{count, plural, one {# PubPeer comment} other {# PubPeer comments}}",{count:e.comments}))),t.length===0?"":`<li>
      <div class="entry-head"><a href="${a(w(e.doi))}" target="_blank" rel="noopener">${a(m(e.title))}</a></div>
      <div class="tags">${t.join("")}</div>
    </li>`}function fe(e){if(!e.notice)return"";let t=e.notice.kind==="retraction",n=t?"notice-retracted":"notice-concern",r=`<strong>${a(t?u("report.notice.retracted","This article has been retracted."):u("report.notice.concern","This article has an expression of concern."))}</strong>`,i=y(e.notice.doi);return i?`<a class="notice ${n}"
      href="${a(w(i))}" target="_blank" rel="noopener">
      ${r}
      <span>${a(u("report.notice.read","Read the notice \u2197"))}</span>
    </a>`:`<div class="notice ${n}">${r}</div>`}var B=`
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
`;function G(e){let t=e.replications.length,n=e.reproductions.length,r=e.originals.length,i=e.references.filter(l=>I(l)!==""),c=[t?{n:t,label:u("report.stat.replications","{count, plural, one {Replication} other {Replications}}",{count:t})}:null,n?{n,label:u("report.stat.reproductions","{count, plural, one {Reproduction} other {Reproductions}}",{count:n})}:null,r?{n:r,label:u("report.stat.originals","{count, plural, one {Original study} other {Original studies}}",{count:r})}:null,e.pubpeer?.comments?{n:e.pubpeer.comments,label:u("report.stat.pubpeerComments","{count, plural, one {PubPeer comment} other {PubPeer comments}}",{count:e.pubpeer.comments})}:null].filter(l=>l!==null),d=E(e.sourceUrl),s=d?`<a href="${a(d)}" target="_blank" rel="noopener">${a(m(e.title))}</a>`:a(m(e.title)),o=[e.authors,e.year?String(e.year):null].filter(l=>!!l).join(" \xB7 ");return`<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">${a(u("report.title","Meta Report"))}</span>
    </div>
    <div class="head">
      <h1>${s}</h1>
      ${o?`<div class="byline">${a(o)}</div>`:""}
      ${e.doi?`<div class="doi">${a(e.doi)}</div>`:""}
    </div>
    ${fe(e)}
    ${c.length?`<div class="stats">${c.map(l=>`<div class="stat"><b>${l.n}</b><span>${a(l.label)}</span></div>`).join("")}</div>`:""}
    ${A(u("report.section.replications","Replications"),e.replications)}
    ${A(u("report.section.reproductions","Reproductions"),e.reproductions)}
    ${A(u("report.section.originals","Original papers"),e.originals)}
    ${i.length?`<section>
      <h2>${a(u("report.section.flaggedRefs","Flagged references"))} <span class="count">${i.length}</span></h2>
      <ul class="entries">${i.map(I).join("")}</ul>
    </section>`:""}
    <div class="colophon">
      ${z("report.colophon.compiled",'Compiled by <a href="{url}">FORRT ORE</a> on {date} from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.',{url:O,date:new Date(e.generated).toLocaleDateString(_(),{dateStyle:"long"})})}
      ${a(u("report.colophon.caveat","Replication evidence is a starting point for judgement, not a verdict."))}
    </div>
  </div>`}var M=document.getElementById("report");function me(){let e=document.createElement("style");e.textContent=B,document.head.appendChild(e)}function V(e){M.innerHTML=`<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Meta Report</span></div>
      <div class="head"><h1>${e}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`}async function K(){me();let e=location.hash.slice(1);if(!e){V("No report in this link");return}let t=await q(e);if(!t){V("This report link could not be read");return}document.title=`${m(t.title)} \u2014 FORRT ORE Meta Report`,M.innerHTML=G(t);let n=document.createElement("a");n.className="install",n.href=O,n.textContent="Get FORRT ORE \u2014 see this for every paper you read \u2192",M.appendChild(n)}K();window.addEventListener("hashchange",()=>void K());})();
