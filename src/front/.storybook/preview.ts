import type { Preview } from "@storybook/react";
import "../src/index.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => {
      // Same mechanism as the app: `dark` class + color-scheme on <html>.
      const dark = context.globals.theme === "dark";
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      return Story();
    },
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
