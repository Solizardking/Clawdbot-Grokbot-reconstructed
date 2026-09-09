# Clawd Bot brand artwork

Clawd Bot uses the existing violet lobster artwork below. These images were generated with the built-in imagegen tool; their original prompts are retained for reproducibility. Run commands from the Clawd Bot repository root.

Vite copies this directory to `dist-ui/brand/` during `npm run build:ui`. Edit these source assets rather than generated output.

Production sources:

- `clawd-icon.png`: master for web and native icons. Rebuild with `npm run icons` on macOS.
- `clawd-poses.png`: regenerated first reference, 3×3 pose atlas.
- `clawd-activities.png`: regenerated second reference, 3×3 activity atlas.

ClawdSprite maps bot states to cells. These are state illustrations, not frame-by-frame animation. Explicit legacy expression previews retain the vector renderer; uploaded avatars remain supported.

## Prompts

### Icon
Use case: logo-brand. Create a professional app icon for Clawd Bot, inspired by the purple lobster mascot in the reference. Single centered symmetrical lobster head and two raised claws, refined bold sculpted shapes, rich violet with restrained magenta edge highlights and a single clean amber glass visor. No lettering on visor, no text anywhere, no pixels, no tiny legs or noisy detail. Premium minimal 3D product-brand finish with soft satin material, excellent recognition at 32px. Full bleed square deep midnight plum background, no rounded outer frame, generous safe margins, strong silhouette. 1024x1024 square. Reference is identity inspiration, do not reproduce the sprite grid.

### Poses
Use case: stylized-concept. Regenerate reference image 1 as a much more professional mascot pose atlas for Clawd Bot. Reference image 2 is the approved new icon: match its smooth sculpted violet lobster, magenta highlights and clean amber visor without lettering. EXACTLY 3 columns by 3 rows, nine evenly sized square cells in a square canvas, one whole small full-body lobster centered in each cell with generous margins. Row 1: neutral facing front, greeting with raised claw, cheerful both claws raised. Row 2: thinking claw near chin, working on small dark laptop, examining a small tablet. Row 3: attentive slight lean, celebrating, resting. Consistent character proportions, camera and scale. Refined stylized 3D, soft satin finish, clean silhouettes. Uniform solid midnight plum background #160624 across every cell, no borders, no labels, no text, no checkerboard, no extra characters. Keep every character entirely within its cell. Designed for CSS 3x3 sprite cropping.

### Activities
Use case: stylized-concept. Regenerate reference image 1 as professional Clawd Bot activity mascot atlas, matching reference image 2's new premium violet sculpted lobster and amber glass visor exactly. EXACTLY 3 columns x 3 rows in square image, equal square cells, one complete character centered within each cell, generous safe margins, consistent scale and front camera. Row 1: walking turned slightly left, walking turned slightly right, arriving with claw waving. Row 2: sleepy crouched with lowered antennae, alert both claws raised, puzzled claw at chin. Row 3: busy typing on dark laptop, checking small tablet, triumphant raised claws. Soft satin violet, magenta edge accents, amber visor without text, clean simplified forms, polished 3D mascot. Uniform solid midnight plum #160624 background, no ground shadows extending outside cells, no grid lines, no labels, no text, no checkerboard. Sprite atlas for CSS 3x3 cropping, not a collage.

