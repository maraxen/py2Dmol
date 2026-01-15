export interface ViewerConfig {
    viewer_id: string | null;
    display: {
        size: [number, number];
        rotate: boolean;
        autoplay: boolean;
        controls: boolean;
        box: boolean;
    };
    rendering: {
        shadow: boolean;
        shadow_strength: number;
        outline: "none" | "partial" | "full" | boolean;
        width: number;
        ortho: number;
        detect_cyclic: boolean;
    };
    color: {
        mode: string;
        colorblind: boolean;
    };
    pae: {
        enabled: boolean;
        size: number;
    };
    scatter: {
        enabled: boolean;
        size: number;
    };
    overlay: {
        enabled: boolean;
    };
}

export interface FrameData {
    coords: number[][]; // Nx3
    plddts?: number[];
    chains?: string[];
    position_types?: string[];
    pae?: number[] | Uint8Array | number[][];
    scatter?: number[] | {x: number, y: number}; // [x, y]
    position_names?: string[];
    residue_numbers?: number[];
    bonds?: number[][]; // [[idx1, idx2], ...]
    color?: any; // Frame-level color override
    name?: string;
    contacts?: any[]; // For object level contacts storage
}

export interface ObjectData {
    name?: string;
    frames: FrameData[];
    maxExtent: number;
    stdDev: number;
    globalCenterSum: any; // Vec3
    totalPositions: number;
    _lastPlddtFrame: number;
    _lastPaeFrame: number;
    bonds?: number[][] | null;
    contacts?: any[] | null;
    ligandGroups: Map<any, any>;
    selectionState: {
        positions: Set<number>;
        chains: Set<string>;
        paeBoxes: any[];
        selectionMode: string;
    };
    viewerState: {
        rotation: number[][];
        zoom: number;
        perspectiveEnabled: boolean;
        focalLength: number;
        center: any | null; // Vec3
        extent: number | null;
        currentFrame: number;
    };
    scatterConfig?: any;
    color?: any;
    colorMode?: string;
    rotation_matrix?: number[][];
    center?: number[];
    msa?: any;
}
