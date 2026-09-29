// Shaders of the effects (design/plateau-3d): all additive but the hologram, uTime shared (frozen with reduced motion).
import { PAS } from "./disposition.ts";

const FIN = "\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n";
export const VS_UV = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
export const VS_MONDE = "varying vec3 vMonde; void main() { vec4 m = modelMatrix * vec4(position, 1.0); vMonde = m.xyz; gl_Position = projectionMatrix * viewMatrix * m; }";

export const FS_SURBRILLANCE = `
uniform vec3 uColor; uniform float uFill, uPulse, uTime; uniform vec2 uSize, uDemi; varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = abs(p) - uDemi + 0.05;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.05;
  float trait = 1.0 - smoothstep(0.0, 0.025, abs(d));
  float halo = exp(-max(d, 0.0) * 16.0) * step(0.0, d) * 0.8;
  float pulse = mix(1.0, 0.6 + 0.4 * sin(uTime * 4.0), uPulse);
  gl_FragColor = vec4(uColor, (trait + halo + step(d, 0.0) * uFill) * pulse);${FIN}}`;

export const FS_HOLOGRAMME = `
uniform sampler2D map; uniform vec3 uColor; uniform float uReveal, uOpacity, uTime; varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float d = max(abs(p.x) * 2.0, abs(p.y) * 2.0 + abs(p.x));
  if (d > 1.0) discard;
  vec3 art = texture2D(map, vec2(0.5 + p.x / 1.1, vUv.y)).rgb;
  float trame = 0.8 + 0.2 * sin(vUv.y * 260.0 - uTime * 5.0);
  float bord = smoothstep(0.86, 1.0, d);
  float monte = 1.0 - smoothstep(uReveal - 0.04, uReveal, vUv.y);
  float front = exp(-abs(vUv.y - uReveal) * 70.0) * step(uReveal, 1.0);
  float pied = smoothstep(0.0, 0.42, vUv.y);
  float scintille = 0.94 + 0.06 * sin(uTime * 31.0);
  vec3 col = art * trame * 0.9 + uColor * (bord * smoothstep(0.05, 0.45, vUv.y) * 1.6 + smoothstep(0.6, 1.0, vUv.y) * 0.22 + front * 2.5);
  gl_FragColor = vec4(col, min(1.0, monte * uOpacity * scintille * max(pied * 0.92, bord * smoothstep(0.05, 0.45, vUv.y)) + front * uOpacity));${FIN}}`;

export const FS_CONE = `
uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv;
void main() {
  float stries = 0.55 + 0.45 * sin(vUv.x * 37.7 + uTime * 3.0);
  gl_FragColor = vec4(uColor, mix(0.3, 1.0, 1.0 - vUv.y) * stries * 0.4 * uOpacity);${FIN}}`;

export const FS_FAISCEAU = `
uniform vec3 uColor; uniform float uMode, uProgress, uOpacity, uTime; varying vec2 vUv;
void main() {
  float tirets = step(0.45, fract(vUv.x * 12.0 - uTime * 1.5)) * 0.8;
  float tete = smoothstep(uProgress - 0.45, uProgress, vUv.x) * step(vUv.x, uProgress);
  vec3 col = mix(uColor, vec3(4.0), tete * tete * uMode * 0.6);
  gl_FragColor = vec4(col, mix(tirets, tete, uMode) * uOpacity);${FIN}}`;

export const FS_SOL = `
uniform vec3 uColor; varying vec3 vMonde;
void main() {
  vec2 c = vMonde.xz / vec2(${PAS.x}, ${PAS.z}) + 0.5;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  float trait = 1.0 - min(min(g.x, g.y), 1.0);
  float fondu = 1.0 - smoothstep(2.0, 6.5, length(vMonde.xz * vec2(0.55, mix(1.7, 1.1, step(0.0, vMonde.z)))));
  gl_FragColor = vec4(uColor, trait * fondu * 0.45);${FIN}}`;

export const FS_BALAYAGE = `
uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main() {
  float y = (vUv.y - 0.5) * 5.0;
  gl_FragColor = vec4(uColor, exp(-y * y) * uOpacity);${FIN}}`;
