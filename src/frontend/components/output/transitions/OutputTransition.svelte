<script lang="ts">
    import type { Transition } from "../../../../types/Show"
    import { custom } from "../../../utils/transitions"

    export let blend = false
    export let transition: Transition | undefined = undefined
    export let inTransition: Transition | null = null
    export let outTransition: Transition | null = null

    // toggled on the node directly: an outroing branch no longer applies reactive class updates
    function setBlend(node: EventTarget | null, animating: boolean) {
        ;(node as HTMLElement | null)?.classList.toggle("blend", animating && blend && (inTransition?.type === "crossfade" || outTransition?.type === "crossfade"))
    }

    $: disableTransition = (inTransition?.type || transition?.type) === "none" || (!inTransition?.duration && !transition?.duration)
</script>

<!-- svelte transition bug!!! -->
{#if disableTransition && !inTransition && !outTransition}
    <div class="transitioner">
        <slot />
    </div>
{:else}
    <!-- blend only while animating: mix-blend-mode makes a backdrop root, so backdrop-filter would stop seeing the background -->
    <div class="transitioner" in:custom={inTransition || transition || {}} out:custom={outTransition || transition || {}} on:introstart={(e) => setBlend(e.currentTarget, true)} on:introend={(e) => setBlend(e.currentTarget, false)} on:outrostart={(e) => setBlend(e.currentTarget, true)} on:outrostart>
        <slot />
    </div>
{/if}

<style>
    .transitioner:global(.blend) {
        mix-blend-mode: plus-lighter;
    }

    div {
        width: 100%;
        height: 100%;

        position: absolute;
        top: 0;
        left: 0;

        pointer-events: none;
    }
</style>
