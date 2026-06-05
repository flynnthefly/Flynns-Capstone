class Brush {
    constructor() {
        this.ctxDraw = null;
        this.ctxA = null;
        this.ctxB = null;
        this.lastX = 0;
        this.lastY = 0;
        this.currentStroke = [];
        this.brushSize = 0;
        this.lineWidth = 0;
    }

    setContext(ctxDraw) {
        this.ctxDraw = ctxDraw;

        // Canvases A and B are in-memory canvases used to draw outlines.
        // A path is drawn on A and the same path but with less thickness is drawn on B.
        // A and B are drawn onto the draw layer with globalCompositeOperation set to destination-out (subtraction).
        const canvasA = document.createElement('canvas');
        canvasA.width = ctxDraw.canvas.width;
        canvasA.height = ctxDraw.canvas.height;
        const ctxA = canvasA.getContext('2d');

        const canvasB = document.createElement('canvas');
        canvasB.width = ctxDraw.canvas.width;
        canvasB.height = ctxDraw.canvas.height;
        const ctxB = canvasB.getContext('2d');

        ctxA.strokeStyle = "yellow";
        ctxA.fillStyle = "yellow";
        ctxA.lineCap = "round";
        ctxA.lineJoin = "round";

        ctxB.lineCap = "round";
        ctxB.lineJoin = "round";

        this.ctxA = ctxA;
        this.ctxB = ctxB;
    }
    
    startDraw(e, lineWidth, brushSize, cursor) {
        this.lineWidth = lineWidth;
        this.brushSize = brushSize;
        this.ctxA.lineWidth = this.brushSize;
        this.ctxB.lineWidth = this.brushSize - this.lineWidth * 2;
        
        [this.lastX, this.lastY] = [cursor.x, cursor.y];
        
        this.draw(e, cursor, true);
    }
    
    draw(e, cursor, isClick = false) {
        if (isClick) {
            this.ctxA.beginPath();
            this.ctxA.arc(cursor.x, cursor.y, this.brushSize / 2, 0, Math.PI * 2);
            this.ctxA.fill();

            this.ctxB.beginPath();
            this.ctxB.arc(cursor.x, cursor.y, (this.brushSize - this.lineWidth * 2) / 2, 0, Math.PI * 2);
            this.ctxB.fill();
        } else {
            this.ctxA.beginPath();
            this.ctxA.moveTo(this.lastX, this.lastY);
            this.ctxA.lineTo(cursor.x, cursor.y);
            this.ctxA.stroke();

            this.ctxB.beginPath();
            this.ctxB.moveTo(this.lastX, this.lastY);
            this.ctxB.lineTo(cursor.x, cursor.y);
            this.ctxB.stroke();
        }

        this.ctxDraw.drawImage(this.ctxA.canvas, 0, 0);
        this.ctxDraw.globalCompositeOperation = "destination-out";
        this.ctxDraw.drawImage(this.ctxB.canvas, 0, 0);
        this.ctxDraw.globalCompositeOperation = "source-over";

        [this.lastX, this.lastY] = [cursor.x, cursor.y];

        this.currentStroke.push({ x: cursor.x, y: cursor.y });
    }

    endDraw(ctx) {
        if (this.currentStroke.length == 0) return [];

        this.ctxA.clearRect(0, 0, this.ctxA.canvas.width, this.ctxA.canvas.height);
        this.ctxB.clearRect(0, 0, this.ctxB.canvas.width, this.ctxB.canvas.height);

        let polygon = strokeToPolygon(this.currentStroke, this.brushSize);
        drawPolygon(polygon, ctx);

        this.currentStroke = [];

        return polygon;
    }
}