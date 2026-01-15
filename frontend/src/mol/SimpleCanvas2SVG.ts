// Minimal canvas2svg implementation for py2Dmol viewer.
// Only supports: lines (moveTo/lineTo/stroke), circles (arc/fill), rectangles (fillRect)

export interface PathCommand {
    type: 'M' | 'L' | 'CIRCLE';
    x: number;
    y: number;
    radius?: number;
}

export interface Operation {
    type: 'stroke' | 'fill' | 'rect' | 'circle';
    pathData?: string;
    strokeStyle?: string;
    fillStyle?: string;
    lineWidth?: number;
    lineCap?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    radius?: number;
}

export class SimpleCanvas2SVG {
    width: number;
    height: number;
    strokeStyle: string;
    fillStyle: string;
    lineWidth: number;
    lineCap: CanvasLineCap;
    currentPath: PathCommand[] | null;
    operations: Operation[];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.strokeStyle = '#000000';
        this.fillStyle = '#000000';
        this.lineWidth = 1;
        this.lineCap = 'butt';
        this.currentPath = null;
        this.operations = [];
    }

    // Path operations
    beginPath() {
        this.currentPath = [];
    }

    moveTo(x: number, y: number) {
        if (!this.currentPath) this.beginPath();
        this.currentPath!.push({ type: 'M', x: x, y: y });
    }

    lineTo(x: number, y: number) {
        if (!this.currentPath) this.beginPath();
        this.currentPath!.push({ type: 'L', x: x, y: y });
    }

    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
        if (!this.currentPath) this.beginPath();
        // py2Dmol only uses full circles (0 to 2π)
        this.currentPath!.push({ type: 'CIRCLE', x: x, y: y, radius: radius });
    }

    // Drawing operations
    stroke() {
        if (!this.currentPath || this.currentPath.length === 0) return;

        let pathData = '';
        for (let i = 0; i < this.currentPath.length; i++) {
            const cmd = this.currentPath[i];
            if (cmd.type === 'M') pathData += `M ${cmd.x} ${cmd.y} `;
            else if (cmd.type === 'L') pathData += `L ${cmd.x} ${cmd.y} `;
        }

        this.operations.push({
            type: 'stroke',
            pathData: pathData.trim(),
            strokeStyle: this.strokeStyle,
            lineWidth: this.lineWidth,
            lineCap: this.lineCap
        });
        this.currentPath = null;
    }

    fill() {
        if (!this.currentPath || this.currentPath.length === 0) return;

        // Check if single full circle (positions)
        if (this.currentPath.length === 1 && this.currentPath[0].type === 'CIRCLE') {
            const c = this.currentPath[0];
            this.operations.push({
                type: 'circle',
                x: c.x,
                y: c.y,
                radius: c.radius,
                fillStyle: this.fillStyle
            });
        } else {
            // Path fill (shouldn't happen in py2Dmol, but handle it)
            let pathData = '';
            for (let i = 0; i < this.currentPath.length; i++) {
                const cmd = this.currentPath[i];
                if (cmd.type === 'M') pathData += `M ${cmd.x} ${cmd.y} `;
                else if (cmd.type === 'L') pathData += `L ${cmd.x} ${cmd.y} `;
            }
            this.operations.push({
                type: 'fill',
                pathData: pathData.trim(),
                fillStyle: this.fillStyle
            });
        }
        this.currentPath = null;
    }

    fillRect(x: number, y: number, w: number, h: number) {
        this.operations.push({
            type: 'rect',
            x: x, y: y, width: w, height: h,
            fillStyle: this.fillStyle
        });
    }

    clearRect() {
        // Ignore - we add white background in SVG
    }

    // Stub methods (not used in rendering)
    save() { }
    restore() { }
    scale() { }
    setTransform() { }
    translate() { }
    rotate() { }

    // Color conversion: rgb(r,g,b) -> #rrggbb
    rgbToHex(color: string): string {
        if (!color || color.startsWith('#')) return color || '#000000';
        const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (m) {
            const r = parseInt(m[1]).toString(16).padStart(2, '0');
            const g = parseInt(m[2]).toString(16).padStart(2, '0');
            const b = parseInt(m[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        return color;
    }

    // Generate SVG
    getSerializedSvg(): string {
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n`;
        svg += `  <rect width="${this.width}" height="${this.height}" fill="#ffffff"/>\n`;

        for (let i = 0; i < this.operations.length; i++) {
            const op = this.operations[i];
            if (op.type === 'rect') {
                svg += `  <rect x="${op.x}" y="${op.y}" width="${op.width}" height="${op.height}" fill="${this.rgbToHex(op.fillStyle!)}"/>\n`;
            } else if (op.type === 'circle') {
                svg += `  <circle cx="${op.x}" cy="${op.y}" r="${op.radius}" fill="${this.rgbToHex(op.fillStyle!)}"/>\n`;
            } else if (op.type === 'stroke') {
                const cap = op.lineCap === 'round' ? 'round' : 'butt';
                svg += `  <path d="${op.pathData}" stroke="${this.rgbToHex(op.strokeStyle!)}" stroke-width="${op.lineWidth}" stroke-linecap="${cap}" fill="none"/>\n`;
            } else if (op.type === 'fill') {
                svg += `  <path d="${op.pathData}" fill="${this.rgbToHex(op.fillStyle!)}"/>\n`;
            }
        }
        svg += '</svg>';
        return svg;
    }
}
