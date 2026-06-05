class Eraser {
  constructor() {
    this.maskCtx = null;
    this.uiCtx   = null;  
    this.lastX = 0; this.lastY = 0;
    this.currentStroke = [];
    this.brushSize = 0;
  }
  setContext(ctxDraw) { this.maskCtx = ctxDraw; }
  setContexts({ maskCtx, uiCtx }) { this.maskCtx = maskCtx; this.uiCtx = uiCtx; }

  startDraw(e, lineWidth, brushSize, cursor) {
    this.brushSize = brushSize;
    [this.lastX, this.lastY] = [cursor.x, cursor.y];
    this.currentStroke = [{ x: cursor.x, y: cursor.y }];
    this.draw(e, cursor, true);
  }

  draw(e, cursor, isClick = false) {
    const ctx = this.uiCtx;            
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const shade = 'rgba(220,220,220,0.6)';

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    if (isClick) {
      ctx.arc(cursor.x, cursor.y, this.brushSize/2, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.moveTo(this.lastX, this.lastY);
      ctx.lineTo(cursor.x, cursor.y);
      ctx.lineWidth = this.brushSize;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.strokeStyle = shade;
    ctx.lineWidth = this.brushSize;
    if (isClick) {
      ctx.arc(cursor.x, cursor.y, this.brushSize/2, 0, Math.PI*2);
      ctx.fillStyle = shade;
      ctx.fill();
    } else {
      ctx.moveTo(this.lastX, this.lastY);
      ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();
    }
    ctx.restore();

    [this.lastX, this.lastY] = [cursor.x, cursor.y];
    this.currentStroke.push({ x: cursor.x, y: cursor.y });
  }

  endDraw() {
    if (this.uiCtx) {
      this.uiCtx.clearRect(0, 0, this.uiCtx.canvas.width, this.uiCtx.canvas.height);
    }
    if (this.currentStroke.length === 0) return [];
    const eraserPolygon = strokeToPolygon(this.currentStroke, this.brushSize);
    this.currentStroke = [];
    return eraserPolygon;
  }
}