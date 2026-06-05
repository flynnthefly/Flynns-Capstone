class Canvas {
    constructor(stage) {
        this.stage = stage;

        this.width = 0;
        this.height = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.zoom = 1;

        this.canvasImage = null;
        this.canvasDraw = null;
        this.canvasMasks = {};
    }

    #createCanvas(styles = {}) {
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        Object.assign(canvas.style, {
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'block',
            position: 'absolute',
            ...styles
        });
        this.stage.appendChild(canvas);
        return canvas;
    }

    setColour(canvas, colour) {
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = colour;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
    }

    setup(img) {
        this.width = img.naturalWidth;
        this.height = img.naturalHeight;
        
        // Image layer
        this.canvasImage = this.#createCanvas({
            // maxWidth: '100%',
            // maxHeight: '100%',
            // display: 'block'
        })
        this.canvasImage.getContext('2d').drawImage(img, 0, 0);

        // Drawing layer
        // Strokes are temporarily drawn here before being rendered on a mask layer.
        // This is so we don't have to redraw any existing polygons that we go over.
        this.canvasDraw = this.#createCanvas({
            //position: 'absolute',
            zIndex: 999 // This number should be above all other canvases but below UI elements.
        })
        this.setColour(this.canvasDraw, 'yellow');

        return [this.canvasImage, this.canvasDraw];
    }
    
    addMask(id, colour) {
        const canvasMask = this.#createCanvas({
            //position: 'absolute'
        })
        this.setColour(canvasMask, colour)

        this.canvasMasks[id] = canvasMask;

        console.log(`Mask with id ${id} and ${colour} created`);
    }

    getMask(id) {
        return this.canvasMasks[id] || null;
    }

    showMask(id) {
        this.getMask(id).style.visibility = 'visible';
    }

    hideMask(id) {
        this.getMask(id).style.visibility = 'hidden';
    }

    #applyTransform(canvas) {
        canvas.style.transformOrigin = 'top left';
        canvas.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.zoom})`;
    }

    #updateTransform() {
        this.#applyTransform(this.canvasImage);
        this.#applyTransform(this.canvasDraw);
        Object.values(this.canvasMasks).forEach(canvasMask => {
            this.#applyTransform(canvasMask);
        });
    }

    setZoom(zoom) {
        this.zoom = zoom;
        this.#updateTransform();
    }

    getZoom() {
        return this.zoom;
    }

    setOffset(offsetX, offsetY) {
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this.#updateTransform();
    }

    getOffset() {
        return { x: this.offsetX, y: this.offsetY };
    }

    getCursorPosition(e) {
        const rect = this.canvasDraw.getBoundingClientRect();

        const scaleX = this.canvasDraw.width / rect.width;
        const scaleY = this.canvasDraw.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }
}