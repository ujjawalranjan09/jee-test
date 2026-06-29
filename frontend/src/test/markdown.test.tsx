import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "../utils/markdown";

describe("Markdown component", () => {
  it("renders plain text as a paragraph", () => {
    render(<Markdown source="Hello world" />);
    const p = screen.getByText("Hello world");
    expect(p.tagName).toBe("P");
  });

  it("renders ## headings as h2", () => {
    render(<Markdown source="## Section title" />);
    const h = screen.getByRole("heading", { level: 2 });
    expect(h.textContent).toBe("Section title");
  });

  it("renders ### headings as h3", () => {
    render(<Markdown source="### Subsection" />);
    const h = screen.getByRole("heading", { level: 3 });
    expect(h.textContent).toBe("Subsection");
  });

  it("renders **bold** and *italic*", () => {
    render(<Markdown source="This is **bold** and *italic* text." />);
    const wrap = document.querySelector(".md")!;
    expect(wrap.querySelector("strong")?.textContent).toBe("bold");
    expect(wrap.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders unordered lists from dash bullets", () => {
    render(<Markdown source={"- first\n- second\n- third"} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
    const list = items[0]!.parentElement!;
    expect(list.tagName).toBe("UL");
  });

  it("renders ordered lists", () => {
    render(<Markdown source={"1. one\n2. two\n3. three"} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["one", "two", "three"]);
    expect(items[0]!.parentElement!.tagName).toBe("OL");
  });

  it("renders inline math via KaTeX into .katex elements", () => {
    const { container } = render(<Markdown source="The answer is $x^2$" />);
    const katex = container.querySelector(".katex");
    expect(katex).not.toBeNull();
    // KaTeX renders x² using HTML, so we check the rendered text content
    expect(katex?.textContent).toContain("x");
  });

  it("renders display math as a centered block", () => {
    const { container } = render(
      <Markdown source={"$$\n\\frac{a}{b}\n$$"} />,
    );
    const displayMath = container.querySelector(".md-math--block");
    expect(displayMath).not.toBeNull();
    const katexDisplay = container.querySelector(".katex-display");
    expect(katexDisplay).not.toBeNull();
  });

  it("separates paragraphs with blank lines", () => {
    render(
      <Markdown source={"First paragraph.\n\nSecond paragraph."} />,
    );
    const paras = document.querySelectorAll(".md p");
    expect(paras.length).toBe(2);
    expect(paras[0]?.textContent).toBe("First paragraph.");
    expect(paras[1]?.textContent).toBe("Second paragraph.");
  });

  it("renders blockquotes", () => {
    const { container } = render(
      <Markdown source={"> quoted text here"} />,
    );
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toBe("quoted text here");
  });

  it("does not choke on dollar signs that aren't math (e.g. $20)", () => {
    // $20 has digits next to the $ so it should render as plain text
    const { container } = render(
      <Markdown source={"The price is $20 and not math."} />,
    );
    const katex = container.querySelector(".katex");
    expect(katex).toBeNull();
    expect(container.textContent).toContain("$20");
  });

  it("gracefully degrades on bad LaTeX without throwing", () => {
    // throwOnError: false in our renderer means KaTeX returns an
    // error span instead of throwing.
    expect(() => {
      render(<Markdown source={"$\\notacommand$"} />);
    }).not.toThrow();
  });

  it("supports \\[...\\] LaTeX display math", () => {
    const { container } = render(
      <Markdown source={"Equation:\n\\[\nx^2 + y^2 = z^2\n\\]"} />,
    );
    const display = container.querySelector(".md-math--block");
    expect(display).not.toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("supports \\(...\\) LaTeX inline math", () => {
    const { container } = render(
      <Markdown source={"Pythagoras: \\(a^2 + b^2 = c^2\\) is famous."} />,
    );
    // Should render one inline KaTeX block and no display block.
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".katex-display")).toBeNull();
    expect(container.textContent).toContain("Pythagoras");
    expect(container.textContent).toContain("is famous");
  });

  it("does not render the literal \\( or \\[ in output", () => {
    const { container } = render(
      <Markdown source="Inline math: \\(x + 1\\)" />,
    );
    // The raw delimiters should have been consumed by the tokenizer.
    expect(container.textContent).not.toContain("\\(");
    expect(container.textContent).not.toContain("\\)");
  });

  it("normalizes over-escaped backslashes (LLM emits \\\\()", () => {
    // Some LLM outputs arrive with literal "\\(" (two chars: backslash +
    // paren) instead of the proper LaTeX "\(" (backslash + paren).
    // We treat both the same and feed the normalized form to KaTeX.
    const { container } = render(
      <Markdown source={"Let \\(Ax = b\\) where A is a matrix."} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    // The literal "\\(" and "\\)" should not leak through.
    expect(container.textContent).not.toContain("\\(");
    expect(container.textContent).not.toContain("\\)");
  });

  it("renders bare LaTeX commands like \\alpha, \\beta as math", () => {
    // When the LLM forgets to wrap math in $...$ delimiters, the bare
    // command should still render via KaTeX.
    const { container } = render(
      <Markdown source={"Let \\alpha, \\beta in R be such that ..."} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    // Greek letters should appear in the rendered output (α, β).
    expect(container.textContent).toContain("α");
    expect(container.textContent).toContain("β");
    // The raw backslash-command should NOT appear in plain text.
    expect(container.textContent).not.toContain("\\alpha");
    expect(container.textContent).not.toContain("\\beta");
  });

  it("renders bare \\frac{a}{b} as a math expression", () => {
    const { container } = render(
      <Markdown source={"Find \\frac{\\beta}{\\alpha}."} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("\\frac");
  });

  it("does not render non-math backslashes (e.g. C:\\Users)", () => {
    // Windows paths and other non-LaTeX backslashes stay as plain text.
    const { container } = render(
      <Markdown source={"File saved to C:\\Users\\test\\file.pdf"} />,
    );
    // C:\Users is not a LaTeX command, so no KaTeX should be rendered.
    expect(container.querySelector(".katex")).toBeNull();
    // The path text is preserved as-is.
    expect(container.textContent).toContain("C:\\Users\\test\\file.pdf");
  });

  it("renders the screenshot bug example correctly", () => {
    // Reproduces the exact prompt from the bug report.
    const sample =
      "Let \\(\\alpha, \\beta \\in \\mathbb{R}\\) be such that the system " +
      "of linear equations \\(x+2y+z=5\\), \\(2x+y+\\alpha z=5\\), " +
      "\\(8x+4y+\\beta z=18\\) has no solution. " +
      "Then \\(\\frac{\\beta}{\\alpha}\\) is equal to:";
    const { container } = render(<Markdown source={sample} />);
    // Should render at least one KaTeX block per math expression.
    const katexCount = container.querySelectorAll(".katex").length;
    expect(katexCount).toBeGreaterThanOrEqual(5);
    // No raw delimiters should leak through.
    expect(container.textContent).not.toContain("\\(");
    expect(container.textContent).not.toContain("\\)");
    expect(container.textContent).not.toContain("\\)");
    expect(container.textContent).not.toContain("\\mathbb");
    expect(container.textContent).not.toContain("\\alpha");
    expect(container.textContent).not.toContain("\\beta");
    expect(container.textContent).not.toContain("\\frac");
  });

  it("renders integral with spelled-out bounds (∫(from a to b))", () => {
    // The LLM sometimes writes integral bounds in English instead of
    // LaTeX. preprocessAsciiMath rewrites them so KaTeX renders them.
    const { container } = render(
      <Markdown source={"The integral ∫(from -1 to 1) f(x) dx is zero."} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    // The literal "(from -1 to 1)" should be gone after rewriting.
    expect(container.textContent).not.toContain("(from");
    expect(container.textContent).not.toContain(" to ");
  });

  it("wraps multi-digit superscripts in braces (x^15 → x^{15})", () => {
    // Without braces, KaTeX only renders the first character as a
    // superscript and treats the rest as text. e.g. x^15 becomes
    // x^(1)5 visually, which is wrong.
    const { container } = render(<Markdown source={"Given x^15 + y^14"} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    // The bare-command scanner should have wrapped the expression as math.
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    // KaTeX renders "x^{15}" as "x" + superscript "15" + superscript marker.
    // The textContent should NOT contain the literal caret.
    expect(container.textContent).not.toContain("^");
  });

  it("leaves single-digit superscripts alone (x^2 stays as x^2)", () => {
    const { container } = render(<Markdown source={"x^2 + y^2 = r^2"} />);
    // KaTeX handles single-digit exponents without braces.
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("renders the screenshot question 8 example correctly", () => {
    // Exact text from the user's screenshot showing the bug.
    const sample =
      "The value of the integral ∫(from -1 to 1) (x^15 + x^14 + x^13 + " +
      "x^12 + x^11) / (x^2 + 2x + 2) dx is :";
    const { container } = render(<Markdown source={sample} />);
    // Should produce at least one math block (the integral).
    expect(container.querySelector(".katex")).not.toBeNull();
    // The "(from -1 to 1)" should be parsed and rewritten.
    expect(container.textContent).not.toContain("(from");
    expect(container.textContent).not.toContain(" to 1)");
  });
});