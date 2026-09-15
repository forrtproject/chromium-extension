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
describe("Word F marker",()=>{
 it("shows an outlined F after negative checks, even with open access",async()=>{
  const pill=make();expect(pill.dataset.floraMarkerState).toBe("checking");
  state.set(doi,{status:"no-match"});repaint();
  await vi.waitFor(()=>expect(pill.dataset.floraMarkerState).toBe("empty"));
  const trigger=pill.querySelector<HTMLElement>('[role="button"]')!;
  expect(trigger.title).toContain("No replication evidence");
  expect(getComputedStyle(trigger.querySelector('[data-flora-doi-segment]')!).display).toBe("none");
  trigger.click();expect(pill.querySelector<HTMLElement>('[data-flora-popover]')!.style.display).toBe("flex");
  expect(pill.querySelector('[data-flora-popover]')!.textContent).toContain("Open Access");
  expect(document.querySelector('#flora-pubpeer-panel')).toBeNull();
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
 it("reuses the report for a document without an article PubPeer empty state",()=>{
  state.set(doi,{status:"no-match"});
  renderSidePanel([], [{doi,title:"A referenced study"}],state,new Map([[doi,"reference"]]),new Map(),[],"Document 1",undefined,{documentMode:true});
  const panel=document.querySelector('#flora-pubpeer-panel')!;
  expect(panel.textContent).toContain("Meta Report");expect(panel.textContent).toContain("Document 1");
  expect(panel.textContent).toContain("A referenced study");expect(panel.textContent).not.toContain("This article hasn't been discussed");
 });
});
