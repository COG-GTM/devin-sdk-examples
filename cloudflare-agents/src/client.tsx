import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Console } from "./console";
import { Toaster } from "./components/toaster";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Console />
      <Toaster />
    </StrictMode>,
  );
}
