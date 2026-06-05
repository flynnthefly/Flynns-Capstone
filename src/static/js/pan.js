class Pan {
  constructor(canvas) {
    this.canvas = canvas;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;
  }

  startPan(e) {
    this.isPanning = true;

    this.startX = e.clientX - this.canvas.getOffset().x;
    this.startY = e.clientY - this.canvas.getOffset().y;
  }

  pan(e) {
    if (!this.isPanning) return;

    this.canvas.setOffset(e.clientX - this.startX, e.clientY - this.startY);
  }

  endPan() {
    this.isPanning = false;
  }
}