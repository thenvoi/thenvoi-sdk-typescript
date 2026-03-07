import { describe, expect, it } from "vitest";

import { createPrimaryCtaEvent, FEATURED_DOGS, PAGE_ID, renderFeaturedDogs } from "../examples/dog-landing-page/page.mjs";

describe("dog landing page example", () => {
  it("renders featured dogs from static mock data", () => {
    const html = renderFeaturedDogs(FEATURED_DOGS);

    expect(FEATURED_DOGS).toHaveLength(3);
    expect(html).toContain("Milo");
    expect(html).toContain("Luna");
    expect(html).toContain("Daisy");
    expect(html).toContain("role=\"listitem\"");
    expect(html).toContain("loading=\"lazy\"");
  });

  it("creates CTA analytics payload with page and cta identifier", () => {
    const event = createPrimaryCtaEvent(PAGE_ID, "hero-start-adoption");

    expect(event).toEqual({
      event: "primary_cta_click",
      page: "dog-landing-page",
      ctaId: "hero-start-adoption",
    });
  });
});

