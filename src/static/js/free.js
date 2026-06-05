class Free {
    constructor() {
        this.ctxDraw = null;
        this.lastX = 0;
        this.lastY = 0;
        this.currentStroke = [];
        this.lineWidth = 0;
    }

    setContext(ctxDraw) {
        this.ctxDraw = ctxDraw;
    }
    
    startDraw(e, lineWidth, brushSize, cursor) {
        this.lineWidth = lineWidth;
        
        [this.lastX, this.lastY] = [cursor.x, cursor.y];
        
        this.draw(e, cursor, true);
    }
    
    draw(e, cursor, isClick = false) {
        if (isClick) {
            this.ctxDraw.beginPath();
            this.ctxDraw.arc(cursor.x, cursor.y, this.lineWidth / 2, 0, Math.PI * 2);
            this.ctxDraw.fill();
        } else {
            this.ctxDraw.beginPath();
            this.ctxDraw.moveTo(this.lastX, this.lastY);
            this.ctxDraw.lineTo(cursor.x, cursor.y);
            this.ctxDraw.stroke();
        }

        [this.lastX, this.lastY] = [cursor.x, cursor.y];

        this.currentStroke.push({ x: cursor.x, y: cursor.y });
    }

    endDraw(ctx) {
        if (this.currentStroke.length == 0) return [];

        let polygon = this.currentStroke
        drawPolygon(polygon, ctx);

        this.currentStroke = [];

        return polygon;
    }
}