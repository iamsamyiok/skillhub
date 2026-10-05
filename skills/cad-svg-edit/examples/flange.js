// 示例：法兰盘（多孔环阵 + 半径标注）—— 用法见 SKILL.md 无头模式
cadAPI.clear();
cadAPI.circle(0, 0, 150, { strokeW: 3, fill: "none" });
cadAPI.circle(0, 0, 130, { strokeW: 1, fill: "none" });
const bore = cadAPI.circle(0, 0, 40, { strokeW: 2, fill: "none" });
const hole = cadAPI.circle(100, 0, 12, { strokeW: 2, fill: "none" });
cadAPI.arrayPolar(hole.id, 0, 0, 8, 360, true);
cadAPI.dimRadius(bore.id);
cadAPI.text(-60, -180, "FLANGE 8xR12", 16);
cadAPI.fit();
