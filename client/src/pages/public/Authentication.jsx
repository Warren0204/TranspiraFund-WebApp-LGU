import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Mail, Lock, AlertCircle, RefreshCw } from 'lucide-react';
import emailjs from '@emailjs/browser';
import logo from '../../assets/logo.png';

// --- LOGIC LAYER (Custom Hook) ---

const useOtpVerification = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // 1. Data Retrieval
  const userEmail = location.state?.email || '';
  const targetDashboard = location.state?.targetPath || '/';

  // 2. State Management (Secure & Minimal)
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const inputRefs = useRef([]);
  const hasSent = useRef(false);

  // 3. Security Redirect: Zero-Trust for empty state
  useEffect(() => {
    if (!userEmail) {
      navigate('/login', { replace: true });
    }
  }, [userEmail, navigate]);

  // 4. Auto-Send OTP (Idempotent: runs once per session/mount)
  useEffect(() => {
    const sessionKey = `otp_sent_${userEmail}`;
    const alreadySent = sessionStorage.getItem(sessionKey);

    if (userEmail && !hasSent.current && !alreadySent) {
      hasSent.current = true;
      sessionStorage.setItem(sessionKey, 'true'); // Persist across StrictMode remounts
      sendOtpCode();
    }

    // Cleanup on unmount not needed for this logic, but we want to allow resends manually
  }, [userEmail]);

  // --- BUSINESS LOGIC ---

  const generateRandomCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const sendOtpCode = async () => {
    setIsSending(true);
    setError('');
    setSuccessMsg('');

    // Clear session lock allows valid re-sends if manually triggered? 
    // Actually, manual trigger bypasses the useEffect check, so it's fine.
    // But let's be safe and update the timestamp or similar if we wanted complex logic.
    // For now, simple is better.

    // Generate Code in memory
    const newCode = generateRandomCode();
    setGeneratedCode(newCode);

    // Securely fetch config (Without logging them)
    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID?.trim();
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID?.trim();
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY?.trim();

    if (!serviceId || !templateId || !publicKey) {
      // Generic error for user, suppression of technical details
      setError("System Configuration Error. Please contact support.");
      setIsSending(false);
      return;
    }

    try {
      await emailjs.send(
        serviceId,
        templateId,
        {
          to_email: userEmail,
          email: userEmail,
          otp_code: newCode,
        },
        publicKey
      );

      setSuccessMsg(`Verification code sent successfully.`);
    } catch (err) {
      // Information Hiding: Do not expose raw error objects to console or UI
      // We catch the error but show a sanitized message to the user
      setError("Unable to send verification code. Please try again later.");
    } finally {
      setIsSending(false);
    }
  };

  const handleVerify = (e) => {
    e.preventDefault();
    if (isVerifying) return; // Prevent double-submission

    const enteredCode = otp.join('');

    // Strict Validation
    if (enteredCode.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setIsVerifying(true);

    // Simulate verification delay for UX feedback
    setTimeout(() => {
      if (enteredCode === generatedCode) {
        navigate(targetDashboard, { replace: true });
      } else {
        setError('Invalid Verification Code.');
        setIsVerifying(false);
        setOtp(['', '', '', '', '', '']); // Clear sensitive input on fail
        inputRefs.current[0].focus();
      }
    }, 800);
  };

  // --- INPUT HANDLERS (Regex Allowlisting) ---
  const handleDigitChange = (index, value) => {
    // Constraint: Only allow numeric digits
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    setError('');

    // Auto-focus next input
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Paste Handler (Efficiency UX)
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').trim();

    // Clean & Validate: Only digits, max 6
    const cleanDigits = pastedData.replace(/\D/g, '').slice(0, 6).split('');

    if (cleanDigits.length === 0) return;

    const newOtp = [...otp];
    cleanDigits.forEach((digit, i) => {
      if (i < 6) newOtp[i] = digit;
    });

    setOtp(newOtp);
    setError('');

    // Focus logic: Focus the input after the last pasted digit
    const focusIndex = Math.min(cleanDigits.length, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  return {
    otp, userEmail, isSending, isVerifying, error, successMsg,
    inputRefs, handleDigitChange, handleKeyDown, handleVerify, sendOtpCode, handlePaste
  };
};

// --- UI LAYER (Pure & decoupled) ---

const Authentication = () => {
  const navigate = useNavigate();
  const {
    otp, userEmail, isSending, isVerifying, error, successMsg,
    inputRefs, handleDigitChange, handleKeyDown, handleVerify, sendOtpCode, handlePaste
  } = useOtpVerification();

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

      {/* RIGHT SIDE: Interactive Form */}
      <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center px-8 md:px-24 relative">
        <button onClick={() => navigate('/login')} className="absolute top-10 left-10 flex items-center gap-2 text-slate-400 hover:text-slate-600 transition-colors text-sm font-semibold">
          <ArrowLeft size={18} />
          Back to Login
        </button>

        <div className="max-w-md w-full mx-auto text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Verify Identity</h2>
          <p className="text-slate-500 mb-8">Enter the 6-digit code sent to your email.</p>

          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse">
            <Mail size={32} className="text-blue-600" />
          </div>

          <p className="text-sm text-slate-500 mb-2">Check your inbox:</p>
          <div className="inline-block bg-slate-100 px-4 py-2 rounded-lg text-slate-800 font-bold mb-6 border border-slate-200">
            {userEmail}
          </div>

          {/* STATUS MESSAGES (Sanitized) */}
          {isSending && (
            <p className="text-blue-500 text-sm font-semibold mb-6 animate-pulse">Sending OTP Email...</p>
          )}
          {successMsg && (
            <p className="text-green-600 text-sm font-semibold mb-6 flex items-center justify-center gap-2">
              <ShieldCheck size={16} /> {successMsg}
            </p>
          )}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-center justify-center gap-2 text-red-600 animate-in fade-in">
              <AlertCircle size={18} />
              <span className="text-sm font-semibold">{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify}>
            <div className="flex gap-3 justify-center mb-8">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  maxLength={1}
                  value={digit}
                  disabled={isVerifying || isSending}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={handlePaste}
                  autoFocus={index === 0}
                  className="w-12 h-14 text-center text-2xl font-bold border border-slate-300 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all bg-white text-slate-700"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={isVerifying || isSending}
              className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2
                ${isVerifying || isSending
                  ? 'bg-blue-400 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0 shadow-blue-600/20'
                } text-white`}
            >
              {isVerifying ? 'Verifying...' : 'Verify Identity'}
            </button>
          </form>

          <button
            onClick={sendOtpCode}
            disabled={isSending}
            className="mt-6 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors flex items-center justify-center gap-2 mx-auto"
          >
            <RefreshCw size={14} className={isSending ? "animate-spin" : ""} />
            Resend Code
          </button>

          <div className="mt-12 flex items-center justify-center gap-2 text-xs text-slate-400 font-bold tracking-wide uppercase">
            <Lock size={12} />
            SECURED BY TRANSPIRAFUND INFRASTRUCTURE
          </div>
        </div>
      </div>
    </div>
  );
};

export default Authentication;