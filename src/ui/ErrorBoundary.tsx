import { Component, type ReactNode } from "react";

/** Keeps one broken panel from blanking the whole studio. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) { console.error("UI error:", error.message, error.stack, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, font: "14px system-ui", maxWidth: 640, margin: "10vh auto" }}>
        <h2>Something broke in the workbench.</h2>
        <p style={{ color: "#555" }}>{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })}>Try again</button> <a href="/app">Reload</a>
      </div>
    );
  }
}
