<script lang="ts">
    import { onDestroy, tick } from "svelte"
    import type { Styles } from "../../../../types/Settings"
    import type { OutBackground, Transition, TransitionData } from "../../../../types/Show"
    import { easings } from "../../../utils/transitions"
    import { clone } from "../../helpers/array"
    import BackgroundMedia from "./BackgroundMedia.svelte"

    export let data: OutBackground
    export let outputId: string
    export let transition: Transition
    export let currentStyle: Styles | null = null
    export let slideFilter = ""

    export let ratio = 1

    export let animationStyle = ""
    export let mirror = false

    $: duration = transition.duration ?? 800
    $: noTransition = transition.type === "none" || !duration
    $: style = `height: 100%;zoom: ${1 / ratio};transition: filter ${duration}ms, backdrop-filter ${duration}ms;${slideFilter}`

    let firstActive = true
    let background1: any = null
    let background2: any = null
    let firstFadingOut = false
    let currentlyLoadingFirst = false

    // WIP changing media while another transitions is not smooth
    // WIP changing quicly between media might make it not receive updates

    let loading = false
    let timeout: NodeJS.Timeout | null = null
    let tooRapid: NodeJS.Timeout | null = null
    let tryAgain = false

    // crossfade (dissolve): both layers are animated together and blended additively, so there is no dip in between
    let pendingDissolve: TransitionData | null = null
    let dissolveQueued = false
    let dissolving = false
    let destroyed = false
    let firstLayer: HTMLDivElement
    let secondLayer: HTMLDivElement
    let animations: Animation[] = []
    const instantTransition = { type: "none", duration: 0, easing: "linear" } as const

    onDestroy(() => {
        destroyed = true
        if (timeout) clearTimeout(timeout)
        if (tooRapid) clearTimeout(tooRapid)
        animations.forEach((animation) => animation.cancel())
    })

    $: if (data) createBackground()
    function createBackground() {
        // wait for the running dissolve to finish, then show the latest data
        if (pendingDissolve || dissolving) {
            dissolveQueued = true
            return
        }

        // prevent svelte bug creating multiple items if creating new while old clears
        if (tooRapid) {
            tryAgain = true
            return
        }
        tooRapid = setTimeout(() => {
            tooRapid = null
            if (tryAgain) createBackground()
            tryAgain = false
        }, duration / 2)

        if (timeout) {
            clearTimeout(timeout)
            firstActive = !background2?.path
        }
        if (loading) loading = false

        // clearing
        if (!data.path && !data.id) {
            background1 = null
            background2 = null
            return
        }

        let newData = clone(data)

        // update existing background, if same
        let activeId = firstActive ? background1?.path || background1?.id : background2?.path || background2?.id
        if (activeId === (data.path || data.id)) {
            if (firstActive) {
                background1 = newData
                transition1 = clone(transition)
            } else {
                background2 = newData
                transition2 = clone(transition)
            }
            return
        }

        // Online player videos (YouTube/Vimeo) should not have dual overlapping iframes during transitions
        const isPlayer = newData?.type === "player" || background1?.type === "player" || background2?.type === "player"
        if (isPlayer) {
            background1 = newData
            background2 = null
            transition1 = clone(transition)
            firstActive = true
            loading = false
            return
        }

        const isCrossfade = (transition.in || transition).type === "crossfade"
        const hasActiveBg = !!(background1 || background2)
        const mountDelay = hasActiveBg && !isCrossfade ? duration / 4 + 20 : 0
        timeout = setTimeout(() => {
            loading = true
            let loadingFirst = !background1 // && background2?.path ? background2?.path !== data.path : background2?.id !== data.id
            currentlyLoadingFirst = loadingFirst

            const previous = loadingFirst ? background2 : background1
            const incoming = transition.in || transition
            const outgoing = transition.out || transition
            const canDissolve = previous && incoming.type === "crossfade" && outgoing.type === "crossfade" && Number.isFinite(incoming.duration) && incoming.duration > 0 && incoming.duration === outgoing.duration && incoming.easing === outgoing.easing
            pendingDissolve = canDissolve ? clone(incoming) : null
            if (!pendingDissolve) firstFadingOut = !loadingFirst
            // the dissolve animates the layer itself, so the inner media must appear at once
            const nextTransition = pendingDissolve ? { ...clone(transition), in: instantTransition } : clone(transition)

            if (loadingFirst) {
                background1 = newData
                transition1 = nextTransition
            } else {
                background2 = newData
                transition2 = nextTransition
            }

            // max loading time fallback
            const maxLoadTimeout = Math.max(2000, duration)
            timeout = setTimeout(() => {
                if (loading) loaded(loadingFirst)
            }, maxLoadTimeout)
        }, mountDelay)
    }

    function loaded(isFirst: boolean) {
        if (!loading || currentlyLoadingFirst !== isFirst) return // media loaded, but probably fading out

        loading = false
        if (pendingDissolve) {
            const options = pendingDissolve
            pendingDissolve = null
            if (timeout) clearTimeout(timeout)
            timeout = null
            dissolve(isFirst, options)
            return
        }
        firstActive = isFirst

        // allow firstActive to trigger first
        timeout = setTimeout(() => {
            if (isFirst) {
                background2 = null
            } else {
                background1 = null
            }
            timeout = null
        })
    }

    function dissolve(isFirst: boolean, options: TransitionData) {
        const incoming = isFirst ? firstLayer : secondLayer
        const outgoing = isFirst ? secondLayer : firstLayer
        const length = options.duration
        const easing = easings.find(({ value }) => value === options.easing)?.function || ((value: number) => value)
        const opacity = (time: number) => Math.min(1, Math.max(0, easing(time)))

        dissolving = true
        firstFadingOut = !isFirst
        firstActive = isFirst

        // opacity-only Web Animations run on the compositor (GPU); keyframes are sampled so any easing curve can be used
        const steps = Math.min(1200, Math.ceil(length / 16.67))
        const frames = Array.from({ length: steps + 1 }, (_, index) => opacity(index / steps))
        animations = [
            incoming.animate(
                frames.map((value) => ({ opacity: value })),
                { duration: length, fill: "both" }
            ),
            outgoing.animate(
                frames.map((value) => ({ opacity: 1 - value })),
                { duration: length, fill: "both" }
            )
        ]
        void Promise.all(animations.map((animation) => animation.finished)).then(finish, () => {})

        function finish() {
            if (destroyed) return
            outgoing.style.visibility = "hidden"
            animations.forEach((animation) => animation.cancel())
            animations = []
            if (isFirst) background2 = null
            else background1 = null

            // remove the retired layer while its inner outro is still suppressed
            void tick().then(() => {
                if (destroyed) return
                dissolving = false
                incoming.style.visibility = ""
                if (dissolveQueued) {
                    dissolveQueued = false
                    createBackground()
                }
            })
        }
    }

    // don't remove data when clearing
    let background1Data: OutBackground = {}
    let background2Data: OutBackground = {}
    $: if (background1) background1Data = clone(background1)
    $: if (background2) background2Data = clone(background2)

    let transition1 = transition
    let transition2 = transition

    // don't "refresh" animation when chaning slide
    let animation1 = ""
    let animation2 = ""
    $: updateAnimation(animationStyle)
    function updateAnimation(animation) {
        setTimeout(
            () => {
                if (background1 && !(loading && !firstActive)) animation1 = animation
                else animation2 = animation
            },
            duration / 4 + 60
        )
    }
</script>

<div class="media" class:dissolving {style}>
    {#if background1}
        <div class="media layer" bind:this={firstLayer} class:hidden={!firstActive && (loading || noTransition)}>
            <BackgroundMedia data={background1Data} fadingOut={firstFadingOut} suppressOutro={dissolving && !firstActive} {outputId} transition={transition1} {currentStyle} animationStyle={animation1} {mirror} on:loaded={() => loaded(true)} />
        </div>
    {/if}
    {#if background2}
        <div class="media layer" bind:this={secondLayer} class:hidden={firstActive && (loading || noTransition)}>
            <BackgroundMedia data={background2Data} fadingOut={!firstFadingOut} suppressOutro={dissolving && firstActive} {outputId} transition={transition2} {currentStyle} animationStyle={animation2} {mirror} on:loaded={() => loaded(false)} />
        </div>
    {/if}
</div>

<style>
    .dissolving {
        isolation: isolate;
    }
    .dissolving > .layer {
        mix-blend-mode: plus-lighter;
    }

    .hidden {
        opacity: 0;
    }

    .media {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        height: 100%;
        transform: translate(-50%, -50%);
    }
</style>
