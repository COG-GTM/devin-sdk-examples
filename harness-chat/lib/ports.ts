/** Sandbox ports. Shared by server (sandbox creation, probing) and client (Preview panel). */

/** The harness bridge listens here; pinned so the preview ports stay free. */
export const BRIDGE_PORT = 4000;

/**
 * Sandbox ports have to be declared up front, so these common dev-server
 * ports are opened on every sandbox; whatever Devin serves on any of them
 * shows in the Preview panel.
 */
export const PREVIEW_PORTS = [3000, 5173, 8000, 8080] as const;
