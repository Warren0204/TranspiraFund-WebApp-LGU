import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck, Lock, Map, Cpu, ChevronRight, Fingerprint,
  Building2, BarChart3, ArrowRight, CheckCircle2, Users,
  Activity, Eye, FileSearch, Landmark, Award
} from 'lucide-react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ROLES } from '../../config/roles';
import logo from '../../assets/logo.png';

// --- ANIMATED COUNTER ---
const AnimatedCounter = ({ target, prefix = '', suffix = '', duration = 1200 }) => {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (target === 0 || hasAnimated.current) {
      setCount(target);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const start = performance.now();
          const animate = (now) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(animate);
            else setCount(target);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
};

// --- CURRENCY FORMATTER ---
const formatBudgetShort = (val) => {
  if (val >= 1_000_000_000) return { num: +(val / 1_000_000_000).toFixed(1), suffix: 'B' };
  if (val >= 1_000_000) return { num: +(val / 1_000_000).toFixed(1), suffix: 'M' };
  if (val >= 1_000) return { num: +(val / 1_000).toFixed(0), suffix: 'K' };
  return { num: val, suffix: '' };
};

// --- TOPOGRAPHIC BACKGROUND ---
const TopoBg = memo(() => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.04]" aria-hidden="true">
    <defs>
      <pattern id="topo" width="200" height="200" patternUnits="userSpaceOnUse">
        <path d="M 0 80 Q 50 60 100 80 T 200 80" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <path d="M 0 120 Q 50 100 100 120 T 200 120" fill="none" stroke="currentColor" strokeWidth="0.6" />
        <path d="M 0 160 Q 50 140 100 160 T 200 160" fill="none" stroke="currentColor" strokeWidth="0.4" />
        <circle cx="100" cy="100" r="30" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" strokeWidth="0.2" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#topo)" />
  </svg>
));

// --- MAIN LANDING PAGE ---
const Landing = () => {
  const navigate = useNavigate();

  // --- REAL-TIME DATA FROM FIRESTORE ---
  const [projectCount, setProjectCount] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);
  const [engineerCount, setEngineerCount] = useState(0);
  const [departmentCount, setDepartmentCount] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const projects = snapshot.docs.map(doc => doc.data());
        setProjectCount(projects.length);
        setTotalBudget(projects.reduce((acc, p) => acc + (Number(p.budget) || 0), 0));
        setDataLoaded(true);
      },
      () => setDataLoaded(true)
    );

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const users = snapshot.docs.map(doc => doc.data());
        setEngineerCount(users.filter(u => {
          const r = u.role;
          return r === ROLES.PROJECT_ENGINEER || r === 'Project Engineer' || r === 'PROJ_ENG';
        }).length);
        setDepartmentCount(new Set(users.map(u => u.department).filter(Boolean)).size);
      },
      () => { }
    );

    return () => { unsubProjects(); unsubUsers(); };
  }, []);

  const budget = useMemo(() => formatBudgetShort(totalBudget), [totalBudget]);
  const handleLoginClick = () => navigate('/login');

  return (
    <div className="min-h-screen bg-[#0B0F1A] font-sans text-white selection:bg-blue-500/30 overflow-x-hidden">

      {/* ====== NAV ====== */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F1A]/70 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="TranspiraFund" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full ring-1 ring-white/10" />
            <span className="font-bold text-white/90 text-sm sm:text-base tracking-tight">TranspiraFund</span>
            <div className="hidden sm:flex items-center gap-1 ml-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <Activity size={10} className="text-emerald-400" />
              <span className="text-[9px] font-semibold text-emerald-400 tracking-wider uppercase">Live</span>
            </div>
          </div>
          <button
            onClick={handleLoginClick}
            className="flex items-center gap-2 bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08] text-white/90 text-xs sm:text-sm font-medium px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl transition-all"
            aria-label="Navigate to secure login"
          >
            <Lock size={13} />
            Portal Access
          </button>
        </div>
      </nav>

      {/* ====== HERO — "Open Ledger" Concept ====== */}
      <section className="relative pt-24 sm:pt-32 md:pt-40 pb-8 sm:pb-12 px-4 sm:px-6" aria-labelledby="hero-heading">
        <TopoBg />

        {/* Radial Glow */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-blue-600/[0.07] rounded-full blur-[120px] pointer-events-none" aria-hidden="true" />

        <div className="max-w-6xl mx-auto relative z-10">

          {/* Eyebrow Badge */}
          <div className="flex justify-center mb-8 sm:mb-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-white/60 text-[10px] sm:text-[11px] font-medium tracking-widest uppercase">
              <Landmark size={12} className="text-blue-400" />
              Local Government Infrastructure Portal
            </div>
          </div>

          {/* Headline — Editorial Typography */}
          <div className="text-center mb-8 sm:mb-12">
            <h1 id="hero-heading" className="text-[2.5rem] sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.03em] leading-[0.95]">
              <span className="text-white/90">Transparent</span>
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
                Public Works
              </span>
            </h1>
            <p className="mt-5 sm:mt-6 text-base sm:text-lg text-white/40 max-w-xl mx-auto leading-relaxed font-light">
              Every peso accounted for. Every project tracked.
              <br className="hidden sm:block" />
              The operating system for <span className="text-white/60 font-medium">accountable governance</span>.
            </p>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-10 sm:mb-14">
            <button
              onClick={handleLoginClick}
              aria-label="Navigate to secure login page"
              className="group flex items-center gap-2.5 bg-white text-slate-900 px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-sm sm:text-base transition-all duration-300 hover:shadow-[0_0_40px_rgba(255,255,255,0.15)] hover:-translate-y-0.5"
            >
              <Lock size={16} aria-hidden="true" />
              Secure LGU Login
              <ChevronRight size={16} className="opacity-0 -ml-3 group-hover:opacity-100 group-hover:ml-0 transition-all duration-300" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-white/30 font-medium tracking-wider uppercase">
              <ShieldCheck size={12} className="text-emerald-500/70" />
              <span>256-bit Encrypted</span>
              <span className="w-0.5 h-0.5 bg-white/20 rounded-full" />
              <span>Authorized Only</span>
            </div>
          </div>

          {/* ====== LIVE DATA DASHBOARD STRIP ====== */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 max-w-4xl mx-auto">
            {[
              { label: 'Registered Projects', value: projectCount, icon: <Building2 size={16} /> },
              { label: 'Budget Managed', value: budget.num, prefix: '₱', suffix: budget.suffix, icon: <BarChart3 size={16} /> },
              { label: 'Field Engineers', value: engineerCount, icon: <Users size={16} /> },
              { label: 'Departments', value: departmentCount, icon: <Landmark size={16} /> },
            ].map(stat => (
              <div key={stat.label} className="relative group bg-white/[0.04] border border-white/[0.06] rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:bg-white/[0.07] hover:border-white/[0.1] transition-all duration-300">
                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                  <span className="text-white/20 group-hover:text-blue-400/60 transition-colors">{stat.icon}</span>
                  <span className="text-[9px] sm:text-[10px] font-semibold text-white/25 uppercase tracking-widest">{stat.label}</span>
                </div>
                <p className={`text-2xl sm:text-3xl md:text-4xl font-black tracking-tight transition-colors duration-500 ${dataLoaded ? 'text-white/90' : 'text-white/10'}`}>
                  <AnimatedCounter target={stat.value} prefix={stat.prefix || ''} suffix={stat.suffix || ''} />
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== TRANSITION — Dark to Light ====== */}
      <div className="h-24 sm:h-32 bg-gradient-to-b from-[#0B0F1A] to-[#F1F5F9]" aria-hidden="true" />

      {/* ====== BENTO GRID — Capabilities ====== */}
      <section className="bg-[#F1F5F9] py-12 sm:py-16 md:py-20 px-4 sm:px-6" aria-label="System Capabilities">
        <div className="max-w-6xl mx-auto">

          {/* Section Intro */}
          <div className="mb-10 sm:mb-14 max-w-xl">
            <p className="text-[11px] font-bold text-blue-600 tracking-[0.2em] uppercase mb-2">How It Works</p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              From blueprint to billing —<br />
              <span className="text-slate-400">every step is on record.</span>
            </h2>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">

            {/* Card 1 — Large (spans 2 cols on lg) */}
            <div className="sm:col-span-2 lg:col-span-2 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-6 sm:p-8 hover:shadow-lg hover:shadow-slate-200/50 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-blue-50 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-11 h-11 sm:w-12 sm:h-12 bg-blue-600 text-white rounded-xl sm:rounded-2xl flex items-center justify-center mb-5">
                  <Eye size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 mb-2 tracking-tight">Full Transparency Engine</h3>
                <p className="text-slate-500 leading-relaxed text-sm sm:text-[15px] max-w-lg">
                  Every transaction, every milestone, every approval — logged immutably with timestamps and actor identity.
                  The public ledger ensures no project disappears and no fund goes unaccounted.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {['Audit Trail', 'Immutable Logs', 'Actor Tracking'].map(tag => (
                    <span key={tag} className="px-2.5 py-1 bg-slate-100 text-slate-500 text-[10px] sm:text-[11px] font-semibold rounded-lg tracking-wide uppercase">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Card 2 — Tall */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute bottom-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-tl-full blur-2xl" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-11 h-11 sm:w-12 sm:h-12 bg-emerald-500/20 text-emerald-400 rounded-xl sm:rounded-2xl flex items-center justify-center mb-5">
                  <ShieldCheck size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold mb-2 tracking-tight">Geo-Tagged Evidence</h3>
                <p className="text-white/50 leading-relaxed text-sm sm:text-[15px]">
                  GPS-locked, timestamped photos validate every billing claim. No coordinates, no payment.
                </p>
                <div className="mt-5 pt-5 border-t border-white/[0.08]">
                  <div className="flex items-center gap-2 text-emerald-400/80 text-[11px] font-semibold">
                    <CheckCircle2 size={14} />
                    <span>Eliminates ghost projects</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3 — Medium */}
            <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-6 sm:p-8 hover:shadow-lg hover:shadow-slate-200/50 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-indigo-50 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-11 h-11 sm:w-12 sm:h-12 bg-indigo-100 text-indigo-600 rounded-xl sm:rounded-2xl flex items-center justify-center mb-5 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
                  <Cpu size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 mb-2 tracking-tight">AI-Powered Planning</h3>
                <p className="text-slate-500 leading-relaxed text-sm sm:text-[15px]">
                  Generative AI produces scope-of-work and milestones automatically — preventing cost overruns before they happen.
                </p>
              </div>
            </div>

            {/* Card 4 — Medium */}
            <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 p-6 sm:p-8 hover:shadow-lg hover:shadow-slate-200/50 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-cyan-50 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-11 h-11 sm:w-12 sm:h-12 bg-cyan-100 text-cyan-600 rounded-xl sm:rounded-2xl flex items-center justify-center mb-5 group-hover:bg-cyan-600 group-hover:text-white transition-colors duration-300">
                  <Map size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 mb-2 tracking-tight">Unified City Command</h3>
                <p className="text-slate-500 leading-relaxed text-sm sm:text-[15px]">
                  One dashboard connecting the Mayor's Office, Engineering Division, and Planning — real-time, role-based, citywide.
                </p>
              </div>
            </div>

            {/* Card 5 — Accent */}
            <div className="bg-blue-600 rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/20 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-11 h-11 sm:w-12 sm:h-12 bg-white/20 text-white rounded-xl sm:rounded-2xl flex items-center justify-center mb-5">
                  <FileSearch size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold mb-2 tracking-tight">Real-Time Audit</h3>
                <p className="text-blue-100/70 leading-relaxed text-sm sm:text-[15px]">
                  Every action creates an audit entry. Who did what, when, and why — searchable and exportable on demand.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== PRINCIPLE STRIP ====== */}
      <section className="bg-white py-12 sm:py-16 px-4 sm:px-6 border-y border-slate-200/80" aria-label="Core principles">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
            {[
              { icon: <Eye size={20} />, title: 'Open by Design', desc: 'Every data point is traceable. Zero hidden transactions.' },
              { icon: <Award size={20} />, title: 'Accountable Actors', desc: 'Role-based access ensures every action has an owner.' },
              { icon: <Activity size={20} />, title: 'Living System', desc: 'Real-time data — not static reports. Always current.' },
            ].map(item => (
              <div key={item.title} className="flex gap-4">
                <div className="w-10 h-10 shrink-0 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-1">{item.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== CTA — Minimal ====== */}
      <section className="bg-[#F1F5F9] py-16 sm:py-20 md:py-24 px-4 sm:px-6" aria-label="Call to action">
        <div className="max-w-3xl mx-auto text-center">
          <Fingerprint size={36} className="text-slate-300 mx-auto mb-5" aria-hidden="true" />
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-3 sm:mb-4">
            Access requires authorization.
          </h2>
          <p className="text-slate-400 text-base sm:text-lg mb-8 max-w-lg mx-auto">
            This portal is restricted to verified officials of the Local Government Unit with provisioned credentials.
          </p>
          <button
            onClick={handleLoginClick}
            aria-label="Navigate to secure login page"
            className="group inline-flex items-center gap-2.5 bg-slate-900 hover:bg-slate-800 text-white px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-sm sm:text-base transition-all duration-300 hover:shadow-xl hover:shadow-slate-900/15 hover:-translate-y-0.5"
          >
            <Lock size={16} aria-hidden="true" />
            Enter Secure Portal
            <ArrowRight size={16} className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className="bg-slate-900 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2.5">
              <img src={logo} alt="TranspiraFund" className="w-6 h-6 sm:w-7 sm:h-7 rounded-full ring-1 ring-white/10" />
              <span className="font-bold text-white/70 text-sm">TranspiraFund</span>
              <span className="text-[9px] text-white/20 font-medium tracking-wider uppercase">LGU</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] sm:text-xs text-white/25 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" aria-hidden="true" />
                Operational
              </span>
              <span className="w-0.5 h-0.5 bg-white/10 rounded-full" />
              <span>v1.0</span>
            </div>
            <p className="text-[10px] sm:text-xs text-white/20 font-medium">
              © 2026 Local Government. Internal Use Only.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default Landing;