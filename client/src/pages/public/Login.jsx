import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowLeft, Landmark } from 'lucide-react';
import AuthService from '../../services/AuthService';
import logo from '../../assets/logo.png';

const useLoginLogic = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const getRouteByRole = (role) => {
    const safeRole = role?.toUpperCase() || '';
    switch (safeRole) {
      case 'MIS': return '/admin/dashboard';
      case 'HCSD': return '/hcsd/dashboard';
      case 'DEPW': return '/hcsd/dashboard'; // migration fallback — remove after all users migrated
      default: return '/unauthorized';
    }
  };

  const loginUser = async (email, password) => {
    const errors = {};
    if (!email.trim()) errors.email = 'Official email is required';
    if (!password) errors.password = 'Password is required';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setAuthError('');
      return;
    }

    setFieldErrors({});
    setAuthError('');
    setIsLoading(true);

    try {
      const { user, role } = await AuthService.login(email, password);
      const targetRoute = getRouteByRole(role);

      if (targetRoute === '/unauthorized') {
        setAuthError('Access denied. Your role is not authorized.');
        return;
      }

      navigate('/verify-identity', {
        state: { email: user.email, targetPath: targetRoute },
        replace: true
      });
    } catch (err) {
      setAuthError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return { loginUser, isLoading, authError, fieldErrors, setAuthError };
};

const Login = () => {
  const navigate = useNavigate();
  const { loginUser, isLoading, authError, fieldErrors } = useLoginLogic();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLoading) return;
    loginUser(formData.email, formData.password);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="min-h-screen flex font-sans text-slate-800 bg-[#F8FAFC]">


      <div className="hidden lg:flex w-1/2 bg-teal-700 relative flex-col items-center justify-center text-white p-12 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true">
          <svg className="w-full h-full">
            <defs>
              <pattern id="login-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#login-grid)" />
          </svg>
        </div>
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-[100px]" aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-teal-400/10 rounded-full blur-[80px]" aria-hidden="true" />

        <div className="relative z-10 flex flex-col items-center text-center max-w-md">
          <div className="w-24 h-24 rounded-full overflow-hidden mb-8">
            <img src={logo} alt="TranspiraFund seal" className="w-full h-full object-cover scale-[1.55]" />
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tight leading-tight">
            Secure Access<br />Portal
          </h1>
          <p className="text-teal-100 text-[15px] leading-relaxed">
            City-wide transparency. Barangay-level visibility.
            <br />
            Authorized LGU personnel only.
          </p>
          <div className="mt-8 flex items-center gap-3">
            {['Encrypted', 'Role-Based', 'Audited'].map(tag => (
              <span key={tag} className="px-3 py-1 bg-white/10 border border-white/10 rounded-lg text-xs font-semibold tracking-wide uppercase">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>


      <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center px-6 sm:px-12 md:px-24 relative">

        <button
          onClick={() => navigate('/')}
          className="absolute top-6 left-6 sm:top-8 sm:left-8 flex items-center gap-2 text-slate-400 hover:text-teal-700 transition-colors font-semibold text-sm group"
          aria-label="Back to home page"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" aria-hidden="true" />
          Back to Home
        </button>


        <div className="flex lg:hidden items-center justify-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-full overflow-hidden">
            <img src={logo} alt="TranspiraFund" className="w-full h-full object-cover scale-[1.55]" />
          </div>
          <span className="font-bold text-slate-800 text-base tracking-tight">TranspiraFund</span>
        </div>

        <div className="max-w-md w-full mx-auto">
          <div className="mb-8 sm:mb-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-semibold tracking-widest uppercase mb-4">
              <Landmark size={12} />
              LGU Portal
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">Official Login</h2>
            <p className="text-slate-500 text-[15px]">Sign in with your government email address.</p>
          </div>

          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200/80 rounded-xl flex items-center gap-3 text-red-700" role="alert">
              <AlertCircle size={18} className="shrink-0" aria-hidden="true" />
              <span className="text-sm font-semibold">{authError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                Official Email
              </label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors" aria-hidden="true">
                  <Mail size={18} />
                </div>
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`w-full pl-12 pr-4 py-3.5 bg-[#F8FAFC] border rounded-xl focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400
                    ${fieldErrors.email ? 'border-red-300 focus:border-red-500 bg-red-50/50' : 'border-slate-200 focus:border-teal-600'}`}
                  placeholder="name@lgu.gov.ph"
                  autoComplete="email"
                  aria-invalid={fieldErrors.email ? 'true' : 'false'}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                />
              </div>
              {fieldErrors.email && (
                <p id="email-error" className="text-xs text-red-600 font-semibold ml-1" role="alert">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                Password
              </label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-700 transition-colors" aria-hidden="true">
                  <Lock size={18} />
                </div>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className={`w-full pl-12 pr-12 py-3.5 bg-[#F8FAFC] border rounded-xl focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-slate-800 text-[15px] placeholder:text-slate-400
                    ${fieldErrors.password ? 'border-red-300 focus:border-red-500 bg-red-50/50' : 'border-slate-200 focus:border-teal-600'}`}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  aria-invalid={fieldErrors.password ? 'true' : 'false'}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {fieldErrors.password && (
                <p id="password-error" className="text-xs text-red-600 font-semibold ml-1" role="alert">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full font-bold py-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 mt-2 text-[15px]
                ${isLoading
                  ? 'bg-teal-500 cursor-wait shadow-teal-500/20'
                  : 'bg-teal-700 hover:bg-teal-800 hover:-translate-y-0.5 active:translate-y-0 shadow-teal-700/20 hover:shadow-lg hover:shadow-teal-700/20'
                } text-white`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                  Authenticating...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-10 text-center">
            <p className="text-xs text-slate-400 font-semibold tracking-wide uppercase flex items-center justify-center gap-2">
              <ShieldCheck size={13} className="text-teal-700" aria-hidden="true" />
              Secured by TranspiraFund
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;