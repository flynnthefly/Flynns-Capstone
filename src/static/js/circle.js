class Circle {
    constructor() {
        this.ctxDraw = null;
        this.startX = 0;
        this.startY = 0;
        this.endX = 0;
        this.endY = 0;
        this.currentCircle = null;
        this.lineWidth = 0;
        this.numPoints = 36;
    }

    setContext(ctxDraw) {
        this.ctxDraw = ctxDraw;
    }

    startDraw(e, lineWidth, brushSize, cursor) {
        this.lineWidth = lineWidth;
        [this.startX, this.startY] = [cursor.x, cursor.y];
        this.currentCircle = null;
    }

    draw(e, cursor, isClick = false) {
        this.endX = cursor.x;
        this.endY = cursor.y;
        
        const dx = this.endX - this.startX;
        const dy = this.endY - this.startY;
        const radius = Math.sqrt(dx * dx + dy * dy) / 2;

        const centerX = (this.startX + this.endX) / 2;
        const centerY = (this.startY + this.endY) / 2;

        this.currentCircle = { x: centerX, y: centerY, radius };

        this.ctxDraw.clearRect(0, 0, this.ctxDraw.canvas.width, this.ctxDraw.canvas.height);
        this.ctxDraw.beginPath();
        this.ctxDraw.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        this.ctxDraw.stroke();
    }

    endDraw(ctx) {
        if (!this.currentCircle) return [];

        const { x: centerX, y: centerY, radius } = this.currentCircle;
        const polygon = [];

        for (let i = 0; i < this.numPoints; i++) {
            const angle = (i / this.numPoints) * 2 * Math.PI;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            polygon.push({ x, y });
        }
        polygon.push(polygon[0]); // Adding the start point again to close the shape properly.

        drawPolygon(polygon, ctx);

        this.currentCircle = null;

        return polygon;
    }
}