import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolResult } from "../../../src/tools/registry.js"

const mocks = vi.hoisted(() => ({
  initializePicnicClient: vi.fn(),
  sendRequest: vi.fn(),
  verifyPicnic2FACode: vi.fn(),
}))

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({
    sendRequest: mocks.sendRequest,
  }),
  initializePicnicClient: mocks.initializePicnicClient,
  saveSession: vi.fn(),
  verifyPicnic2FACode: mocks.verifyPicnic2FACode,
}))

function parseToolResult(result: ToolResult) {
  return JSON.parse(result.content[0].text ?? "")
}

function promoTile({
  productId,
  promotionId,
  name,
  label,
  price,
  originalPrice,
  targeted = false,
  promoBox = false,
}: {
  productId: string
  promotionId: string
  name: string
  label: string
  price: number
  originalPrice?: number
  targeted?: boolean
  promoBox?: boolean
}) {
  return {
    type: "PML",
    id: `selling-unit-${productId}-tile${promoBox ? "-PromoBox" : ""}`,
    analytics: {
      contexts: [
        {
          data: { product_id: productId },
          schema: "iglu:tech.picnic.snowplow.analytics/product/jsonschema/1-0-0",
        },
        {
          data: {
            promotion_id: promotionId,
            promotion_label: label,
            price,
            ...(originalPrice !== undefined && {
              strikethrough_price: originalPrice,
              show_strikethrough_price: true,
            }),
          },
          schema: "iglu:tech.picnic.snowplow.analytics/promotion/jsonschema/1-1-0",
        },
        ...(targeted
          ? [
              {
                data: { campaign_name: "campaign-id" },
                schema: "iglu:tech.picnic.snowplow.analytics/targeted_campaign/jsonschema/1-1-0",
              },
            ]
          : []),
      ],
    },
    content: {
      type: "SELLING_UNIT_TILE",
      sellingUnit: {
        id: productId,
        display_price: price,
        image_id: `image-${productId}`,
        max_count: 12,
        name,
        unit_quantity: "1 stuk",
      },
    },
  }
}

function regularTile() {
  return {
    type: "PML",
    id: "selling-unit-s999-tile",
    analytics: { contexts: [{ data: { product_id: "s999" } }] },
    content: {
      type: "SELLING_UNIT_TILE",
      sellingUnit: {
        id: "s999",
        display_price: 399,
        name: "Regular product",
        unit_quantity: "1 stuk",
      },
    },
  }
}

async function loadTools() {
  vi.resetModules()
  const { toolRegistry } = await import("../../../src/tools/registry.js")
  await import("../../../src/tools/picnic-tools.js")
  return toolRegistry
}

describe("promotions tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches weekly Picnic promotions from the current promotions page", async () => {
    const firstTile = promoTile({
      productId: "s100",
      promotionId: "promo-1",
      name: "Discount tomatoes",
      label: "nu €1.99",
      price: 199,
      originalPrice: 249,
    })
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: {
          children: [
            firstTile,
            regularTile(),
            [
              promoTile({
                productId: "s200",
                promotionId: "promo-2",
                name: "Bonus pasta",
                label: "1+1 gratis",
                price: 239,
              }),
              firstTile,
            ],
          ],
        },
      },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {})
    const payload = parseToolResult(result)

    expect(mocks.sendRequest).toHaveBeenCalledWith("GET", "/pages/promo-page-root", null, true)
    expect(payload.promotions).toEqual([
      {
        product_id: "s100",
        promotion_id: "promo-1",
        name: "Discount tomatoes",
        price: 199,
        unit: "1 stuk",
        promotion_label: "nu €1.99",
        original_price: 249,
        image_id: "image-s100",
        max_count: 12,
      },
      {
        product_id: "s200",
        promotion_id: "promo-2",
        name: "Bonus pasta",
        price: 239,
        unit: "1 stuk",
        promotion_label: "1+1 gratis",
        image_id: "image-s200",
        max_count: 12,
      },
    ])
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 25,
      returned: 2,
      total: 2,
      hasMore: false,
    })
  })

  it("paginates promotions after deduplicating repeated tiles", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: [
          promoTile({
            productId: "s100",
            promotionId: "promo-1",
            name: "Discount tomatoes",
            label: "nu €1.99",
            price: 199,
          }),
          promoTile({
            productId: "s200",
            promotionId: "promo-2",
            name: "Bonus pasta",
            label: "1+1 gratis",
            price: 239,
          }),
          promoTile({
            productId: "s300",
            promotionId: "promo-3",
            name: "Deal soap",
            label: "2 voor €5",
            price: 279,
          }),
        ],
      },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {
      offset: 1,
      limit: 1,
    })
    const payload = parseToolResult(result)

    expect(payload.promotions).toEqual([
      expect.objectContaining({
        product_id: "s200",
        promotion_id: "promo-2",
      }),
    ])
    expect(payload.pagination).toEqual({
      offset: 1,
      limit: 1,
      returned: 1,
      total: 3,
      hasMore: true,
    })
  })

  it("exposes Family benefits and signals from a nested Picnic page", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: {
          children: [
            {
              id: "family-benefits-card",
              content: {
                children: [
                  { markdown: "Picnic Family" },
                  { markdown: "10% auf Obst und Gemüse" },
                  { markdown: "10% auf Markthalle" },
                  { markdown: "2x more Wunsch-Rabatt choices" },
                  { markdown: "Reservierbare Lieferfenster" },
                ],
              },
            },
          ],
        },
      },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_family_benefits", {})
    const payload = parseToolResult(result)

    expect(mocks.sendRequest).toHaveBeenCalledWith("GET", "/pages/promo-page-root", null, true)
    expect(payload).toEqual({
      source: {
        pageId: "promo-page-root",
        endpoint: "/pages/promo-page-root",
      },
      benefits: [
        { id: "produce", description: "10% off fruit and vegetables" },
        { id: "markthalle", description: "10% off Markthalle" },
        { id: "wunsch_rabatt", description: "2x more Wunsch-Rabatt choices" },
        { id: "delivery_windows", description: "Up to 3x as many delivery windows" },
        { id: "reservable_windows", description: "Reservable delivery windows" },
      ],
      account_evidence: {
        status: "family_data_exposed",
        signals: [
          "family-benefits-card",
          "Picnic Family",
          "10% auf Markthalle",
          "2x more Wunsch-Rabatt choices",
          "Reservierbare Lieferfenster",
        ],
      },
    })
  })

  it("does not claim Family data is exposed when the page has no Family signals", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: { body: { children: [{ markdown: "Angebote der Woche" }, regularTile()] } },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_family_benefits", {})
    const payload = parseToolResult(result)

    expect(payload.account_evidence).toEqual({
      status: "not_exposed",
      signals: [],
    })
  })

  it("lists only live-shaped PromoBox targeted-campaign tiles", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: {
          children: [
            {
              children: [
                promoTile({
                  productId: "s-wunsch-1",
                  promotionId: "choice-1",
                  name: "Chosen coffee",
                  label: "20% Rabatt",
                  price: 399,
                  originalPrice: 499,
                  targeted: true,
                  promoBox: true,
                }),
              ],
            },
            promoTile({
              productId: "s-weekly-1",
              promotionId: "weekly-1",
              name: "Weekly pasta",
              label: "1+1 gratis",
              price: 239,
            }),
          ],
        },
      },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_list_wunsch_rabatt_choices", {})
    const payload = parseToolResult(result)

    expect(payload.choices).toEqual([
      expect.objectContaining({
        product_id: "s-wunsch-1",
        promotion_id: "choice-1",
        price: 399,
      }),
    ])
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 25,
      returned: 1,
      total: 1,
      hasMore: false,
    })
    expect(payload.activation).toEqual({
      mode: "unavailable",
      selection_tool_available: false,
      limitation:
        "Cart additions can change Picnic's isExplicitlyActivated/remainingActivations fields without applying the displayed discount to cart prices. The exposed PromoBox refresh is read-only, and no verified selection action is available.",
    })
  })

  it("exposes PromoBox counters without treating them as selection or savings proof", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: {
        id: "targeted-promo",
        body: {
          child: {
            children: [
              {
                onMount: {
                  callback: {
                    props: {
                      v0: {
                        availablePromoIDs: {
                          "choice-1": { isExplicitlyActivated: true },
                          "choice-2": { isExplicitlyActivated: false },
                        },
                        remainingActivations: 2,
                      },
                    },
                  },
                },
              },
              promoTile({
                productId: "s-choice-1",
                promotionId: "choice-1",
                name: "Personal tomatoes",
                label: "20% Rabatt",
                price: 180,
                originalPrice: 225,
                targeted: true,
                promoBox: true,
              }),
              promoTile({
                productId: "s-targeted-weekly-1",
                promotionId: "targeted-weekly-1",
                name: "Targeted weekly pasta",
                label: "20% Rabatt",
                price: 160,
                originalPrice: 200,
                targeted: true,
              }),
              promoTile({
                productId: "s-weekly-1",
                promotionId: "weekly-1",
                name: "Weekly pasta",
                label: "1+1 gratis",
                price: 239,
              }),
            ],
          },
        },
      },
    })

    const toolRegistry = await loadTools()
    const choices = parseToolResult(
      await toolRegistry.executeTool("picnic_list_wunsch_rabatt_choices", {}),
    )
    const family = parseToolResult(await toolRegistry.executeTool("picnic_get_family_benefits", {}))

    expect(choices.choices).toEqual([
      expect.objectContaining({ product_id: "s-choice-1", promotion_id: "choice-1" }),
    ])
    expect(choices.promo_box_state).toEqual({
      available_promotions_total: 2,
      server_reported_remaining_activations: 2,
      server_reported_explicit_activations: 1,
      verification: "not_proof_of_selection_or_savings",
    })
    expect(family.promo_box_state).toEqual(choices.promo_box_state)
  })

  it("does not expose an activation path when PromoBox cards remain unselected", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: {
          children: [
            {
              availablePromoIDs: { "choice-1": { isExplicitlyActivated: false } },
              remainingActivations: 10,
            },
            promoTile({
              productId: "s1021587",
              promotionId: "choice-1",
              name: "Paprika Mix",
              label: "20% Rabatt",
              price: 183,
              originalPrice: 229,
              targeted: true,
              promoBox: true,
            }),
          ],
        },
      },
    })

    const toolRegistry = await loadTools()
    const payload = parseToolResult(
      await toolRegistry.executeTool("picnic_list_wunsch_rabatt_choices", {}),
    )

    expect(payload.activation).toEqual({
      mode: "unavailable",
      selection_tool_available: false,
      limitation:
        "Cart additions can change Picnic's isExplicitlyActivated/remainingActivations fields without applying the displayed discount to cart prices. The exposed PromoBox refresh is read-only, and no verified selection action is available.",
    })
    expect(
      toolRegistry.getToolsList().some((tool) => tool.name === "picnic_activate_wunsch_rabatt"),
    ).toBe(false)
  })
})
