import { Pseudo3DRenderer } from './mol/Pseudo3DRenderer';
import { ViewerConfig } from './types';

declare global {
    interface Window {
        py2dmol_viewers: any;
        initializePy2DmolViewer: any;
        viewerConfig: any;
    }
}

window.py2dmol_viewers = window.py2dmol_viewers || {};

export function initializePy2DmolViewer(containerElement: HTMLElement, viewerId: string) {
    const config = window.viewerConfig || {};
    const canvas = containerElement.querySelector('canvas');
    if (canvas) {
        const renderer = new Pseudo3DRenderer(canvas, config as ViewerConfig);
        // Expose renderer
        window.py2dmol_viewers[viewerId] = {
            renderer,
            handleIncrementalStateUpdate: (frames: any, meta: any) => { /* ... */ },
            handleReplaceFrame: (frame: any, meta: any) => { /* ... */ }
        };
        // Start animation
        renderer.animate();
    }
}

window.initializePy2DmolViewer = initializePy2DmolViewer;
