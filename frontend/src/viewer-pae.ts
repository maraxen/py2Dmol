import { PAERenderer } from './pae/PAERenderer';

declare global {
    interface Window {
        PAE: any;
        PAERenderer: any;
    }
}

const PAE = {
    Renderer: PAERenderer,
    initialize: (renderer: any, containerElement: HTMLElement, config: any) => {
        // ... init logic
        const paeCanvas = containerElement.querySelector('#paeCanvas') as HTMLCanvasElement;
        if (paeCanvas) {
            const paeRenderer = new PAERenderer(paeCanvas, renderer);
            renderer.setPAERenderer(paeRenderer);
        }
    }
};

window.PAE = PAE;
window.PAERenderer = PAERenderer;
