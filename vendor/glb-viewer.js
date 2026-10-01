/* Nanoodle GLB viewer — original, no third-party runtime.
   Classic script (CSP script-src 'self'). The editor injects it only when a
   3D result or a 3D import is on screen; graphs without one never request it.
   Draws on load, resize, orbit, and zoom. Pointer bursts share one
   requestAnimationFrame; the callback paints once and does not schedule again.
   An offscreen stage does not redraw. */
(function (root) {
  "use strict";

  var COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  var BPE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

  function ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function mul(a, b) {
    var o = new Array(16), c, r;
    for (c = 0; c < 4; c++) for (r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function trs(t, r, s) {
    var x = r[0], y = r[1], z = r[2], w = r[3];
    var sx = s[0], sy = s[1], sz = s[2];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1
    ];
  }
  function xform(m, x, y, z, dir) {
    var w = dir ? 0 : 1;
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w
    ];
  }
  function norm3(x, y, z) {
    var l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  function readAcc(json, bin, index) {
    var acc = json.accessors[index];
    if (!acc || acc.bufferView == null) return null;
    var bv = json.bufferViews[acc.bufferView];
    var ncomp = COMPS[acc.type], bpe = BPE[acc.componentType];
    if (!ncomp || !bpe || !bv) return null;
    var stride = bv.byteStride || bpe * ncomp;
    var start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    var view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    var out = new Float32Array(acc.count * ncomp);
    var i, c, o, v;
    for (i = 0; i < acc.count; i++) {
      for (c = 0; c < ncomp; c++) {
        o = start + i * stride + c * bpe;
        if (o + bpe > bin.byteLength) return null;
        if (acc.componentType === 5126) v = view.getFloat32(o, true);
        else if (acc.componentType === 5123) v = view.getUint16(o, true);
        else if (acc.componentType === 5121) v = view.getUint8(o);
        else if (acc.componentType === 5122) v = view.getInt16(o, true);
        else if (acc.componentType === 5120) v = view.getInt8(o);
        else if (acc.componentType === 5125) v = view.getUint32(o, true);
        else return null;
        out[i * ncomp + c] = v;
      }
    }
    return { data: out, count: acc.count, componentType: acc.componentType };
  }

  function imageOf(json, bin, texIndex) {
    if (texIndex == null || !json.textures || !json.images) return null;
    var tex = json.textures[texIndex];
    if (!tex || tex.source == null) return null;
    var img = json.images[tex.source];
    if (!img) return null;
    if (img.bufferView != null && bin) {
      var bv = json.bufferViews[img.bufferView];
      var s = bv.byteOffset || 0;
      return { bytes: bin.subarray(s, s + bv.byteLength), mime: img.mimeType || "image/png" };
    }
    return null;
  }

  function faceNormals(positions, indices) {
    var n = positions.length / 3;
    var acc = new Float32Array(n * 3);
    var out = new Float32Array(n * 3);
    function add(ia, ib, ic) {
      var ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
      var bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
      var cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
      var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      acc[ia * 3] += nx; acc[ia * 3 + 1] += ny; acc[ia * 3 + 2] += nz;
      acc[ib * 3] += nx; acc[ib * 3 + 1] += ny; acc[ib * 3 + 2] += nz;
      acc[ic * 3] += nx; acc[ic * 3 + 1] += ny; acc[ic * 3 + 2] += nz;
    }
    var q, i;
    if (indices && indices.length >= 3) {
      for (q = 0; q + 2 < indices.length; q += 3) add(indices[q], indices[q + 1], indices[q + 2]);
    } else {
      for (i = 0; i + 2 < n; i += 3) add(i, i + 1, i + 2);
    }
    for (i = 0; i < n; i++) {
      var nn = norm3(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]);
      out[i * 3] = nn[0]; out[i * 3 + 1] = nn[1]; out[i * 3 + 2] = nn[2];
    }
    return out;
  }

  function emitMesh(json, bin, mesh, world, out) {
    var prims = (mesh && mesh.primitives) || [];
    var p, attr, pos, nrm, uv, idx, mat, pbr, color, img, i, q, tp, tn;
    for (p = 0; p < prims.length; p++) {
      if (prims[p].mode != null && prims[p].mode !== 4) continue;
      attr = prims[p].attributes || {};
      if (attr.POSITION == null) continue;
      pos = readAcc(json, bin, attr.POSITION);
      if (!pos) continue;
      nrm = attr.NORMAL != null ? readAcc(json, bin, attr.NORMAL) : null;
      uv = attr.TEXCOORD_0 != null ? readAcc(json, bin, attr.TEXCOORD_0) : null;
      idx = prims[p].indices != null ? readAcc(json, bin, prims[p].indices) : null;
      mat = json.materials && json.materials[prims[p].material];
      pbr = (mat && mat.pbrMetallicRoughness) || {};
      color = pbr.baseColorFactor || [0.82, 0.84, 0.88, 1];
      img = imageOf(json, bin, pbr.baseColorTexture && pbr.baseColorTexture.index);
      var positions = new Float32Array(pos.count * 3);
      var normals = new Float32Array(pos.count * 3);
      var uvs = new Float32Array(pos.count * 2);
      for (i = 0; i < pos.count; i++) {
        tp = xform(world, pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2], false);
        positions[i * 3] = tp[0]; positions[i * 3 + 1] = tp[1]; positions[i * 3 + 2] = tp[2];
        if (nrm) {
          tn = norm3.apply(null, xform(world, nrm.data[i * 3], nrm.data[i * 3 + 1], nrm.data[i * 3 + 2], true));
          normals[i * 3] = tn[0]; normals[i * 3 + 1] = tn[1]; normals[i * 3 + 2] = tn[2];
        }
        if (uv) { uvs[i * 2] = uv.data[i * 2]; uvs[i * 2 + 1] = uv.data[i * 2 + 1]; }
      }
      var indices = null;
      if (idx) {
        var max = 0;
        for (q = 0; q < idx.count; q++) if (idx.data[q] > max) max = idx.data[q];
        indices = max > 65535 ? new Uint32Array(idx.data) : Uint16Array.from(idx.data);
      }
      if (!nrm) normals = faceNormals(positions, indices);
      out.push({ positions: positions, normals: normals, uvs: uvs, indices: indices, color: color, image: img, twoSided: !!(mat && mat.doubleSided) });
    }
  }

  function parseGlb(input) {
    try {
      var bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      if (bytes.byteLength < 20) return { error: "that file isn’t a GLB" };
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (dv.getUint32(0, true) !== 0x46546C67) return { error: "that file isn’t a GLB" };
      if (dv.getUint32(4, true) !== 2) return { error: "only glTF 2.0 GLB files can be shown" };
      var off = 12, json = null, bin = new Uint8Array(0), len, type, start;
      while (off + 8 <= bytes.byteLength) {
        len = dv.getUint32(off, true);
        type = dv.getUint32(off + 4, true);
        start = off + 8;
        if (start + len > bytes.byteLength) return { error: "this GLB is truncated" };
        if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + len)));
        else if (type === 0x004E4942) bin = bytes.subarray(start, start + len);
        off = start + len;
      }
      if (!json) return { error: "this GLB has no scene" };
      var req = json.extensionsRequired || [];
      var hard = req.filter(function (e) { return e === "KHR_draco_mesh_compression" || e === "EXT_meshopt_compression"; });
      if (hard.length) return { error: "this model uses " + hard[0] + " — download the .glb to open it elsewhere" };
      var meshes = [];
      var nodes = json.nodes || [];
      var scene = (json.scenes && json.scenes[json.scene || 0]) || null;
      function walk(idx, parent) {
        var node = nodes[idx] || {};
        var local = node.matrix ? node.matrix.slice() : trs(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
        var world = mul(parent, local);
        if (node.mesh != null) emitMesh(json, bin, json.meshes[node.mesh], world, meshes);
        (node.children || []).forEach(function (c) { walk(c, world); });
      }
      if (scene && scene.nodes && scene.nodes.length) scene.nodes.forEach(function (i) { walk(i, ident()); });
      else (json.meshes || []).forEach(function (m) { emitMesh(json, bin, m, ident(), meshes); });
      if (!meshes.length) return { error: "no triangles in this model" };
      return { meshes: meshes };
    } catch (e) {
      return { error: "couldn’t read this model" };
    }
  }

  function lookAt(eye, center, up) {
    var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, (2 * far * near) * nf, 0];
  }

  var VS = "attribute vec3 aPos;attribute vec3 aNrm;attribute vec2 aUv;uniform mat4 uMvp;varying vec3 vN;varying vec3 vW;varying vec2 vUv;void main(){vN=aNrm;vW=aPos;vUv=aUv;gl_Position=uMvp*vec4(aPos,1.0);}";
  var FS = "precision mediump float;uniform vec4 uColor;uniform sampler2D uTex;uniform float uTexOn;uniform float uTwo;uniform vec3 uEye;varying vec3 vN;varying vec3 vW;varying vec2 vUv;vec3 toLin(vec3 c){return pow(max(c,vec3(0.0)),vec3(2.2));}vec3 toSrgb(vec3 c){return pow(max(c,vec3(0.0)),vec3(0.4545));}void main(){vec3 c=uColor.rgb;if(uTexOn>0.5)c*=texture2D(uTex,vUv).rgb;c=toLin(c);vec3 n=normalize(vN);vec3 V=normalize(uEye-vW);float face=max(dot(n,V),0.0);if(uTwo>0.5)face=abs(dot(n,V));float hemi=0.5+0.5*n.y;vec3 sky=vec3(0.62,0.68,0.78);vec3 gnd=vec3(0.22,0.20,0.18);vec3 fill=mix(gnd,sky,clamp(hemi,0.0,1.0));vec3 lit=c*(0.42+0.36*fill+0.70*face);gl_FragColor=vec4(toSrgb(lit),1.0);}";

  function decodeDataUrl(url) {
    var i = url.indexOf(",");
    if (i < 0) throw new Error("bad");
    var meta = url.slice(0, i), data = url.slice(i + 1);
    var raw, k, out;
    if (/;base64/i.test(meta)) {
      raw = root.atob(data);
      out = new Uint8Array(raw.length);
      for (k = 0; k < raw.length; k++) out[k] = raw.charCodeAt(k) & 255;
      return out.buffer;
    }
    raw = decodeURIComponent(data);
    if (root.TextEncoder) return new root.TextEncoder().encode(raw).buffer;
    out = new Uint8Array(raw.length);
    for (k = 0; k < raw.length; k++) out[k] = raw.charCodeAt(k) & 255;
    return out.buffer;
  }

  function fetchable(url) {
    if (typeof url !== "string" || !url) return "";
    if (/^blob:/i.test(url)) return url;
    if (/^https:\/\//i.test(url)) return url;
    if (/^examples\/[A-Za-z0-9_./-]+$/.test(url) && url.indexOf("..") < 0) return url;
    if (/^\/examples\/[A-Za-z0-9_./-]+$/.test(url) && url.indexOf("..") < 0) return url;
    return "";
  }

  function asBytes(source) {
    if (source instanceof ArrayBuffer) return source;
    if (root.Uint8Array && source instanceof root.Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(source) && !(source instanceof DataView))
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    return null;
  }

  function mount(container, source, opts) {
    opts = opts || {};
    var canvas = document.createElement("canvas");
    canvas.className = "glb-canvas";
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;visibility:hidden;touch-action:none;cursor:grab";
    container.appendChild(canvas);
    var gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false })
      || canvas.getContext("experimental-webgl", { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) { opts.onError && opts.onError("WebGL isn’t available in this browser"); return { destroy: function () {} }; }
    var uintExt = gl.getExtension("OES_element_index_uint");
    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader failed");
      return s;
    }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
    } catch (err) {
      opts.onError && opts.onError("couldn’t start the 3D viewer");
      return { destroy: function () { var ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); canvas.remove(); } };
    }
    var loc = {
      mvp: gl.getUniformLocation(prog, "uMvp"),
      eye: gl.getUniformLocation(prog, "uEye"),
      two: gl.getUniformLocation(prog, "uTwo"),
      color: gl.getUniformLocation(prog, "uColor"),
      tex: gl.getUniformLocation(prog, "uTex"),
      texOn: gl.getUniformLocation(prog, "uTexOn"),
      pos: gl.getAttribLocation(prog, "aPos"),
      nrm: gl.getAttribLocation(prog, "aNrm"),
      uv: gl.getAttribLocation(prog, "aUv")
    };
    var gpu = [], dead = false, visible = true, ready = false, frame = 0;
    var yaw = 0.7, pitch = 0.4, dist = 3, radius = 1, cx = 0, cy = 0, cz = 0;
    var pts = new Map(), pinch = 0, ro = null, io = null;

    function fail(msg) { if (!dead && opts.onError) opts.onError(msg); }
    function schedule() {
      if (dead || frame) return;
      var raf = root.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      frame = raf(function () {
        frame = 0;
        render();
      });
    }
    function resize() {
      var w = container.clientWidth || 300, h = container.clientHeight || 200;
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      var W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    }
    function render() {
      if (dead || !visible || !ready || gl.isContextLost()) return;
      resize();
      if (!canvas.width || !canvas.height) return;
      var cp = Math.cos(pitch), sp = Math.sin(pitch), cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
      var eye = [cx + dist * cp * syaw, cy + dist * sp, cz + dist * cp * cyaw];
      var view = lookAt(eye, [cx, cy, cz], [0, 1, 0]);
      var proj = perspective(0.7, canvas.width / canvas.height, Math.max(0.01, radius * 0.02), dist + radius * 8);
      var mvp = mul(proj, view);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.063, 0.075, 0.102, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(mvp));
      gl.uniform3f(loc.eye, eye[0], eye[1], eye[2]);
      var i;
      for (i = 0; i < gpu.length; i++) {
        var g = gpu[i];
        gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
        gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(loc.nrm); gl.vertexAttribPointer(loc.nrm, 3, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 32, 24);
        gl.uniform4fv(loc.color, g.color);
        if (g.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.uniform1i(loc.tex, 0); gl.uniform1f(loc.texOn, 1); }
        else gl.uniform1f(loc.texOn, 0);
        gl.uniform1f(loc.two, g.two || 0);
        if (g.idx) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
          gl.drawElements(gl.TRIANGLES, g.count, g.itype, 0);
        } else gl.drawArrays(gl.TRIANGLES, 0, g.count);
      }
    }
    function potSize(n) {
      var cap = Math.min(Math.max(1, n | 0), 1024), p = 1;
      while ((p << 1) > 0 && (p << 1) <= cap) p <<= 1;
      return p;
    }
    function texSource(bmp) {
      var w = bmp.width || 1, h = bmp.height || 1;
      if (w <= 1024 && h <= 1024 && (w & (w - 1)) === 0 && (h & (h - 1)) === 0) return bmp;
      var tw = potSize(w), th = potSize(h);
      var cnv = root.document.createElement("canvas");
      cnv.width = tw; cnv.height = th;
      cnv.getContext("2d").drawImage(bmp, 0, 0, tw, th);
      return cnv;
    }
    function upload(parsed) {
      var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      parsed.meshes.forEach(function (m) {
        var inter = new Float32Array(m.positions.length / 3 * 8);
        var i, x, y, z;
        for (i = 0; i < m.positions.length / 3; i++) {
          x = m.positions[i * 3]; y = m.positions[i * 3 + 1]; z = m.positions[i * 3 + 2];
          if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
          if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
          inter[i * 8] = x; inter[i * 8 + 1] = y; inter[i * 8 + 2] = z;
          inter[i * 8 + 3] = m.normals[i * 3]; inter[i * 8 + 4] = m.normals[i * 3 + 1]; inter[i * 8 + 5] = m.normals[i * 3 + 2];
          inter[i * 8 + 6] = m.uvs[i * 2]; inter[i * 8 + 7] = m.uvs[i * 2 + 1];
        }
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
        var rec = { buf: buf, color: new Float32Array(m.color), two: m.twoSided ? 1 : 0, tex: null, idx: null, count: m.positions.length / 3, itype: gl.UNSIGNED_SHORT };
        if (m.indices) {
          var u32 = m.indices instanceof Uint32Array;
          if (u32 && !uintExt) { fail("this model is too detailed to draw here — download the .glb"); return; }
          rec.idx = gl.createBuffer();
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rec.idx);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
          rec.count = m.indices.length;
          rec.itype = u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        }
        gpu.push(rec);
        if (m.image && m.image.bytes && root.createImageBitmap) {
          var blob = new Blob([m.image.bytes], { type: m.image.mime || "image/png" });
          root.createImageBitmap(blob).then(function (bmp) {
            if (dead || gl.isContextLost()) return;
            var src = texSource(bmp);
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            rec.tex = tex;
            if (bmp.close) bmp.close();
            schedule();
          }).catch(function () {});
        }
      });
      if (!gpu.length) { fail("no triangles in this model"); return; }
      cx = (min[0] + max[0]) / 2; cy = (min[1] + max[1]) / 2; cz = (min[2] + max[2]) / 2;
      radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
      dist = radius * 2.8;
      ready = true;
      canvas.style.visibility = "visible";
      schedule();
      opts.onReady && opts.onReady();
    }

    function orbitOk(e) {
      if (!e || e.pointerType !== "touch") return true;
      var node = container.closest && container.closest(".node");
      return !node || node.classList.contains("sel");
    }
    function onDown(e) {
      if (!orbitOk(e)) return;
      e.preventDefault(); e.stopPropagation();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.style.cursor = "grabbing";
      if (pts.size === 2) {
        var a = Array.from(pts.values());
        pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      }
    }
    function onMove(e) {
      var p = pts.get(e.pointerId); if (!p) return;
      e.preventDefault(); e.stopPropagation();
      if (pts.size >= 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = Array.from(pts.values());
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
        if (pinch) { dist = Math.max(radius * 0.45, Math.min(radius * 14, dist * (pinch / d))); pinch = d; schedule(); }
        return;
      }
      yaw += (e.clientX - p.x) * 0.01;
      pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - p.y) * 0.01));
      p.x = e.clientX; p.y = e.clientY;
      schedule();
    }
    function onUp(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (!pts.size) canvas.style.cursor = "grab";
    }
    function onWheel(e) {
      e.preventDefault(); e.stopPropagation();
      dist = Math.max(radius * 0.45, Math.min(radius * 14, dist * Math.exp(e.deltaY * 0.0011)));
      schedule();
    }
    function onDbl(e) {
      e.preventDefault(); e.stopPropagation();
      yaw = 0.7; pitch = 0.4; dist = radius * 2.8;
      schedule();
    }
    function onLost(e) {
      e.preventDefault();
      dead = true;
      ready = false;
      fail("the view ran out of GPU memory");
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("webglcontextlost", onLost, false);
    if (typeof root.ResizeObserver === "function") { ro = new root.ResizeObserver(function () { schedule(); }); ro.observe(container); }
    if (typeof root.IntersectionObserver === "function") {
      io = new root.IntersectionObserver(function (entries) {
        visible = entries.some(function (en) { return en.isIntersecting; });
        if (visible) schedule();
      });
      io.observe(container);
    }

    function takeBuf(buf) {
      if (dead) return;
      var parsed = parseGlb(buf);
      if (parsed.error) { fail(parsed.error); return; }
      upload(parsed);
    }
    function onFetchErr(err) {
      if (dead) return;
      var status = err && err.status;
      if (status === 404) { fail("this model isn’t on the server (404)"); return; }
      if (status) { fail("couldn’t load the model (" + status + ")"); return; }
      var msg = (err && err.message) || "";
      if (/fetch|network|cors|failed/i.test(msg)) fail("couldn’t load the model — the host blocked the browser. Use Save or Open.");
      else fail(msg || "couldn’t load the model");
    }
    function loadRemote(url) {
      var fetcher = (root.fetch || fetch);
      fetcher(url).then(function (r) {
        if (!r.ok) {
          var err = new Error("http " + r.status);
          err.status = r.status;
          throw err;
        }
        return r.arrayBuffer();
      }).then(takeBuf).catch(onFetchErr);
    }
    var bytes = asBytes(source);
    if (bytes) takeBuf(bytes);
    else if (source && typeof source.arrayBuffer === "function" && typeof source.size === "number") source.arrayBuffer().then(takeBuf).catch(onFetchErr);
    else if (typeof source === "string" && /^data:/i.test(source)) {
      try { takeBuf(decodeDataUrl(source)); }
      catch (e) { fail("that file isn’t a GLB"); }
    } else {
      var url = fetchable(source);
      if (!url) fail("couldn’t show this model");
      else loadRemote(url);
    }

    return {
      destroy: function () {
        if (dead && !canvas.parentNode) return;
        dead = true;
        if (frame && root.cancelAnimationFrame) { try { root.cancelAnimationFrame(frame); } catch (e) {} }
        frame = 0;
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("dblclick", onDbl);
        canvas.removeEventListener("webglcontextlost", onLost);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        if (!gl.isContextLost()) {
          gpu.forEach(function (g) { gl.deleteBuffer(g.buf); if (g.idx) gl.deleteBuffer(g.idx); if (g.tex) gl.deleteTexture(g.tex); });
          var ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext();
        }
        gpu = [];
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  root.NanoodleGlbViewer = { mount: mount, parseGlb: parseGlb };
})(typeof globalThis !== "undefined" ? globalThis : this);
