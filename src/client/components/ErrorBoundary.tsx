import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[Madura AI ErrorBoundary]', error, errorInfo);

    // Record in diagnostic logs
    if (typeof window !== 'undefined') {
      const logs = (window as any).__STARTUP_LOGS__ || [];
      logs.push({
        type: 'REACT_ERROR',
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
      });
      (window as any).__STARTUP_LOGS__ = logs;
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    if (confirm('Reset application data and reload? Your chat history in this browser/device will be cleared.')) {
      try {
        localStorage.clear();
      } catch (e) {
        console.error(e);
      }
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          width: '100vw',
          backgroundColor: '#0a0a0a',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          boxSizing: 'border-box',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          textAlign: 'center',
        }}>
          <div style={{
            maxWidth: '460px',
            width: '100%',
            backgroundColor: '#141414',
            border: '1px solid #262626',
            borderRadius: '16px',
            padding: '28px 24px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: '#ef4444',
            }}>
              <AlertTriangle size={28} />
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: '#f3f4f6' }}>
              Something went wrong
            </h2>

            <p style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '20px', lineHeight: '1.5' }}>
              Madura AI encountered an unexpected error while rendering this view. You can safely reload the application.
            </p>

            {this.state.error && (
              <div style={{
                backgroundColor: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                color: '#ef4444',
                textAlign: 'left',
                marginBottom: '20px',
                overflowX: 'auto',
                fontFamily: 'monospace',
              }}>
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
              <button
                onClick={this.handleReload}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  backgroundColor: '#3b82f6',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px 18px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <RefreshCw size={16} />
                <span>Reload Madura AI</span>
              </button>

              <button
                onClick={this.handleReset}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  backgroundColor: '#262626',
                  color: '#9ca3af',
                  border: '1px solid #333333',
                  borderRadius: '10px',
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <Trash2 size={15} />
                <span>Reset Data & Reload</span>
              </button>

              <button
                onClick={() => this.setState({ showDetails: !this.state.showDetails })}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '6px',
                  marginTop: '6px',
                }}
              >
                <span>Diagnostic details</span>
                {this.state.showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {this.state.showDetails && (
              <pre style={{
                marginTop: '14px',
                maxHeight: '180px',
                overflowY: 'auto',
                fontSize: '11px',
                color: '#9ca3af',
                backgroundColor: '#0f0f0f',
                padding: '10px',
                borderRadius: '8px',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {this.state.error?.stack || 'No stack trace available'}
                {this.state.errorInfo?.componentStack}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
