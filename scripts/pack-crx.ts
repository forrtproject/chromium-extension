// Packs dist/ + manifest.json into a signed CRX3 and emits everything Chrome's
// self-hosted update mechanism needs: the update manifest it polls, plus the
// one-time policy files a tester installs to subscribe to the dev channel.
//
// Chrome refuses to install a CRX dragged in from outside the Web Store, so
// self-hosted distribution goes through enterprise policy (ExtensionSettings)
// pointed at our update_url. That policy is what makes updates silent.
//
// Signing is delegated to Chrome itself (--pack-extension) rather than a
// hand-rolled CRX3 writer, so the format stays whatever Chrome accepts.

import {execFileSync} from "node:child_process";
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import {createHash, createPublicKey} from "node:crypto";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

const OUT_DIR = "build";
const CRX_NAME = "flora-dev.crx";
// Stable identifiers so reinstalling a profile replaces the old one.
const PROFILE_UUID = "3f1c9a52-8d47-4a1e-9a2f-6b0d5c7e41aa";
const PAYLOAD_UUID = "9c2e7b14-5a63-4f08-b7d1-2e8a4f60c933";

interface Args {
    version: string;
    crxUrl: string;
    updatesUrl: string;
}

function parseArgs(): Args {
    const get = (name: string): string | undefined => {
        const prefix = `--${name}=`;
        return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
    };
    const version = get("version");
    const crxUrl = get("crx-url");
    const updatesUrl = get("updates-url");
    if (!version || !crxUrl || !updatesUrl) {
        throw new Error(
            "usage: pack-crx --version=0.1.0.42 --crx-url=https://…/flora-dev.crx --updates-url=https://…/updates.xml"
        );
    }
    if (!/^\d+(\.\d+){0,3}$/.test(version)) {
        throw new Error(`version must be 1–4 dot-separated integers, got "${version}"`);
    }
    return {version, crxUrl, updatesUrl};
}

/** The private key, from CRX_PRIVATE_KEY (CI) or CRX_KEY_FILE (local runs). */
function readPrivateKey(): string {
    const inline = process.env.CRX_PRIVATE_KEY;
    if (inline?.includes("PRIVATE KEY")) return inline;
    const keyFile = process.env.CRX_KEY_FILE;
    if (keyFile && existsSync(keyFile)) return readFileSync(keyFile, "utf8");
    throw new Error(
        "No signing key. Set CRX_PRIVATE_KEY (PEM contents) or CRX_KEY_FILE (path to the .pem)."
    );
}

/**
 * A Chrome extension id is the first 16 bytes of the SHA-256 of the DER public
 * key, hex-encoded with 0-f remapped to a-p. Verified against the crx_id Chrome
 * itself embeds in the packed file.
 */
export function extensionIdFromPublicKeyDer(der: Buffer): string {
    const digest = createHash("sha256").update(der).digest().subarray(0, 16);
    return [...digest]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + parseInt(char, 16)));
}

function publicKeyDer(privateKeyPem: string): Buffer {
    return createPublicKey(privateKeyPem).export({type: "spki", format: "der"});
}

export function extensionIdFromPrivateKey(privateKeyPem: string): string {
    return extensionIdFromPublicKeyDer(publicKeyDer(privateKeyPem));
}

function which(command: string): string | null {
    try {
        const found = execFileSync(process.platform === "win32" ? "where" : "which", [command], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return found.split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
    } catch {
        return null;
    }
}

/** Chrome from the environment, the PATH, or a freshly installed Chrome for Testing. */
function resolveChrome(): string {
    if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    for (const candidate of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
        const found = which(candidate);
        if (found) return found;
    }
    const output = execFileSync(
        "npx",
        ["--yes", "@puppeteer/browsers", "install", "chrome@stable"],
        {encoding: "utf8", shell: process.platform === "win32"}
    );
    // The last line is "chrome@<version> <absolute path>".
    const lastLine = output.trim().split(/\r?\n/).pop() ?? "";
    const path = lastLine.slice(lastLine.indexOf(" ") + 1).trim();
    if (!path || !existsSync(path)) throw new Error(`Could not resolve a Chrome binary from: ${output}`);
    return path;
}

function stageExtension(version: string): string {
    const stage = join(OUT_DIR, "crx-src");
    rmSync(stage, {recursive: true, force: true});
    mkdirSync(stage, {recursive: true});

    const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as Record<string, unknown>;
    manifest.version = version;
    writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    cpSync("dist", join(stage, "dist"), {recursive: true});
    return stage;
}

function packCrx(stage: string, privateKeyPem: string): string {
    const chrome = resolveChrome();
    const keyDir = mkdtempSync(join(tmpdir(), "flora-crx-"));
    const keyPath = join(keyDir, "signing.pem");
    writeFileSync(keyPath, privateKeyPem, {mode: 0o600});
    chmodSync(keyPath, 0o600);
    try {
        execFileSync(
            chrome,
            [
                `--pack-extension=${resolve(stage)}`,
                `--pack-extension-key=${resolve(keyPath)}`,
                `--user-data-dir=${join(keyDir, "profile")}`,
                "--no-sandbox",
                "--no-first-run",
                "--disable-gpu",
            ],
            {stdio: "inherit"}
        );
    } finally {
        rmSync(keyDir, {recursive: true, force: true});
    }

    const packed = `${stage}.crx`;
    if (!existsSync(packed)) throw new Error(`Chrome did not produce ${packed}`);
    const target = join(OUT_DIR, CRX_NAME);
    rmSync(target, {force: true});
    renameSync(packed, target);
    rmSync(`${stage}.pem`, {force: true});
    return target;
}

function updatesXml(id: string, version: string, crxUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${id}">
    <updatecheck codebase="${crxUrl}" version="${version}" />
  </app>
</gupdate>
`;
}

function windowsReg(id: string, updatesUrl: string): string {
    // CRLF and the version header are required for regedit to accept the file.
    return [
        "Windows Registry Editor Version 5.00",
        "",
        `[HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionSettings\\${id}]`,
        '"installation_mode"="normal_installed"',
        `"update_url"="${updatesUrl}"`,
        "",
    ].join("\r\n");
}

function macProfile(id: string, updatesUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>org.forrt.flora.devchannel</string>
  <key>PayloadUUID</key><string>${PROFILE_UUID}</string>
  <key>PayloadDisplayName</key><string>FLoRA dev channel</string>
  <key>PayloadDescription</key><string>Installs the FLoRA test build in Chrome and keeps it updated automatically.</string>
  <key>PayloadOrganization</key><string>FORRT</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.google.Chrome</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>org.forrt.flora.devchannel.chrome</string>
      <key>PayloadUUID</key><string>${PAYLOAD_UUID}</string>
      <key>PayloadDisplayName</key><string>Chrome extension policy</string>
      <key>PayloadEnabled</key><true/>
      <key>ExtensionSettings</key>
      <dict>
        <key>${id}</key>
        <dict>
          <key>installation_mode</key><string>normal_installed</string>
          <key>update_url</key><string>${updatesUrl}</string>
        </dict>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

/** `--id`: print the identity derived from the key, without packing anything. */
function printIdentity(privateKeyPem: string): void {
    console.log(`extension id   : ${extensionIdFromPrivateKey(privateKeyPem)}`);
    console.log(`manifest "key" : ${publicKeyDer(privateKeyPem).toString("base64")}`);
}

function main(): void {
    if (process.argv.includes("--id")) {
        printIdentity(readPrivateKey());
        return;
    }

    const {version, crxUrl, updatesUrl} = parseArgs();
    if (!existsSync("dist/background.js")) {
        throw new Error("dist/ is missing or stale — run `npm run build` first.");
    }

    const privateKeyPem = readPrivateKey();
    const id = extensionIdFromPrivateKey(privateKeyPem);

    mkdirSync(OUT_DIR, {recursive: true});
    const stage = stageExtension(version);
    const crx = packCrx(stage, privateKeyPem);
    rmSync(stage, {recursive: true, force: true});

    writeFileSync(join(OUT_DIR, "updates.xml"), updatesXml(id, version, crxUrl));
    writeFileSync(join(OUT_DIR, "flora-dev-channel-windows.reg"), windowsReg(id, updatesUrl));
    writeFileSync(join(OUT_DIR, "flora-dev-channel-macos.mobileconfig"), macProfile(id, updatesUrl));

    console.log(`extension id : ${id}`);
    console.log(`version      : ${version}`);
    console.log(`crx          : ${crx}`);
    console.log(`update_url   : ${updatesUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
