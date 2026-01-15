import { MSAViewer } from './msa/MSAViewer';

declare global {
    interface Window {
        MSA: any;
    }
}

window.MSA = MSAViewer;
