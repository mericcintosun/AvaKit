/**
 * Optional Web3Auth (social-login) entry point.
 *
 * Exposed as a separate subpath (`@avakit/core/web3auth`) so that importing
 * `@avakit/core` never pulls in the optional `@web3auth/modal` dependency.
 * Only consumers that opt into social login import this module — and they
 * install `@web3auth/modal` themselves.
 */

export { type Web3AuthAdapterOptions, web3authAdapter } from "./adapters/web3auth.js";
