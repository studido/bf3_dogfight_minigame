// Split the two outer underwing missiles out of the merged F/A-18 meshes into their own
// nodes (missile_L / missile_R), so the game can hide them when fired and reuse one as
// the in-flight missile model. Triangles are moved by connected component + zone.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [inp, out] = process.argv.slice(2);
const d = await io.read(inp), root = d.getRoot();
const mul=(m,v)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
const inZone = (c) => c.mn[0] > -5.6 && c.mx[0] < -1.4 && c.mn[1] > -0.46 && c.mx[1] < 0.0 && Math.min(Math.abs(c.mn[2]), Math.abs(c.mx[2])) > 4.38 && Math.max(Math.abs(c.mn[2]), Math.abs(c.mx[2])) < 4.93 && Math.sign(c.mn[2]) === Math.sign(c.mx[2]);
const groups = {};
let moved = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const M = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial(); if (mat && mat.getName() === 'Darker_paint') continue; // rails/lugs stay on the pylon
    const pos = p.getAttribute('POSITION'), idx = p.getIndices(), N = pos.getCount();
    const W = [], key = new Map(), rep = new Int32Array(N);
    for (let i = 0; i < N; i++) { const w = mul(M, pos.getElement(i, [0, 0, 0])); W.push(w); const k = w.map((v) => Math.round(v * 500)).join(','); if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
    const par = Int32Array.from({ length: N }, (_, i) => i); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < idx.getCount(); t += 3) { const a = f(rep[idx.getScalar(t)]), b = f(rep[idx.getScalar(t + 1)]), c = f(rep[idx.getScalar(t + 2)]); par[b] = a; par[f(c)] = a; }
    const comp = new Map();
    for (let t = 0; t < idx.getCount(); t += 3) {
      const r = f(rep[idx.getScalar(t)]); let c = comp.get(r);
      if (!c) { c = { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }; comp.set(r, c); }
      for (let j = 0; j < 3; j++) { const w = W[idx.getScalar(t + j)]; for (let k = 0; k < 3; k++) { c.mn[k] = Math.min(c.mn[k], w[k]); c.mx[k] = Math.max(c.mx[k], w[k]); } }
    }
    const keep = [], side = { L: [], R: [] };
    for (let t = 0; t < idx.getCount(); t += 3) {
      const c = comp.get(f(rep[idx.getScalar(t)])), tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
      if (inZone(c)) side[c.mn[2] > 0 ? 'L' : 'R'].push(...tri); else keep.push(...tri);
    }
    if (!side.L.length && !side.R.length) continue;
    const IA = idx.getArray().constructor;
    idx.setArray(new IA(keep));
    for (const s of ['L', 'R']) {
      if (!side[s].length) continue;
      moved += side[s].length / 3;
      if (!groups[s]) { groups[s] = d.createNode('missile_' + s); node.getParentNode().addChild(groups[s]); }
      const np = d.createPrimitive().setMaterial(mat).setIndices(d.createAccessor().setType('SCALAR').setArray(new IA(side[s])).setBuffer(root.listBuffers()[0]));
      for (const sem of p.listSemantics()) np.setAttribute(sem, p.getAttribute(sem));
      const nm = d.createMesh(mesh.getName() + '_msl' + s).addPrimitive(np);
      const nn = d.createNode(node.getName() + '_msl' + s).setMesh(nm).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
      groups[s].addChild(nn);
    }
  }
}
await io.write(out, d);
console.log(inp, 'moved tris', moved, 'groups', Object.keys(groups));
