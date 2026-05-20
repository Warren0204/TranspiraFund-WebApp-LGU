// Single source of truth for project slippage math AND the derived
// "display status" rule. Consumed by HCSD Project Detail (Slippage /
// Days Delay stat tiles), HCSD Dashboard (Slippage Alerts widget,
// Active Registry row pills, donut chart), and the HCSD Project
// Registry (status column + status filter). Kept dependency-free so
// every surface computes identical numbers from the same project doc.

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

// Returns the *display* status for a project — one of "Completed",
// "Delayed", or "Ongoing". Rules:
//   1. Completed (persisted) → "Completed"
//   2. Delayed   (persisted) → "Delayed"
//   3. Persisted "Ongoing" but slippage > 0 → "Delayed" (the daily
//      detectProjectSlippage cron hasn't caught up yet; this keeps the
//      UI in agreement with reality immediately)
//   4. Anything else → "Ongoing"
// Mirrors the donut-counter rule in HcsdDashboard so the row pill,
// progress bar tint, status column, and donut all show one truth.
export const deriveStatus = (project) => {
    const raw = (project?.status || '').toLowerCase();
    if (raw === 'completed') return 'Completed';
    if (raw === 'delayed')   return 'Delayed';
    if (computeSlippage(project).slippage > 0) return 'Delayed';
    return 'Ongoing';
};
