declare module "libfx/browser" {
  export function supportsJspi(): boolean;
  export function createFxAgent(options: object): Promise<unknown>;
}
