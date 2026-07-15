#!/usr/bin/env python3
"""Markdown-протокол -> PDF. Локально, через markdown + weasyprint.
Usage: md2pdf.py <protocol.md> <out.pdf>
Запускать интерпретатором из venv: /root/transcribe/venv/bin/python3
"""
import sys
import markdown
from weasyprint import HTML

src, out = sys.argv[1], sys.argv[2]

with open(src, encoding="utf-8") as f:
    body = markdown.markdown(f.read(), extensions=["tables", "fenced_code", "sane_lists"])

CSS = """
@page { size: A4; margin: 20mm 18mm; }
* { font-family: 'DejaVu Sans', sans-serif; }
body { font-size: 11pt; line-height: 1.45; color: #1a1a1a; }
h1 { font-size: 20pt; margin: 0 0 12pt; }
h2 { font-size: 14pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; }
ul, ol { margin: 4pt 0 8pt 0; padding-left: 18pt; }
li { margin: 2pt 0; }
p { margin: 4pt 0; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
th, td { border: 1px solid #bbb; padding: 5pt 8pt; text-align: left; vertical-align: top; }
th { background: #f2f2f2; font-weight: bold; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 9.5pt; }
"""

html = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}</body></html>"
HTML(string=html).write_pdf(out)
print("[md2pdf] ->", out)
