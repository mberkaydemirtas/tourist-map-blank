module.exports = {
  "src/**/*.{js,jsx,ts,tsx}": ["npx eslint -c .eslintrc.cjs --fix", "npx prettier -w"],
  "src/**/*.{json,md}": ["npx prettier -w"]
};
