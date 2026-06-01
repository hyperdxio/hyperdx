import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class QueryStatsErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[QueryStats] panel crashed; hiding it', error, info);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
