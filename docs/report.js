"use strict";(()=>{var C={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",thinsp:" ",ensp:" ",emsp:" ",ndash:"\u2013",mdash:"\u2014",hellip:"\u2026",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D"},Y=/<\/?([a-z][a-z0-9]*)[^<>]*>/gi,W=new Set(["sub","sup"]);function M(e){return e.replace(Y,(t,n)=>W.has(n.toLowerCase())?"":"\0").replace(/\u0000+/g,(t,n,o)=>new RegExp("\\p{L}","u").test(o[n-1]??"")&&new RegExp("\\p{L}","u").test(o[n+t.length]??"")?" ":"")}function Q(e){return e.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(t,n)=>{if(n[0]==="#"){let i=/^#x/i.test(n)?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return i>0&&i<=1114111?String.fromCodePoint(i):t}let o=n.toLowerCase();return Object.hasOwn(C,o)?C[o]:t})}function m(e){let t=e??"";for(let n=0;n<3;n++){let o=Q(M(t));if(o===t)break;t=o}return M(t).replace(/[\s ]+/g," ").trim()}function E(e){if(!e)return null;try{let t=new URL(e);return t.protocol==="https:"||t.protocol==="http:"?t.href:null}catch{return null}}var P=class extends Error{},_=new Map;function X(e){let t=_.get(e);if(t)return t;let n=0,o=r=>{throw new P(`${r} at ${n} in ${JSON.stringify(e)}`)},i=()=>{for(;n<e.length&&/\s/.test(e[n]);)n++},c=()=>{i();let r=/^[^\s{},]+/.exec(e.slice(n));return r||o("expected a name"),n+=r[0].length,r[0]},d=(r,l)=>{let R=[],f="",$=()=>{f&&R.push({kind:"text",text:f}),f=""};for(;n<e.length;){let b=e[n];if(b==="'"){let h=e[n+1];if(h==="'"){f+="'",n+=2;continue}if(h==="{"||h==="}"||h==="#"){let g=e.indexOf("'",n+1);if(g<0){f+=e.slice(n+1),n=e.length;continue}f+=e.slice(n+1,g),n=g+1;continue}f+=b,n++;continue}if(b==="}"){l||o("unmatched }");break}if(b==="#"&&r){$(),R.push({kind:"pound"}),n++;continue}if(b==="{"){$(),n++;let h=c();if(i(),e[n]==="}"){n++,R.push({kind:"arg",name:h});continue}e[n]!==","&&o("expected , or }"),n++;let g=c();g!=="plural"&&g!=="select"&&o(`unsupported argument type ${g}`),i(),e[n]!==","&&o("expected ,"),n++;let v={};for(;;){if(i(),e[n]==="}"){n++;break}let J=c();i(),e[n]!=="{"&&o("expected { after option"),n++,v[J]=d(g==="plural",!0),e[n]!=="}"&&o("unclosed option"),n++}v.other||o(`${g} needs an "other" option`),R.push({kind:g,name:h,options:v});continue}f+=b,n++}return $(),R},s=d(!1,!1);return n<e.length&&o("trailing input"),_.set(e,s),s}var N=new Map;function Z(e,t){let n=N.get(e);return n||(n=new Intl.PluralRules(e),N.set(e,n)),n.select(t)}function T(e,t={},n="en"){let o=(i,c)=>{let d="";for(let s of i)if(s.kind==="text")d+=s.text;else if(s.kind==="pound")d+=c==null?"#":c.toLocaleString(n);else if(s.kind==="arg"){let r=t[s.name];d+=r==null?`{${s.name}}`:typeof r=="number"?r.toLocaleString(n):r}else if(s.kind==="plural"){let r=Number(t[s.name]??0),l=s.options[`=${r}`]??s.options[Z(n,r)]??s.options.other;d+=o(l,r)}else{let r=s.options[String(t[s.name])]??s.options.other;d+=o(r,c)}return d};return o(X(e),null)}var F="en",ee={};function j(){return F}function D(e,t,n){let o=ee[e];if(o!=null)try{return T(o,n,F)}catch{}return T(t,n,"en")}function p(e,t,n){return D(e,t,n)}var te={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},ne=e=>e.replace(/[&<>"']/g,t=>te[t]);function z(e,t,n){let o={};for(let[i,c]of Object.entries(n??{}))o[i]=typeof c=="string"?ne(c):c;return D(e,t,o)}var U="https://forrt.org/chromium-extension/";function oe(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t+"=".repeat((4-t.length%4)%4));return Uint8Array.from(n,o=>o.charCodeAt(0))}async function re(e,t){let n=new ReadableStream({start(r){r.enqueue(e),r.close()}}),o=[],i=n.pipeThrough(t).getReader();for(;;){let{done:r,value:l}=await i.read();if(r)break;l&&o.push(l)}let c=o.reduce((r,l)=>r+l.length,0),d=new Uint8Array(c),s=0;for(let r of o)d.set(r,s),s+=r.length;return d}var w=e=>typeof e=="object"&&e!==null,u=e=>typeof e=="string"?e:void 0,x=e=>typeof e=="number"&&Number.isFinite(e)&&e>=0?Math.floor(e):void 0,H=e=>e==="retraction"||e==="concern"?e:void 0,k=e=>Array.isArray(e)?e.filter(w):[],ie=/^10\.\d+(?:\.\d+)*\/\S+$/,se=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,y=e=>{let t=u(e);return t!==void 0&&ie.test(t)&&!se.test(t)?t:void 0},ae=864e13,ce=e=>{let t=x(e);return t!==void 0&&t<=ae?t:void 0};function L(e){return`https://doi.org/${e.split("/").map(encodeURIComponent).join("/")}`}function S(e){return{title:u(e.title)??"",doi:y(e.doi),url:u(e.url),authors:u(e.authors),year:x(e.year),journal:u(e.journal),outcome:u(e.outcome)}}function le(e){let t=y(e.doi);return t?{title:u(e.title)??t,doi:t,replications:x(e.replications),reproductions:x(e.reproductions),inAtlas:e.inAtlas===!0?!0:void 0,notice:H(e.notice),comments:x(e.comments)}:null}function de(e){if(!w(e)||e.v!==1)return null;let t=u(e.title),n=ce(e.generated);if(t===void 0||n===void 0)return null;let o=w(e.notice)?e.notice:null,i=o?y(o.doi):void 0,c=o?H(o.kind):void 0,d=w(e.pubpeer)?e.pubpeer:null;return{v:1,title:t,doi:y(e.doi),authors:u(e.authors),year:x(e.year),sourceUrl:u(e.sourceUrl),generated:n,notice:c?{kind:c,...i?{doi:i}:{}}:null,replications:k(e.replications).map(S),reproductions:k(e.reproductions).map(S),originals:k(e.originals).map(S),references:k(e.references).map(le).filter(s=>s!==null),pubpeer:d?{comments:x(d.comments)??0,url:u(d.url)??""}:null}}async function q(e){try{let t=await re(oe(e),new DecompressionStream("deflate-raw"));return de(JSON.parse(new TextDecoder().decode(t)))}catch{return null}}function a(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]??t)}function pe(e){let t=e.split(",").map(n=>n.trim()).filter(Boolean);return t.map((n,o)=>{let i=n.toLowerCase();return i==="success"?"successful":i==="not checked"&&t.length===2?o===0?"computation not checked":"robustness not checked":n})}function ue(e){let t=e.toLowerCase();return t.includes("success")||t.includes("replicated")||t==="yes"?"background:#d1fae5;color:#065f46;":t.includes("fail")||t==="no"?"background:#fee2e2;color:#991b1b;":"background:#fef8e8;color:#b8860b;"}function ge(e){let t=y(e.doi),n=E(e.url)??(t?L(t):null),o=n?`<a href="${a(n)}" target="_blank" rel="noopener">${a(m(e.title))}</a>`:a(m(e.title)),i=[e.authors,e.year?String(e.year):null,e.journal].filter(l=>!!l).join(" \xB7 "),c=e.outcome?pe(e.outcome):[],d=c.length>0?`<span class="badges">${c.map(l=>`<span class="badge" style="${ue(l)}">${a(l)}</span>`).join("")}</span>`:"",s=t?`<a class="meta-doi" href="${a(L(t))}" target="_blank" rel="noopener">doi:${a(t)}</a>`:"",r=[i?a(i):"",s].filter(Boolean).join(" \xB7 ");return`<li><div class="entry-head">${o}${d}</div>${r?`<div class="meta">${r}</div>`:""}</li>`}function A(e,t){return t.length===0?"":`<section>
      <h2>${a(e)} <span class="count">${t.length}</span></h2>
      <ul class="entries">${t.map(ge).join("")}</ul>
    </section>`}function I(e){let t=[],n=(o,i)=>`<span class="tag tag-${o}">${a(i)}</span>`;return e.replications&&t.push(n("repl",p("report.tag.replications","{count, plural, one {# replication} other {# replications}}",{count:e.replications}))),e.reproductions&&t.push(n("repro",p("report.tag.reproductions","{count, plural, one {# reproduction} other {# reproductions}}",{count:e.reproductions}))),e.inAtlas&&t.push(n("atlas",p("report.tag.inAtlas","In the Atlas"))),e.notice==="retraction"&&t.push(n("retracted",p("report.tag.retracted","Retracted"))),e.notice==="concern"&&t.push(n("concern",p("report.tag.concern","Concern"))),e.comments&&t.push(n("pubpeer",p("report.tag.pubpeerComments","{count, plural, one {# PubPeer comment} other {# PubPeer comments}}",{count:e.comments}))),t.length===0?"":`<li>
      <div class="entry-head"><a href="${a(L(e.doi))}" target="_blank" rel="noopener">${a(m(e.title))}</a></div>
      <div class="tags">${t.join("")}</div>
    </li>`}function fe(e){if(!e.notice)return"";let t=e.notice.kind==="retraction",n=t?"notice-retracted":"notice-concern",o=`<strong>${a(t?p("report.notice.retracted","This article has been retracted."):p("report.notice.concern","This article has an expression of concern."))}</strong>`,i=y(e.notice.doi);return i?`<a class="notice ${n}"
      href="${a(L(i))}" target="_blank" rel="noopener">
      ${o}
      <span>${a(p("report.notice.read","Read the notice \u2197"))}</span>
    </a>`:`<div class="notice ${n}">${o}</div>`}var B=`
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
`;function G(e){let t=e.replications.length,n=e.reproductions.length,o=e.originals.length,i=e.references.filter(l=>I(l)!==""),c=[t?{n:t,label:p("report.stat.replications","{count, plural, one {Replication} other {Replications}}",{count:t})}:null,n?{n,label:p("report.stat.reproductions","{count, plural, one {Reproduction} other {Reproductions}}",{count:n})}:null,o?{n:o,label:p("report.stat.originals","{count, plural, one {Original study} other {Original studies}}",{count:o})}:null,e.pubpeer?.comments?{n:e.pubpeer.comments,label:p("report.stat.pubpeerComments","{count, plural, one {PubPeer comment} other {PubPeer comments}}",{count:e.pubpeer.comments})}:null].filter(l=>l!==null),d=E(e.sourceUrl),s=d?`<a href="${a(d)}" target="_blank" rel="noopener">${a(m(e.title))}</a>`:a(m(e.title)),r=[e.authors,e.year?String(e.year):null].filter(l=>!!l).join(" \xB7 ");return`<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">${a(p("report.title","Meta Report"))}</span>
    </div>
    <div class="head">
      <h1>${s}</h1>
      ${r?`<div class="byline">${a(r)}</div>`:""}
      ${e.doi?`<div class="doi">${a(e.doi)}</div>`:""}
    </div>
    ${fe(e)}
    ${c.length?`<div class="stats">${c.map(l=>`<div class="stat"><b>${l.n}</b><span>${a(l.label)}</span></div>`).join("")}</div>`:""}
    ${A(p("report.section.replications","Replications"),e.replications)}
    ${A(p("report.section.reproductions","Reproductions"),e.reproductions)}
    ${A(p("report.section.originals","Original papers"),e.originals)}
    ${i.length?`<section>
      <h2>${a(p("report.section.flaggedRefs","Flagged references"))} <span class="count">${i.length}</span></h2>
      <ul class="entries">${i.map(I).join("")}</ul>
    </section>`:""}
    <div class="colophon">
      ${z("report.colophon.compiled",'Compiled by <a href="{url}">FORRT ORE</a> on {date} from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.',{url:U,date:new Date(e.generated).toLocaleDateString(j(),{dateStyle:"long"})})}
      ${a(p("report.colophon.caveat","Replication evidence is a starting point for judgement, not a verdict."))}
    </div>
  </div>`}var O=document.getElementById("report");function me(){let e=document.createElement("style");e.textContent=B,document.head.appendChild(e)}function V(e){O.innerHTML=`<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Meta Report</span></div>
      <div class="head"><h1>${e}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`}async function K(){me();let e=location.hash.slice(1);if(!e){V("No report in this link");return}let t=await q(e);if(!t){V("This report link could not be read");return}document.title=`${m(t.title)} \u2014 FORRT ORE Meta Report`,O.innerHTML=G(t);let n=document.createElement("a");n.className="install",n.href=U,n.textContent="Get FORRT ORE \u2014 see this for every paper you read \u2192",O.appendChild(n)}K();window.addEventListener("hashchange",()=>void K());})();
