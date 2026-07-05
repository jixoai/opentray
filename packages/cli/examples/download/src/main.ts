import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app root not found");
}

const app = mount(App, { target: root });

export default app;
