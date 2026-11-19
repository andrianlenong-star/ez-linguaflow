import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Terjadi kesalahan tak terduga pada antarmuka aplikasi.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('EduZone LinguaFlow UI ErrorBoundary:', error, info);
  }

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div
            role="alert"
            className="max-w-md w-full rounded-2xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-sm"
          >
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">
                Aplikasi Mengalami Gangguan Sementara
              </h1>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Muat Ulang Aplikasi</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
