export { type InjectedAdapterOptions, injectedAdapter } from "./injected.js";
export type { WalletAdapter, WalletConnection } from "./types.js";
// web3authAdapter is intentionally NOT re-exported here. It lives behind the
// `@avakit/core/web3auth` subpath so `@avakit/core` stays free of the optional
// `@web3auth/modal` dependency. See src/web3auth.ts.
