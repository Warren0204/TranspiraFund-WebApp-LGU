// Single source of truth for project slippage math. Consumed by HCSD
// Project Detail (Slippage / Days Delay stat tiles) and the HCSD
// Dashboard Slippage Alerts widget. Kept dependency-free so both
// surfaces compute identical numbers from the same project doc.

const diffDays = (a, b) => {
    if (!a || !b) return null;
    const ms = new Date(b) - new Date(a);
    return isNaN(ms) ? null : Math.round(ms / 86400000);
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const computeSlippage = (project) => {
    if (!project) return { durationDays: null, timeElapsed: 0, slippage: 0, daysDelay: 0 };
    const start = project.officialDateStarted;
    const end   = project.originalDateCompletion;
    const actual = Number(project.actualPercent) || 0;
    const durationDays = diffDays(start, end);

    let timeElapsed = 0;
    if (start && end) {
        const now = Date.now();
        const s = new Date(start).getTime();
        const e = new Date(end).getTime();
        timeElapsed = clamp(((now - s) / (e - s)) * 100, 0, 100);
    }
    const slippage = timeElapsed - actual;
    const daysDelay = slippage > 0 && durationDays
        ? Math.round((slippage / 100) * durationDays)
        : 0;

    return {
        durationDays,
        timeElapsed: Math.round(timeElapsed * 10) / 10,
        slippage:    Math.round(slippage    * 10) / 10,
        daysDelay,
    };
};
