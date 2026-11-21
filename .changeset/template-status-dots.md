---
"create-avalanche-app": patch
---

The status dots in the `icm-messenger`, `l1-launch` and `token-bridge` apps no longer pulse with CSS animations, in line with AvaKit's rule that animations use Framer Motion or GSAP and that `tw-animate-css` is only for shadcn/ui's own enter and exit animations.
