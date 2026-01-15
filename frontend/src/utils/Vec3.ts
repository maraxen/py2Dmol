export class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }
    add(v: Vec3) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v: Vec3) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
    mul(s: number) { return new Vec3(this.x * s, this.y * s, this.z * s); }
    dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    length() { return Math.sqrt(this.dot(this)); }
    distanceTo(v: Vec3) { return this.sub(v).length(); }
    distanceToSq(v: Vec3) { const s = this.sub(v); return s.dot(s); }
    normalize() {
        const len = this.length();
        return len > 0 ? this.mul(1 / len) : new Vec3(0, 0, 1);
    }
}
