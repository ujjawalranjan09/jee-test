/**
 * Tiny Markdown + LaTeX renderer tailored to the shapes QuizForge's
 * LLM actually emits for solutions and chat answers.
 *
 * Supports:
 *   ## / ### headings
 *   paragraphs (blank-line separated)
 *   **bold** and *italic*
 *   `inline code`
 *   $...$ inline math and $$...$$ display math (via KaTeX)
 *   unordered list items ("- ", "* ", or "1. ")
 *
 * Deliberately NOT a full CommonMark parser — anything more exotic
 * (nested lists, tables, images, links, HTML blocks) is rendered as
 * plain text. That's intentional: the LLM rarely emits those in quiz
 * solutions and a hand-rolled parser keeps the bundle small while
 * avoiding the foot-guns of dangerouslySetInnerHTML for arbitrary
 * Markdown input.
 */

import { Fragment, type ReactNode } from "react";
import katex from "katex";

/**
 * Normalize LaTeX source so KaTeX can render it.
 *
 * LLMs frequently over-escape LaTeX backslashes when emitting JSON:
 * a literal "\alpha" may arrive in the wire string as "\\alpha" (two
 * characters: backslash + a). KaTeX needs a single backslash, so we
 * collapse runs of two-or-more backslashes down to one. This is safe
 * because "\\\\" (an escaped backslash in LaTeX itself) is not a
 * common occurrence in LLM-generated math.
 */
function normalizeLatex(src: string): string {
  return src.replace(/\\{2,}/g, "\\");
}

/** Render a single LaTeX expression (no delimiters) to HTML. */
function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(normalizeLatex(latex), {
      displayMode,
      throwOnError: false, // fall back to source text on bad LaTeX
      output: "html",
      strict: "ignore",
    });
  } catch {
    // Last-resort escape so we never inject raw LaTeX as HTML.
    return displayMode
      ? `<pre>${escapeHtml(latex)}</pre>`
      : `<code>${escapeHtml(latex)}</code>`;
  }
}

/** Minimal HTML escape for safe insertion of inline text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Tokenize a markdown-ish string into a sequence of math-aware
 * inline segments. Math segments are { kind: "math", value, display }
 * while text segments are plain strings.
 *
 * The tokenizer walks left-to-right and respects these delimiters
 * (in priority order):
 *   $$ ... $$           display math, may span lines
 *   \[ ... \]           display math, may span lines (LaTeX standard)
 *   $ ... $             inline math, single line
 *   \( ... \)           inline math, single line (LaTeX standard)
 *
 * Boundary rules: an opening "$" or "\(" must NOT be preceded by an
 * alphanumeric character or another opener (so we don't eat currency
 * like "$20" or the second "$" of "$$"). The closing delimiter has no
 * boundary check — it can be immediately preceded by math content
 * like "x^2$".
 */
type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean };

function tokenizeInline(src: string): InlineToken[] {
  // Collapse double-escaped backslashes up front so that LLMs which emit
  // "\\alpha" (literal two-char backslash+a) get normalized to "\alpha"
  // (one-char backslash+a) that KaTeX understands. Same trick used
  // inside ``renderMath`` for the math-body side.
  src = normalizeLatex(src);
  // ASCII-math fallbacks ("∫(from a to b)", "x^15") → proper LaTeX so
  // the bare-command scanner can pick them up.
  src = preprocessAsciiMath(src);

  const out: InlineToken[] = [];
  let i = 0;
  let buf = "";

  const flushBuf = () => {
    if (buf) {
      out.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  /** Try to match a display-math block starting at position `i`.
   *  Returns the end index (exclusive) if matched, otherwise -1. */
  const tryDisplay = (start: number): number => {
    const open = src.slice(start, start + 2);
    let close: string;
    if (open === "$$") close = "$$";
    else if (open === "\\[") close = "\\]";
    else return -1;
    const end = src.indexOf(close, start + 2);
    if (end < 0) return -1;
    const value = src.slice(start + 2, end);
    flushBuf();
    out.push({ kind: "math", value, display: true });
    return end + close.length;
  };

  while (i < src.length) {
    // Display math first (takes precedence over single-$-math).
    if (src.startsWith("$$", i) || src.startsWith("\\[", i)) {
      const next = tryDisplay(i);
      if (next > 0) {
        i = next;
        continue;
      }
    }

    // Inline math: \( ... \)  (LaTeX standard, single line).
    if (src.startsWith("\\(", i)) {
      const lineEnd = src.indexOf("\n", i + 2);
      const searchEnd = lineEnd === -1 ? src.length : lineEnd;
      const close = src.indexOf("\\)", i + 2);
      if (close > 0 && close < searchEnd) {
        flushBuf();
        out.push({
          kind: "math",
          value: src.slice(i + 2, close),
          display: false,
        });
        i = close + 2;
        continue;
      }
    }

    // Inline math: $...$  (single line).
    if (src[i] === "$") {
      const prev = i > 0 ? src[i - 1] : " ";
      const next = i + 1 < src.length ? src[i + 1] : " ";
      if (
        !/[A-Za-z0-9]/.test(prev) &&
        next !== "$"
      ) {
        // Find the matching closing $ on the same line.
        const lineEnd = src.indexOf("\n", i + 1);
        const searchEnd = lineEnd === -1 ? src.length : lineEnd;
        const close = src.indexOf("$", i + 1);
        if (close > 0 && close < searchEnd) {
          flushBuf();
          out.push({
            kind: "math",
            value: src.slice(i + 1, close),
            display: false,
          });
          i = close + 1;
          continue;
        }
      }
    }

    buf += src[i];
    i++;
  }

  flushBuf();
  return out;
}

/**
 * Convert common ASCII-math conventions the LLM falls back on when it
 * forgets proper LaTeX. These are pure rewrites (no semantic loss)
 * applied to the source before tokenization, so all subsequent
 * processing (bare-command detection, delimiter parsing) sees clean
 * LaTeX.
 *
 * Order matters: do the integral-rewrite BEFORE the superscript one
 * so the bounds get their own braces.
 */
function preprocessAsciiMath(src: string): string {
  let out = src;

  // ∫(from a to b) → \int_{a}^{b}        (and ∫_a^b, ∫^b_a variants)
  // The LLM sometimes spells out integral bounds in English or uses
  // both subscript and superscript notation. Be liberal in what we
  // accept; KaTeX will normalize the spacing itself.
  out = out.replace(
    /∫\s*\(\s*from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*\)/g,
    (_m, lo, hi) => `\\int_{${lo}}^{${hi}}`,
  );
  out = out.replace(
    /∫\s*_\{(-?\d+(?:\.\d+)?)\}\s*\^\{(-?\d+(?:\.\d+)?)\}/g,
    (_m, lo, hi) => `\\int_{${lo}}^{${hi}}`,
  );
  out = out.replace(
    /∫\s*_(-?\d+(?:\.\d+)?)\s*\^(-?\d+(?:\.\d+)?)/g,
    (_m, lo, hi) => `\\int_{${lo}}^{${hi}}`,
  );

  // x^15 → x^{15}  (single-digit exponents don't need braces, but
  // multi-digit ones do for KaTeX to render them as a single superscript)
  // Skip if the next char is already a brace.
  out = out.replace(
    /\^([0-9]+)(?![0-9A-Za-z{])/g,
    (_m, digits) =>
      digits.length === 1 ? `^${digits}` : `^{${digits}}`,
  );
  // x_n → x_{n} only when subscript is a multi-char identifier, so
  // single-letter subscripts (common in math, e.g. x_i) stay readable.
  out = out.replace(
    /_([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9{])/g,
    (_m, ident) => `_{${ident}}`,
  );

  return out;
}

/** Common LaTeX commands that should be rendered as math even when the
 *  LLM forgets to wrap them in $...$ delimiters. Conservative list —
 *  anything not in here stays as plain text so we don't accidentally
 *  render Windows file paths or random backslashes as math. */
const LATEX_COMMANDS = new Set<string>([
  // Greek letters
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta",
  "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu",
  "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau",
  "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
  "Phi", "Psi", "Omega",
  // Math operators
  "frac", "sqrt", "sum", "prod", "int", "iint", "iiint", "oint",
  "lim", "liminf", "limsup", "inf", "sup", "max", "min",
  "sin", "cos", "tan", "cot", "sec", "csc",
  "sinh", "cosh", "tanh", "coth",
  "log", "ln", "exp", "det", "gcd", "dim", "ker", "hom",
  "mod", "bmod", "pmod",
  // Relations
  "leq", "le", "geq", "ge", "neq", "ne", "equiv", "approx", "sim",
  "simeq", "cong", "propto", "prec", "succ",
  "in", "notin", "ni", "subset", "supset", "subseteq", "supseteq",
  "cup", "cap", "setminus",
  // Arrows
  "to", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow",
  "Leftarrow", "Leftrightarrow", "mapsto", "longrightarrow",
  // Misc
  "infty", "partial", "nabla", "forall", "exists", "nexists",
  "mathbb", "mathrm", "mathcal", "mathfrak", "mathbf", "mathit",
  "text", "textbf", "textit", "textrm", "textsf", "texttt",
  "left", "right", "big", "Big", "bigg", "Bigg",
  "begin", "end", "cases", "matrix", "pmatrix", "bmatrix", "vmatrix",
  "overline", "underline", "overbrace", "underbrace",
  "hat", "bar", "tilde", "vec", "dot", "ddot", "dddot",
  "cdot", "times", "div", "pm", "mp", "ast", "star", "circ",
  "oplus", "ominus", "otimes", "cup", "cap", "wedge", "vee",
  "langle", "rangle", "lceil", "rceil", "lfloor", "rfloor",
  "Rightarrow", "Leftarrow", "Leftrightarrow", "Uparrow", "Downarrow",
]);

/** Render an inline token list to React nodes (no block-level handling). */
function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.flatMap((tok, idx) => {
    if (tok.kind === "math") {
      const html = renderMath(tok.value, tok.display);
      // katex output is sanitized by the library itself, but we still
      // pass it through dangerouslySetInnerHTML — that's the entire
      // point of using KaTeX here.
      return [
        <span
          key={idx}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
          className={tok.display ? "md-math md-math--block" : "md-math"}
        />,
      ];
    }
    return renderTextInlineWithBareLatex(tok.value, idx);
  });
}

/** Like renderTextInline but splits the input at bare-LaTeX commands
 *  (``\alpha``, ``\frac{a}{b}``, etc.) AND common math expressions
 *  (``x^2``, ``x_n``, ``3.14``, single Greek letters) so each renders
 *  as math even when the LLM forgets to wrap it in ``$...$``. */
function renderTextInlineWithBareLatex(
  text: string,
  keyPrefix: string,
): ReactNode[] {
  // Single combined regex:
  //   group 1: \command (with optional {arg}{arg} suffix)
  //   group 2: <id>^<digits-or-braced-expr>   e.g. x^2, x^{15}, x^{2n+1}
  //   group 3: <id>_<ident-or-braced-expr>    e.g. x_n, x_{ij}, x_{n+1}
  // We match them in turn and walk the string forward. Whichever
  // pattern hits first wins at each position.
  const combined =
    /\\([A-Za-z]+(?:\{[^}]*\})*(?:\{[^}]*\})*)|([A-Za-z](?:[A-Za-z0-9]*[A-Za-z0-9])?\^(?:[0-9]+|\{[^}]*\}))|([A-Za-z](?:[A-Za-z0-9]*[A-Za-z0-9])?_(?:[A-Za-z][A-Za-z0-9]*|\{[^}]*\}))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = combined.exec(text)) !== null) {
    // Decide which group matched (only one can match at a time).
    const isCommand = !!m[1];
    const cmdOrExpr = m[0];

    if (isCommand) {
      // \command: validate against the allowlist.
      const cmd = m[1]!.match(/^([A-Za-z]+)/)![1]!;
      if (!LATEX_COMMANDS.has(cmd)) continue;
    }
    // For groups 2 and 3 (no backslash), the pattern itself is the
    // indicator that this is math — no allowlist needed.

    const start = m.index;
    // For \command: extend to consume balanced brace-args.
    // For x^2 / x_n: the regex already consumed the whole expression.
    let end = start + cmdOrExpr.length;
    if (isCommand) {
      // Extend over any extra whitespace + balanced {arg} groups.
      while (end < text.length && /[\s{]/.test(text[end]!)) {
        if (text[end] === "{") {
          let depth = 1;
          end++;
          while (end < text.length && depth > 0) {
            if (text[end] === "{") depth++;
            else if (text[end] === "}") depth--;
            end++;
          }
        } else {
          end++;
        }
      }
    }

    const preceding = text.slice(last, start);
    if (preceding) {
      out.push(renderTextInline(preceding, `${keyPrefix}-${key++}`));
    }
    const html = renderMath(text.slice(start, end), false);
    out.push(
      <span
        key={`${keyPrefix}-${key++}-math`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
        className="md-math"
      />,
    );
    last = end;
    combined.lastIndex = end;
  }
  if (last < text.length) {
    out.push(renderTextInline(text.slice(last), `${keyPrefix}-${key++}`));
  }
  return out;
}

/** Apply bold/italic/code transformations to plain text. */
function renderTextInline(text: string, keyPrefix: string): ReactNode {
  // Split on **, * and ` while keeping the delimiters so we can map
  // them to <strong>/<em>/<code>. The token regex matches:
  //   \*\*[^*]+\*\*    bold
  //   \*[^*]+\*        italic (but not **)
  //   `[^`]+`          inline code
  const regex =
    /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\n)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(regex)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      parts.push(text.slice(last, idx));
    }
    const tok = m[0];
    if (tok === "\n") {
      parts.push(<br key={`${keyPrefix}-br-${key++}`} />);
    } else if (tok.startsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-b-${key++}`}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-c-${key++}`}>{tok.slice(1, -1)}</code>,
      );
    } else if (tok.startsWith("*")) {
      parts.push(
        <em key={`${keyPrefix}-i-${key++}`}>{tok.slice(1, -1)}</em>,
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return <Fragment key={`${keyPrefix}-frag`}>{parts}</Fragment>;
}

/* ─── Block-level parser ───────────────────────────────────────────── */

/**
 * Split a string into "blocks" separated by blank lines. We do a
 * minimal pass: a heading is a line starting with `#`, a list item
 * is a line starting with `- `, `* `, or a digit+`. Everything else
 * is a paragraph (possibly multi-line with `  \n` line breaks).
 */
function splitBlocks(src: string): { kind: string; content: string }[] {
  // Normalize over-escaped backslashes once at the block level so that
  // downstream regexes (which all assume single-backslash form) work
  // uniformly across the LLM's various output styles.
  src = normalizeLatex(src);
  // Convert common ASCII-math fallbacks (``∫(from a to b)``, ``x^15``)
  // to proper LaTeX so the bare-command scanner and KaTeX render
  // them correctly.
  src = preprocessAsciiMath(src);
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: { kind: string; content: string }[] = [];
  let buf: string[] = [];
  let kind = "p";

  const flush = () => {
    if (buf.length === 0) return;
    blocks.push({ kind, content: buf.join("\n").trim() });
    buf = [];
    kind = "p";
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flush();
      continue;
    }

    // Heading: ## or ###
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      blocks.push({
        kind: `h${headingMatch[1]!.length}`,
        content: headingMatch[2]!.trim(),
      });
      continue;
    }

    // Unordered list item
    if (/^[-*]\s+/.test(line)) {
      if (kind !== "ul") {
        flush();
        kind = "ul";
      }
      buf.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    // Ordered list item
    if (/^\d+\.\s+/.test(line)) {
      if (kind !== "ol") {
        flush();
        kind = "ol";
      }
      buf.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }

    // Block quote (treat as paragraph with prefix)
    if (/^>\s?/.test(line)) {
      if (kind !== "blockquote") {
        flush();
        kind = "blockquote";
      }
      buf.push(line.replace(/^>\s?/, ""));
      continue;
    }

    // Default: paragraph text. Allow line-continuations (a single \n
    // becomes a <br> inside the paragraph).
    if (kind !== "p") {
      flush();
      kind = "p";
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

/* ─── Public component ─────────────────────────────────────────────── */

interface MarkdownProps {
  source: string;
  className?: string;
}

/**
 * Render a markdown-ish string with LaTeX math as React nodes.
 *
 * Output structure:
 *   <div class="md">
 *     <h2>Heading</h2>
 *     <p>Paragraph with $inline math$ and **bold**.</p>
 *     <ul><li>...</li></ul>
 *   </div>
 *
 * Styling is in `src/components/Review/SolutionPanel.css` (`.md`).
 */
export function Markdown({ source, className }: MarkdownProps) {
  const blocks = splitBlocks(source);

  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      {blocks.map((b, i) => {
        const tokens = tokenizeInline(b.content);
        const children = renderInline(tokens);

        switch (b.kind) {
          case "h1":
            return <h1 key={i}>{children}</h1>;
          case "h2":
            return <h2 key={i}>{children}</h2>;
          case "h3":
            return <h3 key={i}>{children}</h3>;
          case "h4":
            return <h4 key={i}>{children}</h4>;
          case "ul":
            return (
              <ul key={i}>
                {b.content.split("\n").map((item, j) => (
                  <li key={j}>{renderInline(tokenizeInline(item))}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {b.content.split("\n").map((item, j) => (
                  <li key={j}>{renderInline(tokenizeInline(item))}</li>
                ))}
              </ol>
            );
          case "blockquote":
            return (
              <blockquote key={i}>{children}</blockquote>
            );
          default:
            return <p key={i}>{children}</p>;
        }
      })}
    </div>
  );
}