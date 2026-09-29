/**
 * ErrorBoundary.jsx – Phase-level fault isolation for MOCK PRO.
 *
 * Wraps any child component/phase. On error it renders a styled
 * fallback card ("Phase Error – Click to Retry") WITHOUT crashing
 * the global header, navigation, or InterviewContext state.
 *
 * Usage:
 *   <ErrorBoundary phase="Coding IDE">
 *     <CodingPhase />
 *   </ErrorBoundary>
 */

import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught phase error:', error, errorInfo);
    this.setState({ errorInfo });
    // Future: send to monitoring service (Sentry, etc.)
  }

  handleRetry() {
    this.setState({ hasError: false, error: null, errorInfo: null });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const phaseName = this.props.phase ?? 'Phase';
    const isDev = import.meta.env.DEV;

    return (
      <div className="flex items-center justify-center min-h-[400px] p-6 animate-fade-in">
        <div className="max-w-md w-full">
          {/* Error card */}
          <div className="relative overflow-hidden rounded-2xl border border-red-500/30 bg-surface-800 shadow-glass p-8 text-center">
            {/* Glow backdrop */}
            <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 to-transparent pointer-events-none" />

            {/* Icon */}
            <div className="relative mx-auto mb-5 w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>

            {/* Title */}
            <h2 className="relative text-xl font-bold text-white mb-2">
              {phaseName} Error
            </h2>

            {/* Subtitle */}
            <p className="relative text-sm text-gray-400 mb-1">
              Something went wrong in this phase.
            </p>
            <p className="relative text-xs text-gray-500 mb-6">
              Your progress and state are safe — only this module crashed.
            </p>

            {/* Dev error details */}
            {isDev && this.state.error && (
              <details className="relative mb-6 text-left rounded-lg bg-surface-900 border border-red-500/20 p-3" open>
                <summary className="text-xs font-mono text-red-400 cursor-pointer select-none">
                  Error details (dev only)
                </summary>
                <pre className="mt-2 text-xs text-gray-400 whitespace-pre-wrap break-all overflow-auto max-h-32 font-mono">
                  {this.state.error?.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            {/* Retry button */}
            <button
              id="error-boundary-retry-btn"
              onClick={this.handleRetry}
              className="relative inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm
                         bg-brand-gradient text-white shadow-brand-sm
                         hover:shadow-brand-md hover:scale-105
                         active:scale-95
                         transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            >
              <RefreshCw className="w-4 h-4" />
              Click to Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
