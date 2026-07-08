/*
 * Module: DebriefPanel
 * Purpose: Timeline visualization and debrief review for nursing simulation
 * Exports: createDebriefPanel, DebriefPanel
 *
 * Features:
 * - Timeline event visualization
 * - Student Stop snapshot viewer
 * - Export timeline data (JSON/CSV)
 * - Event markers and annotations
 */

export function createDebriefPanel(options = {}) {
    const {
        timelineManager = null,
        vitalsMonitor = null
    } = options;

    // DOM Elements
    const elements = {
        debriefPanel: document.getElementById('nursingDebriefPanel'),
        debriefMask: document.getElementById('nursingDebriefMask'),
        debriefClose: document.getElementById('nursingDebriefClose'),
        debriefTimeline: document.getElementById('nursingDebriefTimeline'),
        debriefSnapshots: document.getElementById('nursingDebriefSnapshots'),
        debriefExportJSON: document.getElementById('nursingDebriefExportJSON'),
        debriefExportCSV: document.getElementById('nursingDebriefExportCSV'),
        debriefClear: document.getElementById('nursingDebriefClear'),
        debriefEventCount: document.getElementById('nursingDebriefEventCount'),
        debriefDuration: document.getElementById('nursingDebriefDuration')
    };

    // State
    let isOpen = false;
    let sessionStartTime = null;

    // Event type icons and labels
    const EVENT_TYPES = {
        PRESET_CHANGE: { icon: '⚙️', label: 'Preset Change', color: '#4da3ff' },
        EVENT_CARD: { icon: '⚡', label: 'Event Card', color: '#ff9f43' },
        ASK_PATIENT: { icon: '💬', label: 'Ask Patient', color: '#2ee59d' },
        TAG_OBSERVATION: { icon: '🏷️', label: 'Tag Observation', color: '#2ad4ff' },
        STUDENT_STOP: { icon: '🛑', label: 'Student Stop', color: '#ff4d4d' },
        SCENARIO_SELECTED: { icon: '🎛️', label: 'Scenario Selected', color: '#8b5cf6' },
        SCENARIO_STARTED: { icon: '🧪', label: 'Scenario Started', color: '#7c3aed' },
        SCENARIO_STAGE_CHANGED: { icon: '📈', label: 'Scenario Stage', color: '#6366f1' },
        SCENARIO_DECISION_STOP: { icon: '🛑', label: 'Scenario Stop Branch', color: '#ef4444' },
        SCENARIO_COMPLETED: { icon: '✅', label: 'Scenario Completed', color: '#22c55e' }
    };

    // ===== PANEL CONTROLS =====
    function openPanel() {
        if (!elements.debriefPanel || !elements.debriefMask) return;

        elements.debriefPanel.classList.add('open');
        elements.debriefMask.classList.add('open');
        elements.debriefPanel.setAttribute('aria-hidden', 'false');

        isOpen = true;
        renderTimeline();

        console.log('[DebriefPanel] Panel opened');
    }

    function closePanel() {
        if (!elements.debriefPanel || !elements.debriefMask) return;

        elements.debriefPanel.classList.remove('open');
        elements.debriefMask.classList.remove('open');
        elements.debriefPanel.setAttribute('aria-hidden', 'true');

        isOpen = false;

        console.log('[DebriefPanel] Panel closed');
    }

    function togglePanel() {
        if (isOpen) {
            closePanel();
        } else {
            openPanel();
        }
    }

    // ===== TIMELINE RENDERING =====
    function renderTimeline() {
        if (!timelineManager) {
            console.warn('[DebriefPanel] No TimelineManager available');
            return;
        }

        const events = timelineManager.getEvents();

        if (!events || events.length === 0) {
            renderEmptyState();
            return;
        }

        updateSummaryStats(events);
        renderEventList(events);
        renderSnapshotViewer(events);
    }

    function renderEmptyState() {
        if (elements.debriefTimeline) {
            elements.debriefTimeline.innerHTML = `
                <div class="debrief-empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-title">No Events Recorded</div>
                    <div class="empty-desc">Timeline events will appear here during the simulation</div>
                </div>
            `;
        }

        if (elements.debriefSnapshots) {
            elements.debriefSnapshots.innerHTML = `
                <div class="debrief-empty-state">
                    <div class="empty-icon">📸</div>
                    <div class="empty-title">No Snapshots</div>
                    <div class="empty-desc">Student Stop snapshots will appear here</div>
                </div>
            `;
        }
    }

    function updateSummaryStats(events) {
        if (!events || events.length === 0) {
            if (elements.debriefEventCount) elements.debriefEventCount.textContent = '0';
            if (elements.debriefDuration) elements.debriefDuration.textContent = '0:00';
            return;
        }

        // Event count
        if (elements.debriefEventCount) {
            elements.debriefEventCount.textContent = String(events.length);
        }

        // Duration (first event to last event)
        if (elements.debriefDuration && events.length > 1) {
            const firstTime = events[0].timestamp;
            const lastTime = events[events.length - 1].timestamp;
            const durationMs = lastTime - firstTime;
            const durationMin = Math.floor(durationMs / 60000);
            const durationSec = Math.floor((durationMs % 60000) / 1000);
            elements.debriefDuration.textContent = `${durationMin}:${String(durationSec).padStart(2, '0')}`;
        } else if (elements.debriefDuration) {
            elements.debriefDuration.textContent = '0:00';
        }
    }

    function renderEventList(events) {
        if (!elements.debriefTimeline) return;

        const startTime = events[0]?.timestamp || Date.now();

        const eventHTML = events.map((event, index) => {
            const eventType = EVENT_TYPES[event.type] || { icon: '📌', label: event.type, color: '#6b7280' };
            const relativeTime = formatRelativeTime(event.timestamp - startTime);

            return `
                <div class="debrief-event-item" data-event-index="${index}">
                    <div class="event-marker" style="background: ${eventType.color};">
                        <span class="event-icon">${eventType.icon}</span>
                    </div>
                    <div class="event-content">
                        <div class="event-header">
                            <span class="event-type-label">${eventType.label}</span>
                            <span class="event-time">${relativeTime}</span>
                        </div>
                        <div class="event-details">
                            ${renderEventDetails(event)}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        elements.debriefTimeline.innerHTML = `
            <div class="debrief-timeline-container">
                ${eventHTML}
            </div>
        `;
    }

    function renderEventDetails(event) {
        switch (event.type) {
            case 'PRESET_CHANGE':
                return `Preset: <strong>${event.data?.preset?.name || 'Unknown'}</strong>`;

            case 'EVENT_CARD':
                return `${event.data?.label || 'Event'}: <em>"${event.data?.phrase || ''}"</em>`;

            case 'ASK_PATIENT':
                const askPrompt = event.data?.prompt || 'General Check-in';
                const askNote = event.data?.note ? ` · Note: ${event.data.note}` : '';
                return `Prompt: <strong>${askPrompt}</strong>${askNote}`;

            case 'TAG_OBSERVATION':
                const tag = event.data?.tag || 'Observation';
                const tagNote = event.data?.note ? ` · Note: ${event.data.note}` : '';
                return `Tag: <strong>${tag}</strong>${tagNote}`;

            case 'STUDENT_STOP':
                return `<strong>Simulation stopped by student</strong>`;

            case 'SCENARIO_SELECTED':
                return `Selected: <strong>${event.data?.scenarioId || 'off'}</strong> (${event.data?.source || 'ui'})`;

            case 'SCENARIO_STARTED':
                return `Scenario: <strong>${event.data?.scenarioId || '-'}</strong> · ${event.data?.label || ''}`;

            case 'SCENARIO_STAGE_CHANGED':
                return `Stage: <strong>${event.data?.stageId || '-'}</strong> · ${event.data?.reason || ''}`;

            case 'SCENARIO_DECISION_STOP':
                return `Stop branch selected (${event.data?.reason || 'manual'})`;

            case 'SCENARIO_COMPLETED':
                const pausedSec = Math.round((Number(event.data?.pausedMs) || 0) / 1000);
                return `Reason: <strong>${event.data?.completionReason || 'completed'}</strong> · Paused: <strong>${pausedSec}s</strong>`;

            default:
                return JSON.stringify(event.data || {});
        }
    }

    function renderSnapshotViewer(events) {
        if (!elements.debriefSnapshots) return;

        const stopEvents = events.filter(e => e.type === 'STUDENT_STOP' && e.data?.snapshot);

        if (stopEvents.length === 0) {
            elements.debriefSnapshots.innerHTML = `
                <div class="debrief-empty-state">
                    <div class="empty-icon">📸</div>
                    <div class="empty-title">No Stop Snapshots</div>
                    <div class="empty-desc">Snapshots are captured when students stop the simulation</div>
                </div>
            `;
            return;
        }

        const startTime = events[0]?.timestamp || Date.now();

        const snapshotHTML = stopEvents.map((event, index) => {
            const snapshot = event.data.snapshot;
            const relativeTime = formatRelativeTime(event.timestamp - startTime);

            return `
                <div class="snapshot-card">
                    <div class="snapshot-header">
                        <span class="snapshot-title">Stop Event #${index + 1}</span>
                        <span class="snapshot-time">${relativeTime}</span>
                    </div>
                    <div class="snapshot-content">
                        ${renderSnapshotVitals(snapshot.vitals)}
                        ${renderSnapshotCues(snapshot.cues)}
                        <div class="snapshot-state">
                            <strong>Patient State:</strong> ${snapshot.patientState || 'Unknown'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        elements.debriefSnapshots.innerHTML = snapshotHTML;
    }

    function renderSnapshotVitals(vitals) {
        if (!vitals) return '<div class="snapshot-no-data">No vitals data</div>';

        return `
            <div class="snapshot-vitals">
                <div class="snapshot-vital">HR: <strong>${Math.round(vitals.hr || 0)}</strong> bpm</div>
                <div class="snapshot-vital">BP: <strong>${Math.round(vitals.sbp || 0)}/${Math.round(vitals.dbp || 0)}</strong> mmHg</div>
                <div class="snapshot-vital">RR: <strong>${Math.round(vitals.rr || 0)}</strong> bpm</div>
                <div class="snapshot-vital">SpO₂: <strong>${Math.round(vitals.spo2 || 0)}%</strong></div>
            </div>
        `;
    }

    function renderSnapshotCues(cues) {
        if (!cues) return '<div class="snapshot-no-data">No cues data</div>';

        return `
            <div class="snapshot-cues">
                <div class="snapshot-cue">Pain: <strong>${String(cues.pain || 'Unknown')}</strong></div>
                <div class="snapshot-cue">Anxiety: <strong>${String(cues.anxiety || 'Unknown')}</strong></div>
                <div class="snapshot-cue">Comfort: <strong>${String(cues.comfort || 'Unknown')}</strong></div>
            </div>
        `;
    }

    function formatRelativeTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        if (minutes === 0) {
            return `${seconds}s`;
        }
        return `${minutes}m ${seconds}s`;
    }

    // ===== EXPORT FUNCTIONS =====
    function exportJSON() {
        if (!timelineManager) {
            console.warn('[DebriefPanel] No TimelineManager available for export');
            return;
        }

        const events = timelineManager.getEvents();
        const exportData = {
            exportDate: new Date().toISOString(),
            eventCount: events.length,
            events: events
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `nursing-timeline-${Date.now()}.json`;
        link.click();

        URL.revokeObjectURL(url);

        console.log('[DebriefPanel] Timeline exported as JSON');
    }

    function exportCSV() {
        if (!timelineManager) {
            console.warn('[DebriefPanel] No TimelineManager available for export');
            return;
        }

        const events = timelineManager.getEvents();

        // CSV Headers
        let csv = 'Timestamp,Type,Details\n';

        // CSV Rows
        events.forEach(event => {
            const timestamp = new Date(event.timestamp).toISOString();
            const type = event.type;
            const details = JSON.stringify(event.data || {}).replace(/"/g, '""');
            csv += `"${timestamp}","${type}","${details}"\n`;
        });

        const dataBlob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(dataBlob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `nursing-timeline-${Date.now()}.csv`;
        link.click();

        URL.revokeObjectURL(url);

        console.log('[DebriefPanel] Timeline exported as CSV');
    }

    function clearTimeline() {
        if (!timelineManager) return;

        const confirmed = confirm('Clear all timeline events? This cannot be undone.');
        if (!confirmed) return;

        timelineManager.clear();
        renderTimeline();

        console.log('[DebriefPanel] Timeline cleared');
    }

    // ===== EVENT LISTENERS =====
    function initialize() {
        console.log('[DebriefPanel] Initializing...');

        if (elements.debriefClose) {
            elements.debriefClose.addEventListener('click', closePanel);
        }

        if (elements.debriefMask) {
            elements.debriefMask.addEventListener('click', closePanel);
        }

        if (elements.debriefExportJSON) {
            elements.debriefExportJSON.addEventListener('click', exportJSON);
        }

        if (elements.debriefExportCSV) {
            elements.debriefExportCSV.addEventListener('click', exportCSV);
        }

        if (elements.debriefClear) {
            elements.debriefClear.addEventListener('click', clearTimeline);
        }

        // Keyboard shortcut: Ctrl+D to toggle debrief panel
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                togglePanel();
            }
        });

        console.log('[DebriefPanel] Initialized successfully');
    }

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // ===== PUBLIC API =====
    return {
        openPanel,
        closePanel,
        togglePanel,
        renderTimeline,
        exportJSON,
        exportCSV,
        clearTimeline
    };
}

// Export for module compatibility
export const DebriefPanel = {
    createDebriefPanel
};
