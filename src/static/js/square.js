class Square {
    constructor() {
        this.ctxDraw = null;
        this.startX = 0;
        this.startY = 0;
        this.currentRect = null;
        this.lineWidth = 0;
    }

    setContext(ctxDraw) {
        this.ctxDraw = ctxDraw;
    }

    startDraw(e, lineWidth, brushSize, cursor) {
        this.lineWidth = lineWidth;
        [this.startX, this.startY] = [cursor.x, cursor.y];

        this.currentRect = {
            x: this.startX,
            y: this.startY,
            width: 0,
            height: 0
        };
    }

    draw(e, cursor, isClick = false) {
        if (!this.currentRect) return;

        let width = cursor.x - this.startX;
        let height = cursor.y - this.startY;

        this.currentRect = {
            x: this.startX,
            y: this.startY,
            width,
            height
        };

        this.ctxDraw.clearRect(0, 0, this.ctxDraw.canvas.width, this.ctxDraw.canvas.height);

        this.ctxDraw.beginPath();
        this.ctxDraw.rect(this.currentRect.x, this.currentRect.y, this.currentRect.width, this.currentRect.height);
        this.ctxDraw.stroke();
    }

    endDraw(ctx) {
        if (!this.currentRect) return [];

        let rect = this.currentRect;

        let polygon = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.height },
            { x: rect.x, y: rect.y + rect.height },
            { x: rect.x, y: rect.y }  // Adding the start point again to close the shape properly.
        ];

        drawPolygon(polygon, ctx);
        
        this.currentRect = null;

        return polygon;
    }
}