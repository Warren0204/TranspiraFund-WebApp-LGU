import { memo, useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck, Lock, Map, Cpu, ChevronRight, Fingerprint,
  Building2, BarChart3, ArrowRight, CheckCircle2, Users,
  Activity, Eye, FileSearch, Landmark, Award
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import logo from '../../assets/logo.png';

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

const formatBudgetShort = (val) => {
  if (val >= 1_000_000_000) return { num: +(val / 1_000_000_000).toFixed(1), suffix: 'B' };
  if (val >= 1_000_000) return { num: +(val / 1_000_000).toFixed(1), suffix: 'M' };
  if (val >= 1_000) return { num: +(val / 1_000).toFixed(0), suffix: 'K' };
  return { num: val, suffix: '' };
};

const GridPattern = memo(() => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.03]" aria-hidden="true">
    <defs>
      <pattern id="grid-pattern" width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#0F766E" strokeWidth="0.5" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid-pattern)" />
  </svg>
));

const useLandingStats = () => {
  const [stats, setStats] = useState({
    projectCount: 0,
    totalBudget: 0,
    engineerCount: 0,
    departmentCount: 0,
  });
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'stats', 'public'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setStats({
            projectCount: data.projectCount || 0,
            totalBudget: data.totalBudget || 0,
            engineerCount: data.engineerCount || 0,
            departmentCount: data.departmentCount || 0,
          });
        }
        setDataLoaded(true);
      },
      (error) => {
        console.error('[Landing/stats-public] snapshot listener error:', error);
        setDataLoaded(true);
      }
    );
    return () => unsubscribe();
  }, []);

  return { stats, dataLoaded };
};

const Landing = () => {
  const navigate = useNavigate();
  const { stats, dataLoaded } = useLandingStats();

  const budget = useMemo(() => formatBudgetShort(stats.totalBudget), [stats.totalBudget]);
  const handleLoginClick = () => navigate('/login');

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-800 selection:bg-teal-200/40 overflow-x-hidden">

      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden">
              <img src={logo} alt="TranspiraFund" className="w-full h-full object-cover scale-[1.55]" />
            </div>
            <span className="font-bold text-slate-800 text-sm sm:text-base tracking-tight">TranspiraFund</span>
            <div className="hidden sm:flex items-center gap-1 ml-1.5 px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200/60">
              <Activity size={10} className="text-teal-700" />
              <span className="text-[11px] font-semibold text-teal-700 tracking-wider uppercase">Live</span>
            </div>
          </div>
          <button
            onClick={handleLoginClick}
            className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
            aria-label="Navigate to secure login"
          >
            <Lock size={14} />
            Portal Access
          </button>
        </div>
      </nav>

      <section className="relative pt-24 sm:pt-32 md:pt-40 pb-8 sm:pb-12 px-4 sm:px-6" aria-labelledby="hero-heading">
        <GridPattern />
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-teal-100/30 rounded-full blur-[120px] pointer-events-none" aria-hidden="true" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="flex justify-center mb-8 sm:mb-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-semibold tracking-widest uppercase">
              <Landmark size={13} className="text-teal-700" />
              Local Government Infrastructure Portal
            </div>
          </div>

          <div className="text-center mb-8 sm:mb-12">
            <h1 id="hero-heading" className="text-[2.5rem] sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.03em] leading-[0.95]">
              <span className="text-slate-800">Transparent</span>
              <br />
              <span className="text-teal-700">Public Works</span>
            </h1>
            <p className="mt-5 sm:mt-6 text-base sm:text-lg text-slate-500 max-w-xl mx-auto leading-relaxed">
              City-wide transparency. Barangay-level visibility.
              <br className="hidden sm:block" />
              Track every infrastructure project from
              <span className="text-slate-700 font-semibold"> planning to completion</span>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-10 sm:mb-14">
            <button
              onClick={handleLoginClick}
              aria-label="Navigate to secure login page"
              className="group flex items-center gap-2.5 bg-teal-700 hover:bg-teal-800 text-white px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-sm sm:text-base transition-all duration-300 shadow-md hover:shadow-lg hover:shadow-teal-800/15 hover:-translate-y-0.5"
            >
              <Lock size={16} aria-hidden="true" />
              Secure LGU Login
              <ChevronRight size={16} className="opacity-0 -ml-3 group-hover:opacity-100 group-hover:ml-0 transition-all duration-300" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-medium tracking-wider uppercase">
              <ShieldCheck size={13} className="text-teal-700" />
              <span>Secure Access</span>
              <span className="w-1 h-1 bg-slate-300 rounded-full" />
              <span>Authorized Personnel Only</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 max-w-4xl mx-auto">
            {[
              { label: 'Active Projects', value: stats.projectCount, icon: <Building2 size={16} /> },
              { label: 'Budget Tracked', value: budget.num, prefix: '₱', suffix: budget.suffix, icon: <BarChart3 size={16} /> },
              { label: 'Field Engineers', value: stats.engineerCount, icon: <Users size={16} /> },
              { label: 'Departments', value: stats.departmentCount, icon: <Landmark size={16} /> },
            ].map(stat => (
              <div key={stat.label} className="relative group bg-white border border-slate-200/80 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-teal-300/60 hover:shadow-md hover:shadow-teal-50 transition-all duration-300">
                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                  <span className="text-slate-400 group-hover:text-teal-700 transition-colors">{stat.icon}</span>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{stat.label}</span>
                </div>
                <p className={`text-2xl sm:text-3xl md:text-4xl font-black tracking-tight transition-colors duration-500 ${dataLoaded ? 'text-slate-800' : 'text-slate-200'}`}>
                  <AnimatedCounter target={stat.value} prefix={stat.prefix || ''} suffix={stat.suffix || ''} />
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="h-16 sm:h-24 bg-gradient-to-b from-[#F8FAFC] to-white" aria-hidden="true" />

      <section className="bg-white py-12 sm:py-16 md:py-20 px-4 sm:px-6" aria-label="System Capabilities">
        <div className="max-w-6xl mx-auto">
          <div className="mb-10 sm:mb-14 max-w-xl">
            <p className="text-xs font-bold text-teal-700 tracking-[0.2em] uppercase mb-2">How It Works</p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-800 tracking-tight leading-tight">
              From blueprint to completion —<br />
              <span className="text-slate-400">every step is documented.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="sm:col-span-2 lg:col-span-2 bg-[#F8FAFC] rounded-2xl sm:rounded-3xl border border-slate-200 p-6 sm:p-8 hover:shadow-lg hover:shadow-teal-50 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-teal-50 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-teal-700 text-white rounded-2xl flex items-center justify-center mb-5">
                  <Eye size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-800 mb-2 tracking-tight">Full Transparency Engine</h3>
                <p className="text-slate-500 leading-relaxed text-[15px] max-w-lg">
                  Every transaction, milestone, and approval is logged with timestamps and personnel identity.
                  No project goes untracked and no fund goes unaccounted.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {['Audit Trail', 'Immutable Logs', 'Personnel Tracking'].map(tag => (
                    <span key={tag} className="px-2.5 py-1 bg-teal-50 text-teal-700 text-xs font-semibold rounded-lg tracking-wide uppercase">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white hover:shadow-lg hover:shadow-slate-800/20 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute bottom-0 right-0 w-32 h-32 bg-teal-500/10 rounded-tl-full blur-2xl" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-teal-700/30 text-teal-300 rounded-2xl flex items-center justify-center mb-5">
                  <ShieldCheck size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold mb-2 tracking-tight">Geo-Tagged Evidence</h3>
                <p className="text-slate-300 leading-relaxed text-[15px]">
                  GPS-locked, timestamped site photos validate every billing claim. No coordinates, no approval.
                </p>
                <div className="mt-5 pt-5 border-t border-white/10">
                  <div className="flex items-center gap-2 text-teal-300 text-sm font-semibold">
                    <CheckCircle2 size={14} />
                    <span>Eliminates ghost projects</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#F8FAFC] rounded-2xl sm:rounded-3xl border border-slate-200 p-6 sm:p-8 hover:shadow-lg hover:shadow-slate-100 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-teal-50 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-teal-100 text-teal-700 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-teal-700 group-hover:text-white transition-colors duration-300">
                  <Cpu size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-800 mb-2 tracking-tight">AI-Powered Planning</h3>
                <p className="text-slate-500 leading-relaxed text-[15px]">
                  Automated scope-of-work and milestone generation helps prevent delays and cost overruns.
                </p>
              </div>
            </div>

            <div className="bg-[#F8FAFC] rounded-2xl sm:rounded-3xl border border-slate-200 p-6 sm:p-8 hover:shadow-lg hover:shadow-slate-100 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-teal-50 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-teal-100 text-teal-700 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-teal-700 group-hover:text-white transition-colors duration-300">
                  <Map size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-800 mb-2 tracking-tight">Connected Departments</h3>
                <p className="text-slate-500 leading-relaxed text-[15px]">
                  One dashboard for Construction Services and Field Engineering — real-time, role-based, citywide.
                </p>
              </div>
            </div>

            <div className="bg-teal-700 rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white hover:bg-teal-800 hover:shadow-lg hover:shadow-teal-700/20 transition-all duration-300 group relative overflow-hidden">
              <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-white/20 text-white rounded-2xl flex items-center justify-center mb-5">
                  <FileSearch size={22} />
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold mb-2 tracking-tight">Real-Time Audit Trail</h3>
                <p className="text-teal-100 leading-relaxed text-[15px]">
                  Every action is recorded — who did what, when, and why. Searchable and exportable anytime.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#F8FAFC] py-12 sm:py-16 px-4 sm:px-6 border-y border-slate-200/60" aria-label="Core principles">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
            {[
              { icon: <Eye size={20} />, title: 'Open by Design', desc: 'Every data point is traceable. No hidden transactions.' },
              { icon: <Award size={20} />, title: 'Clear Accountability', desc: 'Role-based access ensures every action has a responsible owner.' },
              { icon: <Activity size={20} />, title: 'Always Current', desc: 'Real-time synchronized data — not static monthly reports.' },
            ].map(item => (
              <div key={item.title} className="flex gap-4">
                <div className="w-11 h-11 shrink-0 bg-teal-100 text-teal-700 rounded-xl flex items-center justify-center">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base mb-1">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16 sm:py-20 md:py-24 px-4 sm:px-6" aria-label="Call to action">
        <div className="max-w-3xl mx-auto text-center">
          <Fingerprint size={36} className="text-teal-300 mx-auto mb-5" aria-hidden="true" />
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-800 tracking-tight mb-3 sm:mb-4">
            Access requires authorization.
          </h2>
          <p className="text-slate-500 text-base sm:text-lg mb-8 max-w-lg mx-auto leading-relaxed">
            This portal is restricted to verified Local Government Unit officials with provisioned credentials.
          </p>
          <button
            onClick={handleLoginClick}
            aria-label="Navigate to secure login page"
            className="group inline-flex items-center gap-2.5 bg-slate-800 hover:bg-slate-900 text-white px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-sm sm:text-base transition-all duration-300 shadow-md hover:shadow-xl hover:shadow-slate-900/15 hover:-translate-y-0.5"
          >
            <Lock size={16} aria-hidden="true" />
            Enter Secure Portal
            <ArrowRight size={16} className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
          </button>
        </div>
      </section>

      <footer className="bg-slate-800 border-t border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full overflow-hidden">
                <img src={logo} alt="TranspiraFund" className="w-full h-full object-cover scale-[1.55]" />
              </div>
              <span className="font-bold text-white/80 text-sm">TranspiraFund</span>
              <span className="text-xs text-white/40 font-medium tracking-wider uppercase">LGU</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-white/40 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse" aria-hidden="true" />
                Operational
              </span>
              <span className="w-1 h-1 bg-white/20 rounded-full" />
              <span>v1.0</span>
            </div>
            <p className="text-xs text-white/40 font-medium">
              © 2026 Local Government Unit. Internal Use Only.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default Landing;