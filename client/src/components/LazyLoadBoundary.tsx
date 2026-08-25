import { Component, type ErrorInfo, type ReactNode } from "react";

type LazyLoadBoundaryProps = {
  children: ReactNode;
};

type LazyLoadBoundaryState = {
  failed: boolean;
};

export default class LazyLoadBoundary extends Component<LazyLoadBoundaryProps, LazyLoadBoundaryState> {
  state: LazyLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyLoadBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, details: ErrorInfo): void {
    console.error("workspace_chunk_load_failed", {
      errorName: error.name,
      componentStack: details.componentStack
    });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="lazy-load-failure" role="alert">
        <div>
          <p className="eyebrow text-danger">Loading interrupted</p>
          <h1>Workspace could not be loaded</h1>
          <p>Check the connection, then reload this workspace. No order or form was submitted.</p>
          <button className="btn btn-danger" type="button" onClick={() => window.location.reload()}>
            Reload workspace
          </button>
        </div>
      </main>
    );
  }
}
