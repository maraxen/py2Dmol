import { Vec3 } from './Vec3';

export function rotationMatrixX(angle: number): number[][] { const c = Math.cos(angle), s = Math.sin(angle); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
export function rotationMatrixY(angle: number): number[][] { const c = Math.cos(angle), s = Math.sin(angle); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
export function multiplyMatrices(a: number[][], b: number[][]): number[][] { const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j]; return r; }
export function applyMatrix(m: number[][], v: Vec3): Vec3 { return new Vec3(m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z, m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z, m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z); }
export function sigmoid(x: number): number { return 0.5 + x / (2 * (1 + Math.abs(x))); }
