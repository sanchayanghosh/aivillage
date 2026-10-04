import React from "react";
import { createRoot } from "react-dom/client";
import Workbench from "./graph/Workbench";
import Landing from "./landing/Landing";
import ErrorBoundary from "./ErrorBoundary";
import "./styles.css";

// "/" is the landing page; "/app" is the workbench (empty until you import a transcript).
const isApp = location.pathname.replace(/\/$/, "") === "/app";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ErrorBoundary>{isApp ? <Workbench /> : <Landing />}</ErrorBoundary></React.StrictMode>,
);
