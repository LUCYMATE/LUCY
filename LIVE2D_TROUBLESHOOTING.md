# LUCY Live2D crash / white-screen notes

This file records the Live2D investigation and what to check if the avatar crashes or stays blank again.

## What was found

The strongest code-level cause for a development-only blank Live2D view is the interaction between React Strict Mode and Pixi's WebGL lifecycle:

1. The app root is wrapped in React `<StrictMode>` in `src/main.tsx`.
2. React intentionally runs an extra effect setup/cleanup cycle in development.
3. `src/components/avatar/Live2DViewer.tsx` creates a Pixi renderer using a canvas, then its effect cleanup immediately stops and destroys that renderer.
4. During Strict Mode's replay, the effect tries to create a renderer again using the same canvas. If WebGL cannot be reinitialized cleanly, the avatar can remain blank or fail during startup.

The Live2D effect was changed to reuse the renderer during Strict Mode's immediate replay and defer actual destruction by one microtask. It also now shows the WebGL initialization error and stops the loading spinner if Pixi cannot initialize.

This is a strong source-level cause for development-mode instability, but it is **not confirmed as the trigger for a particular crash** because no console stack from the failing run was available.

## Asset check

The six selectable model manifests (`icy`, `rozen`, `shiroko`, `maya`, `friday`, and `venom`) and their referenced model, texture, physics, motion, and expression files were present during the static check. `public/live2d/core/live2dcubismcore.min.js` is also present and included by `index.html`.

## If the avatar is still blank

1. Run the app manually in dev mode, switch to Live2D, and wait for the failure.
2. Open the app's developer console and copy the first error plus its stack. Look for messages beginning with `[Live2DViewer]` or `[AvatarErrorBoundary]`, and any `WebGL context lost` or `WebGLRenderer` message.
3. Interpret the first error:
   - `Failed to load model` or a `404` for `*.model3.json`: the saved model selection or asset path is wrong. Reset `lucy_live2d_model` in the app's local storage to `rozen` and retry.
   - `Live2D Cubism Core` missing/undefined: check that `/live2d/core/live2dcubismcore.min.js` loads before the app bundle.
   - `WebGL context lost`, `context creation failed`, or a shader compile error: the GPU/WebView2 renderer or the custom `BatchRenderer.contextChange` override is implicated. Record the full GPU/shader error before changing graphics code.
   - `AvatarErrorBoundary` with a React component stack: the first stack frame identifies the component that threw; use its copied error details.
4. Send the complete first error and stack. A blank canvas alone does not identify whether the failure is WebGL, a model asset, or a React exception.

## Known caution

`Live2DViewer.tsx` replaces Pixi's global `BatchRenderer.contextChange` method to work around GPU shader limits. This is nonstandard and could cause failures on particular GPUs or after WebGL context loss. It remains a suspect, not a confirmed cause, until the runtime stack points to it.

## Verification status

The project was inspected statically and the model-file references were checked. The app was not launched and no build was run, so the lifecycle change still needs a manual dev-mode check.
