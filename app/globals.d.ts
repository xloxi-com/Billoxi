declare module "*.css";
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
declare module "*.png" {
  const src: string;
  export default src;
}
