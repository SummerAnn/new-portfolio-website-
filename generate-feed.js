// Run with: node generate-feed.js
// Generates feed.xml from content.js notes array

import { notes } from "./content.js";

const SITE = "https://summerann.org";

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const items = notes
  .map((n) => {
    const link = `${SITE}/article.html?slug=${n.slug}`;
    const desc = escapeXml(n.excerpt);
    const date = new Date(`${n.date} 1, 2026`).toUTCString();
    return `    <item>
      <title>${escapeXml(n.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${date}</pubDate>
      <description>${desc}</description>
    </item>`;
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Summer Ann — Journal</title>
    <link>${SITE}</link>
    <description>Notes on multi-agent systems, AI safety, and research.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;

import { writeFileSync } from "fs";
writeFileSync("feed.xml", xml);
console.log(`Generated feed.xml with ${notes.length} items`);
