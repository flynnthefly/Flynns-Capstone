class UndoRedoManager {
    constructor(maxHistorySize = 10) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.isUndoRedoOperation = false;
    }

    // Save the current state of all mask canvases and polygon data
    saveState(canvasMasks, polygons) {
        if (this.isUndoRedoOperation) return;

        const state = {
            canvasStates: {},
            polygonData: {}
        };
        
        // Capture the current state of all mask canvases
        for (const [maskId, maskCanvas] of Object.entries(canvasMasks)) {
            if (maskCanvas) {
                state.canvasStates[maskId] = maskCanvas.toDataURL();
            }
        }

        // Capture the current polygon data
        for (const [maskId, polygonArray] of Object.entries(polygons)) {
            if (polygonArray) {
                state.polygonData[maskId] = JSON.parse(JSON.stringify(polygonArray));
            }
        }

        // Add to undo stack
        this.undoStack.push(state);
        
        // Limit undo stack size
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        // Clear redo stack when new action is performed
        this.redoStack = [];

        this.updateButtonStates();
        
        console.log('Saved state, undo stack size:', this.undoStack.length);
    }

    // Undo the last action
    undo(canvasMasks, polygons) {
        if (this.undoStack.length === 0) {
            console.log('Cannot undo: no states in undo stack');
            return false;
        }

        console.log('Undoing, undo stack size before:', this.undoStack.length);

        // Save current state to redo stack
        const currentState = {
            canvasStates: {},
            polygonData: {}
        };
        for (const [maskId, maskCanvas] of Object.entries(canvasMasks)) {
            if (maskCanvas) {
                currentState.canvasStates[maskId] = maskCanvas.toDataURL();
            }
        }
        for (const [maskId, polygonArray] of Object.entries(polygons)) {
            if (polygonArray) {
                currentState.polygonData[maskId] = JSON.parse(JSON.stringify(polygonArray));
            }
        }
        this.redoStack.push(currentState);

        // Get the previous state
        const previousState = this.undoStack.pop();

        // Restore the previous state
        this.isUndoRedoOperation = true;
        this.restoreState(previousState, canvasMasks, polygons);
        this.isUndoRedoOperation = false;

        this.updateButtonStates();
        
        console.log('Undo complete, undo stack size after:', this.undoStack.length, 'redo stack size:', this.redoStack.length);
        return true;
    }

    // Redo the last undone action
    redo(canvasMasks, polygons) {
        if (this.redoStack.length === 0) {
            console.log('Cannot redo: no states in redo stack');
            return false;
        }

        console.log('Redoing, redo stack size before:', this.redoStack.length);

        // Save current state to undo stack
        const currentState = {
            canvasStates: {},
            polygonData: {}
        };
        for (const [maskId, maskCanvas] of Object.entries(canvasMasks)) {
            if (maskCanvas) {
                currentState.canvasStates[maskId] = maskCanvas.toDataURL();
            }
        }
        for (const [maskId, polygonArray] of Object.entries(polygons)) {
            if (polygonArray) {
                currentState.polygonData[maskId] = JSON.parse(JSON.stringify(polygonArray));
            }
        }
        this.undoStack.push(currentState);

        // Get the next state
        const nextState = this.redoStack.pop();

        // Restore the next state
        this.isUndoRedoOperation = true;
        this.restoreState(nextState, canvasMasks, polygons);
        this.isUndoRedoOperation = false;

        this.updateButtonStates();
        
        console.log('Redo complete, undo stack size:', this.undoStack.length, 'redo stack size after:', this.redoStack.length);
        return true;
    }

    // Restore a saved state to the canvas masks and polygon data
    restoreState(state, canvasMasks, polygons) {
        // Restore canvas states
        for (const [maskId, imageData] of Object.entries(state.canvasStates)) {
            const maskCanvas = canvasMasks[maskId];
            if (maskCanvas) {
                const ctx = maskCanvas.getContext('2d');
                ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                
                // If the imageData is empty (transparent canvas), just clear it
                if (imageData === 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==') {
                    // This is a 1x1 transparent PNG, so just leave the canvas clear
                    continue;
                }
                
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0);
                };
                img.src = imageData;
            }
        }

        // Restore polygon data
        for (const [maskId, polygonArray] of Object.entries(state.polygonData)) {
            if (polygonArray) {
                polygons[maskId] = JSON.parse(JSON.stringify(polygonArray));
            }
        }
    }

    // Update the visual state of undo/redo buttons
    updateButtonStates() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (undoBtn) {
            undoBtn.style.opacity = this.undoStack.length > 0 ? '1' : '0.5';
            undoBtn.style.cursor = this.undoStack.length > 0 ? 'pointer' : 'not-allowed';
        }

        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length > 0 ? '1' : '0.5';
            redoBtn.style.cursor = this.redoStack.length > 0 ? 'pointer' : 'not-allowed';
        }
    }

    // Clear all history
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.updateButtonStates();
    }

    // Clear undo stack but keep redo stack (used when setting baseline)
    clearUndoStack() {
        this.undoStack = [];
        this.updateButtonStates();
    }

    // Check if undo is available
    canUndo() {
        return this.undoStack.length > 0;
    }

    // Check if redo is available
    canRedo() {
        return this.redoStack.length > 0;
    }
}
