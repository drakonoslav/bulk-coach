module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/lib"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};
