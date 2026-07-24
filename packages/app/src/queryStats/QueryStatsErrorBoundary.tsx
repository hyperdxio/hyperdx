import React from 'react';

type Props = {
  children: React.ReactNode;
  // When this value changes, the boundary clears the error state so a
  // subsequent open can re-mount the panel after a crash.
  resetKey?: unknown;
};
type State = { hasError: boolean };

export class QueryStatsErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[QueryStats] panel crashed; hiding it', error, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
