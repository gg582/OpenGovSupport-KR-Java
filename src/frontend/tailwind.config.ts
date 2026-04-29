import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#1A3258",
          50: "#F1F4F9",
          100: "#E2E8F2",
          200: "#C2CDE0",
          900: "#1A3258",
        },
        accent: {
          DEFAULT: "#005BAB",
          hover: "#004A8C",
          50: "#E5F0FA",
          100: "#CCE0F5",
        },
        page: "#F8F9FA",
        line: "#D1D5DB",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Roboto",
          "\"Helvetica Neue\"",
          "\"Apple SD Gothic Neo\"",
          "\"Noto Sans KR\"",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        tighter: "-0.02em",
        tight: "-0.01em",
      },
      fontSize: {
        xs: ["11px", "16px"],
        sm: ["13px", "20px"],
        base: ["14px", "22px"],
        lg: ["16px", "24px"],
        xl: ["18px", "26px"],
        "2xl": ["22px", "30px"],
      },
      boxShadow: {
        focus: "0 0 0 2px #005BAB",
      },
    },
  },
  plugins: [],
};

export default config;
