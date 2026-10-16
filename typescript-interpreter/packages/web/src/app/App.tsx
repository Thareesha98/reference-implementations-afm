// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import type { ReactNode } from "react";
import { BrowserRouter, Outlet, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { ThemeProvider } from "./ThemeContext";
import { AgentsLibraryProvider } from "../agents/AgentsLibraryContext";
import { HistoryProvider } from "../history/HistoryContext";
import { PermissionsLedgerProvider } from "../permissions/PermissionsLedgerContext";
import { WorkspacePage } from "../pages/workspace/WorkspacePage";
import { Tip } from "./Tip";

function RootLayout() {
  return (
    <div className="root-shell">
      <div className="root-content">
        <Outlet />
      </div>
      <Tip />
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<WorkspacePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AgentsLibraryProvider>
        <HistoryProvider>
          <PermissionsLedgerProvider>{children}</PermissionsLedgerProvider>
        </HistoryProvider>
      </AgentsLibraryProvider>
    </ThemeProvider>
  );
}

export function RouterRoot() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Providers>
          <AppRoutes />
        </Providers>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
