import { describe, expect, it, vi } from "vitest";
import { buildRockySessionOptions } from "../src/runtime/pi-runtime.js";

/**
 * The client host and the CLI must not diverge on discovery or trust. Asserting
 * on the options value keeps this offline and keeps the seam below the policy:
 * injecting a fake session factory would delete the very code under test.
 */
describe("Rocky session options", () => {
  const base = {
    cwd: "/work",
    agentDir: "/home/user/.rocky/agent",
    resolveTrust: async () => false,
  };

  it("disables the harness's general skill discovery", () => {
    expect(buildRockySessionOptions(base).resourceLoaderOptions.noSkills).toBe(true);
  });

  it("installs Rocky's private-storage and skill-discovery extensions", () => {
    const names = buildRockySessionOptions(base).resourceLoaderOptions.extensionFactories.map((e) => e.name);
    expect(names).toEqual(["rocky-private-session-storage", "rocky-skill-discovery"]);
  });

  it("keeps both extensions hidden from user-facing listings", () => {
    for (const extension of buildRockySessionOptions(base).resourceLoaderOptions.extensionFactories) {
      expect((extension as { hidden?: boolean }).hidden).toBe(true);
    }
  });

  // Without this wiring the extensions' project_trust handler is never
  // consulted and every project silently reads as untrusted.
  it("wires trust resolution through to the caller", async () => {
    const resolveTrust = vi.fn(async () => true);
    const options = buildRockySessionOptions({ ...base, resolveTrust });
    const trusted = await options.resourceLoaderReloadOptions.resolveProjectTrust({
      extensionsResult: { marker: true },
    });
    expect(trusted).toBe(true);
    expect(resolveTrust).toHaveBeenCalledWith({ cwd: "/work", extensionsResult: { marker: true } });
  });

  it("omits extensionsResult rather than passing undefined through", async () => {
    const resolveTrust = vi.fn(async () => false);
    const options = buildRockySessionOptions({ ...base, resolveTrust });
    await options.resourceLoaderReloadOptions.resolveProjectTrust({});
    expect(resolveTrust).toHaveBeenCalledWith({ cwd: "/work" });
  });

  it("restores the creation mask through the private-storage extension", () => {
    const restoreCreationMask = vi.fn();
    const options = buildRockySessionOptions({ ...base, restoreCreationMask });
    expect(options.resourceLoaderOptions.extensionFactories[0]?.name).toBe("rocky-private-session-storage");
    expect(restoreCreationMask).not.toHaveBeenCalled();
  });
});
