/*
 * Module: VitalsSparkline
 * Purpose: Medical-grade Canvas waveform monitor with scan effect (Eraser Bar)
 */

export class VitalsSparkline {
    constructor(canvasElement, options = {}) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d', { 
            alpha: true,
            desynchronized: true,
            powerPreference: 'high-performance'
        });

        // Configuration
        this.maxPoints = options.maxPoints || 500; // Resolution of the window
        this.scanBarWidth = options.scanBarWidth || 40; // Width of the "eraser" gap

        // Colors & Style
        this.color = options.color || '#39ff14'; // Default Neon Green
        this.secondaryColor = options.secondaryColor || '#ffff00';
        this.lineWidth = options.lineWidth || 2.5;
        this.glowBlur = options.glowBlur || 6;
        this.gridColor = 'rgba(255, 255, 255, 0.1)';
        this.gridSpacing = 20;

        // Grid Cache Layer (P0: Performance Optimization)
        this.gridCanvas = document.createElement('canvas');
        this.gridCtx = this.gridCanvas.getContext('2d');
        this._gridCacheDirty = true;

        // Data Buffers (Fixed size circular buffers)
        this.buffer = new Array(this.maxPoints).fill(null);
        this.secondaryBuffer = new Array(this.maxPoints).fill(null);
        this.cursor = 0; // Current writing position (scan head)

        // Value Scaling
        this.minValue = options.minValue ?? 0;
        this.maxValue = options.maxValue ?? 100;

        // Pattern Injection (Legacy support for pulse shapes)
        this.pattern = Array.isArray(options.pattern) ? options.pattern : null;
        this.patternScale = Number.isFinite(options.patternScale) ? options.patternScale : 0;
        this.secondaryScale = Number.isFinite(options.secondaryScale) ? options.secondaryScale : 1;
        this.hasSecondary = Boolean(options.hasSecondary);

        // Incremental injection for smoother animation control
        this.injectionRatio = Number.isFinite(options.injectionRatio) && options.injectionRatio > 1 
            ? options.injectionRatio 
            : 1; // Default: inject full pattern each call
        this.cycleIndex = 0; // Current position in multi-call cycle

        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(this.canvas);

        this.resize();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        this.width = rect.width;
        this.height = rect.height;

        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;

        this.ctx.scale(dpr, dpr);

        // Mark grid cache as dirty
        this._gridCacheDirty = true;

        // Force redraw
        this.render();
    }

    /**
     * Add data point(s). If a pattern is defined, it injects the whole pattern sequence.
     * This allows low-frequency calls (e.g. 10Hz) to generate high-res waveforms (e.g. 100pts).
     */
    addDataPoint(value, secondaryValue = null) {
        if (value == null || Number.isNaN(value)) return;

        const push = (val, secVal) => {
            this.buffer[this.cursor] = val;
            if (this.hasSecondary) {
                this.secondaryBuffer[this.cursor] = secVal;
            }

            this.cursor = (this.cursor + 1) % this.maxPoints;
        };

        if (this.pattern && this.patternScale) {
            // Check if using incremental injection mode
            if (this.injectionRatio > 1) {
                // Incremental injection: spread pattern across multiple calls
                const pointsPerCall = Math.ceil(this.pattern.length / this.injectionRatio);
                const startIdx = this.cycleIndex * pointsPerCall;
                const endIdx = Math.min(startIdx + pointsPerCall, this.pattern.length);

                for (let j = startIdx; j < endIdx; j++) {
                    const factor = this.pattern[j];
                    const pVal = value + factor * this.patternScale;
                    const sVal = (secondaryValue !== null)
                        ? secondaryValue + factor * this.patternScale * this.secondaryScale
                        : null;
                    push(pVal, sVal);
                }

                // Advance cycle for next call
                this.cycleIndex = (this.cycleIndex + 1) % this.injectionRatio;
            } else {
                // Original behavior: inject full pattern each call
                this.pattern.forEach((factor) => {
                    const pVal = value + factor * this.patternScale;
                    const sVal = (secondaryValue !== null)
                        ? secondaryValue + factor * this.patternScale * this.secondaryScale
                        : null;
                    push(pVal, sVal);
                });
            }
        } else {
            // Raw Value
            push(value, secondaryValue);
        }

        requestAnimationFrame(() => this.render());
    }

    clear() {
        this.buffer.fill(null);
        this.secondaryBuffer.fill(null);
        this.cursor = 0;
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    render() {
        if (!this.ctx || !this.width || !this.height) return;

        // 1. Clear Screen
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 2. Draw Grid (Medical Background)
        this.drawGrid();

        // 3. Check if there's valid data
        const hasValidPrimaryData = this.buffer.some(v => v !== null);
        const hasValidSecondaryData = this.hasSecondary ? this.secondaryBuffer.some(v => v !== null) : false;

        if (!hasValidPrimaryData && !hasValidSecondaryData) {
            // No signal indicator
            this.drawNoSignalIndicator();
            return;
        }

        // 4. Draw Waveforms
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.shadowBlur = this.glowBlur;

        // Primary
        if (hasValidPrimaryData) {
            this.ctx.strokeStyle = this.color;
            this.ctx.shadowColor = this.color;
            this.drawSeries(this.buffer);
        }

        // Secondary
        if (this.hasSecondary && hasValidSecondaryData) {
            this.ctx.strokeStyle = this.secondaryColor;
            this.ctx.shadowColor = this.secondaryColor;
            this.drawSeries(this.secondaryBuffer);
        }
    }

    _renderGridToCache() {
        if (!this.width || !this.height) return;

        const dpr = window.devicePixelRatio || 1;
        this.gridCanvas.width = this.width * dpr;
        this.gridCanvas.height = this.height * dpr;
        this.gridCtx.scale(dpr, dpr);

        // Draw Major Grid (every 40px)
        this.gridCtx.beginPath();
        this.gridCtx.lineWidth = 0.5;
        this.gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        for (let x = 0; x <= this.width; x += 40) {
            this.gridCtx.moveTo(x, 0);
            this.gridCtx.lineTo(x, this.height);
        }
        for (let y = 0; y <= this.height; y += 40) {
            this.gridCtx.moveTo(0, y);
            this.gridCtx.lineTo(this.width, y);
        }
        this.gridCtx.stroke();

        // Draw Minor Grid (every 10px) - subtle
        this.gridCtx.beginPath();
        this.gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        for (let x = 0; x <= this.width; x += 10) {
            if (x % 40 === 0) continue; // Skip major lines
            this.gridCtx.moveTo(x, 0);
            this.gridCtx.lineTo(x, this.height);
        }
        for (let y = 0; y <= this.height; y += 10) {
            if (y % 40 === 0) continue;
            this.gridCtx.moveTo(0, y);
            this.gridCtx.lineTo(this.width, y);
        }
        this.gridCtx.stroke();

        this._gridCacheDirty = false;
    }

    drawGrid() {
        if (this._gridCacheDirty) {
            this._renderGridToCache();
        }
        this.ctx.drawImage(this.gridCanvas, 0, 0, this.width, this.height);
    }

    drawScanHead(x, y, color, dynamicRadius = 3) {
        // Draw a bright 'lead' point with dynamic size based on waveform speed
        const radius = Math.min(Math.max(dynamicRadius, 3), 5); // Clamp between 3-5px
        const blur = 10 + (dynamicRadius - 3) * 5; // Increase glow with size

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = blur;
        this.ctx.fill();
        this.ctx.restore();
    }

    drawNoSignalIndicator() {
        // Draw "NO SIGNAL" indicator with medical alert styling
        this.ctx.save();

        // Flashing effect (simulate with opacity based on time)
        const flash = (Math.sin(Date.now() / 200) + 1) / 2;
        this.ctx.globalAlpha = 0.5 + flash * 0.5;

        // Draw dashed border (alert indicator)
        this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([10, 5]);
        this.ctx.strokeRect(5, 5, this.width - 10, this.height - 10);

        // Draw "NO SIGNAL" text
        this.ctx.setLineDash([]);
        this.ctx.font = 'bold 16px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = '#ff4444';
        this.ctx.shadowColor = '#ff0000';
        this.ctx.shadowBlur = 10;
        this.ctx.fillText('NO SIGNAL', this.width / 2, this.height / 2);

        this.ctx.restore();
    }

    drawSeries(data) {
        if (!data) return;

        this.ctx.beginPath();

        const stepX = this.width / this.maxPoints;
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;

        // Calculate the "head" index (most recent valid point written)
        const headIndex = (this.cursor - 1 + this.maxPoints) % this.maxPoints;
        let headX = null;
        let headY = null;

        // Calculate speed for dynamic scan head
        let lastHeadY = null;
        let speed = 0;

        // Scan loop
        for (let i = 0; i < this.maxPoints; i++) {
            // Eraser Logic:
            let dist = i - this.cursor;
            if (dist < 0) dist += this.maxPoints;

            // If we are 'ahead' of the cursor by a small amount, skip (Eraser bar)
            if (dist < this.scanBarWidth) {
                isDrawing = false;
                continue;
            }

            const val = data[i];
            if (val === null || val === undefined) {
                isDrawing = false;
                continue;
            }

            // Map Value to Y (Min=Bottom, Max=Top)
            const range = this.maxValue - this.minValue;
            const norm = (val - this.minValue) / (range || 1);
            // 0.9 scaling factor to keep 5% padding top/bottom
            const y = this.height - (norm * this.height * 0.9 + this.height * 0.05);

            const x = i * stepX;

            if (i === headIndex) {
                headX = x;
                headY = y;
                // Calculate speed based on Y change from previous valid point
                if (lastHeadY !== null) {
                    speed = Math.abs(y - lastHeadY);
                }
                lastHeadY = y;
            }

            if (!isDrawing) {
                this.ctx.moveTo(x, y);
                isDrawing = true;
            } else {
                // Break line if wrapping from max to 0
                // Logic check: The loop goes 0..maxPoints. The visual wrap happens when x goes 0..width.
                // But the 'eraser' moves. The line is visually contiguous EXCEPT at the eraser gap.
                // However, if we just drew at index N-1 and now at N, and they are adjacent in array,
                // they are adjacent on screen.
                // The only case not to draw is if we skipped points (erasor or null).
                // We handle that via IS_DRAWING flag.

                // One edge case: index 0 follows index maxPoints-1? No, loop is linear 0..max.
                // Visual wrapping is handled by the eraser moving.
                // Points 0 and maxPoints-1 are visually adjacent on a static plot? No, 0 is left, max is right.
                // They shouldn't be connected.
                
                // FIX: Break the line if x coordinate wraps from right edge back to left edge
                // This happens when we're at the end of the canvas and the next point is at the beginning
                if (lastX > this.width - stepX * 2 && x < stepX * 2) {
                    // Wrapped around - start a new path
                    this.ctx.stroke();
                    this.ctx.beginPath();
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }

            lastX = x;
            lastY = y;
        }

        this.ctx.stroke();

        // Draw the Scan Head at the leading edge with dynamic size
        if (headX !== null && headY !== null) {
            // Use the current stroke style color for the glow shadow
            const dynamicRadius = 3 + speed * 0.3; // 3px base + 30% of speed
            this.drawScanHead(headX, headY, this.ctx.shadowColor, dynamicRadius);
        }
    }
}

if (typeof window !== 'undefined') {
    window.VitalsSparkline = VitalsSparkline;
}
