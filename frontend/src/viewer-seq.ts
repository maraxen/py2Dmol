import { SeqViewer } from './seq/SeqViewer';

declare global {
    interface Window {
        SEQ: any;
    }
}

window.SEQ = SeqViewer;
