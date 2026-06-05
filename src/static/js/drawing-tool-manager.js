class DrawingToolManager {
    constructor(ctxDraw, canvas) {
        this.drawingTool = null;
        this.ctxDraw = ctxDraw;
        this.currentCtx = null;
        this.isDrawing = false;
        this.brushSize = 50;
        this.lineWidth = 3;

        this.canvas = canvas;

        this.startDraw = this.startDraw.bind(this);
        this.draw = this.draw.bind(this);
        this.endDraw = this.endDraw.bind(this);
    }

    setDrawingTool(drawingTool) {
        this.drawingTool = drawingTool;
        this.drawingTool.setContext(this.ctxDraw);
    }

    setContext(currentCtx) {
        this.currentCtx = currentCtx;
    }

    setBrushSize(brushSize) {
        this.brushSize = brushSize;
    }

    startDraw(e) {
        this.isDrawing = true;
        
        this.drawingTool.startDraw(e, this.lineWidth, this.brushSize, this.canvas.getCursorPosition(e));
    }

    draw(e) {
        if (!this.isDrawing) return;

        this.drawingTool.draw(e, this.canvas.getCursorPosition(e));
    }

    endDraw() {
        this.isDrawing = false;

        this.ctxDraw.clearRect(0, 0, this.ctxDraw.canvas.width, this.ctxDraw.canvas.height);

        return this.drawingTool.endDraw(this.currentCtx);
    }
}