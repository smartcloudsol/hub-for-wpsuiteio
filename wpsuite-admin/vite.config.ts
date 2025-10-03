import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import basicSsl from "@vitejs/plugin-basic-ssl";
//import tailwindcss from "@tailwindcss/vite";

console.log("PREMIUM BUILD:", process.env.WPSUITE_PREMIUM === "true");

export default defineConfig({
  plugins: [react(), basicSsl() /*, tailwindcss()*/],
  define: {
    global: {},
    "process.env": {},
  },
});
