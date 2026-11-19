/**
 * The copy-paste snippet the /avatar page offers for embedding a mascot on
 * another site. It has to work there on its own: the model and poster URLs are
 * absolute on the site's origin (a relative "/3d/fox.glb" resolves against the
 * other site and 404s), and it brings the <model-viewer> script it depends on.
 * The .glb files are fetched cross-origin, so next.config.ts sends
 * `Access-Control-Allow-Origin: *` on /3d/*.
 *
 * This module imports nothing, so test/embed-snippet.test.mjs can load it with
 * plain Node.
 */

/**
 * The @google/model-viewer version the page itself loads. Keep it equal to
 * the version in package.json (the test checks): the snippet pins the same one.
 */
export const MODEL_VIEWER_VERSION = "4.4.0";

/** The standalone ES module build (three.js bundled in), from the npm package via jsDelivr. */
export const MODEL_VIEWER_SCRIPT = `https://cdn.jsdelivr.net/npm/@google/model-viewer@${MODEL_VIEWER_VERSION}/dist/model-viewer.min.js`;

export interface EmbeddableModel {
  /** Site-relative path of the .glb, e.g. "/3d/fox.glb". */
  src: string;
  /** Site-relative path of the poster image. */
  poster: string;
  /** The baked animation clip to play. */
  clip: string;
  title: string;
}

/** `origin` is the site's canonical origin, e.g. "https://avakit.dev". */
export function embedSnippet(model: EmbeddableModel, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `<script type="module" src="${MODEL_VIEWER_SCRIPT}"></script>
<model-viewer
  src="${base}${model.src}"
  poster="${base}${model.poster}"
  autoplay animation-name="${model.clip}"
  camera-controls environment-image="neutral"
  shadow-intensity="0" exposure="1"
  alt="${model.title}">
</model-viewer>`;
}
