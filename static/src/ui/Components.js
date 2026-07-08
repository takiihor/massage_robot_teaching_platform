(function () {
    // Lightweight toast for status/ mode change (avoids flooding chat area)
    function showStatusToast(message, type = 'info', duration = 4000) {
        let toast = document.getElementById('statusToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'statusToast';
            toast.style.cssText = `
            position: fixed;
            top: 82px;
            right: 18px;
            z-index: 1200;
            padding: 12px 14px;
            border-radius: 12px;
            background: rgba(0,0,0,0.85);
            color: #fff;
            font-size: 13px;
            box-shadow: 0 8px 20px rgba(0,0,0,0.25);
            opacity: 0;
            transform: translateY(-6px);
            transition: all 0.25s ease;
            pointer-events: none;
            max-width: 260px;
            line-height: 1.4;
            display: flex;
            align-items: flex-start;
            gap: 8px;
        `;
            document.body.appendChild(toast);
        }

        const typeIcons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        const bgColor = {
            info: 'rgba(0,0,0,0.85)',
            success: 'rgba(40,167,69,0.9)',
            warning: 'rgba(243,156,18,0.92)',
            error: 'rgba(231,76,60,0.92)'
        }[type] || 'rgba(0,0,0,0.85)';

        toast.style.background = bgColor;
        toast.innerHTML = `<span>${typeIcons[type] || 'ℹ️'}</span><span>${message}</span>`;
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        if (window.__statusToastTimer) clearTimeout(window.__statusToastTimer);
        window.__statusToastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';
        }, duration);
    }

    window.showStatusToast = showStatusToast;
})();
