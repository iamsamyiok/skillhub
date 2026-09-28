// 版本命名：原名 → <base>_v1.1.svg；已有版本 → 小版本号 +1
// 用法：node next_name.mjs diagram.svg        -> diagram_v1.1.svg
//       node next_name.mjs diagram_v1.3.svg   -> diagram_v1.4.svg
const name = (process.argv[2] || '').trim();
const m = name.match(/^(.+?)(_v(\d+)\.(\d+))?\.svg$/i);
if (!m) { console.error('ERR bad name: ' + name); process.exit(1); }
const minor = m[2] ? Number(m[4]) + 1 : 1;
console.log(`${m[1]}_v1.${minor}.svg`);
