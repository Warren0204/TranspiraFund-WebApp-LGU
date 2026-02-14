import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import AuthService from '../../services/AuthService';
import logo from '../../assets/logo.png';

// --- 🧠 LOGIC LAYER (Custom Hook) ---
// Decouples Business Logic from Presentation (Separation of Concerns)
const useLoginLogic = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({}); // For inline validation

  // 🚦 Traffic Controller Logic
  const getRouteByRole = (role) => {
    const safeRole = role?.toUpperCase() || '';
    switch (safeRole) {
      case 'MIS': return '/admin/dashboard';
      case 'MAYOR': return '/mayor/dashboard';
      case 'DEPW': return '/depw/dashboard';
      case 'CPDO': return '/cpdo/dashboard';
      default:

        return '/unauthorized';
    }
  };

  const loginUser = async (email, password) => {
    // 1. Strict Input Traps (Validation)
    const errors = {};
    if (!email.trim()) errors.email = "Official Email is required";
    if (!password) errors.password = "Secure credential is required";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setAuthError('');
      return;
    }

    setFieldErrors({});
    setAuthError('');
    setIsLoading(true);

    try {
      // 2. Centralized Authentication via Service
      const { user, role } = await AuthService.login(email, password);

      // 3. Authorization (Route Determination)
      const targetRoute = getRouteByRole(role);

      if (targetRoute === '/unauthorized') {

        setAuthError("Access Denied. Unauthorized Role.");
        return;
        // Note: In strict systems, we might route them anyway or show a specific error.
        // For now, staying on page with error is better UX than redirecting to a 403 page.
      }

      // 4. Secure Hand-off (Redirect to OTP)
      navigate('/verify-identity', {
        state: { email: user.email, targetPath: targetRoute },
        replace: true
      });

    } catch (err) {

      // AuthService throws user-friendly errors
      setAuthError(err.message || "Access Denied. Verification failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return { loginUser, isLoading, authError, fieldErrors, setAuthError };
};

// --- 🎨 UI LAYER (Presentation) ---
const Login = () => {
  const navigate = useNavigate();
  const { loginUser, isLoading, authError, fieldErrors } = useLoginLogic();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLoading) return; // Enforce Idempotency
    loginUser(formData.email, formData.password);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="min-h-screen flex font-sans text-slate-800 bg-slate-50">

      {/* LEFT SIDE: Visual Branding */}
      <div className="hidden lg:flex w-1/2 bg-blue-600 relative flex-col items-center justify-center text-white p-12 overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mb-8 shadow-inner border border-white/30 overflow-hidden p-1">
            <img src={logo} alt="Seal" className="w-full h-full rounded-full object-cover" />
          </div>
          <h1 className="text-4xl font-bold mb-4 tracking-tight">Secure Access<br />Portal</h1>
          <p className="max-w-md text-blue-100 text-lg leading-relaxed opacity-90 font-medium">
            Strict Role-Based Access Control (RBAC).<br />Authorized LGU Personnel Only.
          </p>
        </div>
      </div>

      {/* RIGHT SIDE: Login Form */}
      <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center px-8 md:px-24 relative">

        {/* Back Button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-8 left-8 flex items-center gap-2 text-slate-400 hover:text-blue-600 transition-colors font-semibold text-sm group"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </button>

        <div className="max-w-md w-full mx-auto">

          {/* Header Section */}
          <div className="mb-10">
            <h2 className="text-3xl font-bold text-slate-900 mb-2">Official Login</h2>
            <p className="text-slate-500">Sign in with your government email address.</p>
          </div>

          {/* Top Level Error (Access Denied) */}
          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={20} className="shrink-0" />
              <span className="text-sm font-semibold">{authError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Email Field */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                Official Email
              </label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                  <Mail size={20} />
                </div>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`w-full pl-12 pr-4 py-3.5 bg-slate-50 border rounded-xl focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-medium text-slate-800 placeholder:text-slate-400
                    ${fieldErrors.email ? 'border-red-300 focus:border-red-500 bg-red-50/50' : 'border-slate-200 focus:border-blue-500'}
                  `}
                  placeholder="name@lgu.gov.ph"
                />
              </div>
              {/* Inline Validation Error */}
              {fieldErrors.email && (
                <p className="text-xs text-red-500 font-bold ml-1 animate-in slide-in-from-top-1">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                Password
              </label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                  <Lock size={20} />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className={`w-full pl-12 pr-12 py-3.5 bg-slate-50 border rounded-xl focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-medium text-slate-800 placeholder:text-slate-400
                    ${fieldErrors.password ? 'border-red-300 focus:border-red-500 bg-red-50/50' : 'border-slate-200 focus:border-blue-500'}
                  `}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {/* Inline Validation Error */}
              {fieldErrors.password && (
                <p className="text-xs text-red-500 font-bold ml-1 animate-in slide-in-from-top-1">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full font-bold py-4 rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 mt-4
                ${isLoading
                  ? 'bg-blue-400 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0'
                } text-white`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Authenticate'
              )}
            </button>
          </form>

          <div className="mt-12 text-center">
            <p className="text-xs text-slate-400 font-bold tracking-wide uppercase flex items-center justify-center gap-2">
              <Lock size={12} />
              Secured by TranspiraFund Infrastructure
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;