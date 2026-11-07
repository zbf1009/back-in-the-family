// Node's typings omit the WebAssembly global (lib has no DOM here); only the
// error class that simwasm.ts must recognise is declared.
declare namespace WebAssembly {
  class RuntimeError extends Error {
    constructor(message?: string);
  }
}
