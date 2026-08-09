export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeHref(value: string) {
  const href = value.trim();
  if (href.startsWith("/") || href.startsWith("#")) return escapeHtml(href);

  try {
    const parsed = new URL(href);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return escapeHtml(href);
  } catch {
    if (!href.includes(":")) return escapeHtml(href);
  }

  return "#";
}

function inlineMarkdown(text: string, slug: string) {
  let out = escapeHtml(text);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    const cleanSrc = src.trim();
    let url = "#";
    if (cleanSrc.startsWith("http://") || cleanSrc.startsWith("https://") || cleanSrc.startsWith("/")) {
      url = cleanSrc;
    } else if (!cleanSrc.includes(":")) {
      url = `/blog/posts/${slug}/assets/${cleanSrc.replace(/^\.?\/?assets\//, "")}`;
    }
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => `<a href="${safeHref(href)}">${label}</a>`);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

export function markdownToHtml(markdown: string, slug: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let table: string[] = [];
  let code: string[] | null = null;
  let codeLang = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "), slug)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item, slug)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${quote.map((item) => `<p>${inlineMarkdown(item, slug)}</p>`).join("")}</blockquote>`);
    quote = [];
  };
  const flushTable = () => {
    if (table.length < 2) return;
    const rows = table.map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inlineMarkdown(cell.trim(), slug)));
    const header = rows[0];
    const body = rows.slice(2);
    html.push(`<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    table = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
    flushTable();
  };

  for (const line of lines) {
    if (code) {
      if (line.startsWith("```")) {
        html.push(`<pre class="language-${escapeHtml(codeLang)}"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
        codeLang = "";
      } else {
        code.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushAll();
      code = [];
      codeLang = line.slice(3).trim();
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (line.startsWith("|")) {
      flushParagraph();
      flushList();
      flushQuote();
      table.push(line);
      continue;
    }
    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      flushTable();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (/^- /.test(line)) {
      flushParagraph();
      flushQuote();
      flushTable();
      list.push(line.replace(/^- /, ""));
      continue;
    }
    if (line.startsWith("#### ")) {
      flushAll();
      html.push(`<h4>${inlineMarkdown(line.slice(5), slug)}</h4>`);
      continue;
    }
    if (line.startsWith("### ")) {
      flushAll();
      html.push(`<h3>${inlineMarkdown(line.slice(4), slug)}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushAll();
      html.push(`<h2>${inlineMarkdown(line.slice(3), slug)}</h2>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushAll();
  return html.join("\n");
}
