import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  readonly fallback: ReactNode
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  readonly hasFailed: boolean
}

/**
 * Catches a render that throws, so a report that passed the shape check yet
 * is wrong deeper down costs its own view and not the page. React offers no
 * hook for this, which is the only reason this is a class.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasFailed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasFailed: true }
  }

  override render(): ReactNode {
    return this.state.hasFailed ? this.props.fallback : this.props.children
  }
}
