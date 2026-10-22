/// <reference types="vite/client" />
/// <reference types="@react-router/node" />
/// <reference path="./worker-configuration.d.ts" />

declare module "virtual:react-router/server-build" {
  const serverBuild: import("react-router").ServerBuild;
  export default serverBuild;
}
