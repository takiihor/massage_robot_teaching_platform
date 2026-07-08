/**
 * ScenarioFlowChart.js
 * Quick-reference flowchart modal for Scenario 1 & 2.
 * Loaded as a plain <script> tag (not ES module) to avoid cache issues.
 * Exposes: window.openScenarioFlowChart(id), window.closeScenarioFlowChart()
 */
(function () {
    'use strict';

    var AVATAR = '/static/assets/avatar/';

    function openScenarioFlowChart(scenarioId) {
        var modal = document.getElementById('scenarioFlowModal');
        if (!modal) return;

        // Activate correct tab
        var tabId = (scenarioId === 'scenario_2' || scenarioId === 's2') ? 's2' : 's1';
        _switchTab(tabId);

        modal.classList.add('open');
    }

    function closeScenarioFlowChart() {
        var modal = document.getElementById('scenarioFlowModal');
        if (modal) modal.classList.remove('open');
    }

    function _switchTab(tabId) {
        var tabs = document.querySelectorAll('.sf-tab-btn');
        var panels = document.querySelectorAll('.sf-flow-panel');
        tabs.forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.sfTab === tabId);
        });
        panels.forEach(function (panel) {
            panel.classList.toggle('active', panel.dataset.sfPanel === tabId);
        });
    }

    // Wire up after DOM is ready
    function _init() {
        var modal = document.getElementById('scenarioFlowModal');
        if (!modal) return;

        var s1Panel = modal.querySelector('.sf-flow-panel[data-sf-panel="s1"]');
        if (s1Panel) {
            s1Panel.innerHTML = ''
                + '<div class="sf-scenario-title s1">S1 · No pain at 15th min</div>'
                + '<div style="padding: 12px; display:flex; justify-content:center;">'
                + '<img src="/new_scenario_design/scenario_1.png" '
                + 'alt="Scenario 1 flowchart" '
                + 'style="display:block; width:100%; max-width:1120px; height:auto; border-radius:12px; border:1px solid rgba(95,227,255,0.25); background:#fff;"/>'
                + '</div>';
        }

        var s2Panel = modal.querySelector('.sf-flow-panel[data-sf-panel="s2"]');
        if (s2Panel) {
            s2Panel.innerHTML = ''
                + '<div class="sf-scenario-title s2">S2 · Moderate / Severe Pain</div>'
                + '<div style="padding: 12px; display:flex; justify-content:center;">'
                + '<img src="/new_scenario_design/scenario_2.png" '
                + 'alt="Scenario 2 flowchart" '
                + 'style="display:block; width:100%; max-width:1120px; height:auto; border-radius:12px; border:1px solid rgba(239,68,68,0.25); background:#fff;"/>'
                + '</div>';
        }

        // Backdrop click → close
        var backdrop = modal.querySelector('.sf-backdrop');
        if (backdrop) backdrop.addEventListener('click', closeScenarioFlowChart);

        // Close button
        var closeBtn = modal.querySelector('.sf-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeScenarioFlowChart);

        // Tab buttons - switch tab AND select scenario
        var tabs = modal.querySelectorAll('.sf-tab-btn');
        tabs.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var tabId = btn.dataset.sfTab;
                _switchTab(tabId);
                // Select the scenario when clicking the tab
                var scenarioId = (tabId === 's2') ? 'scenario_2' : 'scenario_1';
                if (window.nursingScenarioControllerInstance) {
                    window.nursingScenarioControllerInstance.selectScenario(scenarioId, 'flowchart_tab_click');
                }
                // Also update the dropdown
                var select = document.getElementById('teachingScenarioSelect');
                if (select) {
                    select.value = scenarioId;
                }
            });
        });

        // Instructor badge click → open with current scenario
        var badge = document.getElementById('teachingScenarioBadge');
        if (badge) {
            badge.style.cursor = 'pointer';
            badge.title = 'Click to view scenario flowchart';
            badge.addEventListener('click', function () {
                var select = document.getElementById('teachingScenarioSelect');
                var val = select ? select.value : 's1';
                openScenarioFlowChart(val === 'scenario_2' ? 's2' : 's1');
            });
        }

        // Quick select buttons in instructor overlay
        var quickSelectS1 = document.getElementById('quickSelectS1');
        if (quickSelectS1) {
            quickSelectS1.addEventListener('click', function () {
                if (window.nursingScenarioControllerInstance) {
                    window.nursingScenarioControllerInstance.selectScenario('scenario_1', 'quick_select_s1');
                }
                var select = document.getElementById('teachingScenarioSelect');
                if (select) select.value = 'scenario_1';
                openScenarioFlowChart('s1');
            });
        }

        var quickSelectS2 = document.getElementById('quickSelectS2');
        if (quickSelectS2) {
            quickSelectS2.addEventListener('click', function () {
                if (window.nursingScenarioControllerInstance) {
                    window.nursingScenarioControllerInstance.selectScenario('scenario_2', 'quick_select_s2');
                }
                var select = document.getElementById('teachingScenarioSelect');
                if (select) select.value = 'scenario_2';
                openScenarioFlowChart('s2');
            });
        }

        var quickSelectOff = document.getElementById('quickSelectOff');
        if (quickSelectOff) {
            quickSelectOff.addEventListener('click', function () {
                if (window.nursingScenarioControllerInstance) {
                    window.nursingScenarioControllerInstance.selectScenario('off', 'quick_select_off');
                }
                var select = document.getElementById('teachingScenarioSelect');
                if (select) select.value = 'off';
            });
        }

        // Keyboard: Escape closes
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var m = document.getElementById('scenarioFlowModal');
                if (m && m.classList.contains('open')) closeScenarioFlowChart();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    window.openScenarioFlowChart = openScenarioFlowChart;
    window.closeScenarioFlowChart = closeScenarioFlowChart;
    window._switchScenarioFlowTab = _switchTab;
})();
