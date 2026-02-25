module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/lib", "<rootDir>/server"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};
