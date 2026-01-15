import { ScatterPlotViewer } from './scatter/ScatterPlotViewer';

declare global {
    interface Window {
        ScatterPlotViewer: any;
    }
}

window.ScatterPlotViewer = ScatterPlotViewer;
