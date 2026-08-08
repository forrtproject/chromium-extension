import {
    decodeReport,
    renderReportBody,
    REPORT_STYLES,
    INSTALL_URL,
} from "@shared/report";

const root = document.getElementById("report") as HTMLElement;

function injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = REPORT_STYLES;
    document.head.appendChild(style);
}

function renderEmpty(message: string): void {
    root.innerHTML = `<div class="sheet">
      <div class="masthead"><span class="brand">FORRT ORE</span><span class="what">Meta Report</span></div>
      <div class="head"><h1>${message}</h1>
        <div class="byline">A report link carries its whole report in the part of the URL
        after the <code>#</code>. If the link was shortened, wrapped by a mail client, or
        truncated on the way here, that part is lost and the report cannot be rebuilt.</div>
      </div>
    </div>`;
}

async function main(): Promise<void> {
    injectStyles();

    const encoded = location.hash.slice(1);
    if (!encoded) {
        renderEmpty("No report in this link");
        return;
    }

    const payload = await decodeReport(encoded);
    if (!payload) {
        renderEmpty("This report link could not be read");
        return;
    }

    document.title = `${payload.title} — FORRT ORE Meta Report`;
    root.innerHTML = renderReportBody(payload);

    const install = document.createElement("a");
    install.className = "install";
    install.href = INSTALL_URL;
    install.textContent = "Get FORRT ORE — see this for every paper you read →";
    root.appendChild(install);
}

void main();
window.addEventListener("hashchange", () => void main());
