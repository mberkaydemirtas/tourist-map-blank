const p = require("./package.json");
const sections = ["dependencies","devDependencies","peerDependencies","optionalDependencies"];
const bad = [];
for (const s of sections) {
  const obj = p[s];
  if (!obj) continue;
  for (const [k,v] of Object.entries(obj)) {
    if (
      k === "undefined" ||                   // yanlışlıkla eklenmiş anahtar
      typeof v !== "string" ||               // sürüm string değil
      !v.trim() ||                           // boş sürüm
      v === '"' || v === '\\"' ||            // sadece tırnak/sorunlu
      v.includes('\\"')                      // kaçmış tırnaklı sürüm
    ) {
      bad.push({ section: s, name: k, version: v });
    }
  }
}
console.log(bad.length ? JSON.stringify(bad, null, 2) : "OK");
