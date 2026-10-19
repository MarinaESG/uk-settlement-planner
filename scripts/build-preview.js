import { readFile, mkdir, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url),
  read = (p) => readFile(new URL(p, root), "utf8");
const strip = (s) =>
  s
    .replace(/^import [\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, "")
    .replaceAll("export ", "");
const parts = await Promise.all(
  [
    "src/domain.js",
    "src/catalogue.js",
    "public/planner.js",
    "public/app.js",
  ].map(read),
);
let app = strip(parts[3]);
const apiStart = app.indexOf("async function api("),
  apiEnd = app.indexOf("\nfunction message", apiStart);
if (apiStart < 0 || apiEnd < 0) throw Error("Preview API boundary not found.");
app =
  app.slice(0, apiStart) +
  `async function api(path){if(path==='config')return new Response(JSON.stringify({authReady:false,commerce:false,operator:'Pre-launch preview',support:'',catalogue,sources}),{headers:{'Content-Type':'application/json'}});throw Error('This is an offline demonstration. Account and payment services are disabled.');}` +
  app.slice(apiEnd);
app = app.replace(
  /sessionStorage\.getItem\(['"]sp-session['"]\)\s*\|\|\s*['"]['"]/g,
  "''",
);
const script = parts.slice(0, 3).map(strip).join("\n") + "\n" + app;
let html = await read("public/index.html");
html = html
  .replace(
    /<link\s+rel="stylesheet"\s+href="\/style.css"\s*\/?\s*>/,
    "<style>" + (await read("public/style.css")) + "</style>",
  )
  .replace(/<script\s+type="module"\s+src="\/app.js"\s*>\s*<\/script>/, "");
html = html.replace(
  "</body>",
  `<script type="module">${script}</script></body>`,
);
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/Settlement-Planner-UK-Preview.html", root), html);
console.log(
  "Built offline website preview in dist/Settlement-Planner-UK-Preview.html",
);
