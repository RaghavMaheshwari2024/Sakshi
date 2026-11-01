import React from 'react';
import { Button, EmptyState } from './ui';

interface Props {
  children: React.ReactNode;
  /** Changing this clears the error (e.g. moving to another view). */
  resetKey?: unknown;
  title?: string;
  detail?: string;
}

/** A failed panel says so and leaves the rest of the workspace working. */
export class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        title={this.props.title ?? 'This view hit an error'}
        action={<Button size="sm" onClick={() => this.setState({ error: null })}>Try again</Button>}
      >
        {this.props.detail ?? this.state.error.message}
      </EmptyState>
    );
  }
}
