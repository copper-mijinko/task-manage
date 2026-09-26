import { render } from "@testing-library/svelte";
import { writable } from "svelte/store";
import ApplicationStubHarness from "./ApplicationStubHarness.svelte";

/** 行やセルの描画に要る最小限のアプリケーション。 */
export function applicationStub(overrides = {}) {
  return {
    tree: writable(undefined),
    copied: writable([]),
    isProtected: () => false,
    ...overrides,
  };
}

/** スタブのアプリケーションの下でコンポーネントを描く。 */
export function renderWithApplicationStub(component, props = {}, application = applicationStub()) {
  return render(ApplicationStubHarness, { props: { component, props, application } });
}
