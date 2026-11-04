// Mirrors that show the road behind. From the driver's seat a small camera looks back over the
// car into a low-resolution picture, and every pixel of a mirror's glass looks up in it what a
// ray from your eye bounces on to: the left mirror shows behind-left, the right one behind-right,
// the rear-view mirror straight back, each the right way round and moving as you look around.
//
// The glass is cut out of the car models when they load (models.js, cutMirrors). Its normals
// are aimed at the driver's eye, as you would set real mirrors, and spread a little from the
// middle so the wing mirrors are slightly convex. Outside the cockpit nothing extra is drawn and
// the glass shows the colour of the sky.
import * as THREE from 'three';

const uniforms = {
  tMirror: { value: null },
  uViewProj: { value: new THREE.Matrix4() },
  uLive: { value: 0 },
  uSky: { value: new THREE.Color(0.6, 0.66, 0.72) },
};

let material = null;
export function mirrorMaterial() {
  material ||= new THREE.ShaderMaterial({
    name: 'mirror',
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMirror;
      uniform mat4 uViewProj;
      uniform float uLive;
      uniform vec3 uSky;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec3 R = reflect(normalize(vWorld - cameraPosition), normalize(vN));
        // Where the bounced ray is 40 m out: right for the road and cars behind, and the sky is
        // far enough that the small offset between the glass and the camera does not show.
        vec4 c = uViewProj * vec4(vWorld + R * 40.0, 1.0);
        vec2 uv = c.xy / c.w * 0.5 + 0.5;
        float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float seen = uLive * step(0.0, c.w) * smoothstep(0.0, 0.04, edge);
        vec3 sky = uSky * 0.7;
        vec3 col = mix(sky, texture2D(tMirror, clamp(uv, 0.0, 1.0)).rgb, seen);
        gl_FragColor = vec4(col * 0.85, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return material;
}

export class Mirrors {
  constructor({ small = false } = {}) {
    // Half-float, so the bright sky keeps its range for the tone mapping later.
    this.rt = new THREE.WebGLRenderTarget(small ? 320 : 768, small ? 160 : 384, { type: THREE.HalfFloatType, depthBuffer: true });
    uniforms.tMirror.value = this.rt.texture;
    // About 118 degrees across: enough for both wing mirrors and the one in the middle.
    this.cam = new THREE.PerspectiveCamera(80, 2, 0.3, 3000);
    // Phones redraw it every other frame and leave the grass out of it.
    this.every = small ? 2 : 1;
    this.lite = small;
    this.frame = 0;
    this.q = new THREE.Quaternion();
    this.vp = new THREE.Matrix4();
  }

  // Before the frame is drawn. on: the driver's view of a car with mirrors.
  update(renderer, scene, camera, body, on) {
    if (scene.fog) uniforms.uSky.value.copy(scene.fog.color);
    uniforms.uLive.value = on ? 1 : 0;
    if (!on || this.frame++ % this.every) return;
    const cam = this.cam;
    cam.position.copy(camera.position);
    cam.quaternion.copy(body.getWorldQuaternion(this.q)); // a camera looks down -z: out of the back
    if (cam.far !== camera.far) { cam.far = camera.far; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    uniforms.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // The car itself stays out of the picture (it would fill it from inside), and the shadow
    // maps already drawn are used again rather than drawn twice.
    const target = renderer.getRenderTarget(), shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    body.visible = false;
    const hide = this.lite ? scene.children.filter((o) => o.isInstancedMesh && o.userData.noAO && o.visible) : [];
    for (const o of hide) o.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(target);
    for (const o of hide) o.visible = true;
    body.visible = true;
    renderer.shadowMap.autoUpdate = shadows;
  }
}
