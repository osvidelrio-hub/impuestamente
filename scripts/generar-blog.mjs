// Genera el blog 100% en el dominio de Impuestamente a partir de una base de datos de Notion.
// Lee: NOTION_TOKEN, NOTION_DATABASE_ID (variables de entorno / GitHub Secrets)
// Escribe: /blog/index.html, /blog/<slug>.html, /blog/posts.json, y agrega las URLs a sitemap.xml

import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { marked } from "marked";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BLOG_DIR = path.join(ROOT, "blog");
const PARTIALS_DIR = path.join(ROOT, "_partials");
const SITE_URL = "https://impuestamente.com";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("Faltan NOTION_TOKEN o NOTION_DATABASE_ID. Configúralos como Secrets en GitHub.");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const headCommon = fs.readFileSync(path.join(PARTIALS_DIR, "head-common.html"), "utf-8");
const header = fs.readFileSync(path.join(PARTIALS_DIR, "header.html"), "utf-8");
const footer = fs.readFileSync(path.join(PARTIALS_DIR, "footer.html"), "utf-8");

// --- CSS mínimo para el contenido del artículo (se agrega una sola vez al head-common) ---
const PROSE_CSS = `
  <style>
    .prose-article { color: #1e293b; line-height: 1.75; }
    .prose-article h1, .prose-article h2, .prose-article h3 {
      font-family: "Lora", "DM Sans", serif; color: #0b1f33; font-weight: 700;
      margin-top: 1.8em; margin-bottom: 0.6em; letter-spacing: -0.01em;
    }
    .prose-article h1 { font-size: 1.75rem; } .prose-article h2 { font-size: 1.4rem; } .prose-article h3 { font-size: 1.15rem; }
    .prose-article p { margin: 1em 0; }
    .prose-article a { color: #0b7a75; text-decoration: underline; }
    .prose-article ul, .prose-article ol { margin: 1em 0; padding-left: 1.4em; }
    .prose-article li { margin: 0.4em 0; }
    .prose-article blockquote { border-left: 3px solid #eb8a28; padding-left: 1em; color: #475569; font-style: italic; margin: 1.2em 0; }
    .prose-article img { border-radius: 0.75rem; margin: 1.2em 0; max-width: 100%; }
    .prose-article code { background: #edf4f4; padding: 0.15em 0.4em; border-radius: 0.3em; font-size: 0.9em; }
    .prose-article pre { background: #0b1f33; color: #e2e8f0; padding: 1em; border-radius: 0.75em; overflow-x: auto; }
    .prose-article hr { border: none; border-top: 1px solid #d7e2e5; margin: 2em 0; }
  </style>
`;

function pageWrapper({ title, description, ogImage, canonical, bodyHtml, jsonLd }) {
  return `<!doctype html>
<html lang="es-CO">
 <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ""}
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
${headCommon}
${PROSE_CSS}
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
 </head>
 <body class="w-full text-slate-900 antialiased bg-[#f8fafc]">
${header}
  <main>
${bodyHtml}
  </main>
${footer}
  <script>
    document.addEventListener("DOMContentLoaded", () => { if (window.lucide) lucide.createIcons(); });
  </script>
 </body>
</html>
`;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(str) {
  return String(str).toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}

function getProp(props, name, type) {
  const p = props[name];
  if (!p) return "";
  switch (type) {
    case "title": return (p.title || []).map(t => t.plain_text).join("");
    case "rich_text": return (p.rich_text || []).map(t => t.plain_text).join("");
    case "select": return p.select ? p.select.name : "";
    case "date": return p.date ? p.date.start : "";
    case "url": return p.url || "";
    case "files": {
      const f = (p.files || [])[0];
      if (!f) return "";
      return f.type === "external" ? f.external.url : f.file?.url || "";
    }
    default: return "";
  }
}

async function descargarImagen(url, slug) {
  if (!url) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("gif")) ext = "gif";
    const imgDir = path.join(BLOG_DIR, "images");
    fs.mkdirSync(imgDir, { recursive: true });
    const fileName = `${slug}.${ext}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(imgDir, fileName), buffer);
    return `/blog/images/${fileName}`;
  } catch (err) {
    console.warn(`No se pudo descargar la imagen de "${slug}":`, err.message);
    return "";
  }
}

async function localizarImagenesDelContenido(html, slug) {
  const regex = /<img src="([^"]+)"/g;
  let match, i = 0, resultado = html;
  const reemplazos = [];
  while ((match = regex.exec(html)) !== null) {
    reemplazos.push(match[1]);
  }
  for (const url of reemplazos) {
    i++;
    const localUrl = await descargarImagen(url, `${slug}-contenido-${i}`);
    if (localUrl) resultado = resultado.replace(url, localUrl);
  }
  return resultado;
}

async function main() {
  fs.mkdirSync(BLOG_DIR, { recursive: true });

  const pages = [];
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      filter: { property: "Estado", status: { equals: "Publicado" } },
      sorts: [{ property: "Fecha", direction: "descending" }],
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`Publicaciones encontradas: ${pages.length}`);

  const posts = [];

  for (const page of pages) {
    const props = page.properties;
    const titulo = getProp(props, "Título", "title");
    let slug = getProp(props, "Slug", "rich_text") || slugify(titulo);
    slug = slugify(slug);
    const resumen = getProp(props, "Resumen", "rich_text");
    const categoria = getProp(props, "Categoría", "select");
    const fecha = getProp(props, "Fecha", "date") || page.created_time.slice(0, 10);
    const imagen = await descargarImagen(
      getProp(props, "Imagen", "files") || getProp(props, "Imagen", "url"),
      slug
    );

    if (!titulo || !slug) {
      console.warn("Se omite una fila sin título o slug.");
      continue;
    }

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdString = n2m.toMarkdownString(mdBlocks).parent || "";
    let contentHtml = marked.parse(mdString);
    contentHtml = await localizarImagenesDelContenido(contentHtml, slug);

    const fechaTexto = new Date(fecha + "T00:00:00").toLocaleDateString("es-CO", {
      day: "numeric", month: "long", year: "numeric",
    });

    const canonical = `${SITE_URL}/blog/${slug}`;

    const articleBody = `
   <article class="w-full px-4 py-10 md:py-14">
    <div class="mx-auto max-w-3xl">
     <a href="/blog" class="text-sm font-semibold text-[#0b7a75] no-underline hover:text-[#09635f] inline-flex items-center gap-1.5">← Volver al blog</a>
     ${categoria ? `<span class="mt-4 inline-block rounded-full bg-[#0b7a75]/10 text-[#0b7a75] text-xs font-bold px-3 py-1">${escapeHtml(categoria)}</span>` : ""}
     <h1 class="display-font mt-3 text-2xl md:text-4xl font-bold text-[#0b1f33] leading-tight">${escapeHtml(titulo)}</h1>
     <p class="mt-2 text-xs text-slate-500">${fechaTexto}</p>
     ${imagen ? `<img src="${imagen}" alt="${escapeHtml(titulo)}" class="mt-6 w-full rounded-2xl shadow-sm object-cover max-h-96">` : ""}
     <div class="prose-article mt-8">
      ${contentHtml}
     </div>
     <div class="mt-10 rounded-2xl bg-[#0b1f33] p-6 text-center text-white">
      <p class="font-bold">¿Necesitas ayuda con tu declaración de renta?</p>
      <a href="https://wa.me/573019028063" target="_blank" rel="noopener" class="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-bold text-white no-underline">Escribir por WhatsApp</a>
     </div>
    </div>
   </article>`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: titulo,
      description: resumen,
      datePublished: fecha,
      image: imagen || undefined,
      author: { "@type": "Person", name: "Osvaldo Villazon" },
    };

    const html = pageWrapper({
      title: `${titulo} | Impuestamente`,
      description: resumen || titulo,
      ogImage: imagen,
      canonical,
      bodyHtml: articleBody,
      jsonLd,
    });

    fs.writeFileSync(path.join(BLOG_DIR, `${slug}.html`), html, "utf-8");
    posts.push({ titulo, slug, resumen, categoria, fecha, fechaTexto, imagen, url: `/blog/${slug}` });
    console.log(`✓ /blog/${slug}.html`);
  }

  // --- posts.json: lo consume la home para mostrar las últimas publicaciones ---
  fs.writeFileSync(path.join(BLOG_DIR, "posts.json"), JSON.stringify(posts, null, 2), "utf-8");

  // --- índice del blog ---
  const cards = posts.map(p => `
      <a href="${p.url}" class="card-hover rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-underline text-inherit block bg-white">
       <div class="h-40 bg-slate-100 ${p.imagen ? "" : "bg-gradient-to-br from-[#0b7a75] to-[#0b1f33]"}" style="${p.imagen ? `background-image:url('${p.imagen}');background-size:cover;background-position:center;` : ""}"></div>
       <div class="p-5">
        ${p.categoria ? `<span class="text-xs font-semibold text-[#0b7a75]">${escapeHtml(p.categoria)}</span>` : ""}
        <h3 class="display-font mt-1 font-bold text-[#0b1f33]">${escapeHtml(p.titulo)}</h3>
        <p class="mt-2 text-xs text-slate-500">${escapeHtml(p.resumen || "")}</p>
       </div>
      </a>`).join("\n");

  const indexBody = `
   <section class="w-full px-4 py-12 md:py-16">
    <div class="mx-auto max-w-6xl">
     <span class="text-xs font-bold uppercase tracking-widest text-[#0b7a75]">Actualidad Tributaria</span>
     <h1 class="display-font mt-2 text-2xl md:text-4xl font-bold text-[#0b1f33]">Blog</h1>
     <p class="mt-2 text-slate-600 text-sm md:text-base">Guías y análisis sobre declaración de renta y planeación tributaria en Colombia.</p>
     <div class="mt-8 grid gap-6 md:grid-cols-3">
      ${cards || `<p class="col-span-3 text-center text-sm text-slate-500">Aún no hay publicaciones.</p>`}
     </div>
    </div>
   </section>`;

  const indexHtml = pageWrapper({
    title: "Blog | Impuestamente",
    description: "Guías, análisis y noticias sobre declaración de renta y planeación tributaria para personas naturales en Colombia.",
    ogImage: "",
    canonical: `${SITE_URL}/blog`,
    bodyHtml: indexBody,
    jsonLd: null,
  });
  fs.writeFileSync(path.join(BLOG_DIR, "index.html"), indexHtml, "utf-8");
  console.log("✓ /blog/index.html");

  // --- sitemap.xml: agrega las URLs del blog si no están ---
  const sitemapPath = path.join(ROOT, "sitemap.xml");
  if (fs.existsSync(sitemapPath)) {
    let sitemap = fs.readFileSync(sitemapPath, "utf-8");
    const urls = [`${SITE_URL}/blog`, ...posts.map(p => `${SITE_URL}${p.url}`)];
    for (const url of urls) {
      if (!sitemap.includes(`<loc>${url}</loc>`)) {
        sitemap = sitemap.replace("</urlset>", `  <url><loc>${url}</loc></url>\n</urlset>`);
      }
    }
    fs.writeFileSync(sitemapPath, sitemap, "utf-8");
    console.log("✓ sitemap.xml actualizado");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
