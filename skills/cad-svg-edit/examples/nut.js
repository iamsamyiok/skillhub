// 六角螺母 HEX NUT —— 俯视图(plan) + 前视图(front/elevation)
cadAPI.clear();

// ===== 参数 =====
const R  = 57.735;            // 外六边外接圆半径 → 对边距 s = 100.0
const Rc = 46;                // 倒角内六边外接圆半径
const r  = 25;                // 中心孔(螺孔)半径
const sf = +(R * Math.sqrt(3) / 2).toFixed(2);   // 对边距的一半 = 50.00

// 生成正六边形顶点(平顶平底：顶点在左右)
const hexPts = (rad) => {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * Math.PI / 180;
    p.push([+(rad * Math.cos(a)).toFixed(2), +(rad * Math.sin(a)).toFixed(2)]);
  }
  return p;
};
const outer = hexPts(R);
const inner = hexPts(Rc);

// ===== 俯视图 =====
cadAPI.polygon(outer, { stroke:"#1a1a1a", strokeW:2.5, fill:"none" });
cadAPI.polygon(inner, { stroke:"#1a1a1a", strokeW:1.5, fill:"none" });
for (let i = 0; i < 6; i++) {
  cadAPI.line(outer[i][0], outer[i][1], inner[i][0], inner[i][1],
              { stroke:"#1a1a1a", strokeW:1 });
}
const bore = cadAPI.circle(0, 0, r, { stroke:"#1a1a1a", strokeW:2, fill:"none" });
cadAPI.dimRadius(bore.id, { stroke:"#444", strokeW:1 });

// 中心十字线
cadAPI.line(-80, 0, 80, 0, { stroke:"#999", strokeW:1 });
cadAPI.line(0, -80, 0, 80, { stroke:"#999", strokeW:1 });

// 对边距 s 尺寸(右侧竖标)
cadAPI.dimLine(94, -sf, 94, sf, { stroke:"#444", strokeW:1 });

// ===== 前视图( elevation ) =====
const fy = 215, hH = 42, halfW = sf, c = 12;
const xL = -halfW, xR = halfW, yT = fy - hH, yB = fy + hH;
const fpts = [
  [xL,      yT + c], [xL + c, yT],
  [xR - c,  yT],     [xR,     yT + c],
  [xR,      yB - c], [xR - c, yB],
  [xL + c,  yB],     [xL,     yB - c]
];
cadAPI.polygon(fpts, { stroke:"#1a1a1a", strokeW:2.5, fill:"none" });
// 螺孔轴线(中心横线)
cadAPI.line(-72, fy, 72, fy, { stroke:"#999", strokeW:1 });
// 厚度 m 尺寸(左侧竖标)
cadAPI.dimLine(xL - 32, yT, xL - 32, yB, { stroke:"#444", strokeW:1 });
// 宽度(对边距)尺寸(下方横标)
cadAPI.dimLine(xL, yB + 32, xR, yB + 32, { stroke:"#444", strokeW:1 });

// ===== 标注文字 =====
cadAPI.text(-34, -100, "TOP VIEW", 13, { stroke:"#1a1a1a", strokeW:1 });
cadAPI.text(-40,  332, "FRONT VIEW", 13, { stroke:"#1a1a1a", strokeW:1 });
cadAPI.text(-40, -118, "HEX NUT", 17, { stroke:"#1a1a1a", strokeW:1.2 });

// ===== 校验闭环 =====
const v = cadAPI.validate();
const dims = cadAPI.autoDim ? null : null;
cadAPI.fit();
return JSON.stringify({
  count: cadAPI.count(),
  validate: v.ok,
  bbox: cadAPI.bbox(),
  s: +(2 * sf).toFixed(2),
  boreD: +(2 * r).toFixed(2),
  m: +(2 * hH).toFixed(2)
});
