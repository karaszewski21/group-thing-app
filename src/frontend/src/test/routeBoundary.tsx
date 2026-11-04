import { Component, type ComponentType, type ReactNode } from "react";
import { NotFoundSentinel } from "./navigationMock";

interface RouteBoundaryProps {
  NotFound: ComponentType;
  ErrorPage: ComponentType<{ error: Error; reset: () => void }>;
  children: ReactNode;
}

/** A route's `error.tsx` and `not-found.tsx` boundaries as Next nests them
 * around its `page.tsx`. */
export class RouteBoundary extends Component<RouteBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    const { NotFound, ErrorPage, children } = this.props;
    if (error === null) return children;
    if (error instanceof NotFoundSentinel) return <NotFound />;
    return <ErrorPage error={error} reset={() => this.setState({ error: null })} />;
  }
}
