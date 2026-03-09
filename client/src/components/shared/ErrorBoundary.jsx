import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
                    <div className="max-w-md w-full text-center">
                        <div className="w-16 h-16 bg-red-50 border border-red-200/60 rounded-2xl flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle size={28} className="text-red-600" />
                        </div>
                        <h1 className="text-2xl font-extrabold text-slate-800 mb-2">Something went wrong</h1>
                        <p className="text-slate-500 text-[15px] mb-6">
                            An unexpected error occurred. Please refresh the page.
                            If the problem persists, contact system administration.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white font-bold px-6 py-3 rounded-xl transition-colors"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
