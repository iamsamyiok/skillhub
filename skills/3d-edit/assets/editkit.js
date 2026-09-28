//<<3d-edit:kit v1>>
/* ==========================================================================
   3d-edit kit v1.3 — 单文件 three.js 场景的「人机同源」编辑层
   标记区内代码由 3d-creat-v1.2s 技能管理，不要手改（用 `edit3d.mjs sync <file>` 替换）。
   场景侧只需提供 window.SCENE 契约，本块负责：
     寻址 find/pick · 读写 set/entity · 原子批量 patch · 历史 undo/redo（增量+合并）
     选中 select · gizmo 代理变换 · 事件总线 signals · 落盘 saveFile/autosave
   设计约束（借鉴 three.js Editor / ShadowEditor / threepipe 后自定）：
     人与 agent 写的是同一条 patch 命令流 ⇒ 任何手动改动天然可序列化、可撤销、可被 agent 续改。
   ==========================================================================*/
(function installEditKit() {
  const S = window.SCENE;
  if (!S || !S.three || !S.THREE) { console.log('[3d-edit] SKIP — 缺 window.SCENE 契约'); return; }
  const C = window.CITY || (window.CITY = {});
  const T = S.THREE;
  const EDITS = window.__3D_EDITS__ || [];
  const entProps = new Map();          // id → 累积 props（跨 rebuild 重放，因为 rebuild 会重建实体）
  const WIDGET = '__3d_widget';        // gizmo/高亮等编辑器替身：不得进拾取/包围盒/导出
  let recording = true, selected = null, mergeWindow = 500;

  /* ---------- 事件总线（面板/拾取/自动保存的唯一解耦点，不逐帧轮询） ---------- */
  const handlers = new Map();
  const sig = {
    on(k, f) { (handlers.get(k) || handlers.set(k, new Set()).get(k)).add(f); return () => sig.off(k, f); },
    off(k, f) { const s = handlers.get(k); if (s) s.delete(f); },
    emit(k, d) { const s = handlers.get(k); if (s) for (const f of [...s])
      { try { f(d); } catch (e) { console.warn('[3d-edit] signal ' + k + ':', e.message); } } },
  };
  /* 事件名表：objectSelected entityChanged paramsChanged historyChanged sceneGraphChanged saved */

  /* ---------- 参数寻址 ---------- */
  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function setPath(o, path, v) {
    const k = path.split('.'), last = k.pop();
    const t = k.reduce((a, x) => (a[x] = a[x] || {}), o);
    const prev = t[last]; t[last] = v; return prev;
  }
  const asHex = v => (typeof v === 'number' ? v : parseInt(String(v).replace('#', ''), 16));
  const desc = path => (S.manifest || []).find(d => d.path === path);
  const manifest = () => (S.manifest || []).map(d => ({
    path: d.path, label: d.label, kind: d.kind || 'number', effect: d.effect || 'rebuild',
    min: d.min, max: d.max, step: d.step, unit: d.unit, aliases: d.aliases || [],
    options: d.options, desc: d.desc, value: get(S.CONFIG, d.path),
  }));
  function coerce(d, v) {
    if (d.kind === 'color') return asHex(v);
    if (d.kind === 'bool') return v === true || v === 'true' || v === 1;
    if (d.kind === 'number') {
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (Number.isNaN(n)) throw new Error('不是数字: ' + v);
      const lo = d.min ?? -Infinity, hi = d.max ?? Infinity;
      if (n < lo || n > hi) throw new Error(`${d.path}=${n} 超出范围 [${lo}, ${hi}]`);
      return n;
    }
    if (Array.isArray(d.options) && !d.options.includes(v)) throw new Error(`非法取值: ${v}`);
    return v;
  }

  /* ---------- 实体：语义 id → Object3D 或 InstancedMesh 实例 ---------- */
  const ENT = new Map();
  const byKey = new Map();               // mesh.uuid#i（实例）或 obj.uuid → 实体，供 pick 反查
  function reg(id, target, meta = {}) {
    const e = { id, label: meta.label || id, kind: meta.kind || 'object', group: meta.group || '' };
    // 顺序要紧：InstancedMesh 也是 Object3D，先判实例再判整体
    if (target && target.isInstancedMesh && meta.index != null) {
      e.t = 'instance'; e.mesh = target;
      const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
      target.getMatrixAt(meta.index | 0, m); m.decompose(p, q, s);
      e.i = meta.index | 0; e.home = { p: p.toArray(), s: s.toArray(), q: q.toArray() };
    } else if (target && target.isObject3D) {
      e.t = 'object'; e.obj = target;
      e.home = { p: target.position.toArray(), s: target.scale.toArray() };
    } else if (typeof target === 'function') { e.t = 'lazy'; e.resolve = target; }
    else { console.warn('[3d-edit] reg 目标不合法:', id); return null; }
    e.props = Object.assign({ visible: true, translate: [0, 0, 0], scale: [1, 1, 1], rotateY: 0 },
                            meta.props, entProps.get(id) || {});   // 重放历史编辑
    ENT.set(id, e);
    if (e.t === 'instance') byKey.set(e.mesh.uuid + '#' + e.i, e);
    else if (e.t === 'object') byKey.set(e.obj.uuid, e);
    writeXform(e); writeMat(e); captureBase(e);
    return e;
  }
  // 基线材质值 → 让 undo 能把"没设过"的属性恢复回出厂状态
  function captureBase(e) {
    const m = mats(e)[0];
    if (m) for (const k of ['emissiveIntensity', 'opacity', 'roughness', 'metalness'])
      if (k in m && e.props[k] == null) e.props[k] = m[k];
    if (e.t === 'instance' && e.mesh.instanceColor && e.props.color == null) {
      const a = e.mesh.instanceColor.array, i = e.i * 3;
      e.props.color = new T.Color().fromArray(a, i).getHex();
    } else if (m && m.color && e.t === 'object' && e.props.color == null) e.props.color = m.color.getHex();
  }
  const objs = e => e.t === 'object' ? [e.obj] : e.t === 'instance' ? [e.mesh] : (e.resolve ? [].concat(e.resolve()) : []);
  const mats = e => objs(e).flatMap(o => o && o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []);

  const XF = { visible: 1, translate: 1, scale: 1, rotateY: 1, rotate: 1 };
  const MF = { color: 1, emissive: 1, emissiveIntensity: 1, opacity: 1, roughness: 1, metalness: 1, intensity: 1 };
  const DEFV = { visible: true, translate: [0, 0, 0], scale: [1, 1, 1], rotateY: 0, rotate: [0, 0, 0] };
  // scale/translate 允许写标量（"放大 1.4 倍"）或三元数组；一律归一化，避免 undefined 乘出 NaN
  const v3 = (v, d = 0) => Array.isArray(v)
    ? [+v[0 ?? d], +v[1 ?? d], +v[2 ?? d]] : [+(v ?? d), +(v ?? d), +(v ?? d)];
  const noNaN = (a, e) => { if (a.some(n => !Number.isFinite(n)))
    throw new Error(e.id + ' 的 translate/scale 取值非法（需 1 个数字或 3 个数字）'); return a; };
  function writeXform(e) {
    const p = e.props;
    if (e.t === 'lazy') {                        // 只支持显隐；几何归属由场景自己管
      if (p.visible !== undefined) objs(e).forEach(o => { if (o) o.visible = p.visible !== false; });
      return;
    }
    const sc = noNaN(v3(p.scale, 1), e), tr = noNaN(v3(p.translate, 0), e);
    if (e.t === 'instance') {
      const sv = new T.Vector3(e.home.s[0] * sc[0], e.home.s[1] * sc[1], e.home.s[2] * sc[2]);
      if (p.visible === false) sv.set(0, 0, 0);  // 实例没有 visible：零缩放即隐藏
      const m = new T.Matrix4().compose(
        new T.Vector3(e.home.p[0] + tr[0], e.home.p[1] + tr[1], e.home.p[2] + tr[2]),
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), +p.rotateY || 0), sv);
      e.mesh.setMatrixAt(e.i, m);
      e.mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    for (const o of objs(e)) {
      if (!o || !o.position) continue;
      o.visible = p.visible !== false;
      o.position.set(e.home.p[0] + tr[0], e.home.p[1] + tr[1], e.home.p[2] + tr[2]);
      o.scale.set(e.home.s[0] * sc[0], e.home.s[1] * sc[1], e.home.s[2] * sc[2]);
      if (p.rotate) o.rotation.set(+p.rotate[0] || 0, +p.rotate[1] || 0, +p.rotate[2] || 0);
      else o.rotation.y = +p.rotateY || 0;
      o.updateMatrixWorld(true);
    }
  }
  function writeMat(e) {
    const p = e.props;
    for (const m of mats(e)) {
      if (p.color != null) {
        if (e.t === 'instance') { e.mesh.setColorAt(e.i, new T.Color(asHex(p.color))); if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true; }
        else if (m.color) m.color.set(asHex(p.color));
      }
      if (p.emissive != null && m.emissive) m.emissive.set(asHex(p.emissive));
      if (p.emissiveIntensity != null && 'emissiveIntensity' in m) m.emissiveIntensity = +p.emissiveIntensity;
      if (p.opacity != null) { m.opacity = +p.opacity; m.transparent = +p.opacity < 1; }
      if (p.roughness != null && 'roughness' in m) m.roughness = +p.roughness;
      if (p.metalness != null && 'metalness' in m) m.metalness = +p.metalness;
    }
    if (p.intensity != null) for (const o of objs(e)) if (o && 'intensity' in o) o.intensity = +p.intensity;  // 灯光实体
    if (mats(e).length === 0 && (p.opacity != null || p.roughness != null))
      console.warn('[3d-edit] ' + e.id + ' 无 material，材质类编辑被忽略');
  }

  /* ---------- 实体有效变换 ↔ gizmo 代理（实例可拖的关键：三个参考项目都没做这层） ---------- */
  function xformOf(e) {
    const tr = v3(e.props.translate, 0), sc = v3(e.props.scale, 1), r = e.props.rotate ? v3(e.props.rotate, 0) : [0, +e.props.rotateY || 0, 0];
    return { p: [e.home.p[0] + tr[0], e.home.p[1] + tr[1], e.home.p[2] + tr[2]],
             s: [e.home.s[0] * sc[0], e.home.s[1] * sc[1], e.home.s[2] * sc[2]], r };
  }
  function xformTo(e, x) {                     // 代理世界变换 → 相对 home 的增量 props
    const out = { translate: x.p.map((v, i) => +(v - e.home.p[i]).toFixed(4)),
                  scale: x.s.map((v, i) => +(v / (e.home.s[i] || 1)).toFixed(4)) };
    if (e.t === 'instance') out.rotateY = +x.r[1].toFixed(4);   // 实例只绕 Y（UI 同时隐藏 X/Z 环）
    else out.rotate = x.r.map(v => +v.toFixed(4));
    return out;
  }
  function gizmoTarget(id = selected) {
    const e = ENT.get(id);
    if (!e || e.t === 'lazy') return null;
    const x = xformOf(e), a = new T.Object3D();
    a.position.fromArray(x.p); a.scale.fromArray(x.s); a.rotation.fromArray(x.r);
    a.userData[WIDGET] = true; a.name = '3d-edit:anchor';
    S.three.scene.add(a);
    return { anchor: a, id: e.id, instance: e.t === 'instance',
      dispose() { S.three.scene.remove(a); },
      commit(opts) { return gizmoCommit(this, opts); } };
  }
  function gizmoCommit(g, opts = { merge: true }) {
    const e = ENT.get(g.id); if (!e) return [];
    const a = g.anchor;
    return commit(Object.entries(xformTo(e, { p: a.position.toArray(), s: a.scale.toArray(),
      r: [a.rotation.x, a.rotation.y, a.rotation.z] }))
      .map(([prop, value]) => ({ op: 'entity', id: g.id, prop, value })), opts);
  }
  function bbox(id = selected) {
    const e = ENT.get(id); if (!e) return null;
    if (e.t === 'instance') {
      const g = e.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const m = new T.Matrix4(); e.mesh.getMatrixAt(e.i, m);
      return new T.Box3().copy(g.boundingBox).applyMatrix4(m).applyMatrix4(e.mesh.matrixWorld);
    }
    const o = objs(e)[0]; return o ? new T.Box3().setFromObject(o) : null;
  }
  function focus(id = selected) {
    const b = bbox(id); if (!b || b.isEmpty()) return null;
    const ctr = b.getCenter(new T.Vector3()), d = Math.max(b.getSize(new T.Vector3()).length() * 1.6, 2);
    const cam = S.three.camera, ctl = S.three.controls;
    const dir = cam.position.clone().sub(ctl ? ctl.target : new T.Vector3()).normalize();
    cam.position.copy(ctr).addScaledVector(dir, d);
    if (ctl) { ctl.target.copy(ctr); ctl.update && ctl.update(); } else cam.lookAt(ctr);
    C.syncState && C.syncState(); sig.emit('cameraChanged');
    return ctr.toArray().map(n => +n.toFixed(1));
  }

  /* ---------- gizmo 管理器（TransformControls 在场景自己的 realm 里动态装载；UI 只发指令） ----------
     借 three.js Editor 的"一次拖动 = 一步撤销"：拖动中静默预览（不进历史），抬起才记账。
     为什么要工厂注入而不是让宿主 editor.html 自己 new：跨 document 的 three 实例做
     attach/intersect 依赖 realm 一致，版本漂移会静默失灵。宿主只操作 DOM 面板，零 three 依赖。 */
  let Lib = null, loading = null, giz = null;
  const GIZMO_URL = () => S.gizmoUrl || 'three/addons/controls/TransformControls.js';
  function loadLib() {
    if (Lib) return Promise.resolve(Lib);
    return loading || (loading = import(GIZMO_URL())
      .then(m => { Lib = m.TransformControls; sig.emit('gizmoLib', 'ready'); return Lib; })
      .catch(e => { loading = null; throw new Error('TransformControls 装载失败: ' + e.message
        + '（three 版本无此路径时给 SCENE.gizmoUrl 指个可用的 URL）'); }));
  }
  function ungiz() {
    if (!giz) return { ok: true, detached: false };
    const { tc, root, g, box } = giz; giz = null;
    if (S.three.controls) S.three.controls.enabled = true;
    try { tc.detach(); } catch (e) {}
    g.dispose();
    S.three.scene.remove(root); S.three.scene.remove(box);
    try { tc.dispose && tc.dispose(); } catch (e) {}
    sig.emit('gizmoDetached');
    return { ok: true, detached: true };
  }
  function gizSync() {                                   // props → 代理变换（undo/redo/数值面板后对齐）
    if (!giz) return;
    const e = ENT.get(giz.id);
    if (!e || e.t === 'lazy') return ungiz();
    const x = xformOf(e);
    giz.g.anchor.position.fromArray(x.p); giz.g.anchor.scale.fromArray(x.s); giz.g.anchor.rotation.fromArray(x.r);
    const b = bbox(giz.id); if (b && giz.box) giz.box.box.copy(b);
  }
  function gizLimit() { if (giz) giz.tc.showX = giz.tc.showZ = !(giz.instance && giz.mode === 'rotate'); }
  function gizCommit() {                                 // 抬起才记账 ⇒ 一次拖动一步撤销
    if (!giz) return;
    const r = giz.g.commit({ merge: true });
    const b = bbox(giz.id); if (b && giz.box) giz.box.box.copy(b);
    sig.emit('gizmoCommit', { id: giz.id, result: r });
  }
  async function gizmo(id, opts = {}) {
    if (id == null || id === false) return ungiz();
    const e = ENT.get(id);
    if (!e) return { error: '未知实体: ' + id + '（CITY.entities() 查 id）' };
    if (e.t === 'lazy') return { error: '整组实体不能拖动：几何归生成规则管，只能显隐/材质（P3 才动形状）' };
    if (!S.three.renderer || !S.three.camera) return { error: '契约缺 SCENE.three.renderer/camera，gizmo 不可用；面板数值改动仍有效' };
    if (giz && giz.id === id && !opts.force) { giz.mode = opts.mode || giz.mode; giz.space = opts.space || giz.space;
      giz.tc.setMode(giz.mode); giz.tc.setSpace(giz.space); gizLimit(); gizSync();
      return { ok: true, id, mode: giz.mode, space: giz.space, reused: true }; }
    let L; try { L = await loadLib(); } catch (err) { return { error: err.message }; }
    ungiz();
    const g = gizmoTarget(id); if (!g) return { error: '无法为该实体建变换代理' };
    const tc = new L(S.three.camera, opts.dom || S.three.renderer.domElement);
    const root = tc.getHelper ? tc.getHelper() : tc;      // r160 自身即 Object3D；r16x 起要 getHelper()
    root.userData[WIDGET] = tc.userData[WIDGET] = true;    // widget 根隔离：拾取/包围盒/导出都绕开它
    S.three.scene.add(root);
    const b = bbox(id);
    const box = new T.Box3Helper(b || new T.Box3(), new T.Color(0xffb84d));
    box.userData[WIDGET] = true; S.three.scene.add(box);
    giz = { id, tc, root, g, box, instance: g.instance,
      mode: opts.mode || 'translate', space: opts.space || 'world' };
    tc.setSize(opts.size || 0.72); tc.setMode(giz.mode); tc.setSpace(giz.space); gizLimit();
    tc.addEventListener('dragging-changed', ev => {
      if (S.three.controls) S.three.controls.enabled = !ev.value;   // 拖 gizmo 时锁相机轨道
      if (!ev.value) gizCommit();
      sig.emit('gizmoDrag', ev.value);
    });
    tc.addEventListener('objectChange', () => { g.commit({ silent: true }); sig.emit('gizmoChanged', id); });
    tc.attach(g.anchor);
    sig.emit('gizmoAttached', id);
    return { ok: true, id, mode: giz.mode, space: giz.space, instance: g.instance };
  }
  function setXform(id, abs) {                            // 绝对位/缩/旋 → 相对 home 增量（数值面板）
    const e = ENT.get(id || selected);
    if (!e) return [{ error: '未知实体: ' + id }];
    if (e.t === 'lazy') return [{ error: '整组实体不支持变换' }];
    const x = { ...xformOf(e), ...abs };
    const r = commit(Object.entries(xformTo(e, x)).map(([prop, value]) => ({ op: 'entity', id: e.id, prop, value })), { merge: true });
    gizSync(); return r;
  }

  /* ---------- 加/删物件：kit 自带图元工厂（场景侧零代码），同样以数据形式存在 ----------
     与 entity 走同一套：加出来的东西立刻可 pick / gizmo / 改色 / 撤销 / 写进 patches。 */
  const ADD = new Map();                                  // id → {mesh, patch}
  const nextAddId = kind => {                             // 跨 rebuild 稳定：已有最大序号 +1
    let n = 0;
    for (const id of ADD.keys()) { const m = /^prop-(\d+)-/.exec(id); if (m) n = Math.max(n, +m[1]); }
    return 'prop-' + (n + 1) + '-' + kind;
  };
  const KIND_GEO = { box: 'BoxGeometry', cyl: 'CylinderGeometry', cone: 'ConeGeometry',
    sphere: 'SphereGeometry', torus: 'TorusGeometry', plane: 'PlaneGeometry' };
  function makeMesh(kind, P) {
    const s = +P.size || 1, h = +P.height || s, r = P.radius != null ? +P.radius : s / 2;
    const G = T[KIND_GEO[kind]];
    if (!G) return null;
    let g;
    if (kind === 'box') g = new G(s, h, P.depth != null ? +P.depth : s);
    else if (kind === 'plane') g = new G(s, P.depth != null ? +P.depth : s);
    else if (kind === 'cyl' || kind === 'cone') g = new G(r, kind === 'cyl' ? r : 0, h, 24);
    else if (kind === 'sphere') g = new G(r, 24, 16);
    else g = new G(r, s / 8, 12, 32);
    if (kind !== 'plane' && kind !== 'sphere' && kind !== 'torus') g.translate(0, h / 2, 0);  // 脚底落地
    const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: asHex(P.color != null ? P.color : 0xd8dde3),
      roughness: P.roughness != null ? +P.roughness : 0.6, metalness: P.metalness != null ? +P.metalness : 0.1,
      emissive: asHex(P.emissive || 0), emissiveIntensity: P.emissiveIntensity != null ? +P.emissiveIntensity : 0 }));
    m.castShadow = m.receiveShadow = false;
    return m;
  }
  function addOne(p) {                                     // {op:'add', id, kind, props}
    if (ADD.has(p.id)) return { ...p, prev: ADD.get(p.id).patch };   // 重放（undo/redo、恢复草稿）幂等
    const P = p.props || {};
    const mesh = makeMesh(p.kind, P);
    if (!mesh) throw new Error('不支持的图元: ' + p.kind + '（可用 box/cyl/cone/sphere/torus/plane）');
    mesh.name = p.id;
    const y = P.pos ? +P.pos[1] : (S.groundY ? +S.groundY(P.pos ? P.pos[0] : 0, P.pos ? P.pos[2] : 0) : 0);
    mesh.position.set(P.pos ? P.pos[0] : 0, y, P.pos ? P.pos[2] : 0);
    if (P.rotY) mesh.rotation.y = +P.rotY;
    S.three.scene.add(mesh);
    ADD.set(p.id, { mesh, patch: JSON.parse(JSON.stringify(p)) });
    reg(p.id, mesh, { label: P.label || (p.kind + ' 物件'), group: P.group || 'props', kind: 'prop' });
    sig.emit('entityChanged', p.id);
    return { ...p, prev: undefined, added: true };
  }
  function removeOne(p) {
    const a = ADD.get(p.id);
    if (!a) throw new Error('只能删除用 op:add 加出来的物件（' + p.id + ' 不是）。原生几何属生成规则层 → 用 visible=false 隐藏或做 P3 手术');
    const e = ENT.get(p.id);
    S.three.scene.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose();
    ADD.delete(p.id); if (e) ENT.delete(e.id); byKey.delete(a.mesh.uuid);
    if (selected === p.id) selected = null;
    sig.emit('entityChanged', p.id); sig.emit('sceneGraphChanged');
    return { ...p, prev: a.patch };                        // prev = 完整 add patch ⇒ undo 能重建
  }

  /* ---------- 唯一写入口：applyOne(p) → {…, prev, dirty} ---------- */
  function applyOne(p) {
    if (p.op === 'param') {
      const d = desc(p.path); if (!d) throw new Error('未知参数: ' + p.path + '（先 CITY.find 定位）');
      const v = coerce(d, p.value);
      const prev = setPath(S.CONFIG, d.path, v);
      const hot = d.effect === 'hot' && d.apply;
      if (hot) d.apply(v);
      sig.emit('paramsChanged', p.path);
      return { ...p, prev, dirty: !hot };
    }
    if (p.op === 'entity') {
      const e = ENT.get(p.id); if (!e) throw new Error('未知实体 id: ' + p.id + '（先 CITY.entities() 查）');
      if (!XF[p.prop] && !MF[p.prop]) throw new Error('不支持的实体属性: ' + p.prop);
      if (XF[p.prop] && e.t === 'lazy' && p.prop !== 'visible') throw new Error('组实体（lazy）只支持 visible');
      const prev = e.props[p.prop];
      e.props[p.prop] = p.value;
      entProps.set(p.id, { ...(entProps.get(p.id) || {}), [p.prop]: p.value });
      XF[p.prop] ? writeXform(e) : writeMat(e);
      sig.emit('entityChanged', p.id);
      return { ...p, prev };
    }
    if (p.op === 'add') return addOne(p);
    if (p.op === 'remove') return removeOne(p);
    if (p.op === 'preset') { C.snap ? C.snap(p.value) : C.go && C.go(p.value); return { ...p }; }
    throw new Error('未知 op: ' + p.op);
  }
  function runPatch(p) {
    const r = applyOne(p);
    if (r.dirty) {
      if (!S.rebuild) throw new Error('该参数需要 rebuild，但场景未提供 SCENE.rebuild()');
      S.rebuild(); sig.emit('sceneGraphChanged');
    }
    return r;
  }

  /* ---------- 历史：命令 = patch 本身（可 JSON、可写文件），一次 commit = 一条可撤销记录 ---------- */
  const hist = [];                    // {key, patches[], prevs[], ts, label, dirty}
  let hcur = 0;                       // hist[0..hcur-1] 已应用
  const cmdKey = p => p.op + ':' + (p.path || p.id + '.' + (p.prop || ''));
  const labelOf = p => p.op === 'param' ? (desc(p.path) || {}).label || p.path
    : p.op === 'entity' ? ((ENT.get(p.id) || {}).label || p.id) + '·' + p.prop
    : p.op === 'add' ? '加 ' + p.kind + ' ' + p.id : p.op === 'remove' ? '删 ' + p.id : String(p.op);
  const invOf = (p, prev) => p.op === 'add' ? { op: 'remove', id: p.id }
    : p.op === 'remove' ? (prev || null)                        // prev 存着完整 add patch ⇒ 能重建
    : { ...p, value: prev === undefined ? DEFV[p.prop] : prev };
  const history = () => hist.map((c, i) => ({ i, label: c.label, value: c.patches.map(p => p.value),
    applied: i < hcur }));
  // prev 里颜色常是数字（0xff2d55），命令流可能写 '#ff2d55' —— 比之前先归一，否则空改判不出来
  const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof a === 'number' && asHex(b) === a);

  const liveBase = new Map();             // key → 拖动开始那一刻的旧值（silent 预览不能污染撤销基线）
  function commit(patches, opts = {}) {
    const done = [], pairs = [];
    for (const raw of patches) {
      const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
      try {
        const r = runPatch(p); done.push(r);
        if (p.op === 'preset') continue;                                  // 机位不入历史
        const k = cmdKey(p);
        if (opts.silent) { if (!liveBase.has(k)) liveBase.set(k, r.prev); continue; }   // 只实时预览，不记账
        if (liveBase.has(k)) {                                            // 拖完这一下：撤销要回到按下那一刻，不是最后一次预览
          const base = liveBase.get(k); liveBase.delete(k);
          if (JSON.stringify(base) === JSON.stringify(p.value)) continue;  // 拖回原位 = 空步骤，不记
          pairs.push({ p, prev: base, dirty: !!r.dirty });
        } else if ((p.op === 'param' || p.op === 'entity') && sameVal(r.prev, p.value)) {
          r.noop = true;                                // 改前 == 改后：效果照发，但不占撤销步、不落盘
        } else pairs.push({ p, prev: r.prev, dirty: !!r.dirty });
      } catch (err) { done.push({ ...p, error: String(err.message || err) }); console.warn('[3d-edit] ' + err.message); }
    }
    if (recording && !opts.silent && pairs.length) {
      if (hcur < hist.length) hist.splice(hcur);                 // 新编辑作废 redo 尾巴
      const key = pairs.map(x => cmdKey(x.p)).join('+'), t = performance.now();
      const last = hist[hist.length - 1];
      // 合并窗口：同一目标的同一属性、500ms 内连续拖动 → 只留最新值（撤销一步 = 一次拖动/一次滑块）
      if (opts.merge && pairs.length === 1 && last && last.key === key && t - last.ts < mergeWindow) {
        last.patches = [pairs[0].p]; last.ts = t;
      } else {
        hist.push({ key, patches: pairs.map(x => x.p), prevs: pairs.map(x => x.prev),
                    dirty: pairs.some(x => x.dirty), ts: t, label: labelOf(pairs[0].p) + (pairs.length > 1 ? ' ×' + pairs.length : '') });
      }
      if (hist.length > 600) hist.shift();
      hcur = hist.length;
      autosave();
    }
    sig.emit('historyChanged', { index: hcur, length: hist.length });
    return done;
  }
  function step(d) {
    const c = d < 0 ? hist[hcur - 1] : hist[hcur];
    if (!c) return null;
    const out = [];
    recording = false;
    try {
      const items = d < 0 ? c.patches.map((p, i) => invOf(p, c.prevs[i])) : c.patches;
      for (const p of items) {
        if (!p) continue;
        if (p.op === 'entity' && p.value === undefined) continue;         // 无出厂基线：跳过该属性
        out.push(runPatch(p));
      }
    } finally { recording = true; }
    hcur += d;
    sig.emit('historyChanged', { index: hcur, length: hist.length });
    autosave();
    return d < 0 ? { undid: c.label, undone: c.patches, to: c.prevs, result: out }
                 : { redid: c.label, patch: c.patches, to: c.patches.map(p => p.value), result: out };
  }

  /* ---------- 持久化：文件 patches 区（权威）+ localStorage 草稿（防手滑关页） ---------- */
  const AKEY = '3d-edit:' + ((S.meta || {}).name || 'untitled');
  let autoT = 0;
  function autosave() {
    clearTimeout(autoT);
    autoT = setTimeout(() => { try { localStorage.setItem(AKEY, JSON.stringify({ t: Date.now(), patches: editLog() })); } catch (e) {} }, 400);
  }
  function editLog() { return hist.slice(0, hcur).flatMap(c => c.patches.map(p => ({ ...p, note: p.note || c.label }))); }
  const pendingRestore = () => {
    try {
      const a = JSON.parse(localStorage.getItem(AKEY) || 'null');
      if (!a || !a.patches || !a.patches.length) return null;
      if (JSON.stringify(a.patches) === JSON.stringify(EDITS)) return null;   // 与文件一致，无需恢复
      return a;
    } catch (e) { return null; }
  };
  async function saveFile() {
    const body = JSON.stringify(editLog());
    const name = (location.pathname.split('/').pop() || 'index.html').replace(/[^\w.\-]/g, '') || 'index.html';
    try {
      const r = await fetch('/__save?file=' + encodeURIComponent(name),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.ok) { try { localStorage.setItem(AKEY, JSON.stringify({ t: Date.now(), patches: JSON.parse(body) })); } catch (e) {} }
      sig.emit('saved', j); return j;
    } catch (e) { return { error: String(e.message || e), hint: '没在 edit3d.mjs serve 下运行，改用 CITY.save() 复制或下载' }; }
  }

  /* ---------- 对外 API（挂在 CITY 上，与模板自带的 snap/shot/stats 共存） ---------- */
  Object.assign(C, {
    editable: true, kit: 'v1.3', signals: sig, WIDGET,
    manifest,
    find(w) {                                     // 口语 → 可编辑地址
      const q = String(w).trim(), out = [];
      for (const d of manifest()) {
        const hay = [d.path, d.label, d.desc || '', ...(d.aliases || [])].join(' ');
        if (q && (hay.includes(q) || q.length >= 2 && d.aliases.some(a => a.includes(q))))
          out.push({ type: 'param', path: d.path, label: d.label, value: d.value, effect: d.effect, min: d.min, max: d.max });
      }
      for (const e of ENT.values())
        if (!q || e.id.includes(q) || (e.label || '').includes(q) || (e.group || '').includes(q))
          out.push({ type: 'entity', id: e.id, label: e.label, kind: e.kind, group: e.group });
      return out.slice(0, 40);
    },
    get: path => get(S.CONFIG, path),
    pick(nx, ny) {                                  // 归一化屏幕坐标(-1..1)→语义实体 id："那栋楼"从此可指认
      const rc = new T.Raycaster();
      rc.setFromCamera(new T.Vector2(nx, ny), S.three.camera);
      const isW = o => { for (; o; o = o.parent) if (o.userData && o.userData[WIDGET]) return true; return false; };
      const hits = rc.intersectObjects(S.three.scene.children, true)
        .filter(h => h.object.isMesh && h.object.visible !== false && !isW(h.object));
      for (const h of hits) {
        const e = byKey.get(h.object.uuid + '#' + h.instanceId) || byKey.get(h.object.uuid);
        if (e) return { id: e.id, label: e.label, group: e.group,
          hit: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)], dist: +h.distance.toFixed(1) };
      }
      const h = hits[0];
      return h ? { id: null, type: h.object.type,
        hit: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)] } : null;
    },
    entities(g, opts = {}) {
      const all = [...ENT.values()].filter(e => !g || e.id.includes(g) || (e.group || '').includes(g));
      const off = opts.offset | 0, lim = opts.limit ?? 300;
      return all.slice(off, off + lim).map(e => ({ id: e.id, label: e.label, kind: e.kind, group: e.group,
        target: e.t, editable: e.t !== 'lazy', visible: e.props.visible !== false,
        translate: e.props.translate, scale: e.props.scale, rotateY: e.props.rotateY,
        pos: e.t === 'lazy' ? null : xformOf(e).p.map(n => +n.toFixed(1)) }))
        .concat(all.length > off + lim ? [{ id: null, more: all.length - off - lim, total: all.length }] : []);
    },
    /* 选中与 gizmo */
    select(id) {
      if (id && !ENT.has(id)) return null;
      selected = id || null; sig.emit('objectSelected', selected); return selected;
    },
    selected: () => selected,
    deselect() { return C.select(null); },
    xform: id => { const e = ENT.get(id || selected); return e && e.t !== 'lazy' ? xformOf(e) : null; },
    describe(id) {                                   // 单个实体的摘要：面板每帧刷新用它，别拿全量表去 find
      const e = ENT.get(id || selected); if (!e) return null;
      return { id: e.id, label: e.label, kind: e.kind, group: e.group, target: e.t,
        editable: e.t !== 'lazy', visible: e.props.visible !== false };
    },
    entProp: (id, prop) => { const e = ENT.get(id || selected); if (!e) return undefined;
      if (MF[prop] || XF[prop]) return e.props[prop];
      const m = mats(e)[0]; return m ? m[prop] : undefined; },
    gizmoTarget: id => gizmoTarget(id),
    gizmo: (id, o) => gizmo(id, o), ungiz: () => ungiz(), setXform,
    gizmoMode(m) { if (!giz) return null; giz.mode = m; giz.tc.setMode(m); gizLimit(); return m; },
    gizmoSpace(s) { if (!giz) return null; giz.space = s; giz.tc.setSpace(s); return s; },
    gizmoState: () => giz && { id: giz.id, mode: giz.mode, space: giz.space, instance: !!giz.instance,
      dragging: !!giz.tc.dragging, lib: giz.tc.constructor.name },
    bbox: id => { const b = bbox(id); return b && !b.isEmpty()
      ? { min: b.min.toArray().map(n => +n.toFixed(1)), max: b.max.toArray().map(n => +n.toFixed(1)) } : null; },
    bbox3: id => { const b = bbox(id); return b || new T.Box3(); },
    focus: id => focus(id),
    /* 写入 */
    set: (path, value, o) => commit([{ op: 'param', path, value }], o),
    nudge(path, delta) {                          // "再亮一点" = 相对增量，不猜绝对值
      const d = desc(path); if (!d) throw new Error('未知参数: ' + path);
      const step = d.step ?? ((d.max ?? 1) - (d.min ?? 0)) * 0.1;
      return commit([{ op: 'param', path, value: get(S.CONFIG, path) + delta * step }]);
    },
    entity: (id, props) => commit(Object.entries(props).map(([prop, value]) => ({ op: 'entity', id, prop, value }))),
    add(kind, props = {}) {                              // 加物件：{op:'add'} 数据，和别的编辑一起进 patches
      const p = { op: 'add', id: props.id || nextAddId(kind), kind, props };
      const r = commit([p]);
      if (!r[0] || r[0].error) return r;
      C.select(p.id); return r;
    },
    remove(id) { return commit([{ op: 'remove', id }]); },
    prefabs() { return Object.keys(KIND_GEO); },
    patch: (patches, o) => commit(patches, o),
    /* 历史 */
    editLog, history, canUndo: () => hcur > 0, canRedo: () => hcur < hist.length,
    undo: () => step(-1), redo: () => step(1),
    save: () => JSON.stringify(editLog(), null, 1),
    saveFile: () => saveFile(),
    pendingRestore,
    restore(a) { const x = a || pendingRestore(); if (!x) return null; recording = false;
      const r = commit(x.patches); recording = true; return r; },
    discardDraft() { try { localStorage.removeItem(AKEY); } catch (e) {} return 'draft cleared'; },
    reset() {
      hist.length = 0; hcur = 0; entProps.clear(); recording = false; selected = null;
      for (const id of [...ADD.keys()]) try { removeOne({ op: 'remove', id }); } catch (e) {}
      for (const d of S.manifest || []) { setPath(S.CONFIG, d.path, get(S.home, d.path)); d.effect === 'hot' && d.apply && d.apply(get(S.CONFIG, d.path)); }
      S.rebuild && S.rebuild(); C.discardDraft(); recording = true;
      sig.emit('sceneGraphChanged'); sig.emit('historyChanged', { index: 0, length: 0 });
      return 'reset ok';
    },
    surface() {                                   // 一次调用看清"能改什么"
      const m = manifest();
      return { kit: 'v1.3', scene: (S.meta || {}).name || 'untitled', params: m.length,
        hot: m.filter(d => d.effect === 'hot').length, rebuildable: m.filter(d => d.effect !== 'hot').length,
        entities: ENT.size, edits: hcur, history: hist.length,
        groups: [...new Set([...ENT.values()].map(e => e.group || e.kind))].slice(0, 40),
        gizmo: giz ? { id: giz.id, mode: giz.mode, space: giz.space } : null,
        controls: !!S.three.controls, renderer: !!S.three.renderer };
    },
  });

  /* ---------- 接管实体注册：首次 build 在 kit 之前跑，实体先进队列 ---------- */
  for (const a of (S.regQueue || [])) reg(...a);
  S.regQueue = null; S.reg = reg;               // 之后 rebuild 直接注册，reg 内部重放历史编辑

  /* ---------- gizmo 与命令流对齐：任何写入（agent/面板/undo）后代理跟随 ---------- */
  sig.on('entityChanged', id => { if (giz && giz.id === id && !giz.tc.dragging) gizSync(); });
  sig.on('sceneGraphChanged', () => gizSync());
  sig.on('historyChanged', () => gizSync());

  /* ---------- 启动回放文件里的 patches（必须在场景初次构建之后） ----------
     回放同样计入历史，故 undo() / save() 能逐条回退、改写文件里已有的历史 */
  commit(EDITS);
  C.replay = () => { recording = false; commit(EDITS); recording = true; };  // 重新套用，不重复记账
  const dr = pendingRestore();
  console.log('[3d-edit] kit v1.3 ready params=' + (S.manifest || []).length + ' entities=' + ENT.size
    + ' patches=' + EDITS.length + (dr ? '  ⚠ localStorage 有 ' + dr.patches.length + ' 条草稿（CITY.pendingRestore()）' : ''));
})();
//<</3d-edit:kit>>
