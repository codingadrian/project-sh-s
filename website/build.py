#!/usr/bin/env python3
"""
Build script for the Boruca revival-project website.

Regenerates two static, dependency-free artifacts from the source-of-truth
files one directory up:

  - grammar.html   <- boruca_reference_grammar.md, boruca_word_formation.md,
                       boruca_historical_periods.md (converted to HTML and
                       embedded directly, so the page works via a plain
                       file:// open with no server and no client-side fetch)
  - data/vocabulary.js  <- boruca_vocabulary.db `vocabulary_full` view,
                       embedded as a JS array literal (loaded with a plain
                       <script src>, which — unlike fetch()/XHR — is not
                       blocked by browsers under file://)

Re-run this after editing the source .md files or the database:
    python3 website/build.py

No third-party packages are used (this environment has neither `pip` nor a
`markdown` module installed) — inline_md() / md_to_html() below are a small
hand-written converter covering exactly the Markdown constructs these docs
use (headers, bold/italic, inline code, tables, blockquotes, hr, lists).
"""
import html
import json
import re
import sqlite3
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = Path(__file__).resolve().parent

MD_SOURCES = [
    ("Reference Grammar", ROOT / "boruca_reference_grammar.md"),
    ("Word Formation", ROOT / "boruca_word_formation.md"),
    ("Historical Periods", ROOT / "boruca_historical_periods.md"),
]

# headword.lower() -> [vocabulary.id, ...] (a list because ~150 headwords are
# homographs with more than one dictionary entry). Populated by
# build_headword_index() before the grammar page is rendered, then read by
# inline_md()'s italic handling to turn Boruca-form mentions into links into
# the dictionary page.
HEADWORD_INDEX = {}

EDGE_PUNCT = ".,;:!?()[]{}“”«»\""


def slugify(text):
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_]+", "-", text)


def build_headword_index():
    conn = sqlite3.connect(ROOT / "boruca_vocabulary.db")
    cur = conn.cursor()
    cur.execute("SELECT id, headword FROM vocabulary")
    index = {}
    for row_id, headword in cur.fetchall():
        index.setdefault(headword.lower(), []).append(row_id)
    conn.close()
    return index


def dict_link(display_html, ids, raw_text):
    if len(ids) == 1:
        href = f"dictionary.html#e-{ids[0]}"
    else:
        href = f"dictionary.html?q={urllib.parse.quote(raw_text)}"
    return f"<a class='boruca-link' href='{href}'>{display_html}</a>"


def split_edge_punct(token):
    prefix_len = 0
    while prefix_len < len(token) and token[prefix_len] in EDGE_PUNCT:
        prefix_len += 1
    suffix_len = 0
    while suffix_len < len(token) - prefix_len and token[len(token) - 1 - suffix_len] in EDGE_PUNCT:
        suffix_len += 1
    core = token[prefix_len: len(token) - suffix_len] if suffix_len else token[prefix_len:]
    return token[:prefix_len], core, (token[len(token) - suffix_len:] if suffix_len else "")


def linkify_italic(content):
    """Turn a *...* span's inner text into a dictionary link when it (or a
    word inside it) exactly matches a headword in boruca_vocabulary.db."""
    if "<" in content:
        return content  # nested markup (e.g. **bold** inside *italic*) — leave alone

    stripped = content.strip()
    if not stripped:
        return content

    ids = HEADWORD_INDEX.get(stripped.lower())
    if ids:
        return dict_link(content, ids, stripped)

    tokens = re.split(r"(\s+)", content)
    changed = False
    out = []
    for tok in tokens:
        if not tok.strip():
            out.append(tok)
            continue
        prefix, core, suffix = split_edge_punct(tok)
        tok_ids = HEADWORD_INDEX.get(core.lower()) if core else None
        if tok_ids:
            out.append(prefix + dict_link(core, tok_ids, core) + suffix)
            changed = True
        else:
            out.append(tok)
    return "".join(out) if changed else content


def inline_md(text):
    """Apply inline-level markdown (within a single line/paragraph)."""
    text = html.escape(text, quote=False)
    # Restore backslash-escaped angle brackets used in the source docs
    # for literal alphabet notation, e.g. \<sh\> -> <sh> (as visible text)
    text = text.replace("\\&lt;", "&lt;").replace("\\&gt;", "&gt;")
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(
        r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)",
        lambda m: f"<em>{linkify_italic(m.group(1))}</em>",
        text,
    )
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def parse_table(lines, i):
    rows = []
    while i < len(lines) and lines[i].strip().startswith("|"):
        rows.append(lines[i].strip())
        i += 1
    header = [c.strip() for c in rows[0].strip("|").split("|")]
    body = rows[2:]  # rows[1] is the --- separator row
    out = ["<div class='table-wrap'><table>", "<thead><tr>"]
    out += [f"<th>{inline_md(c)}</th>" for c in header]
    out.append("</tr></thead><tbody>")
    for r in body:
        cells = [c.strip() for c in r.strip("|").split("|")]
        out.append("<tr>" + "".join(f"<td>{inline_md(c)}</td>" for c in cells) + "</tr>")
    out.append("</tbody></table></div>")
    return "\n".join(out), i


def md_to_html(md_text, heading_prefix=""):
    lines = md_text.split("\n")
    out = []
    toc = []
    i = 0
    list_stack = []  # stack of dicts: {indent, tag, li_open}

    def close_lists(min_indent=-1):
        while list_stack and list_stack[-1]["indent"] > min_indent:
            top = list_stack.pop()
            if top["li_open"]:
                out.append("</li>")
            out.append(f"</{top['tag']}>")

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            close_lists()
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            close_lists()
            level = len(m.group(1))
            text = m.group(2)
            anchor = f"{heading_prefix}{slugify(text)}"
            out.append(f"<h{level} id='{anchor}'>{inline_md(text)}</h{level}>")
            toc.append((level, text, anchor))
            i += 1
            continue

        if stripped == "---":
            close_lists()
            out.append("<hr>")
            i += 1
            continue

        if stripped.startswith("|"):
            close_lists()
            table_html, i = parse_table(lines, i)
            out.append(table_html)
            continue

        if stripped.startswith(">"):
            close_lists()
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append(f"<blockquote>{inline_md(' '.join(quote_lines))}</blockquote>")
            continue

        list_m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if list_m:
            indent = len(list_m.group(1))
            marker, item_text = list_m.group(2), list_m.group(3)
            tag = "ol" if marker[0].isdigit() else "ul"

            # Close any deeper (or same-depth, different-tag) nested lists first.
            while list_stack and (
                list_stack[-1]["indent"] > indent
                or (list_stack[-1]["indent"] == indent and list_stack[-1]["tag"] != tag)
            ):
                top = list_stack.pop()
                if top["li_open"]:
                    out.append("</li>")
                out.append(f"</{top['tag']}>")

            if list_stack and list_stack[-1]["indent"] == indent:
                # Sibling item at the same level: close the previous <li>.
                if list_stack[-1]["li_open"]:
                    out.append("</li>")
            else:
                # Deeper level: open nested list inside the still-open parent <li>.
                out.append(f"<{tag}>")
                list_stack.append({"indent": indent, "tag": tag, "li_open": False})

            out.append(f"<li>{inline_md(item_text)}")
            list_stack[-1]["li_open"] = True
            i += 1
            continue

        close_lists()
        para_lines = []
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(\s*)([-*]|\d+\.)\s+", lines[i]
        ) and not lines[i].strip().startswith(("#", "|", ">", "---")):
            para_lines.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline_md(' '.join(para_lines))}</p>")

    close_lists()
    return "\n".join(out), toc


def build_grammar_page():
    global HEADWORD_INDEX
    HEADWORD_INDEX = build_headword_index()

    sections_html = []
    full_toc = []
    for title, path in MD_SOURCES:
        md_text = path.read_text(encoding="utf-8")
        prefix = slugify(title) + "--"
        body_html, toc = md_to_html(md_text, heading_prefix=prefix)
        full_toc.append((title, slugify(title), toc))
        sections_html.append(
            f"<section class='doc' id='{slugify(title)}'>\n{body_html}\n</section>"
        )

    nav_parts = []
    for title, anchor, toc in full_toc:
        items = "".join(
            f"<li class='toc-h{lvl}'><a href='#{aid}'>{html.escape(t)}</a></li>"
            for lvl, t, aid in toc
            if lvl <= 3
        )
        nav_parts.append(
            f"<div class='toc-doc'><a class='toc-doc-title' href='#{anchor}'>{html.escape(title)}</a>"
            f"<ul>{items}</ul></div>"
        )

    template = (SITE / "templates" / "grammar_template.html").read_text(encoding="utf-8")
    page = template.replace("{{TOC}}", "\n".join(nav_parts))
    page = page.replace("{{CONTENT}}", "\n".join(sections_html))
    (SITE / "grammar.html").write_text(page, encoding="utf-8")
    print(f"wrote {SITE / 'grammar.html'}")


def build_dictionary_data():
    conn = sqlite3.connect(ROOT / "boruca_vocabulary.db")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, headword, headword_original, tone_marked, part_of_speech,
               part_of_speech_subtype, gloss_es, gloss_en, example_boruca,
               example_translation_es, etymology, semantic_domain, source,
               morphology_type, morphology_analysis, notes
        FROM vocabulary_full
        ORDER BY headword COLLATE NOCASE
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    cur2 = sqlite3.connect(ROOT / "boruca_vocabulary.db").cursor()
    cur2.execute("SELECT DISTINCT category FROM parts_of_speech ORDER BY 1")
    pos_values = [r[0] for r in cur2.fetchall()]
    cur2.execute("SELECT DISTINCT morphology_type FROM vocabulary WHERE morphology_type IS NOT NULL ORDER BY 1")
    morph_values = [r[0] for r in cur2.fetchall()]
    cur2.execute("SELECT name FROM semantic_domains ORDER BY 1")
    domain_values = [r[0] for r in cur2.fetchall()]

    payload = {
        "entries": rows,
        "facets": {
            "partOfSpeech": pos_values,
            "morphologyType": morph_values,
            "semanticDomain": domain_values,
        },
    }

    out_path = SITE / "data" / "vocabulary.js"
    out_path.write_text(
        "// Auto-generated by website/build.py from boruca_vocabulary.db — do not edit by hand.\n"
        "var VOCAB_DATA = " + json.dumps(payload, ensure_ascii=False, indent=None) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {out_path} ({len(rows)} entries)")


if __name__ == "__main__":
    build_dictionary_data()
    build_grammar_page()
