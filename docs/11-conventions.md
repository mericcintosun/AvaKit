# 11 — Project Conventions (binding rules)

> These rules are **binding** for the entire AvaKit codebase. They override any conflicting guidance elsewhere in the docs. When a spec and this file disagree, this file wins until explicitly changed.

## 1. Language

- **All project artifacts are in English**: code, comments, identifiers, file names, commit messages, PR descriptions, README, and shipped documentation.
- The planning docs in this `docs/` folder were drafted in Turkish for alignment; everything produced from the implementation phase onward is English.
- (Out of band: conversation with the project owner happens in Turkish, but nothing written into the repo is Turkish.)

## 2. UI library — shadcn/ui ONLY

- The **only** component library is **shadcn/ui** (Radix primitives + Tailwind).
- No other UI kit: no MUI, Chakra, Mantine, Ant, and **not** Ava Labs BuilderKit's UI components.
- Avalanche-specific components (e.g. `<ConnectAvalanche>`, chain selector) are **built on shadcn primitives**, not imported from another UI library.
- BuilderKit may only be consulted for reference or used for non-UI logic if ever needed — never for rendered UI. (See updated [ADR-003](04-adr.md).)

## 3. Animation

- Animations use **Framer Motion** or **GSAP**. No other animation library.
- Prefer Framer Motion for component-level/React-idiomatic motion; reach for GSAP for complex timelines.

## 4. Color & theming

- Until the product is complete (**all three milestones M1–M3 done**), use **black and white only**. No accent/brand colors yet.
- **Dark/light theme is wired from day one** (via `next-themes` + Tailwind `dark` variant + CSS variables). Every screen must work in both themes.
- Color is added **last**, after M3, on top of the already-themed black/white foundation. Design with theme tokens so colorizing later is a token swap, not a refactor.

## 5. Design quality

- Target a **2026-modern, professional devtools aesthetic**: clean typography, generous spacing, crisp borders, subtle motion, keyboard-friendly, accessible (Radix gives a11y for free).
- Reference bar: the polish level of tools like Vercel/shadcn dashboards, Linear, Resend — minus color, for now.

## 6. Versions

- Use the **latest stable** version of every frontend technology. Examples (as of planning): **Next.js 16**, **React 19**, **Tailwind CSS v4**, latest shadcn/ui, latest `next-themes`.
- Pin exact versions in lockfiles; document the chosen versions in `package.json`. Revisit "latest stable" at implementation time — do not assume these numbers are still current.

## Consequences for existing specs

- [ADR-003](04-adr.md) frontend stack: Tailwind stays (shadcn is built on it), **BuilderKit is demoted** from "wrapped UI" to "not used for UI."
- [07 — Wallet Widget](07-spec-wallet-widget.md): `<ConnectAvalanche>` and `<ChainSelector>` are **shadcn-based**, not BuilderKit-based.
- [08 — Scaffolder](08-spec-scaffolder.md): generated templates ship shadcn + next-themes + black/white tokens by default.

## Checklist for any new UI work

- [ ] Built with shadcn/ui primitives only
- [ ] Works in both dark and light theme
- [ ] Black & white only (no color)
- [ ] Animations via Framer Motion / GSAP only
- [ ] Latest stable versions
- [ ] English throughout
