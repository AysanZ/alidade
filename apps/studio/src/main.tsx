import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

/**
 * One place for how the application talks to its server.
 *
 * The defaults are chosen for a desktop tool that sits open for hours next to
 * a database somebody else may also be writing to, which is not the same shape
 * as a page someone visits for thirty seconds.
 */
const client = new QueryClient({
  defaultOptions: {
    queries: {
      // The registry changes when *this* user imports something, which the
      // import mutations invalidate explicitly. A background poll on top of
      // that is a query per minute answering a question nobody asked.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A tile server under load drops a request now and then, and one silent
      // retry covers it. Three turns a genuine 500 into a four second wait.
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
