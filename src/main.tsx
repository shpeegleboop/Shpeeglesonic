import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

/**
 * Without a boundary, any render error unmounts the whole tree and the window
 * goes black with nothing to go on — not even which component threw. That
 * turned a one-line bug (a persisted browsePath holding a non-groupable field)
 * into a full debugging session, so the diagnostic stayed.
 *
 * Reset clears persisted UI state, because the realistic cause of a crash on
 * launch is bad data in localStorage rather than a bad build.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('Render error:', err, info.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;

    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl text-white">Something broke</h1>
        <pre className="max-w-2xl max-h-64 overflow-auto text-left text-xs text-gray-400 bg-black/40 border border-cosmic-border/50 rounded-lg p-3 whitespace-pre-wrap">
          {this.state.err.name}: {this.state.err.message}
          {'\n\n'}
          {String(this.state.err.stack).slice(0, 900)}
        </pre>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-lg bg-neon-purple/20 text-white hover:bg-neon-purple/30 transition-colors"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors"
            onClick={() => {
              localStorage.removeItem('shpeeglesonic-player');
              window.location.reload();
            }}
          >
            Reset saved view and reload
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
