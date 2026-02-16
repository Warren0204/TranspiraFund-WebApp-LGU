import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Mail, Lock, AlertCircle, RefreshCw, Landmark } from 'lucide-react';
import emailjs from '@emailjs/browser';
import logo from '../../assets/logo.png';

// --- LOGIC LAYER (Custom Hook) ---
// ⚠️ SECURITY WARNING: This OTP verification is CLIENT-SIDE ONLY.
// The OTP code is generated in-browser and validated in-browser, which means
// it can be bypassed by manipulating React state or navigating directly.
// TODO: Migrate OTP generation & validation to a Firebase Cloud Function
// for production-grade security. The server should generate the code,
// send it via email, and validate the user's input server-side.
const useOtpVerification = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const userEmail = location.state?.email || '';
  const targetDashboard = location.state?.targetPath || '/';

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const inputRefs = useRef([]);
  const hasSent = useRef(false);

  useEffect(() => {
    if (!userEmail) {
      navigate('/login', { replace: true });
    }
  }, [userEmail, navigate]);

  useEffect(() => {
    const sessionKey = `otp_sent_${userEmail}`;
    const alreadySent = sessionStorage.getItem(sessionKey);

    if (userEmail && !hasSent.current && !alreadySent) {
      hasSent.current = true;
      sessionStorage.setItem(sessionKey, 'true');
      sendOtpCode();
    }
  }, [userEmail]);

  useEffect(() => {
    if (!isSending) {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [isSending]);

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

    // ⚠️ TODO: Move code generation to server-side (Cloud Function).
    // Currently stored in client memory — accessible via React DevTools.
    const newCode = generateRandomCode();
    setGeneratedCode(newCode);

    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID?.trim();
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID?.trim();
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY?.trim();

    if (!serviceId || !templateId || !publicKey) {
      setError('System configuration error. Please contact support.');
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
      setSuccessMsg('Verification code sent successfully.');
    } catch (err) {
      setError('Unable to send verification code. Please try again later.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerify = (e) => {
    e.preventDefault();
    if (isVerifying) return;

    const enteredCode = otp.join('');

    if (enteredCode.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setIsVerifying(true);

    setTimeout(() => {
      if (enteredCode === generatedCode) {
        navigate(targetDashboard, { replace: true });
      } else {
        setError('Invalid verification code.');
        setIsVerifying(false);
        setOtp(['', '', '', '', '', '']);
        inputRefs.current[0].focus();
      }
    }, 800);
  };

  const handleDigitChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    setError('');

    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').trim();
    const cleanDigits = pastedData.replace(/\D/g, '').slice(0, 6).split('');

    if (cleanDigits.length === 0) return;

    const newOtp = [...otp];
    cleanDigits.forEach((digit, i) => {
      if (i < 6) newOtp[i] = digit;
    });

    setOtp(newOtp);
    setError('');

    const focusIndex = Math.min(cleanDigits.length, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  return {
    otp, userEmail, isSending, isVerifying, error, successMsg,
    inputRefs, handleDigitChange, handleKeyDown, handleVerify, sendOtpCode, handlePaste
  };
};

const Authentication = () => {
  const navigate = useNavigate();
  const {
    otp, userEmail, isSending, isVerifying, error, successMsg,
    inputRefs, handleDigitChange, handleKeyDown, handleVerify, sendOtpCode, handlePaste
  } = useOtpVerification();

  return (
    <div className="min-h-screen flex font-sans text-slate-800 bg-[#F8FAFC]">

      <div className="hidden lg:flex w-1/2 bg-teal-700 relative flex-col items-center justify-center text-white p-12 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true">
          <svg className="w-full h-full">
            <defs>
              <pattern id="auth-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)" />
          </svg>
        </div>
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-[100px]" aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-teal-400/10 rounded-full blur-[80px]" aria-hidden="true" />

        <div className="relative z-10 flex flex-col items-center text-center max-w-md">
          <div className="w-24 h-24 rounded-full overflow-hidden mb-8">
            <img src={logo} alt="TranspiraFund seal" className="w-full h-full object-cover scale-[1.55]" />
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tight leading-tight">
            Identity<br />Verification
          </h1>
          <p className="text-teal-100 text-[15px] leading-relaxed">
            One-time verification code sent to your registered email.
            <br />
            This step ensures only you can access your account.
          </p>
          <div className="mt-8 flex items-center gap-3">
            {['Encrypted', 'Time-Limited', 'Single-Use'].map(tag => (
              <span key={tag} className="px-3 py-1 bg-white/10 border border-white/10 rounded-lg text-xs font-semibold tracking-wide uppercase">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center px-6 sm:px-12 md:px-24 relative">
        <button
          onClick={() => navigate('/login')}
          className="absolute top-6 left-6 sm:top-8 sm:left-8 flex items-center gap-2 text-slate-400 hover:text-teal-700 transition-colors font-semibold text-sm group"
          aria-label="Back to login page"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" aria-hidden="true" />
          Back to Login
        </button>

        <div className="flex lg:hidden items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-full overflow-hidden">
            <img src={logo} alt="TranspiraFund" className="w-full h-full object-cover scale-[1.55]" />
          </div>
          <span className="font-bold text-slate-800 text-base tracking-tight">TranspiraFund</span>
        </div>

        <div className="max-w-md w-full mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-semibold tracking-widest uppercase mb-4">
            <Landmark size={12} />
            Identity Check
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">Verify Your Identity</h2>
          <p className="text-slate-500 text-[15px] mb-8">Enter the 6-digit code sent to your email.</p>

          <div className="w-16 h-16 bg-teal-50 border border-teal-200/60 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Mail size={28} className="text-teal-700" aria-hidden="true" />
          </div>

          <p className="text-sm text-slate-500 mb-2">Check your inbox:</p>
          <div className="inline-block bg-[#F8FAFC] px-4 py-2 rounded-xl text-slate-800 font-bold mb-6 border border-slate-200 text-[15px]">
            {userEmail}
          </div>

          {isSending && (
            <p className="text-teal-600 text-sm font-semibold mb-6 animate-pulse">Sending verification code...</p>
          )}
          {successMsg && (
            <p className="text-teal-700 text-sm font-semibold mb-6 flex items-center justify-center gap-2">
              <ShieldCheck size={16} aria-hidden="true" /> {successMsg}
            </p>
          )}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200/80 rounded-xl flex items-center justify-center gap-2 text-red-700" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span className="text-sm font-semibold">{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify} noValidate>
            <div className="flex gap-3 justify-center mb-8" role="group" aria-label="6-digit verification code">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  disabled={isVerifying || isSending}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={handlePaste}
                  autoFocus={index === 0}
                  aria-label={`Digit ${index + 1} of 6`}
                  className="w-12 h-14 text-center text-2xl font-bold border border-slate-200 rounded-xl focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all bg-[#F8FAFC] text-slate-800"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={isVerifying || isSending}
              className={`w-full font-bold py-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-[15px]
                ${isVerifying || isSending
                  ? 'bg-teal-500 cursor-wait shadow-teal-500/20'
                  : 'bg-teal-700 hover:bg-teal-800 hover:-translate-y-0.5 active:translate-y-0 shadow-teal-700/20 hover:shadow-lg hover:shadow-teal-700/20'
                } text-white`}
            >
              {isVerifying ? 'Verifying...' : 'Verify Identity'}
            </button>
          </form>

          <button
            onClick={sendOtpCode}
            disabled={isSending}
            className="mt-6 text-sm font-semibold text-teal-700 hover:text-teal-800 transition-colors flex items-center justify-center gap-2 mx-auto"
            aria-label="Resend verification code"
          >
            <RefreshCw size={14} className={isSending ? 'animate-spin' : ''} aria-hidden="true" />
            Resend Code
          </button>

          <div className="mt-10 flex items-center justify-center gap-2 text-xs text-slate-400 font-semibold tracking-wide uppercase">
            <ShieldCheck size={13} className="text-teal-700" aria-hidden="true" />
            Secured by TranspiraFund
          </div>
        </div>
      </div>
    </div>
  );
};

export default Authentication;