import {describe, expect, it} from "vitest";
import {extensionIdFromPublicKeyDer} from "../../scripts/pack-crx";

// A throwaway keypair's public half. Its id was cross-checked against the
// crx_id Chrome embedded when packing with the matching private key: if this
// derivation drifts, updates.xml and the tester policy files point at an
// extension id Chrome never installs, and updates silently stop arriving.
const PUBLIC_KEY_DER_BASE64 =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoKCFzX4NRQ2StzL86GL6J/iKgNOs2Pll" +
  "XxjIomNH1aJy56UovMY9dXhriTtz/wG5e3nmTpRNPATRBBVG4RyNTtGoDMOGoQnjuPbDApEnXVqN" +
  "mvVXSHFji67b3HsUjbiOW54XogDCzbmIIpl3IG7SzlirjpJahArsd+IczmXE9LzaQUB64ficCz3Y" +
  "DRQVWwRo36mC3D/2BxTPuh0+aYyaJq3fWVDmvqMxstEUstYaCY5uxaPC3EmdpEOOKHahvHJKT8vN" +
  "Nn+VBUH5CpwK6+7ygGXebSngckx9uDOqNG8DmLJ+KcWrEVo6ADd1uBY3hQtetXZe1/RkhLTFGjq4" +
  "dc41bwIDAQAB";

describe("extensionIdFromPublicKeyDer", () => {
  it("derives the id Chrome puts in the packed CRX", () => {
    expect(extensionIdFromPublicKeyDer(Buffer.from(PUBLIC_KEY_DER_BASE64, "base64")))
      .toBe("hfpimbdklaliabelnggnpbmmadgojdpa");
  });

  it("produces a 32-character id in Chrome's a–p alphabet", () => {
    const id = extensionIdFromPublicKeyDer(Buffer.from(PUBLIC_KEY_DER_BASE64, "base64"));
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-p]{32}$/);
  });
});
