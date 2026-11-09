export interface PubPeerComment {
  id: number;
  number: number;
  user: string;
  createdAt: string;
  markdown: string;
  isAuthorResponse: boolean;
  isEditorResponse: boolean;
}

export interface PubPeerCommentsRequest {
  type: "FLORA_PUBPEER_COMMENTS";
  url: string;
}

export interface PubPeerCommentsResponse {
  type: "FLORA_PUBPEER_COMMENTS_RESULT";
  comments: PubPeerComment[] | null;
  error: string | null;
}

export function isPubPeerThreadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "pubpeer.com" &&
      /^\/publications\/[A-Za-z0-9]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isPubPeerCommentsRequest(msg: unknown): msg is PubPeerCommentsRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const record = msg as Record<string, unknown>;
  return record.type === "FLORA_PUBPEER_COMMENTS" &&
    typeof record.url === "string" &&
    isPubPeerThreadUrl(record.url);
}

const PAGE_DATA = /<script\b[^>]*\bdata-page="app"[^>]*>([\s\S]*?)<\/script>/i;

function isPublished(raw: unknown): boolean {
  const status = typeof raw === "object" && raw !== null ? (raw as {status?: unknown}).status : undefined;
  return status === undefined || status === "published";
}

function toComment(raw: unknown): PubPeerComment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "number" || typeof c.contentMarkdown !== "string") return null;
  return {
    id: c.id,
    number: typeof c.number === "number" ? c.number : 0,
    user: typeof c.user === "string" ? c.user : "",
    createdAt: typeof c.createdAt === "string" ? c.createdAt : "",
    markdown: c.contentMarkdown,
    isAuthorResponse: c.isAuthorResponse === true,
    isEditorResponse: c.isEditorResponse === true,
  };
}

export function extractPubPeerComments(html: string): PubPeerComment[] | null {
  const match = PAGE_DATA.exec(html);
  if (!match) return null;
  let page: unknown;
  try {
    page = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const comments = (page as {props?: {comments?: unknown}} | null)?.props?.comments;
  if (!Array.isArray(comments)) return null;
  const published = comments.filter(isPublished);
  const parsed = published.map(toComment).filter((c): c is PubPeerComment => c !== null);
  return published.length > 0 && parsed.length === 0 ? null : parsed;
}
