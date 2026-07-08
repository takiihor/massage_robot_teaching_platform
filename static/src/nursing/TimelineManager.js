/*
 * Module: TimelineManager
 * Purpose: Collect teaching timeline events (student actions, stops, etc.)
 */

export class TimelineManager {
    constructor() {
        this.events = [];
    }

    addEvent(type, data = {}) {
        if (!type) return;
        this.events.push({
            timestamp: Date.now(),
            type,
            data
        });
    }

    getEvents() {
        return JSON.parse(JSON.stringify(this.events));
    }

    clear() {
        this.events = [];
    }
}

