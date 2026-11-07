// Vite `?raw` imports of the two Warm_Up_Prompt files.
declare module '*.txt?raw' {
  const text: string;
  export default text;
}
