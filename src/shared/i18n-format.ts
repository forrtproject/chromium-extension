/**
 * Minimal ICU MessageFormat subset shared by the runtime and the i18n scripts.
 *
 * Supported: `{name}` arguments, `{n, plural, =0 {…} one {…} other {…}}` with `#`
 * for the formatted number, and `{x, select, a {…} other {…}}`. A literal brace
 * or `#` is written as `'{'`, `'}'` or `'#'`; `''` is a literal apostrophe.
 */

export type MessageValues = Record<string, string | number>;

export type Node =
  | { kind: "text"; text: string }
  | { kind: "arg"; name: string }
  | { kind: "pound" }
  | { kind: "plural" | "select"; name: string; options: Record<string, Node[]> };

export class MessageSyntaxError extends Error {}

const cache = new Map<string, Node[]>();

export function parseMessage(source: string): Node[] {
  const hit = cache.get(source);
  if (hit) return hit;
  let pos = 0;

  const fail = (why: string): never => {
    throw new MessageSyntaxError(`${why} at ${pos} in ${JSON.stringify(source)}`);
  };

  const skipSpace = (): void => {
    while (pos < source.length && /\s/.test(source[pos])) pos++;
  };

  const word = (): string => {
    skipSpace();
    const m = /^[^\s{},]+/.exec(source.slice(pos));
    if (!m) fail("expected a name");
    pos += m![0].length;
    return m![0];
  };

  const parseNodes = (inPlural: boolean, nested: boolean): Node[] => {
    const nodes: Node[] = [];
    let text = "";
    const flush = (): void => {
      if (text) nodes.push({ kind: "text", text });
      text = "";
    };
    while (pos < source.length) {
      const ch = source[pos];
      if (ch === "'") {
        const next = source[pos + 1];
        if (next === "'") { text += "'"; pos += 2; continue; }
        if (next === "{" || next === "}" || next === "#") {
          const end = source.indexOf("'", pos + 1);
          if (end < 0) { text += source.slice(pos + 1); pos = source.length; continue; }
          text += source.slice(pos + 1, end);
          pos = end + 1;
          continue;
        }
        text += ch; pos++; continue;
      }
      if (ch === "}") {
        if (!nested) fail("unmatched }");
        break;
      }
      if (ch === "#" && inPlural) { flush(); nodes.push({ kind: "pound" }); pos++; continue; }
      if (ch === "{") {
        flush();
        pos++;
        const name = word();
        skipSpace();
        if (source[pos] === "}") { pos++; nodes.push({ kind: "arg", name }); continue; }
        if (source[pos] !== ",") fail("expected , or }");
        pos++;
        const type = word();
        if (type !== "plural" && type !== "select") fail(`unsupported argument type ${type}`);
        skipSpace();
        if (source[pos] !== ",") fail("expected ,");
        pos++;
        const options: Record<string, Node[]> = {};
        for (;;) {
          skipSpace();
          if (source[pos] === "}") { pos++; break; }
          const key = word();
          skipSpace();
          if (source[pos] !== "{") fail("expected { after option");
          pos++;
          options[key] = parseNodes(type === "plural", true);
          if (source[pos] !== "}") fail("unclosed option");
          pos++;
        }
        if (!options.other) fail(`${type} needs an "other" option`);
        nodes.push({ kind: type as "plural" | "select", name, options });
        continue;
      }
      text += ch;
      pos++;
    }
    flush();
    return nodes;
  };

  const nodes = parseNodes(false, false);
  if (pos < source.length) fail("trailing input");
  cache.set(source, nodes);
  return nodes;
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, n: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) { rules = new Intl.PluralRules(locale); pluralRules.set(locale, rules); }
  return rules.select(n);
}

export function formatMessage(source: string, values: MessageValues = {}, locale = "en"): string {
  const render = (nodes: Node[], count: number | null): string => {
    let out = "";
    for (const node of nodes) {
      if (node.kind === "text") out += node.text;
      else if (node.kind === "pound") out += count == null ? "#" : count.toLocaleString(locale);
      else if (node.kind === "arg") {
        const v = values[node.name];
        out += v == null ? `{${node.name}}` : typeof v === "number" ? v.toLocaleString(locale) : v;
      } else if (node.kind === "plural") {
        const n = Number(values[node.name] ?? 0);
        const branch = node.options[`=${n}`] ?? node.options[pluralCategory(locale, n)] ?? node.options.other;
        out += render(branch, n);
      } else {
        const branch = node.options[String(values[node.name])] ?? node.options.other;
        out += render(branch, count);
      }
    }
    return out;
  };
  return render(parseMessage(source), null);
}

/** Argument names a message uses, for placeholder parity checks. */
export function messageArguments(source: string): Set<string> {
  const names = new Set<string>();
  const walk = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (node.kind === "arg") names.add(node.name);
      else if (node.kind === "plural" || node.kind === "select") {
        names.add(node.name);
        for (const branch of Object.values(node.options)) walk(branch);
      }
    }
  };
  walk(parseMessage(source));
  return names;
}

/**
 * Distinct HTML tags (opening and closing) used in a message, for markup
 * parity checks. Distinct rather than counted, because writing a plural as full
 * sentences repeats the same tags in each branch.
 */
export function messageTags(source: string): string[] {
  const tags = [...source.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)].map((m) => m[0].startsWith("</") ? `/${m[1].toLowerCase()}` : m[1].toLowerCase());
  return [...new Set(tags)].sort();
}

/**
 * One complete variant of a message with all plural/select choices made, e.g.
 * the "count = one" sentence. `#` is written as `{name}` so each form reads as
 * a normal sentence; `formatMessage` prints both the same way.
 */
export interface MessageForm {
  /** Choices leading to this form, outermost first. */
  path: { name: string; type: "plural" | "select"; key: string }[];
  /** The sentence for this form: text and simple `{arg}` placeholders only. */
  text: string;
}

const quoteText = (text: string): string => text.replace(/'/g, "''").replace(/[{}#]/g, (c) => `'${c}'`);

function serializeNodes(nodes: Node[]): string {
  return nodes.map((n) => {
    if (n.kind === "text") return quoteText(n.text);
    if (n.kind === "arg") return `{${n.name}}`;
    if (n.kind === "pound") return "#";
    return `{${n.name}, ${n.kind}, ${Object.entries(n.options).map(([k, v]) => `${k} {${serializeNodes(v)}}`).join(" ")}}`;
  }).join("");
}

function replacePound(nodes: Node[], name: string): Node[] {
  return nodes.map((n) => {
    if (n.kind === "pound") return { kind: "arg", name } as Node;
    if (n.kind === "plural") return n; // an inner plural has its own #
    if (n.kind === "select") {
      return { ...n, options: Object.fromEntries(Object.entries(n.options).map(([k, v]) => [k, replacePound(v, name)])) };
    }
    return n;
  });
}

/**
 * Split a message into its complete sentences, one per combination of
 * plural/select choices. Text around a plural moves into every branch, so
 * "Show {n, plural, one {# more} other {# more}}" becomes two full sentences.
 * `extraPluralKeys` adds plural categories a target language needs.
 */
export function messageForms(source: string, extraPluralKeys: string[] = []): MessageForm[] {
  const walk = (nodes: Node[], path: MessageForm["path"]): MessageForm[] => {
    const i = nodes.findIndex((n) => n.kind === "plural" || n.kind === "select");
    if (i < 0) return [{ path, text: serializeNodes(nodes) }];
    const choice = nodes[i] as Extract<Node, { kind: "plural" | "select" }>;
    const keys = Object.keys(choice.options);
    if (choice.kind === "plural") {
      for (const k of extraPluralKeys) if (!keys.includes(k)) keys.splice(keys.indexOf("other"), 0, k);
    }
    return keys.flatMap((key) => {
      let branch = choice.options[key] ?? choice.options.other;
      if (choice.kind === "plural") branch = replacePound(branch, choice.name);
      return walk([...nodes.slice(0, i), ...branch, ...nodes.slice(i + 1)], [...path, { name: choice.name, type: choice.kind, key }]);
    });
  };
  return walk(parseMessage(source), []);
}

/** Rebuild an ICU message from its forms (inverse of messageForms). */
export function formsToMessage(forms: MessageForm[]): string {
  const build = (items: MessageForm[], depth: number): string => {
    if (items.length === 1 && items[0].path.length === depth) return items[0].text;
    const { name, type } = items[0].path[depth];
    const keys: string[] = [];
    for (const f of items) if (!keys.includes(f.path[depth].key)) keys.push(f.path[depth].key);
    if (!keys.includes("other")) keys.push("other");
    const branch = (key: string) => {
      const sub = items.filter((f) => f.path[depth].key === key);
      return sub.length ? build(sub, depth + 1) : "";
    };
    return `{${name}, ${type}, ${keys.map((k) => `${k} {${branch(k)}}`).join(" ")}}`;
  };
  return build(forms, 0);
}

/** Whether a message has plural or select choices. */
export function hasChoices(source: string): boolean {
  return parseMessage(source).some((n) => n.kind === "plural" || n.kind === "select");
}
