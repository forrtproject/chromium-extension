import {beforeEach, describe, expect, it, vi} from "vitest";
import {createIndicatorPill, updateIndicatorPillBadges} from "../../src/shared/indicator-pill";
import {lookupPubPeerForDoi} from "../../src/shared/pubpeer-api";
import {renderSidePanel} from "../../src/content-general/injector";
import type {DoiString, LookupState} from "../../src/shared/types";
import {mockResult} from "../helpers";
vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: vi.fn()}));
vi.mock("../../src/shared/settings", () => ({getSettings: vi.fn().mockResolvedValue({email:"test@example.com"})}));
const doi = "10.1037/pspp0000136" as DoiString;
const state = new Map<DoiString, LookupState>();
function repaint() {updateIndicatorPillBadges(document, state, () => [], "pills", undefined, {generation:()=>0});}
function make() {const pill = createIndicatorPill({doi, presentation:"marker", oaStatus:Promise.resolve({isOa:true,url:"https://example.org/paper"})});document.body.append(pill);return pill;}
beforeEach(()=>{document.body.innerHTML="";state.clear();vi.mocked(lookupPubPeerForDoi).mockResolvedValue(null);});
describe("document editor marker",()=>{
 it("dims every segment after negative checks, even with open access",async()=>{
  const pill=make();expect(pill.dataset.floraMarkerState).toBe("checking");
  state.set(doi,{status:"no-match"});repaint();
  await vi.waitFor(()=>expect(pill.dataset.floraMarkerState).toBe("empty"));
  const trigger=pill.querySelector<HTMLElement>('[role="button"]')!;
  expect(trigger.title).toContain("No replication evidence");
  expect(trigger.querySelector('[data-flora-doi-segment]')).not.toBeNull();
  expect(trigger.querySelector<HTMLElement>('[data-flora-badge-segment]')!.style.background).toBe("transparent");
  trigger.click();expect(pill.querySelector<HTMLElement>('[data-flora-popover]')!.style.display).toBe("flex");
  expect(pill.querySelector('[data-flora-popover]')!.textContent).toContain("Open Access");
  expect(document.querySelector('#flora-pubpeer-panel')).toBeNull();
 });
 it("shows the pill's segments, collapsed to icons until hover",()=>{
  const pill=make();const trigger=pill.querySelector<HTMLElement>('[role="button"]')!;
  expect([...trigger.querySelectorAll('[data-flora-segment]')].map(s=>s.getAttribute('data-flora-doi-segment')!==null||s.getAttribute('data-flora-oa-segment')!==null
   ||s.getAttribute('data-flora-pubpeer-segment')!==null||s.getAttribute('data-flora-badge-segment')!==null)).toEqual([true,true,true,true]);
  const label=()=>trigger.querySelector<HTMLElement>('[data-flora-doi-segment] [data-flora-segment-label]')!;
  expect(label().textContent).toBe("DOI");
  expect(label().style.maxWidth).toBe("0px");
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  expect(label().style.maxWidth).toBe("96px");
  trigger.dispatchEvent(new MouseEvent("mouseleave"));
  expect(label().style.maxWidth).toBe("0px");
 });
 it("leaves labels folded away when the margin has no room",()=>{
  const pill=make();const trigger=pill.querySelector<HTMLElement>('[role="button"]')!;
  vi.spyOn(trigger,"getBoundingClientRect").mockReturnValue({width:120,right:window.innerWidth-20} as DOMRect);
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  expect([...trigger.querySelectorAll<HTMLElement>('[data-flora-segment-label]')].map(l=>l.style.maxWidth))
   .toEqual(["0px","0px","0px","0px"]);
 });
 it("spends the room it has on the leading labels",()=>{
  const pill=make();const trigger=pill.querySelector<HTMLElement>('[role="button"]')!;
  vi.spyOn(trigger,"getBoundingClientRect").mockReturnValue({width:120,right:window.innerWidth-8-115} as DOMRect);
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  expect([...trigger.querySelectorAll<HTMLElement>('[data-flora-segment-label]')].map(l=>l.style.maxWidth))
   .toEqual(["96px","0px","0px","0px"]);
 });
 it("strikes an empty label through, but only once it is shown",()=>{
  const pill=make();const trigger=pill.querySelector<HTMLElement>('[role="button"]')!;
  const oa=trigger.querySelector<HTMLElement>('[data-flora-oa-segment]')!;
  const doiSegment=trigger.querySelector<HTMLElement>('[data-flora-doi-segment]')!;
  expect(oa.style.textDecoration).toBe("none");
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  expect(oa.style.textDecoration).toBe("line-through");
  expect(doiSegment.style.textDecoration).toBe("none");
 });
 it("keeps labels out once a lookup rebuilds a segment",async()=>{
  const pill=make();const result=mockResult();result.record.stats.n_replications_total=2;
  state.set(doi,{status:"matched",result,source:"extracted"});repaint();
  const label=pill.querySelector<HTMLElement>('[data-flora-badge-segment] [data-flora-segment-label]')!;
  expect(label.textContent).toBe("Reps");expect(label.style.maxWidth).toBe("0px");
 });
 it("fills for PubPeer comments without FORRT evidence",async()=>{
  vi.mocked(lookupPubPeerForDoi).mockResolvedValue({total_comments:2,url:"https://pubpeer.com/publications/abc",title:"Paper"} as Awaited<ReturnType<typeof lookupPubPeerForDoi>>);
  const pill=make();state.set(doi,{status:"no-match"});repaint();
  await vi.waitFor(()=>expect(pill.dataset.floraMarkerState).toBe("filled"));
  expect(pill.querySelector('[role="button"]')!.getAttribute("aria-label")).toContain("2 PubPeer comments");
 });
 it("fills when FORRT evidence arrives after creation",async()=>{
  const pill=make();const result=mockResult();result.record.stats.n_replications_total=2;
  state.set(doi,{status:"matched",result,source:"extracted"});repaint();
  expect(pill.dataset.floraMarkerState).toBe("filled");
 });
 it("fills for a replication linked to an original study",()=>{
  const pill=make();const result=mockResult();
  result.record.stats.n_replications_total=0;result.record.stats.n_reproductions_total=0;result.record.stats.n_originals_total=1;
  state.set(doi,{status:"matched",result,source:"extracted"});repaint();
  expect(pill.dataset.floraMarkerState).toBe("filled");
  expect(pill.querySelector<HTMLElement>('[role="button"]')!.title).toContain("1 linked study in the FLoRA Replication Atlas");
 });
 it("offers retry for unavailable document PubPeer checks",async()=>{
  const retry=vi.fn().mockResolvedValue(undefined);
  renderSidePanel([],[],state,new Map(),new Map(),[],"Document",retry,{documentMode:true});
  const panel=document.querySelector('#flora-pubpeer-panel')!;
  expect(panel.textContent).toContain("PubPeer unavailable");
  const button=[...panel.querySelectorAll('button')].find(button=>button.textContent==='Retry')!;
  button.click();expect(retry).toHaveBeenCalledOnce();
 });
 it("distinguishes failed checks from an empty result",async()=>{
  vi.mocked(lookupPubPeerForDoi).mockRejectedValue(new Error("offline"));
  const pill=make();state.set(doi,{status:"no-match"});repaint();
  await vi.waitFor(()=>expect(pill.dataset.floraMarkerState).toBe("unavailable"));
  expect(pill.querySelector<HTMLElement>('[role="button"]')!.title).toContain("unavailable");
 });
 it("stays away from a document with no references or DOIs",()=>{
  renderSidePanel([],[],state,new Map(),new Map(),[],"Document 1",undefined,{documentMode:true});
  expect(document.querySelector('#flora-pubpeer-panel')).toBeNull();
 });
 it("clears the panel once the last document reference goes",()=>{
  state.set(doi,{status:"no-match"});
  renderSidePanel([],[{doi,title:"A referenced study"}],state,new Map([[doi,"reference"]]),new Map(),[],"Document 1",undefined,{documentMode:true});
  expect(document.querySelector('#flora-pubpeer-panel')).not.toBeNull();
  renderSidePanel([],[],state,new Map(),new Map(),[],"Document 1",undefined,{documentMode:true});
  expect(document.querySelector('#flora-pubpeer-panel')).toBeNull();
 });
 it("reuses the report for a document without an article PubPeer empty state",()=>{
  state.set(doi,{status:"no-match"});
  renderSidePanel([], [{doi,title:"A referenced study"}],state,new Map([[doi,"reference"]]),new Map(),[],"Document 1",undefined,{documentMode:true});
  const panel=document.querySelector('#flora-pubpeer-panel')!;
  expect(panel.textContent).toContain("Meta Report");expect(panel.textContent).toContain("Document 1");
  expect(panel.textContent).toContain("A referenced study");expect(panel.textContent).not.toContain("This article hasn't been discussed");
 });
});
