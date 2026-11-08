import { get } from "svelte/store"
import { describe, expect, it } from "vitest"
import { transitionData } from "../stores"
import { updateTransition } from "./transitions"

describe("updateTransition (API input)", () => {
    it("keeps valid values", () => {
        updateTransition({ id: "media", type: "crossfade", duration: 1200, easing: "linear" })
        expect(get(transitionData).media).toEqual({ type: "crossfade", duration: 1200, easing: "linear" })
    })

    it("falls back on unknown type, easing, id and a non-numeric or negative duration", () => {
        updateTransition({ id: "bogus" as any, type: "explode" as any, duration: "abc" as any, easing: "wobble" })
        expect(get(transitionData).text).toEqual({ type: "fade", duration: 500, easing: "sine" })
        expect(get(transitionData)).not.toHaveProperty("bogus")

        updateTransition({ duration: -5 })
        expect(get(transitionData).text.duration).toBe(500)
        updateTransition({ duration: "800" as any })
        expect(get(transitionData).text.duration).toBe(800)
    })
})
