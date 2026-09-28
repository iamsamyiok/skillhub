// 示例：齿轮（环形阵列）—— 用法见 SKILL.md 无头模式
cadAPI.clear();
const R = 120, rp = 100, hole = 40;
cadAPI.circle(0, 0, R, { stroke: "#000", strokeW: 2, fill: "none" });
cadAPI.circle(0, 0, hole, { stroke: "#000", strokeW: 2, fill: "none" });
const t = cadAPI.rect(-8, rp - 10, 16, 20, { fill: "#888" });
cadAPI.arrayPolar(t.id, 0, 0, 12, 360, true);
cadAPI.rect(-6, hole - 3, 12, 10, { fill: "#fff" });
const dc = cadAPI.circle(0, 0, R);
cadAPI.dimRadius(dc.id, { stroke: "#c0392b" });
cadAPI.text(-30, -R - 20, "GEAR Z=12", 14);
cadAPI.fit();
const v = cadAPI.verify();
return JSON.stringify({ count: v.count, validate: v.validate, bbox: v.bbox });
