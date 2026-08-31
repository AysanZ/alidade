import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * A crash in one component should not be a black screen.
 *
 * React unmounts the entire tree when a render throws, so a bad row in the
 * attribute table took the map, the panels and the only way to recover with it.
 * The map itself is fine in that situation; what is needed is somewhere to read
 * what happened and a way back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[alidade] a component threw during render", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div>
          <b>Something in the interface stopped working</b>
          <p>
            The map itself is usually fine; this is the panel around it. If this started after
            pulling new code, the API container is probably older than the studio:
          </p>
          <pre>docker compose --env-file .env -f deploy/docker-compose.yml up -d --build api</pre>
          <p className="detail">{error.message}</p>
          <div className="row buttons">
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
