import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./scss/default/_index.scss";
import "./scss/default/_reset.scss"
import { initializeAccentTheme } from "./theme/accentTheme";
import { ToastProvider } from "./components/Toast/ToastProvider";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

initializeAccentTheme();

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
