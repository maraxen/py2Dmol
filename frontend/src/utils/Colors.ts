// Color constants and utilities
export const pymolColors = ["#33ff33", "#00ffff", "#ff33cc", "#ffff00", "#ff9999", "#e5e5e5", "#7f7fff", "#ff7f00", "#7fff7f", "#199999", "#ff007f", "#ffdd5e", "#8c3f99", "#b2b2b2", "#007fff", "#c4b200", "#8cb266", "#00bfbf", "#b27f7f", "#fcd1a5", "#ff7f7f", "#ffbfdd", "#7fffff", "#ffff7f", "#00ff7f", "#337fcc", "#d8337f", "#bfff3f", "#ff7fff", "#d8d8ff", "#3fffbf", "#b78c4c", "#339933", "#66b2b2", "#ba8c84", "#84bf00", "#b24c66", "#7f7f7f", "#3f3fa5", "#a5512b"];
export const colorblindSafeChainColors = [
    "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
    "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF",
    "#AEC7E8", "#FFBB78", "#98DF8A", "#FF9896", "#C5B0D5",
    "#C49C94", "#F7B6D2", "#C7C7C7", "#DBDB8D", "#9EDAE5",
    "#393B79", "#637939", "#8C6D31", "#843C39", "#7B4173",
    "#5254A3", "#8CA252", "#BD9E39", "#AD494A", "#A55194"];
export const LIGHTEN_FACTOR = 0.25;

export const namedColorsMap: { [key: string]: string } = {
    "red": "#ff0000", "green": "#00ff00", "blue": "#0000ff", "yellow": "#ffff00", "cyan": "#00ffff", "magenta": "#ff00ff",
    "orange": "#ffa500", "purple": "#800080", "pink": "#ffc0cb", "brown": "#8b4513", "gray": "#808080", "grey": "#808080",
    "white": "#ffffff", "black": "#000000", "lime": "#00ff00", "navy": "#000080", "teal": "#008080",
    "silver": "#c0c0c0", "maroon": "#800000", "olive": "#808000", "aqua": "#00ffff", "fuchsia": "#ff00ff"
};

export interface RGB { r: number; g: number; b: number; }

export function hexToRgb(hex: string): RGB { if (!hex || typeof hex !== 'string') { return { r: 128, g: 128, b: 128 }; } const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16); return { r, g, b }; }
export function rgbToHex({ r, g, b }: RGB): string { const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v))); const cr = clamp(r).toString(16).padStart(2, '0'); const cg = clamp(g).toString(16).padStart(2, '0'); const cb = clamp(b).toString(16).padStart(2, '0'); return `#${cr}${cg}${cb}`; }
export function lightenRgb(color: RGB, factor = LIGHTEN_FACTOR): RGB { return { r: Math.round(color.r * (1 - factor) + 255 * factor), g: Math.round(color.g * (1 - factor) + 255 * factor), b: Math.round(color.b * (1 - factor) + 255 * factor) }; }
export function lightenHex(hex: string, factor = LIGHTEN_FACTOR): string { return rgbToHex(lightenRgb(hexToRgb(hex), factor)); }
export const chainColors = pymolColors.map(hex => lightenHex(hex));
export const chainColorsColorblind = colorblindSafeChainColors.map(hex => lightenHex(hex));
export const DEFAULT_GREY = { r: 160, g: 160, b: 160 };
export const DEFAULT_CONTACT_COLOR = { r: 255, g: 255, b: 0 };

export const VALID_COLOR_MODES = ['auto', 'chain', 'rainbow', 'plddt', 'deepmind', 'entropy'];

export function getAllValidColorModes() {
    return VALID_COLOR_MODES;
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
export function lightenColor(color: RGB): RGB { return lightenRgb(color, LIGHTEN_FACTOR); }

export function getRainbowColor(value: number, min: number, max: number, colorblind = false): RGB {
    if (max - min < 1e-6) return lightenColor(hsvToRgb(240, 1.0, 1.0)); // Default to blue
    let normalized = (value - min) / (max - min);
    normalized = Math.max(0, Math.min(1, normalized));
    const hue = colorblind
        ? 240 - normalized * 180  // Blue (240°) → Yellow (60°)
        : 240 * (1 - normalized);  // Blue (240°) → Red (0°)
    return lightenColor(hsvToRgb(hue, 1.0, 1.0));
}

export function getPlddtRainbowColor(value: number, min: number, max: number, colorblind = false): RGB {
    if (max - min < 1e-6) {
        return lightenColor(hsvToRgb(colorblind ? 60 : 0, 1.0, 1.0)); // Default to yellow or red
    }
    let normalized = (value - min) / (max - min);
    normalized = Math.max(0, Math.min(1, normalized));
    const hue = colorblind
        ? 60 + normalized * 180   // Yellow (60°) → Blue (240°)
        : normalized * 240;        // Red (0°) → Blue (240°)
    return lightenColor(hsvToRgb(hue, 1.0, 1.0));
}

export function getPlddtColor(plddt: number, colorblind = false): RGB {
    return getPlddtRainbowColor(plddt, 50, 90, colorblind);
}

export function getPlddtAFColor(plddt: number, colorblind = false): RGB {
    if (colorblind) {
        // Colorblind-safe: Blue → Green → Yellow → Red
        if (plddt >= 90) return { r: 0, g: 100, b: 255 };      // Blue
        else if (plddt >= 70) return { r: 0, g: 200, b: 100 }; // Green
        else if (plddt >= 50) return { r: 255, g: 255, b: 0 }; // Yellow
        else return { r: 255, g: 0, b: 0 };                    // Red
    } else {
        // Official AlphaFold: Dark Blue → Cyan → Yellow → Orange
        if (plddt >= 90) return { r: 13, g: 87, b: 211 };      // Dark Blue
        else if (plddt >= 70) return { r: 106, g: 203, b: 241 }; // Cyan
        else if (plddt >= 50) return { r: 254, g: 217, b: 54 }; // Yellow
        else return { r: 253, g: 125, b: 77 };                 // Orange
    }
}

export function getChainColor(chainIndex: number): RGB { if (chainIndex < 0) chainIndex = 0; return hexToRgb(pymolColors[chainIndex % pymolColors.length]); }
