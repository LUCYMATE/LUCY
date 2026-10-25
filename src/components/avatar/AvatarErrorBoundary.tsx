import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useAvatarState } from '../../lib/store/avatarState';
import { AlertTriangle, RotateCcw, Box, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface AvatarErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

interface AvatarErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  showDetails: boolean;
}

export class AvatarErrorBoundary extends Component<AvatarErrorBoundaryProps, AvatarErrorBoundaryState> {
  private unsubStore?: () => void;
  private copyTimeout?: ReturnType<typeof setTimeout>;

  constructor(props: AvatarErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<AvatarErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[AvatarErrorBoundary] Caught avatar rendering or lifecycle error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidMount(): void {
    // Automatically reset error boundary if the avatar engine is switched elsewhere in the app
    let prevEngine = useAvatarState.getState().avatarEngine;
    this.unsubStore = useAvatarState.subscribe((state) => {
      if (state.avatarEngine !== prevEngine) {
        prevEngine = state.avatarEngine;
        if (this.state.hasError) {
          this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
            copied: false,
          });
        }
      }
    });
  }

  componentWillUnmount(): void {
    if (this.unsubStore) {
      this.unsubStore();
    }
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
    }
  }

  handleSwitchToVrm = (): void => {
    try {
      useAvatarState.getState().setAvatarEngine('vrm');
    } catch (err) {
      console.error('[AvatarErrorBoundary] Failed to switch avatar engine to VRM:', err);
    }
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  handleCopyDetails = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    const textToCopy = [
      `[Avatar Engine Error]`,
      `Message: ${error?.message || 'Unknown error'}`,
      `Stack: ${error?.stack || 'No error stack'}`,
      `Component Stack: ${errorInfo?.componentStack || 'No component stack'}`,
    ].join('\n\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      this.setState({ copied: true });
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => {
        this.setState({ copied: false });
      }, 2000);
    } catch (e) {
      console.warn('[AvatarErrorBoundary] Failed to copy error details to clipboard', e);
    }
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, copied, showDetails } = this.state;

    if (!hasError) {
      return this.props.children;
    }

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback(error || new Error('Unknown error'), this.handleRetry);
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const currentEngine = useAvatarState.getState().avatarEngine;
    const componentStack = errorInfo?.componentStack?.trim();
    const errorStack = error?.stack?.trim();

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none select-none">
        {/* Dark glassmorphism modal with Lucy's pink/purple accents */}
        <div className="pointer-events-auto w-full max-w-lg bg-[#0d0d12]/92 backdrop-blur-2xl border border-pink-500/30 rounded-2xl p-6 shadow-[0_0_60px_rgba(236,72,153,0.25)] text-zinc-100 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header */}
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 shrink-0 shadow-[0_0_16px_rgba(236,72,153,0.3)]">
              <AlertTriangle className="w-5 h-5 text-pink-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold bg-gradient-to-r from-pink-400 via-purple-300 to-indigo-300 bg-clip-text text-transparent">
                  Avatar Engine Notice
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-pink-500/20 border border-pink-500/30 text-pink-300">
                  {currentEngine.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                The avatar rendering engine encountered an unexpected error.
              </p>
            </div>
          </div>

          {/* Error Message Box */}
          <div className="bg-black/60 border border-pink-500/20 rounded-xl p-3 flex flex-col gap-1.5 shadow-inner">
            <span className="text-[11px] font-semibold text-pink-400/90 uppercase tracking-wider">
              Error Message
            </span>
            <p className="text-xs text-pink-100/90 font-mono break-words leading-relaxed select-text">
              {error?.message || 'An unknown error occurred while rendering the avatar.'}
            </p>
          </div>

          {/* Component Stack & Technical Details (Collapsible) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <button
                type="button"
                onClick={this.toggleDetails}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-pink-300 transition-colors cursor-pointer pointer-events-auto"
              >
                {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span>{showDetails ? 'Hide Details & Stack' : 'Show Component Stack'}</span>
              </button>

              <button
                type="button"
                onClick={this.handleCopyDetails}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors cursor-pointer pointer-events-auto"
                title="Copy error details to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-green-400" />
                    <span className="text-green-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Error</span>
                  </>
                )}
              </button>
            </div>

            {showDetails && (
              <div className="animate-in fade-in duration-150 flex flex-col gap-2 mt-1">
                {componentStack && (
                  <div>
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                      Component Stack:
                    </span>
                    <pre className="max-h-28 overflow-y-auto text-[11px] leading-relaxed p-2.5 bg-black/70 rounded-lg text-zinc-300 font-mono border border-zinc-800 settings-scrollbar select-text whitespace-pre-wrap">
                      {componentStack}
                    </pre>
                  </div>
                )}
                {errorStack && (
                  <div>
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                      Call Stack:
                    </span>
                    <pre className="max-h-28 overflow-y-auto text-[11px] leading-relaxed p-2.5 bg-black/70 rounded-lg text-zinc-400 font-mono border border-zinc-800 settings-scrollbar select-text whitespace-pre-wrap">
                      {errorStack}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={this.handleSwitchToVrm}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 hover:from-pink-600 hover:via-purple-700 hover:to-indigo-700 text-white font-medium text-xs sm:text-sm shadow-[0_0_20px_rgba(236,72,153,0.35)] flex items-center justify-center gap-2 cursor-pointer transition-all duration-200 active:scale-95 border border-pink-400/40 pointer-events-auto"
            >
              <Box className="w-4 h-4 text-pink-200" />
              <span>Switch to 3D VRM Model</span>
            </button>

            <button
              type="button"
              onClick={this.handleRetry}
              className="py-2.5 px-4 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 hover:text-white font-medium text-xs sm:text-sm border border-zinc-700/80 hover:border-pink-500/40 flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 active:scale-95 pointer-events-auto"
            >
              <RotateCcw className="w-4 h-4 text-zinc-400 group-hover:text-white" />
              <span>Retry</span>
            </button>
          </div>

        </div>
      </div>
    );
  }
}

export default AvatarErrorBoundary;
